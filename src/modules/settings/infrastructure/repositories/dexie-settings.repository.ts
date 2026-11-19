import {
  TRANSACTION_RESOURCES,
  assertSameOrganization,
  type OrganizationId,
} from '@/shared/kernel';
import { withPersistenceErrorHandling, type PmsDatabase } from '@/shared/persistence';
import type { OrganizationSettingsRepositoryPort } from '../../application/ports/settings-repository.port';
import type { OrganizationSettings } from '../../domain/organization-settings';

export class DexieOrganizationSettingsRepository implements OrganizationSettingsRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<OrganizationSettings, OrganizationId>(
      TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS,
    );
  }

  async findByOrganization(organizationId: OrganizationId): Promise<OrganizationSettings | null> {
    return withPersistenceErrorHandling('OrganizationSettings.findByOrganization', async () => {
      const record = await this.table.get(organizationId);
      if (record === undefined || record.organizationId !== organizationId) {
        return null;
      }
      return record;
    });
  }

  async save(settings: OrganizationSettings): Promise<void> {
    await withPersistenceErrorHandling('OrganizationSettings.save', async () => {
      const existing = await this.table.get(settings.organizationId);
      if (existing !== undefined) {
        assertSameOrganization(
          existing.organizationId,
          settings.organizationId,
          'OrganizationSettings',
        );
      }

      await this.table.put(settings);
    });
  }
}
