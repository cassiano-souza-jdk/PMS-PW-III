import type {
  BoardColumnId,
  BoardId,
  ImpedimentSeverity,
  IsoDateTime,
  OrganizationId,
  Priority,
  ProjectBottleneckThresholds,
  ProjectId,
  SubtaskId,
  TaskId,
  TaskStatus,
  TeamId,
  UserId,
} from '@/shared/kernel';

export interface BottleneckProjectSummary {
  readonly id: ProjectId;
  readonly organizationId: OrganizationId;
  readonly teamId?: TeamId;
  readonly name: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly ownerUserId: UserId;
  readonly inactivityThresholdDays: number;
  readonly bottleneckThresholds?: ProjectBottleneckThresholds;
  readonly archivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
}

export interface BottleneckActorProjectScopes {
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}

export interface BottleneckBoardColumnSnapshot {
  readonly id: BoardColumnId;
  readonly boardId: BoardId;
  readonly name: string;
  readonly columnRole: 'INITIAL' | 'OPERATIONAL' | 'FINAL';
  readonly order: number;
  readonly wipLimit: number | null;
  readonly occupyingTaskCount: number;
}

export interface BottleneckTaskSnapshot {
  readonly id: TaskId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly columnId: BoardColumnId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly lastMovedAt: IsoDateTime;
  readonly lastActivityAt: IsoDateTime;
  readonly createdByUserId: UserId;
  readonly assigneeId?: UserId;
  readonly participantIds: readonly UserId[];
  readonly openImpedimentsMaxSeverity?: ImpedimentSeverity;
  readonly openBlockingImpedimentCount: number;
  readonly deletedAt?: IsoDateTime;
}

export interface BottleneckSubtaskSnapshot {
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

export interface BottleneckProjectMemberSnapshot {
  readonly userId: UserId;
  readonly displayName: string;
  readonly projectRole: 'MANAGER' | 'PARTICIPANT';
}

export interface BottleneckProjectWorkData {
  readonly project: BottleneckProjectSummary;
  readonly columns: readonly BottleneckBoardColumnSnapshot[];
  readonly tasks: readonly BottleneckTaskSnapshot[];
  readonly subtasks: readonly BottleneckSubtaskSnapshot[];
  readonly members: readonly BottleneckProjectMemberSnapshot[];
  readonly userDisplayNames: ReadonlyMap<UserId, string>;
  readonly openBlockingImpedimentCount: number;
}

export interface BottleneckUserWorkData {
  readonly tasks: readonly BottleneckTaskSnapshot[];
  readonly subtasks: readonly BottleneckSubtaskSnapshot[];
  readonly projectsById: ReadonlyMap<ProjectId, BottleneckProjectSummary>;
}

export interface UpdateProjectBottleneckRulesRecordInput {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly inactivityThresholdDays?: number;
  readonly bottleneckThresholds?: ProjectBottleneckThresholds;
  readonly now: IsoDateTime;
}

/**
 * Local anti-cycle port allowing `BottleneckService` to inspect projects, Kanban WIP occupancy,
 * tasks, subtasks, participants, impediments and persist threshold updates without importing
 * `@/modules/focus`, `@/modules/tasks`, `@/modules/projects`, `@/modules/kanban`,
 * `@/modules/dependencies`, `@/modules/impediments`, or `@/modules/analytics` (ADR-0012 §3).
 */
export interface BottleneckWorkContextPort {
  listActorProjectScopes(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<BottleneckActorProjectScopes>;
  findProjectById(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<BottleneckProjectSummary | null>;
  listProjectsByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly BottleneckProjectSummary[]>;
  loadProjectWorkData(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<BottleneckProjectWorkData | null>;
  loadOrganizationUserWorkData(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<BottleneckUserWorkData>;
  updateProjectBottleneckRules(
    input: UpdateProjectBottleneckRulesRecordInput,
  ): Promise<BottleneckProjectSummary>;
}
