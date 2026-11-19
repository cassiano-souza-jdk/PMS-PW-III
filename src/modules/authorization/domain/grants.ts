import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  isIsoDateTime,
  isOrganizationRole,
  parseBrandedUuid,
  parseIsoDateTimeMs,
  type Brand,
  type EntityId,
  type GrantId,
  type IsoDateTime,
  type MembershipStatus,
  type OrganizationId,
  type OrganizationRole,
  type OrganizationScoped,
  type ProjectId,
  type TeamId,
  type UserId,
} from '@/shared/kernel';
import {
  ADMIN_ONLY_PERMISSIONS,
  DEMO_MAINTENANCE_PERMISSIONS,
  MANAGER_DELEGABLE_PERMISSIONS,
  isPermissionCode,
  type PermissionCode,
} from './permission-codes';

export type DenyRuleId = Brand<string, 'DenyRuleId'>;

export function asDenyRuleId(value: string, fieldName = 'denyRuleId'): DenyRuleId {
  return parseBrandedUuid<'DenyRuleId'>(value, fieldName);
}

export const PERMISSION_SCOPE_TYPES = {
  ORGANIZATION: 'ORGANIZATION',
  TEAM: 'TEAM',
  PROJECT: 'PROJECT',
  RESOURCE: 'RESOURCE',
} as const;

export type PermissionScopeType =
  (typeof PERMISSION_SCOPE_TYPES)[keyof typeof PERMISSION_SCOPE_TYPES];

const PERMISSION_SCOPE_TYPE_SET: ReadonlySet<string> = new Set<string>(
  Object.values(PERMISSION_SCOPE_TYPES),
);

export function isPermissionScopeType(value: unknown): value is PermissionScopeType {
  return typeof value === 'string' && PERMISSION_SCOPE_TYPE_SET.has(value);
}

export const GRANT_STATUSES = {
  ACTIVE: 'ACTIVE',
  SCHEDULED: 'SCHEDULED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;

export type GrantStatus = (typeof GRANT_STATUSES)[keyof typeof GRANT_STATUSES];

const GRANT_STATUS_SET: ReadonlySet<string> = new Set<string>(Object.values(GRANT_STATUSES));

export function isGrantStatus(value: unknown): value is GrantStatus {
  return typeof value === 'string' && GRANT_STATUS_SET.has(value);
}

/**
 * Concessão adicional explícita (permission-matrix.md §6).
 * Não substitui papel organizacional nem supera Deny Overrides, associação suspensa ou isolamento organizacional.
 */
export interface PermissionGrant extends OrganizationScoped {
  readonly id: GrantId;
  readonly organizationId: OrganizationId;
  readonly granteeUserId: UserId;
  readonly permission: PermissionCode;
  readonly scopeType: PermissionScopeType;
  readonly scopeId?: EntityId;
  readonly grantedByUserId: UserId;
  readonly grantedByRole: OrganizationRole;
  readonly grantedByScopeIds?: readonly EntityId[];
  readonly grantedByHasSpecialAuthority?: boolean;
  readonly grantedAt: IsoDateTime;
  readonly startsAt?: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
  readonly revokedByUserId?: UserId;
  readonly reason: string;
  readonly status: GrantStatus;
}

/**
 * Regra de negação explícita (Deny Overrides — permission-matrix.md §1.2, §6.7, §11.10).
 * Prevalece sobre papéis organizacionais e sobre qualquer PermissionGrant ativo.
 */
export interface ExplicitDenyRule extends OrganizationScoped {
  readonly id: DenyRuleId;
  readonly organizationId: OrganizationId;
  readonly targetUserId: UserId;
  readonly permission: PermissionCode | '*';
  readonly scopeType: PermissionScopeType;
  readonly scopeId?: EntityId;
  readonly reason: string;
  readonly createdByUserId: UserId;
  readonly createdAt: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
}

export interface GrantorAuthority {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly role: OrganizationRole;
  readonly membershipStatus?: MembershipStatus;
  readonly managedProjectIds?: readonly ProjectId[];
  readonly managedTeamIds?: readonly TeamId[];
  readonly managedScopeIds?: readonly EntityId[];
  readonly hasDemoMaintenanceDelegationAuthority?: boolean;
}

export interface PermissionTargetScope {
  readonly organizationId: OrganizationId;
  readonly scopeType: PermissionScopeType;
  readonly scopeId?: EntityId;
  readonly projectId?: ProjectId;
  readonly teamId?: TeamId;
}

/**
 * Deriva o estado temporal efetivo de uma concessão em `now` (permission-matrix.md §6 regras 4–5).
 * Opera em modo falha fechada diante de timestamps inválidos.
 */
export function deriveGrantStatus(
  grant: Pick<PermissionGrant, 'status' | 'startsAt' | 'expiresAt' | 'revokedAt'>,
  now: IsoDateTime,
): GrantStatus {
  if (grant.revokedAt !== undefined || grant.status === GRANT_STATUSES.REVOKED) {
    return GRANT_STATUSES.REVOKED;
  }

  if (!isIsoDateTime(now)) {
    return GRANT_STATUSES.EXPIRED;
  }

  const nowMs = parseIsoDateTimeMs(now);

  if (grant.expiresAt !== undefined) {
    if (!isIsoDateTime(grant.expiresAt)) {
      return GRANT_STATUSES.EXPIRED;
    }

    if (nowMs >= parseIsoDateTimeMs(grant.expiresAt)) {
      return GRANT_STATUSES.EXPIRED;
    }
  }

  if (grant.startsAt !== undefined) {
    if (!isIsoDateTime(grant.startsAt)) {
      return GRANT_STATUSES.EXPIRED;
    }

    if (nowMs < parseIsoDateTimeMs(grant.startsAt)) {
      return GRANT_STATUSES.SCHEDULED;
    }
  }

  return GRANT_STATUSES.ACTIVE;
}

export function isGrantActiveAt(
  grant: Pick<PermissionGrant, 'status' | 'startsAt' | 'expiresAt' | 'revokedAt'>,
  now: IsoDateTime,
): boolean {
  return deriveGrantStatus(grant, now) === GRANT_STATUSES.ACTIVE;
}

/**
 * Avalia se uma regra de negação explícita está ativa em `now`.
 * Em modo falha fechada, timestamps malformados mantêm a negação ativa.
 */
export function isDenyRuleActiveAt(
  rule: Pick<ExplicitDenyRule, 'expiresAt' | 'revokedAt'>,
  now: IsoDateTime,
): boolean {
  if (rule.revokedAt !== undefined) {
    return false;
  }

  if (rule.expiresAt !== undefined) {
    if (!isIsoDateTime(now) || !isIsoDateTime(rule.expiresAt)) {
      return true;
    }

    if (parseIsoDateTimeMs(now) >= parseIsoDateTimeMs(rule.expiresAt)) {
      return false;
    }
  }

  return true;
}

function buildStringIdSet(ids: readonly (string | undefined)[] | undefined): ReadonlySet<string> {
  const set = new Set<string>();
  if (ids === undefined) {
    return set;
  }

  for (const id of ids) {
    if (id !== undefined) {
      set.add(id);
    }
  }

  return set;
}

/**
 * Valida se `grantor` possui autoridade legítima para delegar `targetPermission` em `scope`
 * (permission-matrix.md §6 regras 1–3 e §11 cenários 9 e 17).
 *
 * Regras invioláveis:
 * - MEMBER nunca delega permissões.
 * - `demo.maintenance.*` nunca é herdado de ADMIN ou MANAGER; exige autoridade especial explícita.
 * - MANAGER nunca delega autoridade organizacional, alterações de papel, decisões de contestação/reabertura
 *   ou qualquer permissão fora dos projetos/equipes explicitamente sob sua administração.
 */
export function canGrantorDelegatePermission(
  grantor: GrantorAuthority,
  targetPermission: PermissionCode,
  scope: PermissionTargetScope,
): boolean {
  if (!isPermissionCode(targetPermission)) {
    return false;
  }

  if (!isOrganizationRole(grantor.role)) {
    return false;
  }

  if (!isPermissionScopeType(scope.scopeType)) {
    return false;
  }

  if (grantor.organizationId !== scope.organizationId) {
    return false;
  }

  if (
    grantor.membershipStatus !== undefined &&
    grantor.membershipStatus !== MEMBERSHIP_STATUSES.ACTIVE
  ) {
    return false;
  }

  if (scope.scopeType !== PERMISSION_SCOPE_TYPES.ORGANIZATION && scope.scopeId === undefined) {
    return false;
  }

  if (grantor.role === ORGANIZATION_ROLES.MEMBER) {
    return false;
  }

  if (DEMO_MAINTENANCE_PERMISSIONS.has(targetPermission)) {
    return grantor.hasDemoMaintenanceDelegationAuthority === true;
  }

  if (grantor.role === ORGANIZATION_ROLES.ADMIN) {
    return true;
  }

  // MANAGER: nunca delega escopo organizacional nem permissões exclusivas de ADMIN ou fora da allowlist delegável
  if (scope.scopeType === PERMISSION_SCOPE_TYPES.ORGANIZATION) {
    return false;
  }

  if (
    ADMIN_ONLY_PERMISSIONS.has(targetPermission) ||
    !MANAGER_DELEGABLE_PERMISSIONS.has(targetPermission)
  ) {
    return false;
  }

  const managedProjectScopes = buildStringIdSet([
    ...(grantor.managedProjectIds ?? []),
    ...(grantor.managedScopeIds ?? []),
  ]);
  const managedTeamScopes = buildStringIdSet([
    ...(grantor.managedTeamIds ?? []),
    ...(grantor.managedScopeIds ?? []),
  ]);
  const allManagedScopes = buildStringIdSet(grantor.managedScopeIds);

  if (scope.scopeType === PERMISSION_SCOPE_TYPES.PROJECT) {
    return scope.scopeId !== undefined && managedProjectScopes.has(scope.scopeId);
  }

  if (scope.scopeType === PERMISSION_SCOPE_TYPES.TEAM) {
    return scope.scopeId !== undefined && managedTeamScopes.has(scope.scopeId);
  }

  // RESOURCE scope: o recurso precisa pertencer a um projeto ou equipe administrado pelo MANAGER
  const managesResourceProject =
    scope.projectId !== undefined && managedProjectScopes.has(scope.projectId);
  const managesResourceTeam = scope.teamId !== undefined && managedTeamScopes.has(scope.teamId);
  const managesExactResource = scope.scopeId !== undefined && allManagedScopes.has(scope.scopeId);

  return managesResourceProject || managesResourceTeam || managesExactResource;
}
