import type {
  IsoDateTime,
  OrganizationId,
  ProjectId,
  TaskId,
  TaskStatus,
  TeamId,
  UserId,
} from '@/shared/kernel';

export interface DependencyProjectSummary {
  readonly id: ProjectId;
  readonly organizationId: OrganizationId;
  readonly teamId?: TeamId;
  readonly ownerUserId: UserId;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly archivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
}

export interface DependencyActorProjectScopes {
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}

export interface DependencyTaskSummary {
  readonly id: TaskId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly createdByUserId: UserId;
  readonly assigneeId?: UserId;
  readonly participantIds: readonly UserId[];
  readonly deletedAt?: IsoDateTime;
}

/**
 * Local anti-cycle port allowing `DependencyService` to query project/task context
 * and update `lastActivityAt` without importing `@/modules/tasks`, `@/modules/projects`, or `@/modules/kanban`
 * (ADR-0011 §3).
 */
export interface DependencyWorkContextPort {
  findProjectById(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<DependencyProjectSummary | null>;
  listActorProjectScopes(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<DependencyActorProjectScopes>;
  findTaskWorkContext(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<DependencyTaskSummary | null>;
  findTasksWorkContext(
    organizationId: OrganizationId,
    taskIds: readonly TaskId[],
  ): Promise<readonly DependencyTaskSummary[]>;
  touchTaskActivity(
    organizationId: OrganizationId,
    taskId: TaskId,
    now: IsoDateTime,
  ): Promise<void>;
}
