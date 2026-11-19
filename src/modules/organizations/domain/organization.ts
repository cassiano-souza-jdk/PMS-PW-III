import { ConflictError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  parseBrandedUuid,
  type AuditableTimestamps,
  type Brand,
  type IsoDateTime,
  type MembershipStatus,
  type OrganizationId,
  type OrganizationRole,
  type OrganizationScoped,
  type SoftDeletable,
  type UserId,
} from '@/shared/kernel';

export type OrganizationMemberId = Brand<string, 'OrganizationMemberId'>;

export function asOrganizationMemberId(
  value: string,
  fieldName = 'organizationMemberId',
): OrganizationMemberId {
  return parseBrandedUuid<'OrganizationMemberId'>(value, fieldName);
}

export interface Organization extends AuditableTimestamps, SoftDeletable {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly isDemo: boolean;
  readonly createdByUserId: UserId;
  readonly archivedAt?: IsoDateTime;
}

export interface OrganizationMember extends OrganizationScoped {
  readonly id: OrganizationMemberId;
  readonly userId: UserId;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
  readonly joinedAt: IsoDateTime;
  readonly suspendedAt?: IsoDateTime;
  readonly removedAt?: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export function isActiveOrganizationAdmin(member: OrganizationMember): boolean {
  return member.status === MEMBERSHIP_STATUSES.ACTIVE && member.role === ORGANIZATION_ROLES.ADMIN;
}

/**
 * Prevents demoting, suspending or removing the last active ADMIN of an organization
 * without a safe transfer flow (permission-matrix.md §5.1).
 */
export function assertCanChangeOrRemoveAdmin(
  members: readonly OrganizationMember[],
  targetUserId: UserId,
): void {
  const targetMember = members.find((member) => member.userId === targetUserId);
  if (!targetMember || !isActiveOrganizationAdmin(targetMember)) {
    return;
  }

  const remainingActiveAdmins = members.filter(
    (member) => member.userId !== targetUserId && isActiveOrganizationAdmin(member),
  );

  if (remainingActiveAdmins.length === 0) {
    throw new ConflictError(
      'Cannot demote, suspend or remove the last active ADMIN of the organization.',
      {
        details: { targetUserId },
      },
    );
  }
}
