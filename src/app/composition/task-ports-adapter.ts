import type {
  DependencyActorProjectScopes,
  DependencyProjectSummary,
  DependencyTaskSummary,
  DependencyWorkContextPort,
} from '@/modules/dependencies';
import type {
  ImpedimentActorProjectScopes,
  ImpedimentProjectSummary,
  ImpedimentTaskSummary,
  ImpedimentWorkContextPort,
} from '@/modules/impediments';
import {
  assertWipAllowsCardMove,
  doesTaskStatusOccupyWip,
  type BoardColumn,
} from '@/modules/kanban';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import type {
  TaskActorProjectScopes,
  TaskProjectBoardContext,
  TaskProjectContextPort,
  TaskProjectSummary,
} from '@/modules/tasks';
import {
  asIsoDateTime,
  isSoftDeleted,
  type OrganizationId,
  type ProjectId,
  type TaskId,
  type UserId,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';

async function resolveActorProjectScopes(
  repositories: AppRepositoriesRegistry,
  organizationId: OrganizationId,
  userId: UserId,
): Promise<{
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}> {
  const [orgProjects, actorProjectMemberships] = await Promise.all([
    repositories.projects.projects.listByOrganization(organizationId, {
      includeArchived: true,
      includeDeleted: true,
    }),
    repositories.projects.projectMembers.listByUser(organizationId, userId),
  ]);

  const activeProjectIdSet = new Set(
    orgProjects.filter((project) => !isSoftDeleted(project)).map((project) => project.id),
  );

  const activeMemberships = actorProjectMemberships.filter(
    (member) => member.removedAt === undefined && activeProjectIdSet.has(member.projectId),
  );

  const managedProjectIds = activeMemberships
    .filter((member) => member.projectRole === PROJECT_MEMBER_ROLES.MANAGER)
    .map((member) => member.projectId);

  const participatedProjectIds = activeMemberships.map((member) => member.projectId);

  return { managedProjectIds, participatedProjectIds };
}

/**
 * Thin composition-layer adapter bridging `TaskProjectContextPort` to `projects` and `kanban`
 * repositories/domain policies without breaking the acyclic DAG (ADR-0011 §3).
 */
export function createTaskProjectContextAdapter(
  repositories: AppRepositoriesRegistry,
): TaskProjectContextPort {
  return {
    async findProjectById(
      organizationId: OrganizationId,
      projectId: ProjectId,
    ): Promise<TaskProjectSummary | null> {
      const project = await repositories.projects.projects.findById(organizationId, projectId);
      if (!project) {
        return null;
      }

      return {
        id: project.id,
        organizationId: project.organizationId,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        name: project.name,
        status: project.status,
        ownerUserId: project.ownerUserId,
        ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
        ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
      };
    },

    listActorProjectScopes(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<TaskActorProjectScopes> {
      return resolveActorProjectScopes(repositories, organizationId, userId);
    },

    async isProjectParticipant(
      organizationId: OrganizationId,
      projectId: ProjectId,
      userId: UserId,
    ): Promise<boolean> {
      const member = await repositories.projects.projectMembers.findByProjectAndUser(
        organizationId,
        projectId,
        userId,
      );
      return member !== null && member.removedAt === undefined;
    },

    async findPrimaryBoardWithColumns(
      organizationId: OrganizationId,
      projectId: ProjectId,
    ): Promise<TaskProjectBoardContext | null> {
      const board = await repositories.kanban.projectBoards.findPrimaryByProject(
        organizationId,
        projectId,
      );
      if (!board) {
        return null;
      }

      const columns = await repositories.kanban.boardColumns.listByBoard(organizationId, board.id, {
        includeArchived: true,
      });

      return {
        boardId: board.id,
        boardName: board.name,
        columns,
      };
    },

    assertWipAllowsPlacement({ targetColumn, currentColumnTasks, movingTaskStatus }): void {
      const occupyingCount = currentColumnTasks.filter((task) =>
        doesTaskStatusOccupyWip(task.status),
      ).length;
      const fallbackNow = asIsoDateTime('2026-01-01T00:00:00.000Z');
      const boardColumn: BoardColumn = {
        id: targetColumn.id,
        organizationId: targetColumn.organizationId,
        boardId: targetColumn.boardId,
        name: targetColumn.name,
        columnRole: targetColumn.columnRole,
        order: targetColumn.order,
        wipLimit: targetColumn.wipLimit,
        ...(targetColumn.archivedAt !== undefined ? { archivedAt: targetColumn.archivedAt } : {}),
        createdAt: targetColumn.createdAt ?? fallbackNow,
        updatedAt: targetColumn.updatedAt ?? fallbackNow,
      };

      assertWipAllowsCardMove({
        targetColumn: boardColumn,
        currentColumnOccupyingTaskCount: occupyingCount,
        movingTaskStatus,
      });
    },
  };
}

/**
 * Thin composition-layer adapter bridging `DependencyWorkContextPort` to `projects` and `tasks`
 * repositories without introducing `dependencies -> tasks/projects/kanban` cycles (ADR-0011 §3).
 */
export function createDependencyWorkContextAdapter(
  repositories: AppRepositoriesRegistry,
): DependencyWorkContextPort {
  const buildTaskSummary = async (
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<DependencyTaskSummary | null> => {
    const task = await repositories.tasks.tasks.findById(organizationId, taskId);
    if (!task) {
      return null;
    }

    const participants = await repositories.tasks.taskParticipants.listByTask(
      organizationId,
      taskId,
    );
    const participantIds = participants
      .filter((participant) => participant.removedAt === undefined)
      .map((participant) => participant.userId);

    return {
      id: task.id,
      organizationId: task.organizationId,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      createdByUserId: task.createdByUserId,
      ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
      participantIds,
      ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
    };
  };

  return {
    async findProjectById(
      organizationId: OrganizationId,
      projectId: ProjectId,
    ): Promise<DependencyProjectSummary | null> {
      const project = await repositories.projects.projects.findById(organizationId, projectId);
      if (!project) {
        return null;
      }

      return {
        id: project.id,
        organizationId: project.organizationId,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        ownerUserId: project.ownerUserId,
        status: project.status,
        ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
        ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
      };
    },

    listActorProjectScopes(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<DependencyActorProjectScopes> {
      return resolveActorProjectScopes(repositories, organizationId, userId);
    },

    findTaskWorkContext(
      organizationId: OrganizationId,
      taskId: TaskId,
    ): Promise<DependencyTaskSummary | null> {
      return buildTaskSummary(organizationId, taskId);
    },

    async findTasksWorkContext(
      organizationId: OrganizationId,
      taskIds: readonly TaskId[],
    ): Promise<readonly DependencyTaskSummary[]> {
      const results = await Promise.all(
        taskIds.map((taskId) => buildTaskSummary(organizationId, taskId)),
      );
      return results.filter((item): item is DependencyTaskSummary => item !== null);
    },

    async touchTaskActivity(organizationId, taskId, now): Promise<void> {
      const task = await repositories.tasks.tasks.findById(organizationId, taskId);
      if (!task) {
        return;
      }

      await repositories.tasks.tasks.save({
        ...task,
        lastMovedAt: task.lastMovedAt,
        lastActivityAt: now,
        updatedAt: now,
      });
    },
  };
}

/**
 * Thin composition-layer adapter bridging `ImpedimentWorkContextPort` to `projects`, `kanban` and `tasks`
 * repositories without introducing `impediments -> tasks/projects/kanban` cycles (ADR-0011 §3).
 */
export function createImpedimentWorkContextAdapter(
  repositories: AppRepositoriesRegistry,
): ImpedimentWorkContextPort {
  return {
    async findProjectById(
      organizationId: OrganizationId,
      projectId: ProjectId,
    ): Promise<ImpedimentProjectSummary | null> {
      const project = await repositories.projects.projects.findById(organizationId, projectId);
      if (!project) {
        return null;
      }

      return {
        id: project.id,
        organizationId: project.organizationId,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        ownerUserId: project.ownerUserId,
        status: project.status,
        ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
        ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
      };
    },

    listActorProjectScopes(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<ImpedimentActorProjectScopes> {
      return resolveActorProjectScopes(repositories, organizationId, userId);
    },

    async findTaskWorkContext(
      organizationId: OrganizationId,
      taskId: TaskId,
    ): Promise<ImpedimentTaskSummary | null> {
      const task = await repositories.tasks.tasks.findById(organizationId, taskId);
      if (!task) {
        return null;
      }

      const [participants, pauses, column] = await Promise.all([
        repositories.tasks.taskParticipants.listByTask(organizationId, taskId),
        repositories.tasks.taskPauses.listByTask(organizationId, taskId),
        repositories.kanban.boardColumns.findById(organizationId, task.columnId),
      ]);

      const participantIds = participants
        .filter((participant) => participant.removedAt === undefined)
        .map((participant) => participant.userId);

      return {
        id: task.id,
        organizationId: task.organizationId,
        projectId: task.projectId,
        columnId: task.columnId,
        columnRole: column?.columnRole ?? 'OPERATIONAL',
        status: task.status,
        ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
        createdByUserId: task.createdByUserId,
        ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
        participantIds,
        hasOpenPause: pauses.some((pause) => pause.endedAt === undefined),
        ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
      };
    },

    async syncTaskAfterImpedimentChange({
      organizationId,
      taskId,
      nextStatus,
      now,
    }): Promise<void> {
      const task = await repositories.tasks.tasks.findById(organizationId, taskId);
      if (!task) {
        return;
      }

      await repositories.tasks.tasks.save({
        ...task,
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        lastMovedAt: task.lastMovedAt,
        lastActivityAt: now,
        updatedAt: now,
      });
    },
  };
}
