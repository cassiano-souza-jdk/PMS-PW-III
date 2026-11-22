import type {
  BoardColumnId,
  BoardId,
  IsoDateTime,
  OrganizationId,
  ProjectId,
  TaskStatus,
  TeamId,
  UserId,
} from '@/shared/kernel';
import type { Task } from '../../domain/task';

export type TaskProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type TaskBoardColumnRole = 'INITIAL' | 'OPERATIONAL' | 'FINAL';

export interface TaskProjectSummary {
  readonly id: ProjectId;
  readonly organizationId: OrganizationId;
  readonly teamId?: TeamId;
  readonly name: string;
  readonly status: TaskProjectStatus;
  readonly ownerUserId: UserId;
  readonly archivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
}

export interface TaskActorProjectScopes {
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}

export interface TaskBoardColumnSummary {
  readonly id: BoardColumnId;
  readonly organizationId: OrganizationId;
  readonly boardId: BoardId;
  readonly name: string;
  readonly columnRole: TaskBoardColumnRole;
  readonly order: number;
  readonly wipLimit: number | null;
  readonly archivedAt?: IsoDateTime;
  readonly createdAt?: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
}

export interface TaskProjectBoardContext {
  readonly boardId: BoardId;
  readonly boardName: string;
  readonly columns: readonly TaskBoardColumnSummary[];
}

export interface ValidateTaskWipPlacementInput {
  readonly targetColumn: TaskBoardColumnSummary;
  readonly currentColumnTasks: readonly Task[];
  readonly movingTaskStatus: TaskStatus;
}

/**
 * Local anti-cycle port allowing `TaskService` to inspect project/board/column state
 * and validate WIP placement without importing `@/modules/projects` or `@/modules/kanban` (ADR-0011 §3).
 */
export interface TaskProjectContextPort {
  findProjectById(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<TaskProjectSummary | null>;
  listActorProjectScopes(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<TaskActorProjectScopes>;
  isProjectParticipant(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Promise<boolean>;
  findPrimaryBoardWithColumns(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<TaskProjectBoardContext | null>;
  assertWipAllowsPlacement(input: ValidateTaskWipPlacementInput): void;
}
