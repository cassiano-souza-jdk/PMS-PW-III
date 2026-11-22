import type {
  BoardColumnId,
  IsoDateTime,
  OrganizationId,
  ProjectId,
  TaskId,
  TaskStatus,
  TeamId,
  UserId,
} from '@/shared/kernel';

export interface ImpedimentProjectSummary {
  readonly id: ProjectId;
  readonly organizationId: OrganizationId;
  readonly teamId?: TeamId;
  readonly ownerUserId: UserId;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly archivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
}

export interface ImpedimentActorProjectScopes {
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}

export interface ImpedimentTaskSummary {
  readonly id: TaskId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly columnId: BoardColumnId;
  readonly columnRole: 'INITIAL' | 'OPERATIONAL' | 'FINAL';
  readonly status: TaskStatus;
  readonly startedAt?: IsoDateTime;
  readonly createdByUserId: UserId;
  readonly assigneeId?: UserId;
  readonly participantIds: readonly UserId[];
  readonly hasOpenPause: boolean;
  readonly deletedAt?: IsoDateTime;
}

export interface SyncTaskAfterImpedimentInput {
  readonly organizationId: OrganizationId;
  readonly taskId: TaskId;
  readonly nextStatus?: TaskStatus;
  readonly now: IsoDateTime;
}

/**
 * Local anti-cycle port allowing `ImpedimentService` to read task/project context
 * and synchronize task operational status without importing `@/modules/tasks`, `@/modules/projects`,
 * or `@/modules/kanban` (ADR-0011 §3).
 */
export interface ImpedimentWorkContextPort {
  findProjectById(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ImpedimentProjectSummary | null>;
  listActorProjectScopes(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<ImpedimentActorProjectScopes>;
  findTaskWorkContext(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<ImpedimentTaskSummary | null>;
  syncTaskAfterImpedimentChange(input: SyncTaskAfterImpedimentInput): Promise<void>;
}
