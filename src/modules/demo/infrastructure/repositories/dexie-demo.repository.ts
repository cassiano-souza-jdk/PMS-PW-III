import { TRANSACTION_RESOURCES, parseIsoDateTimeMs, type OrganizationId } from '@/shared/kernel';
import {
  appendImmutableEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { MaintenanceEventRepositoryPort } from '../../application/ports/demo-repository.port';
import type { MaintenanceEvent, MaintenanceEventId } from '../../domain/maintenance-event';

export class DexieMaintenanceEventRepository implements MaintenanceEventRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<MaintenanceEvent, MaintenanceEventId>(
      TRANSACTION_RESOURCES.MAINTENANCE_EVENTS,
    );
  }

  async append(event: MaintenanceEvent): Promise<void> {
    await appendImmutableEntity(this.table, event, 'MaintenanceEvent');
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly MaintenanceEvent[]> {
    return withPersistenceErrorHandling('MaintenanceEvent.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.occurredAt) - parseIsoDateTimeMs(a.occurredAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }
}
