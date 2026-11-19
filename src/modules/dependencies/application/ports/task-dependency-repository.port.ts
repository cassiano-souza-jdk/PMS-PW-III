import type { OrganizationId, ProjectId, TaskId } from '@/shared/kernel';
import type { TaskDependency, TaskDependencyId } from '../../domain/task-dependency';

export interface TaskDependencyRepositoryPort {
  findById(
    organizationId: OrganizationId,
    dependencyId: TaskDependencyId,
  ): Promise<TaskDependency | null>;
  listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly TaskDependency[]>;
  listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskDependency[]>;
  save(dependency: TaskDependency): Promise<void>;
  delete(organizationId: OrganizationId, dependencyId: TaskDependencyId): Promise<void>;
}
