import type { EntityId, GrantId, IsoDateTime, OrganizationId, UserId } from '@/shared/kernel';
import type {
  DenyRuleId,
  ExplicitDenyRule,
  PermissionGrant,
  PermissionScopeType,
} from '../../domain/grants';

export interface PermissionGrantRepositoryPort {
  findById(organizationId: OrganizationId, grantId: GrantId): Promise<PermissionGrant | null>;

  listByGrantee(
    organizationId: OrganizationId,
    granteeUserId: UserId,
  ): Promise<readonly PermissionGrant[]>;

  listActiveByGrantee(
    organizationId: OrganizationId,
    granteeUserId: UserId,
    at: IsoDateTime,
  ): Promise<readonly PermissionGrant[]>;

  listByOrganization(organizationId: OrganizationId): Promise<readonly PermissionGrant[]>;

  save(grant: PermissionGrant): Promise<void>;

  revoke(
    organizationId: OrganizationId,
    grantId: GrantId,
    revokedByUserId: UserId,
    revokedAt: IsoDateTime,
  ): Promise<void>;

  /**
   * Revoga imediatamente todas as concessões vinculadas ao escopo removido
   * (permission-matrix.md §6 regra 6 e §11 cenário 7).
   */
  revokeByScope(
    organizationId: OrganizationId,
    userId: UserId,
    scopeType: PermissionScopeType,
    scopeId: EntityId,
    revokedByUserId: UserId,
    revokedAt: IsoDateTime,
  ): Promise<number>;

  /**
   * Revoga imediatamente todas as concessões de quaisquer usuários vinculadas a um escopo
   * desativado ou excluído logicamente (ADR-0009 §1.4 & §3.1).
   */
  revokeAllByScope(
    organizationId: OrganizationId,
    scopeType: PermissionScopeType,
    scopeId: EntityId,
    revokedByUserId: UserId,
    revokedAt: IsoDateTime,
  ): Promise<number>;
}

export interface ExplicitDenyRuleRepositoryPort {
  findById(
    organizationId: OrganizationId,
    denyRuleId: DenyRuleId,
  ): Promise<ExplicitDenyRule | null>;

  listByTargetUser(
    organizationId: OrganizationId,
    targetUserId: UserId,
  ): Promise<readonly ExplicitDenyRule[]>;

  listActiveByTargetUser(
    organizationId: OrganizationId,
    targetUserId: UserId,
    at: IsoDateTime,
  ): Promise<readonly ExplicitDenyRule[]>;

  listByOrganization(organizationId: OrganizationId): Promise<readonly ExplicitDenyRule[]>;

  save(rule: ExplicitDenyRule): Promise<void>;

  revoke(
    organizationId: OrganizationId,
    denyRuleId: DenyRuleId,
    revokedAt: IsoDateTime,
  ): Promise<void>;
}
