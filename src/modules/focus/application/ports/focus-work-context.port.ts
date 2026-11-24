import type {
  ImpedimentId,
  ImpedimentSeverity,
  IsoDateTime,
  OrganizationId,
  Priority,
  ProjectId,
  SubtaskId,
  TaskId,
  TaskStatus,
  TeamId,
  UserId,
} from '@/shared/kernel';

export interface FocusProjectSummary {
  readonly id: ProjectId;
  readonly organizationId: OrganizationId;
  readonly teamId?: TeamId;
  readonly name: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly ownerUserId: UserId;
  readonly inactivityThresholdDays: number;
  readonly archivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
}

export interface FocusActorProjectScopes {
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}

export interface FocusImpedimentSnapshot {
  readonly id: ImpedimentId;
  readonly severity: ImpedimentSeverity;
  readonly category: string;
  readonly description: string;
}

export interface FocusPendingDependencySnapshot {
  readonly dependencyId: string;
  readonly dependsOnTaskId: TaskId;
  readonly dependsOnTaskTitle: string;
  readonly dependsOnTaskStatus: TaskStatus;
  readonly dependsOnTaskProjectId: ProjectId;
  readonly dependsOnTaskCreatedByUserId: UserId;
  readonly dependsOnTaskAssigneeId?: UserId;
  readonly dependsOnTaskParticipantIds: readonly UserId[];
  readonly dependsOnTaskDeletedAt?: IsoDateTime;
}

export interface FocusTaskWorkSnapshot {
  readonly id: TaskId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly lastMovedAt: IsoDateTime;
  readonly lastActivityAt: IsoDateTime;
  readonly createdByUserId: UserId;
  readonly assigneeId?: UserId;
  readonly participantIds: readonly UserId[];
  readonly deletedAt?: IsoDateTime;
  readonly openPauseReason?: string;
  readonly openBlockingImpediments: readonly FocusImpedimentSnapshot[];
  readonly pendingRequiredDependencies: readonly FocusPendingDependencySnapshot[];
}

export interface FocusSubtaskWorkSnapshot {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly status: 'OPEN' | 'DONE' | 'CANCELLED';
  readonly assigneeId?: UserId;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly parentTaskStatus: TaskStatus;
  readonly parentTaskDeletedAt?: IsoDateTime;
}

/**
 * Local anti-cycle port allowing `FocusService` to query project/task/subtask/impediment/dependency
 * snapshots without importing `@/modules/tasks`, `@/modules/projects`, `@/modules/kanban`,
 * `@/modules/dependencies`, `@/modules/impediments`, or `@/modules/analytics` (ADR-0012 §3).
 */
export interface FocusWorkContextPort {
  listActorProjectScopes(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<FocusActorProjectScopes>;
  listProjectsByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly FocusProjectSummary[]>;
  listOrganizationTaskSnapshots(
    organizationId: OrganizationId,
  ): Promise<readonly FocusTaskWorkSnapshot[]>;
  listOrganizationSubtaskSnapshots(
    organizationId: OrganizationId,
  ): Promise<readonly FocusSubtaskWorkSnapshot[]>;
  findTaskSnapshot(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<FocusTaskWorkSnapshot | null>;
}
