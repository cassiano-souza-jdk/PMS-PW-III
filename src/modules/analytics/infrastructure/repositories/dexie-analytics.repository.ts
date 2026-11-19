import {
  TRANSACTION_RESOURCES,
  type OrganizationId,
  type ProjectId,
  type UserId,
} from '@/shared/kernel';
import {
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

  async save(preference: DashboardPreference): Promise<void> {
    await saveOrganizationScopedEntity(this.table, preference, 'DashboardPreference');
  }
}
