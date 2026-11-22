export {
  asTaskDependencyId,
  assertNoDependencyCycle,
  getPendingRequiredDependencies,
  hasDependencyCycle,
  type DependencyEdge,
  type TaskDependency,
  type TaskDependencyId,
} from './domain/task-dependency';
export type { TaskDependencyRepositoryPort } from './application/ports/task-dependency-repository.port';
export type {
  DependencyActorProjectScopes,
  DependencyProjectSummary,
  DependencyTaskSummary,
  DependencyWorkContextPort,
} from './application/ports/dependency-work-context.port';
export {
  DependencyService,
  type AddTaskDependencyInput,
  type DependencyOperationOptions,
  type DependencyServiceDependencies,
  type RelatedTaskProjection,
  type TaskDependencyListItem,
} from './application/services/dependency-service';
