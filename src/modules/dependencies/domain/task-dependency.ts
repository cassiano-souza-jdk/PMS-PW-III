import { ConflictError } from '@/shared/errors';
import {
  parseBrandedUuid,
  type Brand,
  type IsoDateTime,
  type OrganizationScoped,
  type ProjectId,
  type TaskId,
  type UserId,
} from '@/shared/kernel';

export type TaskDependencyId = Brand<string, 'TaskDependencyId'>;

export function asTaskDependencyId(
  value: string,
  fieldName = 'taskDependencyId',
): TaskDependencyId {
  return parseBrandedUuid<'TaskDependencyId'>(value, fieldName);
}

export interface DependencyEdge {
  readonly taskId: TaskId;
  readonly dependsOnTaskId: TaskId;
}

export interface TaskDependency extends OrganizationScoped, DependencyEdge {
  readonly id: TaskDependencyId;
  readonly projectId: ProjectId;
  readonly required: boolean;
  readonly createdByUserId: UserId;
  readonly createdAt: IsoDateTime;
}

/**
 * Pure directed-graph cycle detection (PRD.md §11 / DOMAIN.md):
 * detects self-dependencies, direct cycles (A -> B -> A) and indirect cycles (A -> B -> C -> A).
 */
export function hasDependencyCycle(
  existingEdges: readonly DependencyEdge[],
  candidateEdge: DependencyEdge,
): boolean {
  if (candidateEdge.taskId === candidateEdge.dependsOnTaskId) {
    return true;
  }

  const adjacency = new Map<TaskId, TaskId[]>();
  const addEdge = (from: TaskId, to: TaskId): void => {
    const neighbors = adjacency.get(from);
    if (neighbors) {
      neighbors.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  };

  for (const edge of existingEdges) {
    addEdge(edge.taskId, edge.dependsOnTaskId);
  }
  addEdge(candidateEdge.taskId, candidateEdge.dependsOnTaskId);

  // Starting from candidateEdge.dependsOnTaskId, check if we can reach candidateEdge.taskId.
  const visited = new Set<TaskId>();
  const stack: TaskId[] = [candidateEdge.dependsOnTaskId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    if (current === candidateEdge.taskId) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const next of neighbors) {
        if (!visited.has(next)) {
          stack.push(next);
        }
      }
    }
  }

  return false;
}

export function assertNoDependencyCycle(
  existingEdges: readonly DependencyEdge[],
  candidateEdge: DependencyEdge,
): void {
  if (candidateEdge.taskId === candidateEdge.dependsOnTaskId) {
    throw new ConflictError('A task cannot depend on itself.', {
      details: { taskId: candidateEdge.taskId },
    });
  }

  if (hasDependencyCycle(existingEdges, candidateEdge)) {
    throw new ConflictError('Adding this dependency would create a cyclic dependency graph.', {
      details: {
        taskId: candidateEdge.taskId,
        dependsOnTaskId: candidateEdge.dependsOnTaskId,
      },
    });
  }
}

export function getPendingRequiredDependencies(
  taskId: TaskId,
  dependencies: readonly TaskDependency[],
  completedTaskIds: ReadonlySet<TaskId>,
): readonly TaskDependency[] {
  return dependencies.filter(
    (dependency) =>
      dependency.taskId === taskId &&
      dependency.required &&
      !completedTaskIds.has(dependency.dependsOnTaskId),
  );
}
