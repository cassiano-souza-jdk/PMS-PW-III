import {
  TRANSACTION_RESOURCES,
  parseIsoDateTimeMs,
  type OrganizationId,
  type ProjectId,
} from '@/shared/kernel';
import {
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { BottleneckAlertRepositoryPort } from '../../application/ports/bottleneck-repository.port';
import {
  isBottleneckAlertResolved,
  type BottleneckAlert,
  type BottleneckAlertId,
  type BottleneckAlertStatus,
} from '../../domain/bottleneck';

export class DexieBottleneckAlertRepository implements BottleneckAlertRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<BottleneckAlert, BottleneckAlertId>(
      TRANSACTION_RESOURCES.BOTTLENECK_ALERTS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    alertId: BottleneckAlertId,
  ): Promise<BottleneckAlert | null> {
    return findOrganizationScopedById(this.table, organizationId, alertId, 'BottleneckAlert');
  }

  async findActiveByDeduplicationKey(
    organizationId: OrganizationId,
    deduplicationKey: string,
  ): Promise<BottleneckAlert | null> {
    return withPersistenceErrorHandling(
      'BottleneckAlert.findActiveByDeduplicationKey',
      async () => {
        const matches = await this.table
          .where('[organizationId+deduplicationKey]')
          .equals([organizationId, deduplicationKey])
          .toArray();

        const active = matches.find((alert) => !isBottleneckAlertResolved(alert));
        return active ?? null;
      },
    );
  }

  async listByOrganization(
    organizationId: OrganizationId,
    options?: {
      readonly projectId?: ProjectId;
      readonly status?: BottleneckAlertStatus;
    },
  ): Promise<readonly BottleneckAlert[]> {
    return withPersistenceErrorHandling('BottleneckAlert.listByOrganization', async () => {
      let records: BottleneckAlert[];

      if (options?.projectId !== undefined && options?.status !== undefined) {
        records = await this.table
          .where('[organizationId+projectId+status]')
          .equals([organizationId, options.projectId, options.status])
          .toArray();
      } else if (options?.projectId !== undefined) {
        records = await this.table
          .where('[organizationId+projectId]')
          .equals([organizationId, options.projectId])
          .toArray();
      } else if (options?.status !== undefined) {
        records = await this.table
          .where('[organizationId+status]')
          .equals([organizationId, options.status])
          .toArray();
      } else {
        records = await this.table.where('organizationId').equals(organizationId).toArray();
      }

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.lastSeenAt) - parseIsoDateTimeMs(a.lastSeenAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(alert: BottleneckAlert): Promise<void> {
    await saveOrganizationScopedEntity(this.table, alert, 'BottleneckAlert');
  }
}
