import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import {
  PERMISSION_CODES,
  assertAuthorized,
  type AuthorizationActor,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import {
  asOrganizationMemberId,
  type Organization,
  type OrganizationMember,
  type OrganizationMemberRepositoryPort,
  type OrganizationRepositoryPort,
} from '@/modules/organizations';
import { normalizeEmail, type UserRepositoryPort } from '@/modules/users';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  parseIsoDateTimeMs,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationRole,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  DEFAULT_INVITATION_EXPIRY_DAYS,
  DEFAULT_INVITATION_INITIAL_ROLE,
  INVITATION_ERROR_REASONS,
  INVITATION_STATUSES,
  asInvitationId,
  assertInvitationCanBeAccepted,
  deriveInvitationStatus,
  type Invitation,
  type InvitationId,
  type InvitationStatus,
} from '../../domain/invitation';
import type { InvitationRepositoryPort } from '../ports/invitation-repository.port';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const createInvitationInputSchema = z.object({
  email: z.string().trim().min(3).max(254),
  expiresInDays: z
    .number()
    .int()
    .min(1, 'Expiration must be at least 1 day.')
    .max(90, 'Expiration cannot exceed 90 days.')
    .optional()
    .default(DEFAULT_INVITATION_EXPIRY_DAYS),
  initialRole: z
    .enum([ORGANIZATION_ROLES.ADMIN, ORGANIZATION_ROLES.MANAGER, ORGANIZATION_ROLES.MEMBER])
    .optional()
    .default(DEFAULT_INVITATION_INITIAL_ROLE),
  correlationId: z.string().uuid().optional(),
});

export interface InvitationServiceDependencies {
  readonly invitations: InvitationRepositoryPort;
  readonly organizations: OrganizationRepositoryPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly users: UserRepositoryPort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface CreateInvitationInput {
  readonly email: string;
  readonly expiresInDays?: number;
  readonly initialRole?: OrganizationRole;
  readonly correlationId?: CorrelationId;
}

export interface CreateInvitationResult {
  readonly invitation: Invitation;
  readonly inviteLink: string;
}

export interface InvitationListItem extends Invitation {
  readonly derivedStatus: InvitationStatus;
  readonly inviteLink: string;
}

export interface InvitationPreview {
  readonly code: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly status: InvitationStatus;
  readonly initialRole: OrganizationRole;
  readonly expiresAt: IsoDateTime;
  readonly emailMatchesActor: boolean;
}

export interface AcceptInvitationResult {
  readonly invitation: Invitation;
  readonly membership: OrganizationMember;
  readonly organization: Organization;
}

export interface InvitationOperationOptions {
  readonly correlationId?: CorrelationId;
}

function defaultNowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

function defaultUuidGenerator(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

function parseWithZod<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  input: unknown,
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid invitation input payload.', {
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

function buildInviteLink(code: string): string {
  return `/invitations/accept?code=${encodeURIComponent(code)}`;
}

function generateInvitationCode(nextUuid: () => string): string {
  const raw = nextUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  return `PMS-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export class InvitationService {
  private readonly deps: InvitationServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: InvitationServiceDependencies) {
    this.deps = deps;
    this.now = deps.now ?? defaultNowIso;
    this.nextUuid = deps.generateUuid ?? defaultUuidGenerator;
  }

  private resolveCorrelationId(candidate?: string): CorrelationId {
    if (candidate && isUuid(candidate)) {
      return asCorrelationId(candidate);
    }
    return asCorrelationId(this.nextUuid());
  }

  private async buildAuthorizationActor(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<AuthorizationActor> {
    const [membership, grants, explicitDenies] = await Promise.all([
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
    ]);

    return {
      isAuthenticated: true,
      userId: actorUserId,
      ...(membership !== null
        ? {
            organizationMembership: {
              organizationId: membership.organizationId,
              role: membership.role,
              status: membership.status,
            },
          }
        : {}),
      grants,
      explicitDenies,
    };
  }

  async createInvitation(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateInvitationInput,
  ): Promise<CreateInvitationResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(createInvitationInputSchema, input);
    const normalizedEmail = normalizeEmail(parsed.email, 'email');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, organization] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.INVITATION_CREATE,
      resource: {
        kind: 'INVITATION',
        id: asEntityId(validatedOrgId),
        exists: organization !== null,
        organizationId: validatedOrgId,
        deletedAt: organization?.deletedAt,
        archivedAt: organization?.archivedAt,
      },
      context: { now },
    });

    if (!organization) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`, {
        details: { organizationId: validatedOrgId },
      });
    }

    const code = generateInvitationCode(this.nextUuid);
    const expiresAt = asIsoDateTime(
      new Date(parseIsoDateTimeMs(now) + parsed.expiresInDays * MS_PER_DAY).toISOString(),
    );

    const invitation: Invitation = {
      id: asInvitationId(this.nextUuid()),
      organizationId: validatedOrgId,
      email: normalizedEmail,
      code,
      tokenHashOrCode: code,
      initialRole: parsed.initialRole,
      status: INVITATION_STATUSES.PENDING,
      invitedByUserId: validatedActorId,
      createdAt: now,
      expiresAt,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.INVITATIONS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.invitations.save(invitation);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'invitation.created',
          resourceType: 'Invitation',
          resourceId: invitation.id,
          after: {
            email: invitation.email,
            initialRole: invitation.initialRole,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'invitation.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Invitation',
            aggregateId: invitation.id,
            payload: {
              invitationId: invitation.id,
              organizationId: validatedOrgId,
              initialRole: invitation.initialRole,
              expiresAt: invitation.expiresAt,
            },
          }),
        );
      },
    );

    this.deps.logger?.info('Organization invitation created.', {
      organizationId: validatedOrgId,
      invitationId: invitation.id,
      correlationId,
    });

    return Object.freeze({
      invitation,
      inviteLink: buildInviteLink(invitation.code),
    });
  }

  async listInvitations(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<readonly InvitationListItem[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const [actor, organization] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.INVITATION_CREATE,
      resource: {
        kind: 'INVITATION',
        id: asEntityId(validatedOrgId),
        exists: organization !== null,
        organizationId: validatedOrgId,
        deletedAt: organization?.deletedAt,
        archivedAt: organization?.archivedAt,
      },
      context: { now },
    });

    const invitations = await this.deps.invitations.listByOrganization(validatedOrgId);
    return invitations.map((invitation) => ({
      ...invitation,
      derivedStatus: deriveInvitationStatus(invitation, now),
      inviteLink: buildInviteLink(invitation.code),
    }));
  }

  async revokeInvitation(
    actorUserId: UserId,
    organizationId: OrganizationId,
    invitationId: InvitationId,
    options: InvitationOperationOptions = {},
  ): Promise<Invitation> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedInvitationId = asInvitationId(invitationId, 'invitationId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.invitations.findById(validatedOrgId, validatedInvitationId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.INVITATION_REVOKE,
      resource: {
        kind: 'INVITATION',
        id: asEntityId(validatedInvitationId),
        exists: existing !== null,
        organizationId: validatedOrgId,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Invitation "${validatedInvitationId}" was not found.`, {
        details: { organizationId: validatedOrgId, invitationId: validatedInvitationId },
      });
    }

    const currentStatus = deriveInvitationStatus(existing, now);
    if (currentStatus !== INVITATION_STATUSES.PENDING) {
      throw new ConflictError(
        `Invitation cannot be revoked because its status is "${currentStatus}".`,
        {
          details: { invitationId: validatedInvitationId, status: currentStatus },
        },
      );
    }

    const revokedInvitation: Invitation = {
      ...existing,
      status: INVITATION_STATUSES.REVOKED,
      revokedAt: now,
      revokedByUserId: validatedActorId,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.INVITATIONS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.invitations.save(revokedInvitation);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'invitation.revoked',
          resourceType: 'Invitation',
          resourceId: validatedInvitationId,
          before: { status: existing.status },
          after: { status: revokedInvitation.status, revokedAt: now },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'invitation.revoked',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Invitation',
            aggregateId: validatedInvitationId,
            payload: {
              invitationId: validatedInvitationId,
              organizationId: validatedOrgId,
            },
          }),
        );
      },
    );

    return revokedInvitation;
  }

  /**
   * Minimal non-sensitive preview of an invitation by code (ADR-0009 §2.2).
   */
  async previewInvitationByCode(actorUserId: UserId, code: string): Promise<InvitationPreview> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const trimmedCode = code.trim();
    if (trimmedCode.length === 0) {
      throw new ValidationError('Invitation "code" is required.', {
        details: { field: 'code' },
      });
    }

    const now = this.now();
    const [actor, invitation] = await Promise.all([
      this.deps.users.findById(validatedActorId),
      this.deps.invitations.findByCode(trimmedCode),
    ]);

    if (!actor || isSoftDeleted(actor)) {
      throw new NotFoundError(`User "${validatedActorId}" was not found.`, {
        details: { userId: validatedActorId },
      });
    }

    if (!invitation) {
      throw new NotFoundError('Invitation was not found.', {
        details: { code: trimmedCode },
      });
    }

    const organization = await this.deps.organizations.findById(invitation.organizationId);
    if (!organization || isSoftDeleted(organization)) {
      throw new NotFoundError('Target organization for this invitation was not found.');
    }

    return Object.freeze({
      code: invitation.code,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      status: deriveInvitationStatus(invitation, now),
      initialRole: invitation.initialRole,
      expiresAt: invitation.expiresAt,
      emailMatchesActor: normalizeEmail(actor.email) === normalizeEmail(invitation.email),
    });
  }

  /**
   * Accepts a nominal invitation strictly for the user whose normalized email matches
   * `invitation.email`, blocking hijacking and suspended-member bypass (ADR-0009 §2).
   */
  async acceptInvitation(
    actorUserId: UserId,
    code: string,
    options: InvitationOperationOptions = {},
  ): Promise<AcceptInvitationResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const trimmedCode = code.trim();
    if (trimmedCode.length === 0) {
      throw new ValidationError('Invitation "code" is required.', {
        details: { field: 'code' },
      });
    }

    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, invitation] = await Promise.all([
      this.deps.users.findById(validatedActorId),
      this.deps.invitations.findByCode(trimmedCode),
    ]);

    if (!actor || isSoftDeleted(actor)) {
      throw new NotFoundError(`User "${validatedActorId}" was not found.`, {
        details: { userId: validatedActorId },
      });
    }

    if (!invitation) {
      throw new NotFoundError('Invitation was not found.', {
        details: { code: trimmedCode },
      });
    }

    // ADR-0009 §2.1: Mandatory normalized email match
    if (normalizeEmail(actor.email) !== normalizeEmail(invitation.email)) {
      throw new AuthorizationError(
        'This invitation was issued for a different email address and cannot be accepted by the current account.',
        {
          details: {
            reason: INVITATION_ERROR_REASONS.EMAIL_MISMATCH,
            invitationId: invitation.id,
          },
        },
      );
    }

    const organization = await this.deps.organizations.findById(invitation.organizationId);
    if (!organization || isSoftDeleted(organization)) {
      throw new NotFoundError('Target organization for this invitation was not found.');
    }

    const existingMembership = await this.deps.organizationMembers.findByOrganizationAndUser(
      invitation.organizationId,
      validatedActorId,
    );

    // ADR-0009 §2.3: Protect pre-existing membership states
    if (existingMembership !== null) {
      if (existingMembership.status === MEMBERSHIP_STATUSES.ACTIVE) {
        throw new ConflictError('User is already an active member of this organization.', {
          details: {
            reason: INVITATION_ERROR_REASONS.MEMBER_ALREADY_ACTIVE,
            organizationId: invitation.organizationId,
          },
        });
      }

      if (existingMembership.status === MEMBERSHIP_STATUSES.SUSPENDED) {
        throw new AuthorizationError(
          'Suspended organization memberships cannot be bypassed by accepting a new invitation.',
          {
            details: {
              reason: INVITATION_ERROR_REASONS.MEMBER_SUSPENDED,
              organizationId: invitation.organizationId,
            },
          },
        );
      }
    }

    let acceptedInvitation!: Invitation;
    let savedMembership!: OrganizationMember;

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.INVITATIONS,
        TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        const freshInvitation = await this.deps.invitations.findById(
          invitation.organizationId,
          invitation.id,
        );
        if (!freshInvitation) {
          throw new NotFoundError('Invitation was not found.');
        }

        assertInvitationCanBeAccepted(freshInvitation, now);

        acceptedInvitation = {
          ...freshInvitation,
          status: INVITATION_STATUSES.ACCEPTED,
          acceptedAt: now,
          acceptedByUserId: validatedActorId,
        };

        savedMembership = {
          id: existingMembership?.id ?? asOrganizationMemberId(this.nextUuid()),
          organizationId: freshInvitation.organizationId,
          userId: validatedActorId,
          role: freshInvitation.initialRole,
          status: MEMBERSHIP_STATUSES.ACTIVE,
          joinedAt: now,
          updatedAt: now,
        };

        await this.deps.invitations.save(acceptedInvitation);
        await this.deps.organizationMembers.save(savedMembership);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: freshInvitation.organizationId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'invitation.accepted',
          resourceType: 'Invitation',
          resourceId: freshInvitation.id,
          before: { status: freshInvitation.status },
          after: {
            status: acceptedInvitation.status,
            membershipId: savedMembership.id,
            role: savedMembership.role,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'invitation.accepted',
            occurredAt: now,
            organizationId: freshInvitation.organizationId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Invitation',
            aggregateId: freshInvitation.id,
            payload: {
              invitationId: freshInvitation.id,
              organizationId: freshInvitation.organizationId,
              userId: validatedActorId,
              role: savedMembership.role,
            },
          }),
        );
      },
    );

    return Object.freeze({
      invitation: acceptedInvitation,
      membership: savedMembership,
      organization,
    });
  }
}
