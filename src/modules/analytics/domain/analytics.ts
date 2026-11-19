import { ValidationError } from '@/shared/errors';
import {
  asIsoDateTime,
  assertValidDateRange,
  availableMetric,
  createDateRange,
  parseBrandedUuid,
  parseIsoDateTimeMs,
  unavailableMetric,
  type Brand,
  type DateRange,
  type IsoDateTime,
  type MetricValue,
  type OrganizationScoped,
  type ProjectId,
  type TaskId,
  type TaskStatus,
  type UserId,
} from '@/shared/kernel';

export type DashboardPreferenceId = Brand<string, 'DashboardPreferenceId'>;

export function asDashboardPreferenceId(
  value: string,
  fieldName = 'dashboardPreferenceId',
): DashboardPreferenceId {
  return parseBrandedUuid<'DashboardPreferenceId'>(value, fieldName);
}

export const DASHBOARD_SCOPES = {
  PERSONAL: 'PERSONAL',
  PROJECT: 'PROJECT',
  ORGANIZATION: 'ORGANIZATION',
} as const;

export type DashboardScope = (typeof DASHBOARD_SCOPES)[keyof typeof DASHBOARD_SCOPES];

export interface DashboardWidgetConfig {
  readonly widgetKey: string;
  readonly visible: boolean;
  readonly order: number;
  readonly filters?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Individual dashboard preference (PRD.md §14, docs/modules/analytics.md):
 * per-user/per-organization, never shared, with demo dashboards isolated from real ones.
 */
export interface DashboardPreference extends OrganizationScoped {
  readonly id: DashboardPreferenceId;
  readonly userId: UserId;
  readonly scope: DashboardScope;
  readonly projectId?: ProjectId;
  readonly widgets: readonly DashboardWidgetConfig[];
  readonly isDemoIsolated: boolean;
  readonly updatedAt: IsoDateTime;
}

export const ANALYTICS_PERIOD_PRESETS = {
  LAST_7_DAYS: 'LAST_7_DAYS',
  LAST_30_DAYS: 'LAST_30_DAYS',
  LAST_90_DAYS: 'LAST_90_DAYS',
  CURRENT_YEAR: 'CURRENT_YEAR',
  CUSTOM: 'CUSTOM',
} as const;

export type AnalyticsPeriodPreset =
  (typeof ANALYTICS_PERIOD_PRESETS)[keyof typeof ANALYTICS_PERIOD_PRESETS];

/** Pure anti-corruption input snapshots for Analytics formulas (ADR-0006 §3.2). */
export interface AnalyticsPauseSnapshot {
  readonly cycleId: string;
  readonly startedAt: IsoDateTime;
  readonly endedAt?: IsoDateTime;
}

export interface AnalyticsTaskCycleSnapshot {
  readonly cycleId: string;
  readonly taskId: TaskId;
  readonly startedAt: IsoDateTime;
  readonly effectiveStartedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
}

export interface AnalyticsTaskSnapshot {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly status: TaskStatus;
  readonly createdAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
}

export type CycleTimeDurationMode = 'EFFECTIVE' | 'TOTAL';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isWithinDateRange(timestamp: IsoDateTime, range: DateRange): boolean {
  const ms = parseIsoDateTimeMs(timestamp);
  return ms >= parseIsoDateTimeMs(range.start) && ms <= parseIsoDateTimeMs(range.end);
}

/**
 * Resolves official Analytics periods (PRD.md §14 / docs/modules/analytics.md):
 * 7, 30, 90 days, current year or custom interval.
 */
export function resolveAnalyticsPeriodRange(
  preset: AnalyticsPeriodPreset,
  referenceNow: IsoDateTime,
  customRange?: DateRange,
): DateRange {
  const refMs = parseIsoDateTimeMs(referenceNow);

  switch (preset) {
    case ANALYTICS_PERIOD_PRESETS.LAST_7_DAYS:
      return createDateRange(
        asIsoDateTime(new Date(refMs - 7 * MS_PER_DAY).toISOString()),
        referenceNow,
      );
    case ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS:
      return createDateRange(
        asIsoDateTime(new Date(refMs - 30 * MS_PER_DAY).toISOString()),
        referenceNow,
      );
    case ANALYTICS_PERIOD_PRESETS.LAST_90_DAYS:
      return createDateRange(
        asIsoDateTime(new Date(refMs - 90 * MS_PER_DAY).toISOString()),
        referenceNow,
      );
    case ANALYTICS_PERIOD_PRESETS.CURRENT_YEAR: {
      const refDate = new Date(refMs);
      const startOfYear = new Date(Date.UTC(refDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      return createDateRange(asIsoDateTime(startOfYear.toISOString()), referenceNow);
    }
    case ANALYTICS_PERIOD_PRESETS.CUSTOM: {
      if (!customRange) {
        throw new ValidationError('Custom analytics period requires an explicit "customRange".');
      }
      assertValidDateRange(customRange, 'customRange');
      return Object.freeze({ ...customRange });
    }
  }
}

/**
 * Computes the immediately preceding period of identical duration for equivalent comparison (PRD.md §14).
 */
export function resolveEquivalentPreviousPeriod(range: DateRange): DateRange {
  assertValidDateRange(range);
  const startMs = parseIsoDateTimeMs(range.start);
  const endMs = parseIsoDateTimeMs(range.end);
  const durationMs = endMs - startMs;

  const previousEndMs = startMs - 1;
  const previousStartMs = previousEndMs - durationMs;

  return createDateRange(
    asIsoDateTime(new Date(previousStartMs).toISOString()),
    asIsoDateTime(new Date(previousEndMs).toISOString()),
  );
}

/**
 * Official Lead Time formula (docs/contracts/metric-definitions.md):
 * average duration from task creation to completion for tasks completed within the period.
 * Returns UNAVAILABLE (never implicit zero) when no eligible tasks exist.
 */
export function calculateLeadTimeMs(
  tasks: readonly AnalyticsTaskSnapshot[],
  period: DateRange,
): MetricValue<number> {
  assertValidDateRange(period);

  const durations: number[] = [];
  for (const task of tasks) {
    if (task.completedAt === undefined || !isWithinDateRange(task.completedAt, period)) {
      continue;
    }

    const duration = parseIsoDateTimeMs(task.completedAt) - parseIsoDateTimeMs(task.createdAt);
    if (duration >= 0) {
      durations.push(duration);
    }
  }

  if (durations.length === 0) {
    return unavailableMetric('INSUFFICIENT_DATA');
  }

  const total = durations.reduce((acc, value) => acc + value, 0);
  return availableMetric(Math.round(total / durations.length));
}

function computeCyclePausedDurationMs(
  cycle: AnalyticsTaskCycleSnapshot,
  pauses: readonly AnalyticsPauseSnapshot[],
  cycleStartMs: number,
  cycleEndMs: number,
): number {
  let pausedMs = 0;

  for (const pause of pauses) {
    if (pause.cycleId !== cycle.cycleId) {
      continue;
    }

    const pauseStartMs = parseIsoDateTimeMs(pause.startedAt);
    const pauseEndMs = pause.endedAt !== undefined ? parseIsoDateTimeMs(pause.endedAt) : cycleEndMs;
    if (pauseEndMs < pauseStartMs) {
      continue;
    }

    const clampedStart = Math.max(pauseStartMs, cycleStartMs);
    const clampedEnd = Math.min(pauseEndMs, cycleEndMs);
    if (clampedEnd > clampedStart) {
      pausedMs += clampedEnd - clampedStart;
    }
  }

  return pausedMs;
}

/**
 * Official Cycle Time formula (docs/contracts/metric-definitions.md):
 * effective start until completion; discounts valid pauses in EFFECTIVE mode while keeping TOTAL mode separate.
 * Returns UNAVAILABLE (NO_COMPLETED_CYCLES) when no completed cycles exist in the period.
 */
export function calculateCycleTimeMs(
  cycles: readonly AnalyticsTaskCycleSnapshot[],
  pauses: readonly AnalyticsPauseSnapshot[],
  period: DateRange,
  mode: CycleTimeDurationMode = 'EFFECTIVE',
): MetricValue<number> {
  assertValidDateRange(period);

  const durations: number[] = [];
  for (const cycle of cycles) {
    if (cycle.completedAt === undefined || !isWithinDateRange(cycle.completedAt, period)) {
      continue;
    }

    const startMs = parseIsoDateTimeMs(cycle.effectiveStartedAt ?? cycle.startedAt);
    const endMs = parseIsoDateTimeMs(cycle.completedAt);
    if (endMs < startMs) {
      continue;
    }

    const totalMs = endMs - startMs;
    if (mode === 'TOTAL') {
      durations.push(totalMs);
    } else {
      const pausedMs = computeCyclePausedDurationMs(cycle, pauses, startMs, endMs);
      durations.push(Math.max(0, totalMs - pausedMs));
    }
  }

  if (durations.length === 0) {
    return unavailableMetric('NO_COMPLETED_CYCLES');
  }

  const sum = durations.reduce((acc, value) => acc + value, 0);
  return availableMetric(Math.round(sum / durations.length));
}

/**
 * Official Throughput formula (docs/contracts/metric-definitions.md):
 * completed execution cycles within the period.
 * Returns UNAVAILABLE when the dataset itself has no records (insufficient data).
 */
export function calculateThroughput(
  cycles: readonly AnalyticsTaskCycleSnapshot[],
  period: DateRange,
): MetricValue<number> {
  assertValidDateRange(period);

  if (cycles.length === 0) {
    return unavailableMetric('INSUFFICIENT_DATA');
  }

  let completedCycles = 0;
  for (const cycle of cycles) {
    if (cycle.completedAt !== undefined && isWithinDateRange(cycle.completedAt, period)) {
      completedCycles += 1;
    }
  }

  return availableMetric(completedCycles);
}

/**
 * Counts unique completed task IDs within the period (docs/contracts/metric-definitions.md).
 * Reopened tasks completed multiple times count once as unique task, distinct from Throughput.
 */
export function countUniqueCompletedTasks(
  cycles: readonly AnalyticsTaskCycleSnapshot[],
  period: DateRange,
): MetricValue<number> {
  assertValidDateRange(period);

  if (cycles.length === 0) {
    return unavailableMetric('INSUFFICIENT_DATA');
  }

  const uniqueTaskIds = new Set<TaskId>();
  for (const cycle of cycles) {
    if (cycle.completedAt !== undefined && isWithinDateRange(cycle.completedAt, period)) {
      uniqueTaskIds.add(cycle.taskId);
    }
  }

  return availableMetric(uniqueTaskIds.size);
}

/**
 * Official Cohort Completion Rate (docs/contracts/metric-definitions.md):
 * tasks created within cohortPeriod that were completed by referenceDate / total tasks in the cohort.
 * Returns UNAVAILABLE (ZERO_DENOMINATOR) when the cohort is empty — never implicit 0.
 */
export function calculateCohortCompletionRate(
  tasks: readonly AnalyticsTaskSnapshot[],
  cohortPeriod: DateRange,
  referenceDate: IsoDateTime,
): MetricValue<number> {
  assertValidDateRange(cohortPeriod);
  const referenceMs = parseIsoDateTimeMs(referenceDate);

  const cohortTasks = tasks.filter((task) => isWithinDateRange(task.createdAt, cohortPeriod));
  if (cohortTasks.length === 0) {
    return unavailableMetric('ZERO_DENOMINATOR');
  }

  const completedInCohort = cohortTasks.filter(
    (task) => task.completedAt !== undefined && parseIsoDateTimeMs(task.completedAt) <= referenceMs,
  ).length;

  return availableMetric(Math.round((completedInCohort / cohortTasks.length) * 10_000) / 10_000);
}

/**
 * Separate indicator: tasks/cycles completed within the period regardless of creation date
 * (PRD.md §14 / docs/contracts/metric-definitions.md).
 */
export function countPeriodCompletions(
  cycles: readonly AnalyticsTaskCycleSnapshot[],
  period: DateRange,
): MetricValue<number> {
  return calculateThroughput(cycles, period);
}
