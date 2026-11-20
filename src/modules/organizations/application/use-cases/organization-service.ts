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
  createDefaultOrganizationSettings,
  type OrganizationSettings,
  type OrganizationSettingsRepositoryPort,
} from '@/modules/settings';
import type { UserRepositoryPort } from '@/modules/users';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
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
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type MembershipStatus,
  type OrganizationId,
  type OrganizationRole,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  asOrganizationMemberId,
  assertCanChangeOrRemoveAdmin,
  type Organization,
  type OrganizationMember,
} from '../../domain/organization';
import type {
  OrganizationMemberRepositoryPort,
  OrganizationRepositoryPort,
} from '../ports/organization-repository.port';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(SLUG_REGEX, 'Slug must contain only lowercase letters, numbers and single hyphens.'),
  description: z.string().trim().max(500).optional(),
  correlationId: z.string().uuid().optional(),
});

const updateOrganizationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.union([z.string().trim().max(500), z.null()]).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    'At least one field ("name" or "description") must be provided.',
  );

const organizationRoleSchema = z.enum([
  ORGANIZATION_ROLES.ADMIN,
  ORGANIZATION_ROLES.MANAGER,
  ORGANIZATION_ROLES.MEMBER,
]);

const memberStatusTransitionSchema = z.enum([
  MEMBERSHIP_STATUSES.ACTIVE,
  MEMBERSHIP_STATUSES.SUSPENDED,
]);

export interface OrganizationServiceDependencies {
  readonly organizations: OrganizationRepositoryPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly organizationSettings: OrganizationSettingsRepositoryPort;
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

export interface MyOrganizationSummary {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
  readonly isDemo: boolean;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
}

export interface CreateOrganizationInput {
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly correlationId?: CorrelationId;
}

export interface CreateOrganizationResult {
  readonly organization: Organization;
  readonly membership: OrganizationMember;
  readonly settings: OrganizationSettings;
}

export interface UpdateOrganizationInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly correlationId?: CorrelationId;
}

export interface OrganizationMemberDetails extends OrganizationMember {
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl?: string;
}

export interface OrganizationOperationOptions {
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

function parseWithZod<TOutput>(schema: z.ZodType<TOutput>, input: unknown): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid organization input payload.', {
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

export class OrganizationService {
  private readonly deps: OrganizationServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: OrganizationServiceDependencies) {
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

  /**
   * Minimal projection of organizations where the authenticated actor holds an ACTIVE membership
   * (PRD.md §5, ADR-0008 §4.4, permission-matrix.md §5.1).
   */
  async listMyOrganizations(actorUserId: UserId): Promise<readonly MyOrganizationSummary[]> {
    const validatedUserId = asUserId(actorUserId, 'actorUserId');
    const memberships = await this.deps.organizationMembers.listByUser(validatedUserId);
    const activeMemberships = memberships.filter(
      (membership) => membership.status === MEMBERSHIP_STATUSES.ACTIVE,
    );

    if (activeMemberships.length === 0) {
      return [];
    }

    const organizationIds = activeMemberships.map((membership) => membership.organizationId);
    const organizations = await this.deps.organizations.listByIds(organizationIds);
    const orgById = new Map<OrganizationId, Organization>();
    for (const org of organizations) {
      if (!isSoftDeleted(org)) {
        orgById.set(org.id, org);
      }
    }

    const summaries: MyOrganizationSummary[] = [];
    for (const membership of activeMemberships) {
      const org = orgById.get(membership.organizationId);
      if (!org) {
        continue;
      }

      summaries.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        isDemo: org.isDemo,
        role: membership.role,
        status: membership.status,
      });
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOrganizationDetails(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<Organization> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const [actor, organization] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_VIEW,
      resource: {
        kind: 'ORGANIZATION',
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

    return organization;
  }

  async createOrganization(
    actorUserId: UserId,
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const parsed = parseWithZod(createOrganizationInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const creator = await this.deps.users.findById(validatedActorId);
    if (!creator || isSoftDeleted(creator)) {
      throw new NotFoundError(`User "${validatedActorId}" was not found.`, {
        details: { userId: validatedActorId },
      });
    }

    const organizationId = asOrganizationId(this.nextUuid());
    const organization: Organization = {
      id: organizationId,
      name: parsed.name,
      slug: parsed.slug,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      isDemo: false,
      createdByUserId: validatedActorId,
      createdAt: now,
      updatedAt: now,
    };

    const membership: OrganizationMember = {
      id: asOrganizationMemberId(this.nextUuid()),
      organizationId,
      userId: validatedActorId,
      role: ORGANIZATION_ROLES.ADMIN,
      status: MEMBERSHIP_STATUSES.ACTIVE,
      joinedAt: now,
      updatedAt: now,
    };

    const settings = createDefaultOrganizationSettings(organizationId, now);

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.ORGANIZATIONS,
        TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS,
        TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        const existingSlug = await this.deps.organizations.findBySlug(parsed.slug);
        if (existingSlug !== null) {
          throw new ConflictError(`Organization slug "${parsed.slug}" is already in use.`, {
            details: { field: 'slug', slug: parsed.slug },
          });
        }

        await this.deps.organizations.save(organization);
        await this.deps.organizationMembers.save(membership);
        await this.deps.organizationSettings.save(settings);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'organization.created',
          resourceType: 'Organization',
          resourceId: organizationId,
          after: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            isDemo: organization.isDemo,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'organization.created',
            occurredAt: now,
            organizationId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Organization',
            aggregateId: organizationId,
            payload: {
              organizationId,
              name: organization.name,
              slug: organization.slug,
            },
          }),
        );
      },
    );

    this.deps.logger?.info('Organization created.', {
      organizationId,
      actorUserId: validatedActorId,
      correlationId,
    });

    return Object.freeze({
      organization,
      membership,
      settings,
    });
  }

  async updateOrganization(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: UpdateOrganizationInput,
  ): Promise<Organization> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(updateOrganizationInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_UPDATE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`, {
        details: { organizationId: validatedOrgId },
      });
    }

    const { description: _prevDescription, ...existingWithoutDescription } = existing;
    let nextDescription: string | undefined = existing.description;
    if (parsed.description !== undefined) {
      nextDescription =
        parsed.description === null || parsed.description.length === 0
          ? undefined
          : parsed.description;
    }

    const updated: Organization = {
      ...existingWithoutDescription,
      name: parsed.name ?? existing.name,
      ...(nextDescription !== undefined ? { description: nextDescription } : {}),
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.ORGANIZATIONS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.organizations.save(updated);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'organization.updated',
          resourceType: 'Organization',
          resourceId: validatedOrgId,
          before: {
            name: existing.name,
            description: existing.description ?? null,
          },
          after: {
            name: updated.name,
            description: updated.description ?? null,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'organization.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Organization',
            aggregateId: validatedOrgId,
            payload: {
              organizationId: validatedOrgId,
              name: updated.name,
            },
          }),
        );
      },
    );

    return updated;
  }

  /**
   * Removes the authenticated actor's own membership from an organization without revoking
   * the global UserSession (PRD.md §5, ADR-0008 §4.4).
   * Blocks leaving if the actor is the last active ADMIN of the organization.
   */
  async leaveOrganization(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: OrganizationOperationOptions = {},
  ): Promise<OrganizationMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const members = await this.deps.organizationMembers.listByOrganization(validatedOrgId);
    const membership = members.find((member) => member.userId === validatedActorId);

    if (!membership) {
      throw new NotFoundError('Active organization membership was not found for this user.', {
        details: { organizationId: validatedOrgId, userId: validatedActorId },
      });
    }

    if (membership.status === MEMBERSHIP_STATUSES.REMOVED) {
      throw new ConflictError('User has already left this organization.', {
        details: { organizationId: validatedOrgId, userId: validatedActorId },
      });
    }

    assertCanChangeOrRemoveAdmin(members, validatedActorId);

    const removedMembership: OrganizationMember = {
      ...membership,
      status: MEMBERSHIP_STATUSES.REMOVED,
      removedAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.organizationMembers.save(removedMembership);

        const activeGrants = await this.deps.permissionGrants.listActiveByGrantee(
          validatedOrgId,
          validatedActorId,
          now,
        );
        for (const grant of activeGrants) {
          await this.deps.permissionGrants.revoke(validatedOrgId, grant.id, validatedActorId, now);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'organization.member.left',
          resourceType: 'OrganizationMember',
          resourceId: membership.id,
          before: {
            role: membership.role,
            status: membership.status,
          },
          after: {
            role: removedMembership.role,
            status: removedMembership.status,
            revokedGrantsCount: activeGrants.length,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'organization.member.left',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'OrganizationMember',
            aggregateId: membership.id,
            payload: {
              organizationId: validatedOrgId,
              userId: validatedActorId,
            },
          }),
        );
      },
    );

    return removedMembership;
  }

  async listOrganizationMembers(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<readonly OrganizationMemberDetails[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const [actor, organization] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: organization !== null,
        organizationId: validatedOrgId,
        deletedAt: organization?.deletedAt,
        archivedAt: organization?.archivedAt,
      },
      context: { now },
    });

    const members = await this.deps.organizationMembers.listByOrganization(validatedOrgId);
    const users = await this.deps.users.findByIds(members.map((member) => member.userId));
    const userById = new Map(users.map((user) => [user.id, user]));

    return members.map((member) => {
      const user = userById.get(member.userId);
      return {
        ...member,
        displayName: user?.displayName ?? 'Unknown User',
        email: user?.email ?? '',
        ...(user?.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
      };
    });
  }

  async changeMemberRole(
    actorUserId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
    role: OrganizationRole,
    options: OrganizationOperationOptions = {},
  ): Promise<OrganizationMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const validatedRole = parseWithZod(organizationRoleSchema, role);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, organization] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: organization !== null,
        organizationId: validatedOrgId,
        deletedAt: organization?.deletedAt,
        archivedAt: organization?.archivedAt,
      },
      context: { now },
    });

    const members = await this.deps.organizationMembers.listByOrganization(validatedOrgId);
    const targetMember = members.find((member) => member.userId === validatedTargetId);

    if (!targetMember) {
      throw new NotFoundError('Target organization member was not found.', {
        details: { organizationId: validatedOrgId, targetUserId: validatedTargetId },
      });
    }

    if (targetMember.status === MEMBERSHIP_STATUSES.REMOVED) {
      throw new ConflictError('Cannot change the role of a removed organization member.', {
        details: { organizationId: validatedOrgId, targetUserId: validatedTargetId },
      });
    }

    if (targetMember.role === validatedRole) {
      return targetMember;
    }

    if (
      targetMember.role === ORGANIZATION_ROLES.ADMIN &&
      validatedRole !== ORGANIZATION_ROLES.ADMIN
    ) {
      assertCanChangeOrRemoveAdmin(members, validatedTargetId);
    }

    const updatedMember: OrganizationMember = {
      ...targetMember,
      role: validatedRole,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.organizationMembers.save(updatedMember);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PERMISSIONS,
          eventType: 'organization.member.role_changed',
          resourceType: 'OrganizationMember',
          resourceId: targetMember.id,
          before: {
            userId: validatedTargetId,
            role: targetMember.role,
          },
          after: {
            userId: validatedTargetId,
            role: updatedMember.role,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'organization.member.role_changed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'OrganizationMember',
            aggregateId: targetMember.id,
            payload: {
              organizationId: validatedOrgId,
              targetUserId: validatedTargetId,
              previousRole: targetMember.role,
              role: updatedMember.role,
            },
          }),
        );
      },
    );

    return updatedMember;
  }

  async suspendOrReactivateMember(
    actorUserId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
    status: 'ACTIVE' | 'SUSPENDED',
    options: OrganizationOperationOptions = {},
  ): Promise<OrganizationMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const validatedStatus = parseWithZod(memberStatusTransitionSchema, status);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, organization] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizations.findById(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_MEMBERS_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: organization !== null,
        organizationId: validatedOrgId,
        deletedAt: organization?.deletedAt,
        archivedAt: organization?.archivedAt,
      },
      context: { now },
    });

    const members = await this.deps.organizationMembers.listByOrganization(validatedOrgId);
    const targetMember = members.find((member) => member.userId === validatedTargetId);

    if (!targetMember) {
      throw new NotFoundError('Target organization member was not found.', {
        details: { organizationId: validatedOrgId, targetUserId: validatedTargetId },
      });
    }

    if (targetMember.status === MEMBERSHIP_STATUSES.REMOVED) {
      throw new ConflictError('Cannot suspend or reactivate a removed organization member.', {
        details: { organizationId: validatedOrgId, targetUserId: validatedTargetId },
      });
    }

    if (targetMember.status === validatedStatus) {
      return targetMember;
    }

    if (validatedStatus === MEMBERSHIP_STATUSES.SUSPENDED) {
      assertCanChangeOrRemoveAdmin(members, validatedTargetId);
    }

    const { suspendedAt: _previousSuspendedAt, ...baseMember } = targetMember;
    const updatedMember: OrganizationMember =
      validatedStatus === MEMBERSHIP_STATUSES.SUSPENDED
        ? {
            ...baseMember,
            status: MEMBERSHIP_STATUSES.SUSPENDED,
            suspendedAt: now,
            updatedAt: now,
          }
        : {
            ...baseMember,
            status: MEMBERSHIP_STATUSES.ACTIVE,
            updatedAt: now,
          };

    const eventType =
      validatedStatus === MEMBERSHIP_STATUSES.SUSPENDED
        ? 'organization.member.suspended'
        : 'organization.member.reactivated';

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.organizationMembers.save(updatedMember);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType,
          resourceType: 'OrganizationMember',
          resourceId: targetMember.id,
          before: {
            userId: validatedTargetId,
            status: targetMember.status,
          },
          after: {
            userId: validatedTargetId,
            status: updatedMember.status,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType,
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'OrganizationMember',
            aggregateId: targetMember.id,
            payload: {
              organizationId: validatedOrgId,
              targetUserId: validatedTargetId,
              status: updatedMember.status,
            },
          }),
        );
      },
    );

    return updatedMember;
  }
}
