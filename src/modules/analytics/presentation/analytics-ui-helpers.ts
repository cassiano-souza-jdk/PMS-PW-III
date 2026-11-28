import type { IntlShape } from 'react-intl';
import type { MessageId } from '@/shared/i18n';
import type {
  BottleneckSeverity,
  DateRange,
  IsoDateTime,
  MetricUnavailableReason,
  MetricValue,
  TaskStatus,
} from '@/shared/kernel';
import type {
  AnalyticsCalibrationDraft,
  AnalyticsCalibrationWeightGroupSums,
  AnalyticsOverview,
  AnalyticsWidgetKey,
  DashboardPreferenceResult,
} from '../application/contracts';

export type AnalyticsPeriodPreset = AnalyticsOverview['preset'];
export type DashboardScope = AnalyticsOverview['scope'];
export type DashboardWidgetConfig = DashboardPreferenceResult['preference']['widgets'][number];

export const CONTROL_SELECT_CLASS_NAME =
  'flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const CONTROL_TEXTAREA_CLASS_NAME =
  'flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const ANALYTICS_SCOPE_OPTIONS: readonly DashboardScope[] = [
  'PERSONAL',
  'PROJECT',
  'ORGANIZATION',
];

export const ANALYTICS_PERIOD_PRESET_OPTIONS: readonly AnalyticsPeriodPreset[] = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'CURRENT_YEAR',
  'CUSTOM',
];

export const ANALYTICS_SCOPE_LABEL_IDS: Readonly<Record<DashboardScope, MessageId>> = {
  PERSONAL: 'analytics.scope.PERSONAL',
  PROJECT: 'analytics.scope.PROJECT',
  ORGANIZATION: 'analytics.scope.ORGANIZATION',
};

export const ANALYTICS_PRESET_LABEL_IDS: Readonly<Record<AnalyticsPeriodPreset, MessageId>> = {
  LAST_7_DAYS: 'analytics.period.preset.LAST_7_DAYS',
  LAST_30_DAYS: 'analytics.period.preset.LAST_30_DAYS',
  LAST_90_DAYS: 'analytics.period.preset.LAST_90_DAYS',
  CURRENT_YEAR: 'analytics.period.preset.CURRENT_YEAR',
  CUSTOM: 'analytics.period.preset.CUSTOM',
};

export const METRIC_REASON_LABEL_IDS: Readonly<Record<MetricUnavailableReason, MessageId>> = {
  INSUFFICIENT_DATA: 'analytics.metric.reason.INSUFFICIENT_DATA',
  NO_COMPLETED_CYCLES: 'analytics.metric.reason.NO_COMPLETED_CYCLES',
  ZERO_DENOMINATOR: 'analytics.metric.reason.ZERO_DENOMINATOR',
  UNAUTHORIZED: 'analytics.metric.reason.UNAUTHORIZED',
};

export const ANALYTICS_WIDGET_LABEL_IDS: Readonly<Record<AnalyticsWidgetKey, MessageId>> = {
  'flow-kpis': 'analytics.widgets.flow-kpis',
  'task-status-breakdown': 'analytics.widgets.task-status-breakdown',
  'my-workload': 'analytics.widgets.my-workload',
  'team-workload': 'analytics.widgets.team-workload',
  'impediments-summary': 'analytics.widgets.impediments-summary',
  'bottlenecks-alerts': 'analytics.widgets.bottlenecks-alerts',
  'feedback-summary': 'analytics.widgets.feedback-summary',
};

export const TASK_STATUS_LABEL_IDS: Readonly<Record<TaskStatus, MessageId>> = {
  TODO: 'tasks.status.TODO',
  IN_PROGRESS: 'tasks.status.IN_PROGRESS',
  PAUSED: 'tasks.status.PAUSED',
  BLOCKED: 'tasks.status.BLOCKED',
  DONE: 'tasks.status.DONE',
  CANCELLED: 'tasks.status.CANCELLED',
};

export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'PAUSED',
  'BLOCKED',
  'DONE',
  'CANCELLED',
];

export const WORKLOAD_BAND_LABEL_IDS: Readonly<Record<BottleneckSeverity, MessageId>> = {
  LOW: 'workload.band.LOW',
  MODERATE: 'workload.band.MODERATE',
  HIGH: 'workload.band.HIGH',
  CRITICAL: 'workload.band.CRITICAL',
};

const IMPEDIMENT_CATEGORY_LABEL_IDS: Readonly<Record<string, MessageId>> = {
  EXTERNAL_DEPENDENCY: 'impediments.category.EXTERNAL_DEPENDENCY',
  TECHNICAL_ISSUE: 'impediments.category.TECHNICAL_ISSUE',
  MISSING_INFORMATION: 'impediments.category.MISSING_INFORMATION',
  RESOURCE_UNAVAILABILITY: 'impediments.category.RESOURCE_UNAVAILABILITY',
  AWAITING_APPROVAL: 'impediments.category.AWAITING_APPROVAL',
  COMMUNICATION: 'impediments.category.COMMUNICATION',
  OTHER: 'impediments.category.OTHER',
};

const IMPEDIMENT_SEVERITY_LABEL_IDS: Readonly<Record<string, MessageId>> = {
  LOW: 'impediments.severity.LOW',
  MEDIUM: 'impediments.severity.MEDIUM',
  HIGH: 'impediments.severity.HIGH',
  CRITICAL: 'impediments.severity.CRITICAL',
};

const BOTTLENECK_INDICATOR_LABEL_IDS: Readonly<Record<string, MessageId>> = {
  WIP: 'bottlenecks.indicator.WIP',
  INACTIVITY: 'bottlenecks.indicator.INACTIVITY',
  OVERDUE: 'bottlenecks.indicator.OVERDUE',
  IMPEDIMENTS: 'bottlenecks.indicator.IMPEDIMENTS',
  OVERLOAD: 'bottlenecks.indicator.OVERLOAD',
};

const BOTTLENECK_SEVERITY_LABEL_IDS: Readonly<Record<string, MessageId>> = {
  LOW: 'bottlenecks.severity.LOW',
  MODERATE: 'bottlenecks.severity.MODERATE',
  MEDIUM: 'bottlenecks.severity.MEDIUM',
  HIGH: 'bottlenecks.severity.HIGH',
  CRITICAL: 'bottlenecks.severity.CRITICAL',
};

const CYCLE_ORIGIN_LABEL_IDS: Readonly<Record<string, MessageId>> = {
  INITIAL: 'analytics.feedback.cycleOrigin.INITIAL',
  CONTESTATION_REOPEN: 'analytics.feedback.cycleOrigin.CONTESTATION_REOPEN',
  EXCEPTIONAL_REOPEN: 'analytics.feedback.cycleOrigin.EXCEPTIONAL_REOPEN',
};

const CONTEST_OUTCOME_LABEL_IDS: Readonly<Record<string, MessageId>> = {
  KEEP_RESOLUTION: 'feedbacks.contests.recommendation.KEEP_RESOLUTION',
  RESUME_SERVICE: 'feedbacks.contests.recommendation.RESUME_SERVICE',
  PENDING: 'feedbacks.reopen.status.PENDING',
};

export const CHART_ACCESSIBLE_PALETTE: readonly string[] = [
  '#1d4ed8',
  '#0f766e',
  '#b45309',
  '#7c3aed',
  '#be123c',
  '#334155',
];

export function formatAnalyticsDateTime(iso: IsoDateTime, intl: IntlShape): string {
  return intl.formatDate(iso, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function formatAnalyticsDate(iso: IsoDateTime, intl: IntlShape): string {
  return intl.formatDate(iso, {
    dateStyle: 'short',
  });
}

export function formatDurationMsValue(ms: number, intl: IntlShape): string {
  const hours = Math.round((ms / (60 * 60 * 1000)) * 10) / 10;
  return intl.formatMessage(
    { id: 'analytics.metric.hoursUnit' },
    { value: intl.formatNumber(hours, { maximumFractionDigits: 1 }) },
  );
}

export function durationMsToHours(ms: number): number {
  return Math.round((ms / (60 * 60 * 1000)) * 10) / 10;
}

export function formatAnalyticsMetricValue(
  metric: MetricValue<number>,
  kind: 'duration' | 'count' | 'percent' | 'score',
  intl: IntlShape,
): string {
  if (metric.status === 'UNAVAILABLE') {
    return `${intl.formatMessage({ id: 'analytics.metric.unavailableBadge' })} (${intl.formatMessage(
      {
        id: METRIC_REASON_LABEL_IDS[metric.reason],
      },
    )})`;
  }

  switch (kind) {
    case 'duration':
      return formatDurationMsValue(metric.value, intl);
    case 'percent': {
      const pct = Math.round(metric.value * 1000) / 10;
      return `${intl.formatNumber(pct, { maximumFractionDigits: 1 })}%`;
    }
    case 'score':
      return `${intl.formatNumber(metric.value, { maximumFractionDigits: 1 })}/100`;
    case 'count':
      return intl.formatNumber(metric.value);
  }
}

export function resolveAnalyticsWidgetLabel(widgetKey: string, intl: IntlShape): string {
  if (Object.prototype.hasOwnProperty.call(ANALYTICS_WIDGET_LABEL_IDS, widgetKey)) {
    return intl.formatMessage({
      id: ANALYTICS_WIDGET_LABEL_IDS[widgetKey as AnalyticsWidgetKey],
    });
  }
  return widgetKey;
}

export function resolveImpedimentCategoryLabel(category: string, intl: IntlShape): string {
  const id = IMPEDIMENT_CATEGORY_LABEL_IDS[category];
  return id !== undefined ? intl.formatMessage({ id }) : category;
}

export function resolveImpedimentSeverityLabel(severity: string, intl: IntlShape): string {
  const id = IMPEDIMENT_SEVERITY_LABEL_IDS[severity];
  return id !== undefined ? intl.formatMessage({ id }) : severity;
}

export function resolveBottleneckIndicatorLabel(indicator: string, intl: IntlShape): string {
  const id = BOTTLENECK_INDICATOR_LABEL_IDS[indicator];
  return id !== undefined ? intl.formatMessage({ id }) : indicator;
}

export function resolveBottleneckSeverityLabel(severity: string, intl: IntlShape): string {
  const id = BOTTLENECK_SEVERITY_LABEL_IDS[severity];
  return id !== undefined ? intl.formatMessage({ id }) : severity;
}

export function resolveCycleOriginLabel(origin: string, intl: IntlShape): string {
  const id = CYCLE_ORIGIN_LABEL_IDS[origin];
  return id !== undefined ? intl.formatMessage({ id }) : origin;
}

export function resolveContestOutcomeLabel(outcome: string, intl: IntlShape): string {
  const id = CONTEST_OUTCOME_LABEL_IDS[outcome];
  return id !== undefined ? intl.formatMessage({ id }) : outcome;
}

export function resolveSeverityBadgeVariant(
  severity: BottleneckSeverity | string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (severity) {
    case 'CRITICAL':
      return 'destructive';
    case 'HIGH':
      return 'default';
    case 'MODERATE':
    case 'MEDIUM':
      return 'outline';
    default:
      return 'secondary';
  }
}

export function moveWidgetInDraft(
  widgets: readonly DashboardWidgetConfig[],
  index: number,
  direction: 'up' | 'down',
): readonly DashboardWidgetConfig[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= widgets.length || targetIndex < 0 || targetIndex >= widgets.length) {
    return widgets;
  }

  const next = [...widgets];
  const currentItem = next[index];
  const swapItem = next[targetIndex];
  if (currentItem === undefined || swapItem === undefined) {
    return widgets;
  }

  next[index] = swapItem;
  next[targetIndex] = currentItem;

  return next.map((widget, order) => ({
    ...widget,
    order,
  }));
}

export function toggleWidgetVisibilityInDraft(
  widgets: readonly DashboardWidgetConfig[],
  widgetKey: string,
): readonly DashboardWidgetConfig[] {
  return widgets.map((widget, order) =>
    widget.widgetKey === widgetKey
      ? {
          ...widget,
          visible: !widget.visible,
          order,
        }
      : {
          ...widget,
          order,
        },
  );
}

export function areWidgetConfigsEqual(
  left: readonly DashboardWidgetConfig[],
  right: readonly DashboardWidgetConfig[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a === undefined ||
      b === undefined ||
      a.widgetKey !== b.widgetKey ||
      a.visible !== b.visible ||
      a.order !== b.order
    ) {
      return false;
    }
  }

  return true;
}

export function computeCalibrationGroupSums(
  draft: AnalyticsCalibrationDraft,
): AnalyticsCalibrationWeightGroupSums {
  const workloadSum =
    Math.round(
      (draft.workloadPriorityWeight +
        draft.workloadDelayWeight +
        draft.workloadImpedimentsWeight +
        draft.workloadOperationalStateWeight) *
        1000,
    ) / 1000;
  const focusSum =
    Math.round(
      (draft.focusPriorityWeight +
        draft.focusDeadlineWeight +
        draft.focusDependenciesWeight +
        draft.focusInactivityWeight +
        draft.focusWorkloadCompatibilityWeight) *
        1000,
    ) / 1000;

  return {
    workloadSum,
    focusSum,
    isWorkloadSumValid: Math.abs(workloadSum - 1) <= 0.001,
    isFocusSumValid: Math.abs(focusSum - 1) <= 0.001,
  };
}

export function buildIsoDateInputValue(iso: IsoDateTime): string {
  return iso.slice(0, 10);
}

export function buildDefaultCustomDateInputs(): { readonly start: string; readonly end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
}

export function parseCustomDateRangeFromInputs(
  startDate: string,
  endDate: string,
): DateRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return null;
  }
  const startIso = `${startDate}T00:00:00.000Z` as IsoDateTime;
  const endIso = `${endDate}T23:59:59.999Z` as IsoDateTime;
  if (Date.parse(startIso) > Date.parse(endIso)) {
    return null;
  }
  return {
    start: startIso,
    end: endIso,
  };
}
