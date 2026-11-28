import type {
  BottleneckSeverity,
  CorrelationId,
  DateRange,
  IsoDateTime,
  MetricValue,
  OrganizationId,
  ProjectId,
  TaskStatus,
  UserId,
} from '@/shared/kernel';
import type {
  AnalyticsPeriodPreset,
  DashboardPreference,
  DashboardScope,
  DashboardWidgetConfig,
} from '../domain/analytics';
import type { AnalyticsCalibratableWeightsSnapshot } from './ports/analytics-governance.port';

export interface GetAnalyticsOverviewInput {
  readonly scope: DashboardScope;
  readonly projectId?: ProjectId;
  readonly preset?: AnalyticsPeriodPreset;
  readonly customRange?: DateRange;
  readonly compareWithPreviousPeriod?: boolean;
}

export interface AnalyticsFlowMetricsSnapshot {
  readonly leadTimeMs: MetricValue<number>;
  readonly effectiveCycleTimeMs: MetricValue<number>;
  readonly totalCycleTimeMs: MetricValue<number>;
  readonly throughput: MetricValue<number>;
  readonly uniqueCompletedTasks: MetricValue<number>;
  readonly periodCompletions: MetricValue<number>;
  readonly cohortCompletionRate: MetricValue<number>;
}

export interface AnalyticsFlowSummary extends AnalyticsFlowMetricsSnapshot {
  readonly totalVisibleTasks: number;
  readonly countsByStatus: Readonly<Record<TaskStatus, number>>;
  readonly previousPeriod?: AnalyticsFlowMetricsSnapshot;
}

export interface AnalyticsCountBucket {
  readonly key: string;
  readonly count: number;
}

export interface AnalyticsImpedimentsSummary {
  readonly totalInPeriod: number;
  readonly openCount: number;
  readonly resolvedInPeriod: number;
  readonly averageResolutionMs: MetricValue<number>;
  readonly byCategory: readonly AnalyticsCountBucket[];
  readonly bySeverity: readonly AnalyticsCountBucket[];
}

export interface AnalyticsMemberWorkloadItem {
  readonly userId: UserId;
  readonly displayName: string;
  readonly score: number;
  readonly level: BottleneckSeverity;
  readonly activeTaskCount: number;
  readonly activeSubtaskCount: number;
  readonly representsHours: false;
}

export interface AnalyticsWorkloadSummary {
  readonly myWorkload: AnalyticsMemberWorkloadItem | null;
  readonly memberWorkloads: readonly AnalyticsMemberWorkloadItem[];
  readonly averageTeamWorkloadScore: MetricValue<number>;
  readonly overloadedMemberCount: number;
  readonly representsHours: false;
}

export interface AnalyticsBottleneckAlertItem {
  readonly alertId: string;
  readonly projectId?: ProjectId;
  readonly indicator: string;
  readonly severity: BottleneckSeverity;
  readonly status: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly summary: string;
  readonly detectedAt: IsoDateTime;
  readonly lastSeenAt: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
}

export interface AnalyticsBottlenecksSummary {
  readonly alerts: readonly AnalyticsBottleneckAlertItem[];
  readonly totalActiveAlerts: number;
  readonly overloadedMemberCount: number;
  readonly byIndicator: readonly AnalyticsCountBucket[];
  readonly bySeverity: readonly AnalyticsCountBucket[];
}

export interface AnalyticsFeedbackVersionBucket {
  readonly versionId: string;
  readonly entryId: string;
  readonly code: string;
  readonly name: string;
  readonly versionNumber: number;
  readonly count: number;
}

export interface AnalyticsFeedbackAssigneePerformance {
  readonly assigneeUserId: UserId;
  readonly displayName: string;
  readonly assignedCount: number;
  readonly resolvedCount: number;
  readonly breachedCount: number;
  readonly averageResolutionMs: MetricValue<number>;
}

export interface AnalyticsFeedbackSlaSummary {
  readonly onTrackCount: number;
  readonly warningCount: number;
  readonly breachedCount: number;
  readonly complianceRate: MetricValue<number>;
}

export interface AnalyticsFeedbackSummary {
  readonly totalInPeriod: number;
  readonly resolvedInPeriod: number;
  readonly resolutionRate: MetricValue<number>;
  readonly slaSummary: AnalyticsFeedbackSlaSummary;
  readonly contestsInPeriod: number;
  readonly contestOutcomes: readonly AnalyticsCountBucket[];
  readonly reopeningsInPeriod: number;
  readonly cyclesByOrigin: readonly AnalyticsCountBucket[];
  readonly byCategoryVersion: readonly AnalyticsFeedbackVersionBucket[];
  readonly byContestReasonVersion: readonly AnalyticsFeedbackVersionBucket[];
  readonly averageFirstResponseMs: MetricValue<number>;
  readonly averageResolutionMs: MetricValue<number>;
  readonly assigneePerformance: readonly AnalyticsFeedbackAssigneePerformance[];
}

export interface AnalyticsOverview {
  readonly organizationId: OrganizationId;
  readonly scope: DashboardScope;
  readonly projectId?: ProjectId;
  readonly isDemoOrganization: boolean;
  readonly preset: AnalyticsPeriodPreset;
  readonly period: DateRange;
  readonly previousPeriod?: DateRange;
  readonly includesThirdPartyIndividualMetrics: boolean;
  readonly generatedAt: IsoDateTime;
  readonly flow: AnalyticsFlowSummary;
  readonly impediments: AnalyticsImpedimentsSummary;
  readonly workload: AnalyticsWorkloadSummary;
  readonly bottlenecks: AnalyticsBottlenecksSummary;
  readonly feedback: AnalyticsFeedbackSummary;
}

export interface GetDashboardPreferenceInput {
  readonly scope: DashboardScope;
  readonly projectId?: ProjectId;
}

export interface SaveDashboardPreferenceInput {
  readonly scope: DashboardScope;
  readonly projectId?: ProjectId;
  readonly widgets: readonly DashboardWidgetConfig[];
  readonly correlationId?: CorrelationId;
}

export interface ResetDashboardPreferenceInput {
  readonly scope: DashboardScope;
  readonly projectId?: ProjectId;
  readonly correlationId?: CorrelationId;
}

export interface DashboardPreferenceResult {
  readonly preference: DashboardPreference;
  readonly isDefault: boolean;
}

export interface AnalyticsCalibrationSettingsView {
  readonly organizationId: OrganizationId;
  readonly calibratableWeights: AnalyticsCalibratableWeightsSnapshot;
  readonly updatedAt: IsoDateTime;
}

export interface UpdateCalibrationSettingsInput {
  readonly calibratableWeights: Partial<AnalyticsCalibratableWeightsSnapshot>;
  readonly justification?: string;
  readonly correlationId?: CorrelationId;
}
