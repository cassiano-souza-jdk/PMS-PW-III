import type {
  BottleneckActorProjectScopes,
  BottleneckBoardColumnSnapshot,
  BottleneckProjectMemberSnapshot,
  BottleneckProjectSummary,
  BottleneckProjectWorkData,
  BottleneckSubtaskSnapshot,
  BottleneckTaskSnapshot,
  BottleneckUserWorkData,
  BottleneckWorkContextPort,
  UpdateProjectBottleneckRulesRecordInput,
} from '@/modules/bottlenecks';
import type {
  FocusActorProjectScopes,
  FocusImpedimentSnapshot,
  FocusPendingDependencySnapshot,
  FocusProjectSummary,
  FocusSubtaskWorkSnapshot,
  FocusTaskWorkSnapshot,
  FocusWorkContextPort,
} from '@/modules/focus';
import { isImpedimentBlocking, type Impediment } from '@/modules/impediments';
import { doesTaskStatusOccupyWip } from '@/modules/kanban';
import type { Project } from '@/modules/projects';
import { NotFoundError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  TASK_STATUSES,
  isSoftDeleted,
  type ImpedimentSeverity,
  type OrganizationId,
  type ProjectId,
  type TaskId,
  type UserId,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';
import { resolveActorProjectScopes } from './task-ports-adapter';

const IMPEDIMENT_SEVERITY_RANK: Readonly<Record<ImpedimentSeverity, number>> = {
  [IMPEDIMENT_SEVERITIES.LOW]: 1,
  [IMPEDIMENT_SEVERITIES.MEDIUM]: 2,
  [IMPEDIMENT_SEVERITIES.HIGH]: 3,
  [IMPEDIMENT_SEVERITIES.CRITICAL]: 4,
};

function toFocusProjectSummary(project: Project): FocusProjectSummary {
  return {
    id: project.id,
    organizationId: project.organizationId,
    ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
    name: project.name,
    status: project.status,
    ownerUserId: project.ownerUserId,
    inactivityThresholdDays: project.inactivityThresholdDays,
    ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
    ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
  };
}

function toBottleneckProjectSummary(project: Project): BottleneckProjectSummary {
  return {
    id: project.id,
    organizationId: project.organizationId,
    ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
    name: project.name,
    status: project.status,
    ownerUserId: project.ownerUserId,
    inactivityThresholdDays: project.inactivityThresholdDays,
    ...(project.bottleneckThresholds !== undefined
      ? { bottleneckThresholds: project.bottleneckThresholds }
      : {}),
    ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
    ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
  };
}

function resolveMaxImpedimentSeverity(
  impediments: readonly Impediment[],
): ImpedimentSeverity | undefined {
  let maxSeverity: ImpedimentSeverity | undefined;
  let maxRank = 0;

  for (const impediment of impediments) {
    if (!isImpedimentBlocking(impediment)) {
      continue;
    }
    const rank = IMPEDIMENT_SEVERITY_RANK[impediment.severity];
    if (rank > maxRank) {
      maxRank = rank;
      maxSeverity = impediment.severity;
    }
  }

  return maxSeverity;
}

/**
 * Thin composition-layer adapter bridging `FocusWorkContextPort` to `projects`, `tasks`,
 * `dependencies`, and `impediments` repositories without breaking the acyclic DAG (ADR-0012 §3).
 */
export function createFocusWorkContextAdapter(
  repositories: AppRepositoriesRegistry,
): FocusWorkContextPort {
  return {
    listActorProjectScopes(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<FocusActorProjectScopes> {
      return resolveActorProjectScopes(repositories, organizationId, userId);
    },

    async listProjectsByOrganization(
      organizationId: OrganizationId,
    ): Promise<readonly FocusProjectSummary[]> {
      const projects = await repositories.projects.projects.listByOrganization(organizationId, {
        includeArchived: true,
        includeDeleted: true,
      });
      return projects.map(toFocusProjectSummary);
    },

    async listOrganizationTaskSnapshots(
      organizationId: OrganizationId,
    ): Promise<readonly FocusTaskWorkSnapshot[]> {
      const [tasks, participants, openImpediments] = await Promise.all([
        repositories.tasks.tasks.listByOrganization(organizationId, { includeDeleted: true }),
        repositories.tasks.taskParticipants.listByOrganization(organizationId),
        repositories.impediments.impediments.listOpenByOrganization(organizationId),
      ]);

      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const activeParticipantsByTaskId = new Map<TaskId, UserId[]>();
      for (const participant of participants) {
        if (participant.removedAt !== undefined) {
          continue;
        }
        const existing = activeParticipantsByTaskId.get(participant.taskId);
        if (existing) {
          existing.push(participant.userId);
        } else {
          activeParticipantsByTaskId.set(participant.taskId, [participant.userId]);
        }
      }

      const blockingImpedimentsByTaskId = new Map<TaskId, FocusImpedimentSnapshot[]>();
      for (const imp of openImpediments) {
        if (!isImpedimentBlocking(imp)) {
          continue;
        }
        const snapshot: FocusImpedimentSnapshot = {
          id: imp.id,
          severity: imp.severity,
          category: imp.category,
          description: imp.description,
        };
        const list = blockingImpedimentsByTaskId.get(imp.taskId);
        if (list) {
          list.push(snapshot);
        } else {
          blockingImpedimentsByTaskId.set(imp.taskId, [snapshot]);
        }
      }

      const nonDeletedTasks = tasks.filter((task) => !isSoftDeleted(task));
      const distinctProjectIds = [...new Set(nonDeletedTasks.map((task) => task.projectId))];
      const dependenciesByProject = await Promise.all(
        distinctProjectIds.map((projectId) =>
          repositories.dependencies.taskDependencies.listByProject(organizationId, projectId),
        ),
      );

      const pendingDepsByTaskId = new Map<TaskId, FocusPendingDependencySnapshot[]>();
      for (const projectDeps of dependenciesByProject) {
        for (const dep of projectDeps) {
          if (!dep.required) {
            continue;
          }
          const predecessor = tasksById.get(dep.dependsOnTaskId);
          if (
            !predecessor ||
            isSoftDeleted(predecessor) ||
            predecessor.status === TASK_STATUSES.DONE
          ) {
            continue;
          }

          const depSnapshot: FocusPendingDependencySnapshot = {
            dependencyId: dep.id,
            dependsOnTaskId: predecessor.id,
            dependsOnTaskTitle: predecessor.title,
            dependsOnTaskStatus: predecessor.status,
            dependsOnTaskProjectId: predecessor.projectId,
            dependsOnTaskCreatedByUserId: predecessor.createdByUserId,
            ...(predecessor.assigneeId !== undefined
              ? { dependsOnTaskAssigneeId: predecessor.assigneeId }
              : {}),
            dependsOnTaskParticipantIds: activeParticipantsByTaskId.get(predecessor.id) ?? [],
            ...(predecessor.deletedAt !== undefined
              ? { dependsOnTaskDeletedAt: predecessor.deletedAt }
              : {}),
          };

          const existing = pendingDepsByTaskId.get(dep.taskId);
          if (existing) {
            existing.push(depSnapshot);
          } else {
            pendingDepsByTaskId.set(dep.taskId, [depSnapshot]);
          }
        }
      }

      const pausedTasks = nonDeletedTasks.filter((task) => task.status === TASK_STATUSES.PAUSED);
      const pausesByTaskId = new Map<TaskId, string>();
      await Promise.all(
        pausedTasks.map(async (task) => {
          const pauses = await repositories.tasks.taskPauses.listByTask(organizationId, task.id);
          const openPause = pauses.find((pause) => pause.endedAt === undefined);
          if (openPause) {
            pausesByTaskId.set(task.id, openPause.reason);
          }
        }),
      );

      return nonDeletedTasks.map((task) => {
        const openPauseReason = pausesByTaskId.get(task.id);
        return {
          id: task.id,
          organizationId: task.organizationId,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
          lastMovedAt: task.lastMovedAt,
          lastActivityAt: task.lastActivityAt,
          createdByUserId: task.createdByUserId,
          ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
          participantIds: activeParticipantsByTaskId.get(task.id) ?? [],
          ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
          ...(openPauseReason !== undefined ? { openPauseReason } : {}),
          openBlockingImpediments: blockingImpedimentsByTaskId.get(task.id) ?? [],
          pendingRequiredDependencies: pendingDepsByTaskId.get(task.id) ?? [],
        };
      });
    },

    async listOrganizationSubtaskSnapshots(
      organizationId: OrganizationId,
    ): Promise<readonly FocusSubtaskWorkSnapshot[]> {
      const [subtasks, tasks] = await Promise.all([
        repositories.tasks.subtasks.listByOrganization(organizationId),
        repositories.tasks.tasks.listByOrganization(organizationId, { includeDeleted: true }),
      ]);

      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const snapshots: FocusSubtaskWorkSnapshot[] = [];

      for (const subtask of subtasks) {
        const parentTask = tasksById.get(subtask.taskId);
        if (!parentTask) {
          continue;
        }
        snapshots.push({
          id: subtask.id,
          taskId: subtask.taskId,
          projectId: parentTask.projectId,
          status: subtask.status,
          ...(subtask.assigneeId !== undefined ? { assigneeId: subtask.assigneeId } : {}),
          priority: parentTask.priority,
          ...(parentTask.dueDate !== undefined ? { dueDate: parentTask.dueDate } : {}),
          parentTaskStatus: parentTask.status,
          ...(parentTask.deletedAt !== undefined
            ? { parentTaskDeletedAt: parentTask.deletedAt }
            : {}),
        });
      }

      return snapshots;
    },

    async findTaskSnapshot(
      organizationId: OrganizationId,
      taskId: TaskId,
    ): Promise<FocusTaskWorkSnapshot | null> {
      const task = await repositories.tasks.tasks.findById(organizationId, taskId);
      if (!task) {
        return null;
      }

      const [participants, impediments, dependencies, pauses] = await Promise.all([
        repositories.tasks.taskParticipants.listByTask(organizationId, taskId),
        repositories.impediments.impediments.listByTask(organizationId, taskId),
        repositories.dependencies.taskDependencies.listByTask(organizationId, taskId),
        repositories.tasks.taskPauses.listByTask(organizationId, taskId),
      ]);

      const participantIds = participants
        .filter((participant) => participant.removedAt === undefined)
        .map((participant) => participant.userId);

      const openBlockingImpediments: FocusImpedimentSnapshot[] = impediments
        .filter(isImpedimentBlocking)
        .map((imp) => ({
          id: imp.id,
          severity: imp.severity,
          category: imp.category,
          description: imp.description,
        }));

      const outgoingRequired = dependencies.filter((dep) => dep.taskId === taskId && dep.required);
      const pendingRequiredDependencies: FocusPendingDependencySnapshot[] = [];
      for (const dep of outgoingRequired) {
        const predecessor = await repositories.tasks.tasks.findById(
          organizationId,
          dep.dependsOnTaskId,
        );
        if (
          predecessor &&
          !isSoftDeleted(predecessor) &&
          predecessor.status !== TASK_STATUSES.DONE
        ) {
          const predParticipants = await repositories.tasks.taskParticipants.listByTask(
            organizationId,
            predecessor.id,
          );
          pendingRequiredDependencies.push({
            dependencyId: dep.id,
            dependsOnTaskId: predecessor.id,
            dependsOnTaskTitle: predecessor.title,
            dependsOnTaskStatus: predecessor.status,
            dependsOnTaskProjectId: predecessor.projectId,
            dependsOnTaskCreatedByUserId: predecessor.createdByUserId,
            ...(predecessor.assigneeId !== undefined
              ? { dependsOnTaskAssigneeId: predecessor.assigneeId }
              : {}),
            dependsOnTaskParticipantIds: predParticipants
              .filter((participant) => participant.removedAt === undefined)
              .map((participant) => participant.userId),
            ...(predecessor.deletedAt !== undefined
              ? { dependsOnTaskDeletedAt: predecessor.deletedAt }
              : {}),
          });
        }
      }

      const openPause = pauses.find((pause) => pause.endedAt === undefined);

      return {
        id: task.id,
        organizationId: task.organizationId,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        lastMovedAt: task.lastMovedAt,
        lastActivityAt: task.lastActivityAt,
        createdByUserId: task.createdByUserId,
        ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
        participantIds,
        ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
        ...(openPause !== undefined ? { openPauseReason: openPause.reason } : {}),
        openBlockingImpediments,
        pendingRequiredDependencies,
      };
    },
  };
}

/**
 * Thin composition-layer adapter bridging `BottleneckWorkContextPort` to `projects`, `kanban`,
 * `tasks`, `impediments`, and `users` repositories without breaking the acyclic DAG (ADR-0012 §3).
 */
export function createBottleneckWorkContextAdapter(
  repositories: AppRepositoriesRegistry,
): BottleneckWorkContextPort {
  return {
    listActorProjectScopes(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<BottleneckActorProjectScopes> {
      return resolveActorProjectScopes(repositories, organizationId, userId);
    },

    async findProjectById(
      organizationId: OrganizationId,
      projectId: ProjectId,
    ): Promise<BottleneckProjectSummary | null> {
      const project = await repositories.projects.projects.findById(organizationId, projectId);
      return project ? toBottleneckProjectSummary(project) : null;
    },

    async listProjectsByOrganization(
      organizationId: OrganizationId,
    ): Promise<readonly BottleneckProjectSummary[]> {
      const projects = await repositories.projects.projects.listByOrganization(organizationId, {
        includeArchived: true,
        includeDeleted: true,
      });
      return projects.map(toBottleneckProjectSummary);
    },

    async loadProjectWorkData(
      organizationId: OrganizationId,
      projectId: ProjectId,
    ): Promise<BottleneckProjectWorkData | null> {
      const project = await repositories.projects.projects.findById(organizationId, projectId);
      if (!project) {
        return null;
      }

      const [board, tasks, orgParticipants, orgSubtasks, projectImpediments, projectMembers] =
        await Promise.all([
          repositories.kanban.projectBoards.findPrimaryByProject(organizationId, projectId),
          repositories.tasks.tasks.listByProject(organizationId, projectId, {
            includeDeleted: false,
          }),
          repositories.tasks.taskParticipants.listByOrganization(organizationId),
          repositories.tasks.subtasks.listByOrganization(organizationId),
          repositories.impediments.impediments.listByProject(organizationId, projectId),
          repositories.projects.projectMembers.listByProject(organizationId, projectId),
        ]);

      const boardColumns = board
        ? await repositories.kanban.boardColumns.listByBoard(organizationId, board.id, {
            includeArchived: false,
          })
        : [];

      const columns: BottleneckBoardColumnSnapshot[] = boardColumns.map((column) => ({
        id: column.id,
        boardId: column.boardId,
        name: column.name,
        columnRole: column.columnRole,
        order: column.order,
        wipLimit: column.wipLimit,
        occupyingTaskCount: tasks.filter(
          (task) => task.columnId === column.id && doesTaskStatusOccupyWip(task.status),
        ).length,
      }));

      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const participantsByTaskId = new Map<TaskId, UserId[]>();
      for (const participant of orgParticipants) {
        if (participant.removedAt !== undefined || !tasksById.has(participant.taskId)) {
          continue;
        }
        const existing = participantsByTaskId.get(participant.taskId);
        if (existing) {
          existing.push(participant.userId);
        } else {
          participantsByTaskId.set(participant.taskId, [participant.userId]);
        }
      }

      const blockingImpedimentsByTaskId = new Map<TaskId, Impediment[]>();
      let openBlockingImpedimentCount = 0;
      for (const imp of projectImpediments) {
        if (!isImpedimentBlocking(imp)) {
          continue;
        }
        openBlockingImpedimentCount += 1;
        const list = blockingImpedimentsByTaskId.get(imp.taskId);
        if (list) {
          list.push(imp);
        } else {
          blockingImpedimentsByTaskId.set(imp.taskId, [imp]);
        }
      }

      const taskSnapshots: BottleneckTaskSnapshot[] = tasks.map((task) => {
        const taskImps = blockingImpedimentsByTaskId.get(task.id) ?? [];
        const maxSeverity = resolveMaxImpedimentSeverity(taskImps);
        return {
          id: task.id,
          organizationId: task.organizationId,
          projectId: task.projectId,
          columnId: task.columnId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
          lastMovedAt: task.lastMovedAt,
          lastActivityAt: task.lastActivityAt,
          createdByUserId: task.createdByUserId,
          ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
          participantIds: participantsByTaskId.get(task.id) ?? [],
          ...(maxSeverity !== undefined ? { openImpedimentsMaxSeverity: maxSeverity } : {}),
          openBlockingImpedimentCount: taskImps.length,
          ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
        };
      });

      const subtaskSnapshots: BottleneckSubtaskSnapshot[] = [];
      for (const subtask of orgSubtasks) {
        const parentTask = tasksById.get(subtask.taskId);
        if (!parentTask) {
          continue;
        }
        subtaskSnapshots.push({
          id: subtask.id,
          taskId: subtask.taskId,
          projectId: parentTask.projectId,
          status: subtask.status,
          ...(subtask.assigneeId !== undefined ? { assigneeId: subtask.assigneeId } : {}),
          priority: parentTask.priority,
          ...(parentTask.dueDate !== undefined ? { dueDate: parentTask.dueDate } : {}),
          parentTaskStatus: parentTask.status,
          ...(parentTask.deletedAt !== undefined
            ? { parentTaskDeletedAt: parentTask.deletedAt }
            : {}),
        });
      }

      const activeMembers = projectMembers.filter((member) => member.removedAt === undefined);
      const userIdsToResolve = new Set<UserId>();
      for (const member of activeMembers) {
        userIdsToResolve.add(member.userId);
      }
      for (const task of taskSnapshots) {
        if (task.assigneeId !== undefined) {
          userIdsToResolve.add(task.assigneeId);
        }
        for (const pId of task.participantIds) {
          userIdsToResolve.add(pId);
        }
      }
      for (const subtask of subtaskSnapshots) {
        if (subtask.assigneeId !== undefined) {
          userIdsToResolve.add(subtask.assigneeId);
        }
      }

      const userDisplayNames = new Map<UserId, string>();
      await Promise.all(
        [...userIdsToResolve].map(async (uid) => {
          const user = await repositories.users.users.findById(uid);
          userDisplayNames.set(uid, user?.displayName ?? uid);
        }),
      );

      const members: BottleneckProjectMemberSnapshot[] = activeMembers.map((member) => ({
        userId: member.userId,
        displayName: userDisplayNames.get(member.userId) ?? member.userId,
        projectRole: member.projectRole,
      }));

      return {
        project: toBottleneckProjectSummary(project),
        columns,
        tasks: taskSnapshots,
        subtasks: subtaskSnapshots,
        members,
        userDisplayNames,
        openBlockingImpedimentCount,
      };
    },

    async loadOrganizationUserWorkData(
      organizationId: OrganizationId,
      _userId: UserId,
    ): Promise<BottleneckUserWorkData> {
      const [projects, tasks, participants, subtasks, openImpediments] = await Promise.all([
        repositories.projects.projects.listByOrganization(organizationId, {
          includeArchived: true,
          includeDeleted: true,
        }),
        repositories.tasks.tasks.listByOrganization(organizationId, { includeDeleted: false }),
        repositories.tasks.taskParticipants.listByOrganization(organizationId),
        repositories.tasks.subtasks.listByOrganization(organizationId),
        repositories.impediments.impediments.listOpenByOrganization(organizationId),
      ]);

      const projectsById = new Map<ProjectId, BottleneckProjectSummary>();
      for (const project of projects) {
        projectsById.set(project.id, toBottleneckProjectSummary(project));
      }

      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const participantsByTaskId = new Map<TaskId, UserId[]>();
      for (const participant of participants) {
        if (participant.removedAt !== undefined) {
          continue;
        }
        const existing = participantsByTaskId.get(participant.taskId);
        if (existing) {
          existing.push(participant.userId);
        } else {
          participantsByTaskId.set(participant.taskId, [participant.userId]);
        }
      }

      const impedimentsByTaskId = new Map<TaskId, Impediment[]>();
      for (const imp of openImpediments) {
        if (!isImpedimentBlocking(imp)) {
          continue;
        }
        const existing = impedimentsByTaskId.get(imp.taskId);
        if (existing) {
          existing.push(imp);
        } else {
          impedimentsByTaskId.set(imp.taskId, [imp]);
        }
      }

      const taskSnapshots: BottleneckTaskSnapshot[] = tasks.map((task) => {
        const taskImps = impedimentsByTaskId.get(task.id) ?? [];
        const maxSeverity = resolveMaxImpedimentSeverity(taskImps);
        return {
          id: task.id,
          organizationId: task.organizationId,
          projectId: task.projectId,
          columnId: task.columnId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
          lastMovedAt: task.lastMovedAt,
          lastActivityAt: task.lastActivityAt,
          createdByUserId: task.createdByUserId,
          ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
          participantIds: participantsByTaskId.get(task.id) ?? [],
          ...(maxSeverity !== undefined ? { openImpedimentsMaxSeverity: maxSeverity } : {}),
          openBlockingImpedimentCount: taskImps.length,
          ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
        };
      });

      const subtaskSnapshots: BottleneckSubtaskSnapshot[] = [];
      for (const subtask of subtasks) {
        const parentTask = tasksById.get(subtask.taskId);
        if (!parentTask) {
          continue;
        }
        subtaskSnapshots.push({
          id: subtask.id,
          taskId: subtask.taskId,
          projectId: parentTask.projectId,
          status: subtask.status,
          ...(subtask.assigneeId !== undefined ? { assigneeId: subtask.assigneeId } : {}),
          priority: parentTask.priority,
          ...(parentTask.dueDate !== undefined ? { dueDate: parentTask.dueDate } : {}),
          parentTaskStatus: parentTask.status,
          ...(parentTask.deletedAt !== undefined
            ? { parentTaskDeletedAt: parentTask.deletedAt }
            : {}),
        });
      }

      return {
        tasks: taskSnapshots,
        subtasks: subtaskSnapshots,
        projectsById,
      };
    },

    async updateProjectBottleneckRules(
      input: UpdateProjectBottleneckRulesRecordInput,
    ): Promise<BottleneckProjectSummary> {
      const existing = await repositories.projects.projects.findById(
        input.organizationId,
        input.projectId,
      );
      if (!existing) {
        throw new NotFoundError(`Project "${input.projectId}" was not found.`, {
          details: { organizationId: input.organizationId, projectId: input.projectId },
        });
      }

      const updated: Project = {
        ...existing,
        ...(input.inactivityThresholdDays !== undefined
          ? { inactivityThresholdDays: input.inactivityThresholdDays }
          : {}),
        ...(input.bottleneckThresholds !== undefined
          ? { bottleneckThresholds: input.bottleneckThresholds }
          : {}),
        updatedAt: input.now,
      };

      await repositories.projects.projects.save(updated);
      return toBottleneckProjectSummary(updated);
    },
  };
}
