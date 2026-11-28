import type {
  FeedbackContestId,
  FeedbackCycleId,
  FeedbackId,
  ImpedimentId,
  ImpedimentSeverity,
  IsoDateTime,
  OrganizationId,
  OrganizationRole,
  Priority,
  ProjectId,
  TaskId,
  TaskStatus,
  UserId,
} from '@/shared/kernel';

/**
 * Anti-corruption context port for Analytics (ADR-0014 §5, ADR-0006 §3.2).
 *
 * `analytics` MUST NOT import operational modules (`tasks`, `projects`, `impediments`, `feedback`,
 * `users`, ...). All historical inputs are delivered as local, read-only snapshots through this
 * port, implemented exclusively in `src/app/composition/analytics-ports-adapter.ts` (F10-T02).
 *
 * Status/category/origin fields of foreign aggregates are intentionally typed as opaque `string`
 * codes: the adapter maps them from the owning module, and Analytics only groups/counts by them,
 * preserving historical versions without coupling to foreign enums.
 */

/** Actor profile used for item-by-item authorization and privacy guards before aggregation. */
export interface AnalyticsActorProfileSnapshot {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly role: OrganizationRole;
  readonly managedProjectIds: readonly ProjectId[];
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly isDemoOrganization: boolean;
}

export interface AnalyticsProjectSnapshot {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly status: string;
  readonly managerUserIds: readonly UserId[];
  readonly memberUserIds: readonly UserId[];
  readonly isDeleted: boolean;
}

export interface AnalyticsWorkTaskSnapshot {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly assigneeUserIds: readonly UserId[];
  readonly createdAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly dueDate?: string;
  readonly isDeleted: boolean;
}

export interface AnalyticsExecutionCycleSnapshot {
  readonly cycleId: string;
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly cycleNumber: number;
  readonly startedAt: IsoDateTime;
  readonly effectiveStartedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
}

export interface AnalyticsTaskPauseSnapshot {
  readonly pauseId: string;
  readonly taskId: TaskId;
  readonly cycleId: string;
  readonly startedAt: IsoDateTime;
  readonly endedAt?: IsoDateTime;
}

export interface AnalyticsImpedimentSnapshot {
  readonly impedimentId: ImpedimentId;
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly category: string;
  readonly severity: ImpedimentSeverity;
  readonly status: string;
  readonly openedAt: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
}

export interface AnalyticsFeedbackSnapshot {
  readonly feedbackId: FeedbackId;
  readonly projectId?: ProjectId;
  readonly authorUserId: UserId;
  readonly assigneeUserId?: UserId;
  readonly status: string;
  readonly categoryId: string;
  readonly categoryVersionId: string;
  readonly createdAt: IsoDateTime;
  readonly firstResponseAt?: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
  readonly closedAt?: IsoDateTime;
}

export interface AnalyticsFeedbackCycleSnapshot {
  readonly cycleId: FeedbackCycleId;
  readonly feedbackId: FeedbackId;
  readonly cycleNumber: number;
  /** `INITIAL` | `CONTESTATION_REOPEN` | `EXCEPTIONAL_REOPEN` (mapped by the adapter). */
  readonly origin: string;
  readonly openedAt: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
  /** SLA state at snapshot time: `ON_TRACK` | `WARNING` | `BREACHED` (mapped by the adapter). */
  readonly slaState?: string;
}

export interface AnalyticsFeedbackContestSnapshot {
  readonly contestId: FeedbackContestId;
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycleId;
  readonly status: string;
  readonly reasonId: string;
  readonly reasonVersionId: string;
  readonly openedAt: IsoDateTime;
}

export interface AnalyticsFeedbackContestDecisionSnapshot {
  readonly decisionId: string;
  readonly contestId: FeedbackContestId;
  readonly decision: string;
  readonly decidedAt: IsoDateTime;
}

/** Historical catalog version (category or contest reason) preserved for distribution charts. */
export interface AnalyticsCatalogVersionSnapshot {
  readonly versionId: string;
  readonly entryId: string;
  readonly code: string;
  readonly name: string;
  readonly versionNumber: number;
}

export interface AnalyticsWorkContextPort {
  getActorProfile(
    organizationId: OrganizationId,
    actorUserId: UserId,
  ): Promise<AnalyticsActorProfileSnapshot | null>;
  listProjects(organizationId: OrganizationId): Promise<readonly AnalyticsProjectSnapshot[]>;
  listTasks(organizationId: OrganizationId): Promise<readonly AnalyticsWorkTaskSnapshot[]>;
  listExecutionCycles(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsExecutionCycleSnapshot[]>;
  listTaskPauses(organizationId: OrganizationId): Promise<readonly AnalyticsTaskPauseSnapshot[]>;
  listImpediments(organizationId: OrganizationId): Promise<readonly AnalyticsImpedimentSnapshot[]>;
  listFeedbacks(organizationId: OrganizationId): Promise<readonly AnalyticsFeedbackSnapshot[]>;
  listFeedbackCycles(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackCycleSnapshot[]>;
  listFeedbackContests(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackContestSnapshot[]>;
  listFeedbackContestDecisions(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackContestDecisionSnapshot[]>;
  listFeedbackCategoryVersions(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsCatalogVersionSnapshot[]>;
  listFeedbackContestReasonVersions(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsCatalogVersionSnapshot[]>;
}
