import { NotFoundError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  type EntityId,
  type GrantId,
  type IsoDateTime,
  type OrganizationId,
  type UserId,
} from '@/shared/kernel';
import {
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  ExplicitDenyRuleRepositoryPort,
  PermissionGrantRepositoryPort,
} from '../../application/ports/authorization-repository.port';
import {
  GRANT_STATUSES,
  isDenyRuleActiveAt,
  isGrantActiveAt,
  type DenyRuleId,
  type ExplicitDenyRule,
  type PermissionGrant,
  type PermissionScopeType,
} from '../../domain/grants';

export class DexiePermissionGrantRepository implements PermissionGrantRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<PermissionGrant, GrantId>(TRANSACTION_RESOURCES.PERMISSION_GRANTS);
  }

  async findById(
    organizationId: OrganizationId,
    grantId: GrantId,
  ): Promise<PermissionGrant | null> {
    return findOrganizationScopedById(this.table, organizationId, grantId, 'PermissionGrant');
  }

  async listByGrantee(
    organizationId: OrganizationId,
    granteeUserId: UserId,
  ): Promise<readonly PermissionGrant[]> {
    return withPersistenceErrorHandling('PermissionGrant.listByGrantee', async () => {
      return this.table
        .where('[organizationId+granteeUserId]')
        .equals([organizationId, granteeUserId])
        .toArray();
    });
  }

  async listActiveByGrantee(
    organizationId: OrganizationId,
    granteeUserId: UserId,
    at: IsoDateTime,
  ): Promise<readonly PermissionGrant[]> {
    const grants = await this.listByGrantee(organizationId, granteeUserId);
    return grants.filter((grant) => isGrantActiveAt(grant, at));
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly PermissionGrant[]> {
    return withPersistenceErrorHandling('PermissionGrant.listByOrganization', async () => {
      return this.table.where('organizationId').equals(organizationId).toArray();
    });
  }

  async save(grant: PermissionGrant): Promise<void> {
    await saveOrganizationScopedEntity(this.table, grant, 'PermissionGrant');
  }

  async revoke(
    organizationId: OrganizationId,
    grantId: GrantId,
    revokedByUserId: UserId,
    revokedAt: IsoDateTime,
  ): Promise<void> {
    await withPersistenceErrorHandling('PermissionGrant.revoke', async () => {
      const existing = await findOrganizationScopedById(
        this.table,
        organizationId,
        grantId,
        'PermissionGrant',
      );
      if (!existing) {
        throw new NotFoundError(`PermissionGrant "${grantId}" was not found.`, {
          details: { grantId, organizationId },
        });
      }

      if (existing.revokedAt !== undefined && existing.status === GRANT_STATUSES.REVOKED) {
        return;
      }

      const revokedGrant: PermissionGrant = {
        ...existing,
        revokedAt,
        revokedByUserId,
        status: GRANT_STATUSES.REVOKED,
      };

      await this.table.put(revokedGrant);
    });
  }

  async revokeByScope(
    organizationId: OrganizationId,
    userId: UserId,
    scopeType: PermissionScopeType,
    scopeId: EntityId,
    revokedByUserId: UserId,
    revokedAt: IsoDateTime,
  ): Promise<number> {
    return withPersistenceErrorHandling('PermissionGrant.revokeByScope', async () => {
      const candidates = await this.table
        .where('[organizationId+granteeUserId+scopeType]')
        .equals([organizationId, userId, scopeType])
        .toArray();

      const grantsToRevoke = candidates.filter(
        (grant) =>
          grant.scopeId === scopeId &&
          grant.revokedAt === undefined &&
          grant.status !== GRANT_STATUSES.REVOKED,
      );

      if (grantsToRevoke.length === 0) {
        return 0;
      }

      const updatedGrants: PermissionGrant[] = grantsToRevoke.map((grant) => ({
        ...grant,
        revokedAt,
        revokedByUserId,
        status: GRANT_STATUSES.REVOKED,
      }));

      await this.table.bulkPut(updatedGrants);
      return updatedGrants.length;
    });
  }
}

export class DexieExplicitDenyRuleRepository implements ExplicitDenyRuleRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<ExplicitDenyRule, DenyRuleId>(
      TRANSACTION_RESOURCES.EXPLICIT_DENY_RULES,
    );
  }

  async findById(
    organizationId: OrganizationId,
    denyRuleId: DenyRuleId,
  ): Promise<ExplicitDenyRule | null> {
    return findOrganizationScopedById(this.table, organizationId, denyRuleId, 'ExplicitDenyRule');
  }

  async listByTargetUser(
    organizationId: OrganizationId,
    targetUserId: UserId,
  ): Promise<readonly ExplicitDenyRule[]> {
    return withPersistenceErrorHandling('ExplicitDenyRule.listByTargetUser', async () => {
      return this.table
        .where('[organizationId+targetUserId]')
        .equals([organizationId, targetUserId])
        .toArray();
    });
  }

  async listActiveByTargetUser(
    organizationId: OrganizationId,
    targetUserId: UserId,
    at: IsoDateTime,
  ): Promise<readonly ExplicitDenyRule[]> {
    const rules = await this.listByTargetUser(organizationId, targetUserId);
    return rules.filter((rule) => isDenyRuleActiveAt(rule, at));
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly ExplicitDenyRule[]> {
    return withPersistenceErrorHandling('ExplicitDenyRule.listByOrganization', async () => {
      return this.table.where('organizationId').equals(organizationId).toArray();
    });
  }

  async save(rule: ExplicitDenyRule): Promise<void> {
    await saveOrganizationScopedEntity(this.table, rule, 'ExplicitDenyRule');
  }

  async revoke(
    organizationId: OrganizationId,
    denyRuleId: DenyRuleId,
    revokedAt: IsoDateTime,
  ): Promise<void> {
    await withPersistenceErrorHandling('ExplicitDenyRule.revoke', async () => {
      const existing = await findOrganizationScopedById(
        this.table,
        organizationId,
        denyRuleId,
        'ExplicitDenyRule',
      );
      if (!existing) {
        throw new NotFoundError(`ExplicitDenyRule "${denyRuleId}" was not found.`, {
          details: { denyRuleId, organizationId },
        });
      }

      if (existing.revokedAt !== undefined) {
        return;
      }

      await this.table.put({
        ...existing,
        revokedAt,
      });
    });
  }
}
