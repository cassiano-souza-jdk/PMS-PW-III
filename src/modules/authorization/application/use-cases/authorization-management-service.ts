import { z } from 'zod';
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TRANSACTION_RESOURCES,
  asCorrelationId,
  asEntityId,
  asEventId,
  asGrantId,
  asIsoDateTime,
  asOrganizationId,
  asUserId,
  createDomainEvent,
  isIsoDateTime,
  isUuid,
  parseIsoDateTimeMs,
  type CorrelationId,
  type DomainEventPublisherPort,
  type EntityId,
  type GrantId,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationRole,
  type ProjectId,
  type TeamId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  GRANT_STATUSES,
  PERMISSION_SCOPE_TYPES,
  asDenyRuleId,
  canGrantorDelegatePermission,
  deriveGrantStatus,
  isDenyRuleActiveAt,
  type DenyRuleId,
  type ExplicitDenyRule,
  type GrantStatus,
  type GrantorAuthority,
  type PermissionGrant,
  type PermissionScopeType,
} from '../../domain/grants';
import {
  MANAGER_DELEGABLE_PERMISSIONS,
  PERMISSION_CODES,
  isPermissionCode,
  type PermissionCode,
} from '../../domain/permission-codes';
import { assertAuthorized, type AuthorizationActor } from '../../domain/policy-engine';
import type {
  AuthorizationAuditWriterPort,
  AuthorizationContextLookupPort,
  AuthorizationScopeSummary,
} from '../ports/authorization-context.port';
import type {
  ExplicitDenyRuleRepositoryPort,
  PermissionGrantRepositoryPort,
} from '../ports/authorization-repository.port';

const scopeTypeSchema = z.enum([
  PERMISSION_SCOPE_TYPES.ORGANIZATION,
  PERMISSION_SCOPE_TYPES.TEAM,
  PERMISSION_SCOPE_TYPES.PROJECT,
  PERMISSION_SCOPE_TYPES.RESOURCE,
]);

const grantPermissionInputSchema = z.object({
  granteeUserId: z.string().uuid(),
  permission: z.string().refine((value): value is PermissionCode => isPermissionCode(value), {
    message: 'Invalid permission code.',
  }),
  scopeType: scopeTypeSchema,
  scopeId: z.string().uuid().optional(),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters long.').max(500),
  startsAt: z
    .string()
    .refine(isIsoDateTime, 'startsAt must be a valid ISO 8601 date-time.')
    .optional(),
  expiresAt: z
    .string()
    .refine(isIsoDateTime, 'expiresAt must be a valid ISO 8601 date-time.')
    .optional(),
  correlationId: z.string().uuid().optional(),
});

const createExplicitDenyInputSchema = z.object({
  targetUserId: z.string().uuid(),
  permission: z
    .string()
    .refine(
      (value): value is PermissionCode | '*' => value === '*' || isPermissionCode(value),
      'Permission must be a valid permission code or "*".',
    ),
  scopeType: scopeTypeSchema,
  scopeId: z.string().uuid().optional(),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters long.').max(500),
  expiresAt: z
    .string()
    .refine(isIsoDateTime, 'expiresAt must be a valid ISO 8601 date-time.')
    .optional(),
  correlationId: z.string().uuid().optional(),
});

export interface AuthorizationManagementServiceDependencies {
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly contextLookup: AuthorizationContextLookupPort;
  readonly auditWriter: AuthorizationAuditWriterPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface MyActiveAccessRules extends AuthorizationScopeSummary {
  readonly grants: readonly PermissionGrant[];
  readonly explicitDenies: readonly ExplicitDenyRule[];
}

export interface PermissionGrantWithDerivedStatus extends PermissionGrant {
  readonly derivedStatus: GrantStatus;
}

export interface ExplicitDenyRuleWithActiveFlag extends ExplicitDenyRule {
  readonly isActive: boolean;
}

export interface GrantPermissionInput {
  readonly granteeUserId: UserId;
  readonly permission: PermissionCode;
  readonly scopeType: PermissionScopeType;
  readonly scopeId?: EntityId;
  readonly reason: string;
  readonly startsAt?: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
  readonly correlationId?: CorrelationId;
}

export interface CreateExplicitDenyRuleInput {
  readonly targetUserId: UserId;
  readonly permission: PermissionCode | '*';
  readonly scopeType: PermissionScopeType;
  readonly scopeId?: EntityId;
  readonly reason: string;
  readonly expiresAt?: IsoDateTime;
  readonly correlationId?: CorrelationId;
}

export interface RevokeAuthorizationRuleOptions {
  readonly reason?: string;
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
    throw new ValidationError('Invalid authorization management payload.', {
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

function isScopeManagedByManager(
  scopeType: PermissionScopeType,
  scopeId: EntityId | undefined,
  managedTeamIds: readonly TeamId[],
  managedProjectIds: readonly ProjectId[],
): boolean {
  if (scopeId === undefined) {
    return false;
  }

  if (scopeType === PERMISSION_SCOPE_TYPES.TEAM) {
    return managedTeamIds.some((id) => (id as string) === (scopeId as string));
  }

  if (scopeType === PERMISSION_SCOPE_TYPES.PROJECT) {
    return managedProjectIds.some((id) => (id as string) === (scopeId as string));
  }

  return false;
}

function isActorBlockedByExplicitDeny(
  explicitDenies: readonly ExplicitDenyRule[],
  role: OrganizationRole,
  targetPermission: PermissionCode,
  scopeType: PermissionScopeType,
  scopeId: EntityId | undefined,
  now: IsoDateTime,
): boolean {
  for (const rule of explicitDenies) {
    if (!isDenyRuleActiveAt(rule, now)) {
      continue;
    }

    const scopeMatches =
      rule.scopeType === PERMISSION_SCOPE_TYPES.ORGANIZATION ||
      (rule.scopeType === scopeType &&
        rule.scopeId !== undefined &&
        scopeId !== undefined &&
        (rule.scopeId as string) === (scopeId as string));

    if (!scopeMatches) {
      continue;
    }

    if (
      role === ORGANIZATION_ROLES.ADMIN &&
      (rule.permission === '*' || rule.permission === PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE)
    ) {
      return true;
    }

    if (
      role === ORGANIZATION_ROLES.MANAGER &&
      (rule.permission === '*' || rule.permission === targetPermission)
    ) {
      return true;
    }
  }

  return false;
}

export class AuthorizationManagementService {
  private readonly deps: AuthorizationManagementServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: AuthorizationManagementServiceDependencies) {
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

  private async assertAdminForOrganization(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<void> {
    const [membership, grants, explicitDenies] = await Promise.all([
      this.deps.contextLookup.getOrganizationMembership(organizationId, actorUserId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
    ]);

    const actor: AuthorizationActor = {
      isAuthenticated: true,
      userId: actorUserId,
      ...(membership !== null ? { organizationMembership: membership } : {}),
      grants,
      explicitDenies,
    };

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(organizationId),
        exists: true,
        organizationId,
      },
      context: { now },
    });

    if (!membership || membership.role !== ORGANIZATION_ROLES.ADMIN) {
      throw new AuthorizationError('Only organization ADMINs can manage explicit deny rules.');
    }
  }

  /**
   * Returns active grants, active deny rules, and managed/participated team/project scopes
   * for the authenticated actor inside `organizationId` (ADR-0009 §4.1).
   */
  async listMyActiveAccessRules(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<MyActiveAccessRules> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const membership = await this.deps.contextLookup.getOrganizationMembership(
      validatedOrgId,
      validatedActorId,
    );

    if (!membership || membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      return Object.freeze({
        grants: [],
        explicitDenies: [],
        managedTeamIds: [],
        memberTeamIds: [],
        managedProjectIds: [],
        participatedProjectIds: [],
      });
    }

    const [grants, explicitDenies, scopes] = await Promise.all([
      this.deps.permissionGrants.listActiveByGrantee(validatedOrgId, validatedActorId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(validatedOrgId, validatedActorId, now),
      this.deps.contextLookup.getActorScopeSummary(validatedOrgId, validatedActorId),
    ]);

    return Object.freeze({
      grants,
      explicitDenies,
      managedTeamIds: scopes.managedTeamIds,
      memberTeamIds: scopes.memberTeamIds,
      managedProjectIds: scopes.managedProjectIds,
      participatedProjectIds: scopes.participatedProjectIds,
    });
  }

  async listOrganizationGrants(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<readonly PermissionGrantWithDerivedStatus[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const membership = await this.deps.contextLookup.getOrganizationMembership(
      validatedOrgId,
      validatedActorId,
    );

    if (
      !membership ||
      membership.status !== MEMBERSHIP_STATUSES.ACTIVE ||
      membership.role === ORGANIZATION_ROLES.MEMBER
    ) {
      throw new AuthorizationError(
        'Only organization ADMINs or scope MANAGERs can list permission grants.',
      );
    }

    const allGrants = await this.deps.permissionGrants.listByOrganization(validatedOrgId);
    const enriched: PermissionGrantWithDerivedStatus[] = allGrants.map((grant) => ({
      ...grant,
      derivedStatus: deriveGrantStatus(grant, now),
    }));

    if (membership.role === ORGANIZATION_ROLES.ADMIN) {
      return enriched;
    }

    const scopes = await this.deps.contextLookup.getActorScopeSummary(
      validatedOrgId,
      validatedActorId,
    );

    return enriched.filter((grant) =>
      isScopeManagedByManager(
        grant.scopeType,
        grant.scopeId,
        scopes.managedTeamIds,
        scopes.managedProjectIds,
      ),
    );
  }

  async listOrganizationDenyRules(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<readonly ExplicitDenyRuleWithActiveFlag[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const membership = await this.deps.contextLookup.getOrganizationMembership(
      validatedOrgId,
      validatedActorId,
    );

    if (
      !membership ||
      membership.status !== MEMBERSHIP_STATUSES.ACTIVE ||
      membership.role === ORGANIZATION_ROLES.MEMBER
    ) {
      throw new AuthorizationError(
        'Only organization ADMINs or scope MANAGERs can list explicit deny rules.',
      );
    }

    const allRules = await this.deps.explicitDenyRules.listByOrganization(validatedOrgId);
    const enriched: ExplicitDenyRuleWithActiveFlag[] = allRules.map((rule) => ({
      ...rule,
      isActive: isDenyRuleActiveAt(rule, now),
    }));

    if (membership.role === ORGANIZATION_ROLES.ADMIN) {
      return enriched;
    }

    const scopes = await this.deps.contextLookup.getActorScopeSummary(
      validatedOrgId,
      validatedActorId,
    );

    return enriched.filter((rule) =>
      isScopeManagedByManager(
        rule.scopeType,
        rule.scopeId,
        scopes.managedTeamIds,
        scopes.managedProjectIds,
      ),
    );
  }

  async grantPermission(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: GrantPermissionInput,
  ): Promise<PermissionGrant> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(grantPermissionInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    if (parsed.scopeType !== PERMISSION_SCOPE_TYPES.ORGANIZATION && parsed.scopeId === undefined) {
      throw new ValidationError(`"scopeId" is required when scopeType is "${parsed.scopeType}".`, {
        details: { field: 'scopeId', scopeType: parsed.scopeType },
      });
    }

    if (
      parsed.startsAt !== undefined &&
      parsed.expiresAt !== undefined &&
      parseIsoDateTimeMs(asIsoDateTime(parsed.startsAt)) >=
        parseIsoDateTimeMs(asIsoDateTime(parsed.expiresAt))
    ) {
      throw new ValidationError('"startsAt" must be strictly earlier than "expiresAt".', {
        details: { field: 'expiresAt' },
      });
    }

    const granteeUserId = asUserId(parsed.granteeUserId, 'granteeUserId');
    const scopeId =
      parsed.scopeId !== undefined ? asEntityId(parsed.scopeId, 'scopeId') : undefined;

    const [membership, scopes, actorExplicitDenies, granteeMembership, scopeExists] =
      await Promise.all([
        this.deps.contextLookup.getOrganizationMembership(validatedOrgId, validatedActorId),
        this.deps.contextLookup.getActorScopeSummary(validatedOrgId, validatedActorId),
        this.deps.explicitDenyRules.listActiveByTargetUser(validatedOrgId, validatedActorId, now),
        this.deps.contextLookup.getOrganizationMembership(validatedOrgId, granteeUserId),
        this.deps.contextLookup.scopeExistsInOrganization(
          validatedOrgId,
          parsed.scopeType,
          scopeId,
        ),
      ]);

    if (!membership || membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new AuthorizationError(
        'Actor does not have an active membership in this organization.',
      );
    }

    if (
      isActorBlockedByExplicitDeny(
        actorExplicitDenies,
        membership.role,
        parsed.permission,
        parsed.scopeType,
        scopeId,
        now,
      )
    ) {
      throw new AuthorizationError(
        `Actor is explicitly denied from delegating "${parsed.permission}" on scope "${parsed.scopeType}".`,
        {
          details: {
            permission: parsed.permission,
            scopeType: parsed.scopeType,
            scopeId,
          },
        },
      );
    }

    if (granteeMembership === null || granteeMembership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new NotFoundError('Grantee must be an active member of the organization.', {
        details: { organizationId: validatedOrgId, granteeUserId },
      });
    }

    if (!scopeExists) {
      throw new NotFoundError('Target permission scope was not found in this organization.', {
        details: { organizationId: validatedOrgId, scopeType: parsed.scopeType, scopeId },
      });
    }

    if (
      membership.role === ORGANIZATION_ROLES.MANAGER &&
      granteeMembership.role === ORGANIZATION_ROLES.ADMIN
    ) {
      throw new AuthorizationError('MANAGER cannot grant permissions to an organization ADMIN.', {
        details: { granteeUserId },
      });
    }

    const managedScopeIds: EntityId[] = [
      ...scopes.managedProjectIds.map((id) => asEntityId(id)),
      ...scopes.managedTeamIds.map((id) => asEntityId(id)),
    ];

    const grantorAuthority: GrantorAuthority = {
      userId: validatedActorId,
      organizationId: validatedOrgId,
      role: membership.role,
      membershipStatus: membership.status,
      managedProjectIds: scopes.managedProjectIds,
      managedTeamIds: scopes.managedTeamIds,
      managedScopeIds,
      hasDemoMaintenanceDelegationAuthority: false,
    };

    const canDelegate = canGrantorDelegatePermission(grantorAuthority, parsed.permission, {
      organizationId: validatedOrgId,
      scopeType: parsed.scopeType,
      ...(scopeId !== undefined ? { scopeId } : {}),
    });

    if (!canDelegate) {
      throw new AuthorizationError(
        `Actor is not authorized to delegate "${parsed.permission}" on scope "${parsed.scopeType}".`,
        {
          details: {
            permission: parsed.permission,
            scopeType: parsed.scopeType,
            scopeId,
          },
        },
      );
    }

    const startsAt = parsed.startsAt !== undefined ? asIsoDateTime(parsed.startsAt) : undefined;
    const expiresAt = parsed.expiresAt !== undefined ? asIsoDateTime(parsed.expiresAt) : undefined;

    const derivedStatus = deriveGrantStatus(
      {
        status: GRANT_STATUSES.ACTIVE,
        ...(startsAt !== undefined ? { startsAt } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
      now,
    );

    const grant: PermissionGrant = {
      id: asGrantId(this.nextUuid()),
      organizationId: validatedOrgId,
      granteeUserId,
      permission: parsed.permission,
      scopeType: parsed.scopeType,
      ...(scopeId !== undefined ? { scopeId } : {}),
      grantedByUserId: validatedActorId,
      grantedByRole: membership.role,
      ...(membership.role === ORGANIZATION_ROLES.MANAGER
        ? { grantedByScopeIds: managedScopeIds }
        : {}),
      grantedAt: now,
      ...(startsAt !== undefined ? { startsAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      reason: parsed.reason,
      status: derivedStatus,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PERMISSION_GRANTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.permissionGrants.save(grant);

        await this.deps.auditWriter.appendAuthorizationAuditEvent({
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          eventType: 'authorization.grant.created',
          resourceType: 'PermissionGrant',
          resourceId: grant.id,
          after: {
            granteeUserId: grant.granteeUserId,
            permission: grant.permission,
            scopeType: grant.scopeType,
            scopeId: grant.scopeId ?? null,
            status: grant.status,
            reason: grant.reason,
          },
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'authorization.grant.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'PermissionGrant',
            aggregateId: grant.id,
            payload: {
              grantId: grant.id,
              granteeUserId: grant.granteeUserId,
              permission: grant.permission,
              scopeType: grant.scopeType,
              ...(grant.scopeId !== undefined ? { scopeId: grant.scopeId } : {}),
            },
          }),
        );
      },
    );

    this.deps.logger?.info('Permission grant created.', {
      organizationId: validatedOrgId,
      grantId: grant.id,
      permission: grant.permission,
      correlationId,
    });

    return grant;
  }

  async revokePermissionGrant(
    actorUserId: UserId,
    organizationId: OrganizationId,
    grantId: GrantId,
    options: RevokeAuthorizationRuleOptions = {},
  ): Promise<void> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedGrantId = asGrantId(grantId, 'grantId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [membership, scopes, existing, actorExplicitDenies] = await Promise.all([
      this.deps.contextLookup.getOrganizationMembership(validatedOrgId, validatedActorId),
      this.deps.contextLookup.getActorScopeSummary(validatedOrgId, validatedActorId),
      this.deps.permissionGrants.findById(validatedOrgId, validatedGrantId),
      this.deps.explicitDenyRules.listActiveByTargetUser(validatedOrgId, validatedActorId, now),
    ]);

    if (
      !membership ||
      membership.status !== MEMBERSHIP_STATUSES.ACTIVE ||
      membership.role === ORGANIZATION_ROLES.MEMBER
    ) {
      throw new AuthorizationError('Actor is not authorized to revoke permission grants.');
    }

    if (!existing) {
      throw new NotFoundError(`PermissionGrant "${validatedGrantId}" was not found.`, {
        details: { organizationId: validatedOrgId, grantId: validatedGrantId },
      });
    }

    const granteeMembership = await this.deps.contextLookup.getOrganizationMembership(
      validatedOrgId,
      existing.granteeUserId,
    );

    if (
      isActorBlockedByExplicitDeny(
        actorExplicitDenies,
        membership.role,
        existing.permission,
        existing.scopeType,
        existing.scopeId,
        now,
      )
    ) {
      throw new AuthorizationError(
        'Actor is explicitly denied from revoking this permission grant.',
        {
          details: {
            grantId: validatedGrantId,
            permission: existing.permission,
            scopeType: existing.scopeType,
            scopeId: existing.scopeId,
          },
        },
      );
    }

    if (membership.role === ORGANIZATION_ROLES.MANAGER) {
      if (
        existing.grantedByRole === ORGANIZATION_ROLES.ADMIN ||
        !MANAGER_DELEGABLE_PERMISSIONS.has(existing.permission) ||
        granteeMembership?.role === ORGANIZATION_ROLES.ADMIN
      ) {
        throw new AuthorizationError(
          'MANAGER cannot revoke permission grants issued by ADMIN, outside delegable permissions, or targeting an ADMIN.',
          {
            details: {
              grantId: validatedGrantId,
              permission: existing.permission,
              grantedByRole: existing.grantedByRole,
            },
          },
        );
      }

      const canRevoke =
        existing.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE
          ? existing.grantedByUserId === validatedActorId
          : isScopeManagedByManager(
              existing.scopeType,
              existing.scopeId,
              scopes.managedTeamIds,
              scopes.managedProjectIds,
            );
      if (!canRevoke) {
        throw new AuthorizationError(
          'MANAGER can only revoke permission grants within their managed teams or projects.',
          {
            details: { grantId: validatedGrantId },
          },
        );
      }
    }

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PERMISSION_GRANTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.permissionGrants.revoke(
          validatedOrgId,
          validatedGrantId,
          validatedActorId,
          now,
        );

        await this.deps.auditWriter.appendAuthorizationAuditEvent({
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          eventType: 'authorization.grant.revoked',
          resourceType: 'PermissionGrant',
          resourceId: validatedGrantId,
          before: {
            status: existing.status,
            permission: existing.permission,
            granteeUserId: existing.granteeUserId,
          },
          after: {
            status: GRANT_STATUSES.REVOKED,
            revokedAt: now,
            reason: options.reason?.trim() || null,
          },
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'authorization.grant.revoked',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'PermissionGrant',
            aggregateId: validatedGrantId,
            payload: {
              grantId: validatedGrantId,
              granteeUserId: existing.granteeUserId,
              permission: existing.permission,
            },
          }),
        );
      },
    );
  }

  async createExplicitDenyRule(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateExplicitDenyRuleInput,
  ): Promise<ExplicitDenyRule> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(createExplicitDenyInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    if (parsed.scopeType !== PERMISSION_SCOPE_TYPES.ORGANIZATION && parsed.scopeId === undefined) {
      throw new ValidationError(`"scopeId" is required when scopeType is "${parsed.scopeType}".`, {
        details: { field: 'scopeId', scopeType: parsed.scopeType },
      });
    }

    await this.assertAdminForOrganization(validatedActorId, validatedOrgId, now);

    const targetUserId = asUserId(parsed.targetUserId, 'targetUserId');
    const scopeId =
      parsed.scopeId !== undefined ? asEntityId(parsed.scopeId, 'scopeId') : undefined;

    const [targetIsActive, scopeExists] = await Promise.all([
      this.deps.contextLookup.isActiveOrganizationMember(validatedOrgId, targetUserId),
      this.deps.contextLookup.scopeExistsInOrganization(validatedOrgId, parsed.scopeType, scopeId),
    ]);

    if (!targetIsActive) {
      throw new NotFoundError('Target user must be an active member of the organization.', {
        details: { organizationId: validatedOrgId, targetUserId },
      });
    }

    if (!scopeExists) {
      throw new NotFoundError('Target deny rule scope was not found in this organization.', {
        details: { organizationId: validatedOrgId, scopeType: parsed.scopeType, scopeId },
      });
    }

    const rule: ExplicitDenyRule = {
      id: asDenyRuleId(this.nextUuid()),
      organizationId: validatedOrgId,
      targetUserId,
      permission: parsed.permission,
      scopeType: parsed.scopeType,
      ...(scopeId !== undefined ? { scopeId } : {}),
      reason: parsed.reason,
      createdByUserId: validatedActorId,
      createdAt: now,
      ...(parsed.expiresAt !== undefined ? { expiresAt: asIsoDateTime(parsed.expiresAt) } : {}),
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.EXPLICIT_DENY_RULES, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.explicitDenyRules.save(rule);

        await this.deps.auditWriter.appendAuthorizationAuditEvent({
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          eventType: 'authorization.deny_rule.created',
          resourceType: 'ExplicitDenyRule',
          resourceId: rule.id,
          after: {
            targetUserId: rule.targetUserId,
            permission: rule.permission,
            scopeType: rule.scopeType,
            scopeId: rule.scopeId ?? null,
            reason: rule.reason,
          },
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'authorization.deny_rule.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'ExplicitDenyRule',
            aggregateId: rule.id,
            payload: {
              denyRuleId: rule.id,
              targetUserId: rule.targetUserId,
              permission: rule.permission,
              scopeType: rule.scopeType,
            },
          }),
        );
      },
    );

    return rule;
  }

  async revokeExplicitDenyRule(
    actorUserId: UserId,
    organizationId: OrganizationId,
    denyRuleId: DenyRuleId,
    options: RevokeAuthorizationRuleOptions = {},
  ): Promise<void> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedDenyRuleId = asDenyRuleId(denyRuleId, 'denyRuleId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    await this.assertAdminForOrganization(validatedActorId, validatedOrgId, now);

    const existing = await this.deps.explicitDenyRules.findById(
      validatedOrgId,
      validatedDenyRuleId,
    );
    if (!existing) {
      throw new NotFoundError(`ExplicitDenyRule "${validatedDenyRuleId}" was not found.`, {
        details: { organizationId: validatedOrgId, denyRuleId: validatedDenyRuleId },
      });
    }

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.EXPLICIT_DENY_RULES, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.explicitDenyRules.revoke(validatedOrgId, validatedDenyRuleId, now);

        await this.deps.auditWriter.appendAuthorizationAuditEvent({
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          eventType: 'authorization.deny_rule.revoked',
          resourceType: 'ExplicitDenyRule',
          resourceId: validatedDenyRuleId,
          before: {
            targetUserId: existing.targetUserId,
            permission: existing.permission,
          },
          after: {
            revokedAt: now,
            reason: options.reason?.trim() || null,
          },
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'authorization.deny_rule.revoked',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'ExplicitDenyRule',
            aggregateId: validatedDenyRuleId,
            payload: {
              denyRuleId: validatedDenyRuleId,
              targetUserId: existing.targetUserId,
              permission: existing.permission,
            },
          }),
        );
      },
    );
  }
}
