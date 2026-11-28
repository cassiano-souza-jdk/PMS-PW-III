import {
  TRANSACTION_RESOURCES,
  type OrganizationId,
  type ProjectId,
  type UserId,
} from '@/shared/kernel';
import {
  deleteOrganizationScopedById,
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { DashboardPreferenceRepositoryPort } from '../../application/ports/analytics-repository.port';
import type {
  DashboardPreference,
  DashboardPreferenceId,
  DashboardScope,
} from '../../domain/analytics';

export class DexieDashboardPreferenceRepository implements DashboardPreferenceRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<DashboardPreference, DashboardPreferenceId>(
      TRANSACTION_RESOURCES.DASHBOARD_PREFERENCES,
    );
  }

  async findById(
    organizationId: OrganizationId,
    preferenceId: DashboardPreferenceId,
  ): Promise<DashboardPreference | null> {
    return findOrganizationScopedById(
      this.table,
      organizationId,
      preferenceId,
      'DashboardPreference',
    );
  }

  async findByUserAndScope(
    organizationId: OrganizationId,
    userId: UserId,
    scope: DashboardScope,
    projectId?: ProjectId,
  ): Promise<DashboardPreference | null> {
    return withPersistenceErrorHandling('DashboardPreference.findByUserAndScope', async () => {
      const candidates = await this.table
        .where('[organizationId+userId+scope]')
        .equals([organizationId, userId, scope])
        .toArray();

      const match = candidates.find((candidate) => candidate.projectId === projectId);
      return match ?? null;
    });
  }

  async listByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly DashboardPreference[]> {
    return withPersistenceErrorHandling('DashboardPreference.listByUser', async () => {
      return this.table.where('[organizationId+userId]').equals([organizationId, userId]).toArray();
    });
  }

  /**
   * Logical uniqueness per `(organizationId, userId, scope, projectId)` over the preserved `v2` schema
   * (ADR-0014 §5): reuses `existing.id` when a preference already exists for the same key.
   */
  async save(preference: DashboardPreference): Promise<DashboardPreference> {
    const existing = await this.findByUserAndScope(
      preference.organizationId,
      preference.userId,
      preference.scope,
      preference.projectId,
    );

    const toPersist: DashboardPreference =
      existing !== null && existing.id !== preference.id
        ? { ...preference, id: existing.id }
        : preference;

    await saveOrganizationScopedEntity(this.table, toPersist, 'DashboardPreference');
    return toPersist;
  }

  async delete(organizationId: OrganizationId, preferenceId: DashboardPreferenceId): Promise<void> {
    await deleteOrganizationScopedById(
      this.table,
      organizationId,
      preferenceId,
      'DashboardPreference',
    );
  }
}
