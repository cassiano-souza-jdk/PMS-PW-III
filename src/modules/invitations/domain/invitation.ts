import { ConflictError } from '@/shared/errors';
import {
  ORGANIZATION_ROLES,
  parseBrandedUuid,
  parseIsoDateTimeMs,
  type Brand,
  type IsoDateTime,
  type OrganizationRole,
  type OrganizationScoped,
  type UserId,
} from '@/shared/kernel';

export type InvitationId = Brand<string, 'InvitationId'>;

export function asInvitationId(value: string, fieldName = 'invitationId'): InvitationId {
  return parseBrandedUuid<'InvitationId'>(value, fieldName);
}

export const INVITATION_STATUSES = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[keyof typeof INVITATION_STATUSES];

/** Default invitation validity window (15 days — PRD.md §7.2). */
export const DEFAULT_INVITATION_EXPIRY_DAYS = 15;

/** Default initial role granted upon invitation acceptance (PRD.md §4 / permission-matrix.md §2). */
export const DEFAULT_INVITATION_INITIAL_ROLE: OrganizationRole = ORGANIZATION_ROLES.MEMBER;

export interface Invitation extends OrganizationScoped {
  readonly id: InvitationId;
  readonly email: string;
  readonly code: string;
  readonly tokenHashOrCode: string;
  readonly initialRole: OrganizationRole;
  readonly status: InvitationStatus;
  readonly invitedByUserId: UserId;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly acceptedAt?: IsoDateTime;
  readonly acceptedByUserId?: UserId;
  readonly revokedAt?: IsoDateTime;
  readonly revokedByUserId?: UserId;
}

export function deriveInvitationStatus(invitation: Invitation, now: IsoDateTime): InvitationStatus {
  if (invitation.status === INVITATION_STATUSES.REVOKED || invitation.revokedAt !== undefined) {
    return INVITATION_STATUSES.REVOKED;
  }

  if (invitation.status === INVITATION_STATUSES.ACCEPTED || invitation.acceptedAt !== undefined) {
    return INVITATION_STATUSES.ACCEPTED;
  }

  if (
    invitation.status === INVITATION_STATUSES.EXPIRED ||
    parseIsoDateTimeMs(now) >= parseIsoDateTimeMs(invitation.expiresAt)
  ) {
    return INVITATION_STATUSES.EXPIRED;
  }

  return INVITATION_STATUSES.PENDING;
}

/**
 * Ensures an invitation cannot be reused, accepted after expiration or accepted after revocation (PRD.md §7.2).
 */
export function assertInvitationCanBeAccepted(invitation: Invitation, now: IsoDateTime): void {
  const effectiveStatus = deriveInvitationStatus(invitation, now);

  if (effectiveStatus !== INVITATION_STATUSES.PENDING) {
    throw new ConflictError(
      `Invitation cannot be accepted because its status is "${effectiveStatus}".`,
      {
        details: {
          invitationId: invitation.id,
          status: effectiveStatus,
        },
      },
    );
  }
}
