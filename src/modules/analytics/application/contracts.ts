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
import {
  DASHBOARD_SCOPES,
  type AnalyticsPeriodPreset,
  type DashboardPreference,
  type DashboardScope,
  type DashboardWidgetConfig,
} from '../domain/analytics';
import type { AnalyticsCalibratableWeightsSnapshot } from './ports/analytics-governance.port';

export const ANALYTICS_WIDGET_KEYS = {
  FLOW_KPIS: 'flow-kpis',
  TASK_STATUS_BREAKDOWN: 'task-status-breakdown',
  MY_WORKLOAD: 'my-workload',
  TEAM_WORKLOAD: 'team-workload',
  IMPEDIMENTS_SUMMARY: 'impediments-summary',
  BOTTLENECKS_ALERTS: 'bottlenecks-alerts',
  FEEDBACK_SUMMARY: 'feedback-summary',
} as const;

export type AnalyticsWidgetKey = (typeof ANALYTICS_WIDGET_KEYS)[keyof typeof ANALYTICS_WIDGET_KEYS];

const ANALYTICS_WIDGET_KEY_SET: ReadonlySet<string> = new Set(Object.values(ANALYTICS_WIDGET_KEYS));

export function isAnalyticsWidgetKey(value: unknown): value is AnalyticsWidgetKey {
  return typeof value === 'string' && ANALYTICS_WIDGET_KEY_SET.has(value);
}

export interface AnalyticsWidgetDefinition {
  readonly widgetKey: AnalyticsWidgetKey;
  readonly allowedScopes: readonly DashboardScope[];
  readonly supportsChart: boolean;
  readonly requiresThirdPartyPolicyNotice: boolean;
}

export const ANALYTICS_WIDGET_CATALOG: Readonly<
  Record<AnalyticsWidgetKey, AnalyticsWidgetDefinition>
> = Object.freeze({
  [ANALYTICS_WIDGET_KEYS.FLOW_KPIS]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.FLOW_KPIS,
    allowedScopes: Object.freeze([
      DASHBOARD_SCOPES.PERSONAL,
      DASHBOARD_SCOPES.PROJECT,
      DASHBOARD_SCOPES.ORGANIZATION,
    ]),
    supportsChart: true,
    requiresThirdPartyPolicyNotice: false,
  }),
  [ANALYTICS_WIDGET_KEYS.TASK_STATUS_BREAKDOWN]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.TASK_STATUS_BREAKDOWN,
    allowedScopes: Object.freeze([
      DASHBOARD_SCOPES.PERSONAL,
      DASHBOARD_SCOPES.PROJECT,
      DASHBOARD_SCOPES.ORGANIZATION,
    ]),
    supportsChart: true,
    requiresThirdPartyPolicyNotice: false,
  }),
  [ANALYTICS_WIDGET_KEYS.MY_WORKLOAD]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.MY_WORKLOAD,
    allowedScopes: Object.freeze([
      DASHBOARD_SCOPES.PERSONAL,
      DASHBOARD_SCOPES.PROJECT,
      DASHBOARD_SCOPES.ORGANIZATION,
    ]),
    supportsChart: false,
    requiresThirdPartyPolicyNotice: false,
  }),
  [ANALYTICS_WIDGET_KEYS.TEAM_WORKLOAD]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.TEAM_WORKLOAD,
    allowedScopes: Object.freeze([DASHBOARD_SCOPES.PROJECT, DASHBOARD_SCOPES.ORGANIZATION]),
    supportsChart: true,
    requiresThirdPartyPolicyNotice: true,
  }),
  [ANALYTICS_WIDGET_KEYS.IMPEDIMENTS_SUMMARY]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.IMPEDIMENTS_SUMMARY,
    allowedScopes: Object.freeze([
      DASHBOARD_SCOPES.PERSONAL,
      DASHBOARD_SCOPES.PROJECT,
      DASHBOARD_SCOPES.ORGANIZATION,
    ]),
    supportsChart: true,
    requiresThirdPartyPolicyNotice: false,
  }),
  [ANALYTICS_WIDGET_KEYS.BOTTLENECKS_ALERTS]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.BOTTLENECKS_ALERTS,
    allowedScopes: Object.freeze([
      DASHBOARD_SCOPES.PERSONAL,
      DASHBOARD_SCOPES.PROJECT,
      DASHBOARD_SCOPES.ORGANIZATION,
    ]),
    supportsChart: true,
    requiresThirdPartyPolicyNotice: true,
  }),
  [ANALYTICS_WIDGET_KEYS.FEEDBACK_SUMMARY]: Object.freeze({
    widgetKey: ANALYTICS_WIDGET_KEYS.FEEDBACK_SUMMARY,
    allowedScopes: Object.freeze([
      DASHBOARD_SCOPES.PERSONAL,
      DASHBOARD_SCOPES.PROJECT,
      DASHBOARD_SCOPES.ORGANIZATION,
    ]),
    supportsChart: true,
    requiresThirdPartyPolicyNotice: true,
  }),
});

export const ANALYTICS_TABS = {
  OVERVIEW: 'OVERVIEW',
  FLOW: 'FLOW',
  FEEDBACK: 'FEEDBACK',
  WORKLOAD_BOTTLENECKS: 'WORKLOAD_BOTTLENECKS',
  CALIBRATION: 'CALIBRATION',
} as const;

export type AnalyticsTabKey = (typeof ANALYTICS_TABS)[keyof typeof ANALYTICS_TABS];

export interface AnalyticsPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface AnalyticsProjectOption {
  readonly id: ProjectId;
  readonly name: string;
  readonly isArchived: boolean;
}

export interface AnalyticsChartDataRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly formattedValue?: string;
}

export interface AnalyticsDashboardDraftState {
  readonly widgets: readonly DashboardWidgetConfig[];
  readonly isEditing: boolean;
  readonly isDirty: boolean;
  readonly isDefault: boolean;
  readonly isSaving: boolean;
}

export interface AnalyticsCalibrationDraft extends AnalyticsCalibratableWeightsSnapshot {
  readonly justification?: string;
}

export interface AnalyticsCalibrationWeightGroupSums {
  readonly workloadSum: number;
  readonly focusSum: number;
  readonly isWorkloadSumValid: boolean;
  readonly isFocusSumValid: boolean;
}

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
