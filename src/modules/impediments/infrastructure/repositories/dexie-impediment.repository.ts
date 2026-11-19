import {
  TRANSACTION_RESOURCES,
  parseIsoDateTimeMs,
  type ImpedimentId,
  type OrganizationId,
  type ProjectId,
  type TaskId,
} from '@/shared/kernel';
import {
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { ImpedimentRepositoryPort } from '../../application/ports/impediment-repository.port';
import { isImpedimentBlocking, type Impediment } from '../../domain/impediment';

export class DexieImpedimentRepository implements ImpedimentRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Impediment, ImpedimentId>(TRANSACTION_RESOURCES.IMPEDIMENTS);
  }

  async findById(
    organizationId: OrganizationId,
    impedimentId: ImpedimentId,
  ): Promise<Impediment | null> {
    return findOrganizationScopedById(this.table, organizationId, impedimentId, 'Impediment');
  }

  async listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly Impediment[]> {
    return withPersistenceErrorHandling('Impediment.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.openedAt) - parseIsoDateTimeMs(b.openedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly Impediment[]> {
    return withPersistenceErrorHandling('Impediment.listByProject', async () => {
      const records = await this.table
        .where('[organizationId+projectId]')
        .equals([organizationId, projectId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.openedAt) - parseIsoDateTimeMs(b.openedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listOpenByOrganization(organizationId: OrganizationId): Promise<readonly Impediment[]> {
    return withPersistenceErrorHandling('Impediment.listOpenByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records
        .filter((impediment) => isImpedimentBlocking(impediment))
        .sort(
          (a, b) =>
            parseIsoDateTimeMs(a.openedAt) - parseIsoDateTimeMs(b.openedAt) ||
            a.id.localeCompare(b.id),
        );
    });
  }

  async save(impediment: Impediment): Promise<void> {
    await saveOrganizationScopedEntity(this.table, impediment, 'Impediment');
  }
}
