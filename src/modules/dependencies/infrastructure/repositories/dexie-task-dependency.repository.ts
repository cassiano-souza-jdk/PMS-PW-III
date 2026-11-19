import {
  TRANSACTION_RESOURCES,
  parseIsoDateTimeMs,
  type OrganizationId,
  type ProjectId,
  type TaskId,
} from '@/shared/kernel';
import {
  deleteOrganizationScopedById,
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { TaskDependencyRepositoryPort } from '../../application/ports/task-dependency-repository.port';
import type { TaskDependency, TaskDependencyId } from '../../domain/task-dependency';

export class DexieTaskDependencyRepository implements TaskDependencyRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskDependency, TaskDependencyId>(
      TRANSACTION_RESOURCES.TASK_DEPENDENCIES,
    );
  }

  async findById(
    organizationId: OrganizationId,
    dependencyId: TaskDependencyId,
  ): Promise<TaskDependency | null> {
    return findOrganizationScopedById(this.table, organizationId, dependencyId, 'TaskDependency');
  }

  async listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly TaskDependency[]> {
    return withPersistenceErrorHandling('TaskDependency.listByProject', async () => {
      const records = await this.table
        .where('[organizationId+projectId]')
        .equals([organizationId, projectId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskDependency[]> {
    return withPersistenceErrorHandling('TaskDependency.listByTask', async () => {
      const [outgoing, incoming] = await Promise.all([
        this.table.where('[organizationId+taskId]').equals([organizationId, taskId]).toArray(),
        this.table
          .where('[organizationId+dependsOnTaskId]')
          .equals([organizationId, taskId])
          .toArray(),
      ]);

      const mergedById = new Map<TaskDependencyId, TaskDependency>();
      for (const dependency of outgoing) {
        mergedById.set(dependency.id, dependency);
      }
      for (const dependency of incoming) {
        mergedById.set(dependency.id, dependency);
      }

      return [...mergedById.values()].sort(
        (a, b) =>
          parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(dependency: TaskDependency): Promise<void> {
    await saveOrganizationScopedEntity(this.table, dependency, 'TaskDependency');
  }

  async delete(organizationId: OrganizationId, dependencyId: TaskDependencyId): Promise<void> {
    await deleteOrganizationScopedById(this.table, organizationId, dependencyId, 'TaskDependency');
  }
}
