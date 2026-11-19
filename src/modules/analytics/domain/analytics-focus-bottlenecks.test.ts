import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  IMPEDIMENT_SEVERITIES,
  METRIC_AVAILABILITY_STATUSES,
  METRIC_UNAVAILABLE_REASONS,
  PRIORITIES,
  TASK_STATUSES,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asSubtaskId,
  asTaskId,
  asUserId,
  createDateRange,
  diffDurationMs,
} from '@/shared/kernel';
import {
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  DEFAULT_PAUSED_WORKLOAD_FACTOR,
  DEFAULT_WORKLOAD_WEIGHTS,
  asBottleneckAlertId,
  calculateWorkloadScore,
  classifyWorkloadScore,
  detectInactiveTasks,
  isBottleneckAlertResolved,
  upsertBottleneckAlert,
  type BottleneckAlert,
  type WorkloadTaskSnapshot,
} from '@/modules/bottlenecks';
import {
  DEFAULT_FOCUS_WEIGHTS,
  FOCUS_MODES,
  asFocusPreferenceId,
  rankFocusTasks,
  type FocusPreference,
  type FocusTaskCandidate,
} from '@/modules/focus';
import {
  ANALYTICS_PERIOD_PRESETS,
  calculateCohortCompletionRate,
  calculateCycleTimeMs,
  calculateLeadTimeMs,
  calculateThroughput,
  countPeriodCompletions,
  countUniqueCompletedTasks,
  resolveAnalyticsPeriodRange,
  resolveEquivalentPreviousPeriod,
  type AnalyticsPauseSnapshot,
  type AnalyticsTaskCycleSnapshot,
  type AnalyticsTaskSnapshot,
} from '../index';

const ORG_A = asOrganizationId('12000000-0000-4000-8000-000000000001');
const PROJECT_1 = asProjectId('22000000-0000-4000-8000-000000000001');
const USER_1 = asUserId('32000000-0000-4000-8000-000000000001');
const TASK_1 = asTaskId('42000000-0000-4000-8000-000000000001');
const TASK_2 = asTaskId('42000000-0000-4000-8000-000000000002');
const TASK_3 = asTaskId('42000000-0000-4000-8000-000000000003');
const SUBTASK_1 = asSubtaskId('43000000-0000-4000-8000-000000000001');
const NOW = asIsoDateTime('2026-11-19T12:00:00Z');

describe('Workload Calculation 0–100 (PRD §12.3)', () => {
  it('uses canonical 30/30/25/15 weights, paused 50% reduction, equal participant split, zero for DONE/CANCELLED and representsHours: false', () => {
    expect(DEFAULT_WORKLOAD_WEIGHTS).toEqual({
      priority: 0.3,
      delay: 0.3,
      impediments: 0.25,
      operationalState: 0.15,
    });
    expect(DEFAULT_PAUSED_WORKLOAD_FACTOR).toBe(0.5);

    // Completed and cancelled items contribute 0
    const completedOnly = calculateWorkloadScore(
      [
        {
          taskId: TASK_1,
          status: TASK_STATUSES.DONE,
          priority: PRIORITIES.CRITICAL,
          participantCount: 1,
        },
        {
          taskId: TASK_2,
          status: TASK_STATUSES.CANCELLED,
          priority: PRIORITIES.HIGH,
          participantCount: 1,
        },
      ],
      [
        {
          subtaskId: SUBTASK_1,
          status: 'DONE',
          priority: PRIORITIES.CRITICAL,
        },
      ],
      NOW,
    );
    expect(completedOnly).toEqual({
      score: 0,
      level: BOTTLENECK_SEVERITIES.LOW,
      activeTaskCount: 0,
      activeSubtaskCount: 0,
      representsHours: false,
    });

    // Equal split among multiple participants (1 vs 2 participants)
    const singleParticipantTask: WorkloadTaskSnapshot = {
      taskId: TASK_1,
      status: TASK_STATUSES.IN_PROGRESS,
      priority: PRIORITIES.CRITICAL,
      dueDate: asIsoDateTime('2026-11-01T12:00:00Z'), // overdue > 7 days => delay 100
      participantCount: 1,
      openImpedimentsMaxSeverity: IMPEDIMENT_SEVERITIES.CRITICAL,
    };
    const soloResult = calculateWorkloadScore([singleParticipantTask], [], NOW, {
      capacityReferenceUnits: 1,
    });
    const sharedResult = calculateWorkloadScore(
      [{ ...singleParticipantTask, participantCount: 2 }],
      [],
      NOW,
      { capacityReferenceUnits: 1 },
    );
    expect(soloResult.score).toBe(100);
    expect(sharedResult.score).toBe(50);
    expect(soloResult.representsHours).toBe(false);

    // Paused task applies 50% reduction factor
    const pausedNoReduction = calculateWorkloadScore(
      [{ ...singleParticipantTask, status: TASK_STATUSES.PAUSED }],
      [],
      NOW,
      { capacityReferenceUnits: 1, pausedFactor: 1 },
    );
    const pausedDefault = calculateWorkloadScore(
      [{ ...singleParticipantTask, status: TASK_STATUSES.PAUSED }],
      [],
      NOW,
      { capacityReferenceUnits: 1 },
    );
    expect(pausedDefault.score).toBe(Math.round(pausedNoReduction.score * 0.5));
  });

  it('classifies exact score bands 0–24, 25–49, 50–74, 75–100 and validates weights', () => {
    expect(classifyWorkloadScore(0)).toBe(BOTTLENECK_SEVERITIES.LOW);
    expect(classifyWorkloadScore(24)).toBe(BOTTLENECK_SEVERITIES.LOW);
    expect(classifyWorkloadScore(25)).toBe(BOTTLENECK_SEVERITIES.MODERATE);
    expect(classifyWorkloadScore(49)).toBe(BOTTLENECK_SEVERITIES.MODERATE);
    expect(classifyWorkloadScore(50)).toBe(BOTTLENECK_SEVERITIES.HIGH);
    expect(classifyWorkloadScore(74)).toBe(BOTTLENECK_SEVERITIES.HIGH);
    expect(classifyWorkloadScore(75)).toBe(BOTTLENECK_SEVERITIES.CRITICAL);
    expect(classifyWorkloadScore(100)).toBe(BOTTLENECK_SEVERITIES.CRITICAL);

    expect(() =>
      calculateWorkloadScore([], [], NOW, {
        weights: { priority: 0.5, delay: 0.5, impediments: 0.5, operationalState: 0 },
      }),
    ).toThrow(ValidationError);
  });
});

describe('Focus Mode — Deterministic Explainable Ranking (PRD §13)', () => {
  it('applies 30/30/20/10/10 weights, separates blockedTasks with reasons and respects individual preferences', () => {
    expect(DEFAULT_FOCUS_WEIGHTS).toEqual({
      priority: 0.3,
      deadline: 0.3,
      dependencies: 0.2,
      inactivity: 0.1,
      workloadCompatibility: 0.1,
    });

    const urgentCandidate: FocusTaskCandidate = {
      organizationId: ORG_A,
      taskId: TASK_1,
      projectId: PROJECT_1,
      title: 'Entrega crítica atrasada',
      status: TASK_STATUSES.IN_PROGRESS,
      priority: PRIORITIES.CRITICAL,
      dueDate: asIsoDateTime('2026-11-18T12:00:00Z'),
      lastMovedAt: asIsoDateTime('2026-11-10T12:00:00Z'),
      inactivityThresholdDays: 5,
      hasPendingRequiredDependencies: false,
      isBlocked: false,
      blockingReasons: [],
      currentUserWorkloadScore: 40,
      effort: 'HIGH',
    };
    const lowCandidate: FocusTaskCandidate = {
      organizationId: ORG_A,
      taskId: TASK_2,
      projectId: PROJECT_1,
      title: 'Refinamento futuro',
      status: TASK_STATUSES.TODO,
      priority: PRIORITIES.LOW,
      dueDate: asIsoDateTime('2026-12-20T12:00:00Z'),
      lastMovedAt: NOW,
      inactivityThresholdDays: 7,
      hasPendingRequiredDependencies: false,
      isBlocked: false,
      blockingReasons: [],
      currentUserWorkloadScore: 40,
      effort: 'LOW',
    };
    const blockedCandidate: FocusTaskCandidate = {
      organizationId: ORG_A,
      taskId: TASK_3,
      projectId: PROJECT_1,
      title: 'Tarefa bloqueada',
      status: TASK_STATUSES.BLOCKED,
      priority: PRIORITIES.CRITICAL,
      lastMovedAt: asIsoDateTime('2026-11-15T12:00:00Z'),
      inactivityThresholdDays: 5,
      hasPendingRequiredDependencies: true,
      isBlocked: true,
      blockingReasons: [
        {
          code: 'OPEN_IMPEDIMENT',
          description: 'Aguardando aprovação de segurança',
          unblockCondition: 'Encerrar impedimento IMP-01',
        },
      ],
      currentUserWorkloadScore: 40,
    };

    const autoRanking = rankFocusTasks(
      [lowCandidate, blockedCandidate, urgentCandidate],
      null,
      NOW,
    );
    expect(autoRanking.mode).toBe(FOCUS_MODES.AUTO);
    expect(autoRanking.actionableTasks.map((item) => item.candidate.taskId)).toEqual([
      TASK_1,
      TASK_2,
    ]);
    expect(autoRanking.actionableTasks[0]?.factors).toEqual({
      priorityScore: 100,
      deadlineScore: 100,
      dependencyScore: 100,
      inactivityScore: 100,
      workloadCompatibilityScore: 95,
    });
    expect(autoRanking.actionableTasks[0]?.score).toBe(99.5);
    expect(autoRanking.blockedTasks).toHaveLength(1);
    expect(autoRanking.blockedTasks[0]?.candidate.taskId).toBe(TASK_3);
    expect(autoRanking.blockedTasks[0]?.reasons[0]?.unblockCondition).toContain('IMP-01');

    // Individual preferences: pinning TASK_2 places it first without altering official priority
    const preference: FocusPreference = {
      id: asFocusPreferenceId('52000000-0000-4000-8000-000000000001'),
      organizationId: ORG_A,
      userId: USER_1,
      mode: FOCUS_MODES.AUTO,
      pinnedTaskIds: [TASK_2],
      hiddenTaskIds: [],
      manualOrderTaskIds: [],
      updatedAt: NOW,
    };

    const pinnedRanking = rankFocusTasks([urgentCandidate, lowCandidate], preference, NOW);
    expect(pinnedRanking.actionableTasks[0]?.candidate.taskId).toBe(TASK_2);
    expect(pinnedRanking.actionableTasks[0]?.isPinned).toBe(true);
  });
});

describe('Bottlenecks — Inactivity vs Activity, Blocked Separation & Alert Deduplication', () => {
  it('uses lastMovedAt (never lastActivityAt) and separates BLOCKED tasks from inactive tasks', () => {
    const result = detectInactiveTasks(
      [
        {
          taskId: TASK_1,
          status: TASK_STATUSES.IN_PROGRESS,
          lastMovedAt: asIsoDateTime('2026-11-10T12:00:00Z'), // 9 days ago >= 7
          lastActivityAt: NOW, // recent comment does NOT reset movement inactivity
          inactivityThresholdDays: 7,
        },
        {
          taskId: TASK_2,
          status: TASK_STATUSES.BLOCKED,
          lastMovedAt: asIsoDateTime('2026-11-01T12:00:00Z'),
          lastActivityAt: asIsoDateTime('2026-11-01T12:00:00Z'),
          inactivityThresholdDays: 7,
        },
        {
          taskId: TASK_3,
          status: TASK_STATUSES.DONE,
          lastMovedAt: asIsoDateTime('2026-10-01T12:00:00Z'),
          lastActivityAt: asIsoDateTime('2026-10-01T12:00:00Z'),
          inactivityThresholdDays: 7,
        },
      ],
      NOW,
    );

    expect(result.inactiveTaskIds).toEqual([TASK_1]);
    expect(result.blockedTaskIds).toEqual([TASK_2]);
  });

  it('deduplicates active equivalent alerts and guarantees ACKNOWLEDGED !== RESOLVED', () => {
    const alertId1 = asBottleneckAlertId('62000000-0000-4000-8000-000000000001');
    const alertId2 = asBottleneckAlertId('62000000-0000-4000-8000-000000000002');
    const tEarly = asIsoDateTime('2026-11-18T10:00:00Z');

    const created = upsertBottleneckAlert(
      [],
      {
        id: alertId1,
        organizationId: ORG_A,
        projectId: PROJECT_1,
        indicator: BOTTLENECK_INDICATORS.WIP,
        severity: BOTTLENECK_SEVERITIES.HIGH,
        targetEntityType: 'BOARD_COLUMN',
        targetEntityId: 'col-1',
        summary: 'WIP exceeded (3/2)',
      },
      tEarly,
    );

    const acknowledged: BottleneckAlert = {
      ...created,
      status: BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED,
      acknowledgedAt: tEarly,
      acknowledgedByUserId: USER_1,
    };
    expect(isBottleneckAlertResolved(acknowledged)).toBe(false);

    const deduplicated = upsertBottleneckAlert(
      [acknowledged],
      {
        id: alertId2,
        organizationId: ORG_A,
        projectId: PROJECT_1,
        indicator: BOTTLENECK_INDICATORS.WIP,
        severity: BOTTLENECK_SEVERITIES.CRITICAL,
        targetEntityType: 'BOARD_COLUMN',
        targetEntityId: 'col-1',
        summary: 'WIP exceeded (4/2)',
      },
      NOW,
    );

    expect(deduplicated.id).toBe(alertId1);
    expect(deduplicated.status).toBe(BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED);
    expect(deduplicated.occurrenceCount).toBe(2);
    expect(deduplicated.severity).toBe(BOTTLENECK_SEVERITIES.CRITICAL);

    const resolved: BottleneckAlert = {
      ...deduplicated,
      status: BOTTLENECK_ALERT_STATUSES.RESOLVED,
      resolvedAt: NOW,
      resolvedByUserId: USER_1,
    };
    expect(isBottleneckAlertResolved(resolved)).toBe(true);
  });
});

describe('Analytics — Official Formulas, Periods & UNAVAILABLE (never implicit zero)', () => {
  it('resolves all official period presets and computes equivalent previous period', () => {
    const p7 = resolveAnalyticsPeriodRange(ANALYTICS_PERIOD_PRESETS.LAST_7_DAYS, NOW);
    const p30 = resolveAnalyticsPeriodRange(ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS, NOW);
    const p90 = resolveAnalyticsPeriodRange(ANALYTICS_PERIOD_PRESETS.LAST_90_DAYS, NOW);
    const pYear = resolveAnalyticsPeriodRange(ANALYTICS_PERIOD_PRESETS.CURRENT_YEAR, NOW);
    const customRange = createDateRange(
      asIsoDateTime('2026-11-01T00:00:00Z'),
      asIsoDateTime('2026-11-10T00:00:00Z'),
    );
    const pCustom = resolveAnalyticsPeriodRange(ANALYTICS_PERIOD_PRESETS.CUSTOM, NOW, customRange);

    const DAY_MS = 24 * 60 * 60 * 1000;
    expect(diffDurationMs(p7.start, p7.end)).toBe(7 * DAY_MS);
    expect(diffDurationMs(p30.start, p30.end)).toBe(30 * DAY_MS);
    expect(diffDurationMs(p90.start, p90.end)).toBe(90 * DAY_MS);
    expect(pYear.start).toBe('2026-01-01T00:00:00.000Z');
    expect(pCustom).toEqual(customRange);

    const prev7 = resolveEquivalentPreviousPeriod(p7);
    expect(diffDurationMs(prev7.start, prev7.end)).toBe(diffDurationMs(p7.start, p7.end));
    expect(diffDurationMs(prev7.end, p7.start)).toBe(1);
  });

  it('computes Lead Time, EFFECTIVE vs TOTAL Cycle Time, Throughput vs Unique Tasks, and Cohort Rate vs Period Completions', () => {
    const period = createDateRange(
      asIsoDateTime('2026-11-01T00:00:00Z'),
      asIsoDateTime('2026-11-30T23:59:59Z'),
    );
    const HOUR_MS = 60 * 60 * 1000;

    const tasks: AnalyticsTaskSnapshot[] = [
      // Created BEFORE cohort, completed IN period
      {
        taskId: TASK_1,
        projectId: PROJECT_1,
        status: TASK_STATUSES.DONE,
        createdAt: asIsoDateTime('2026-10-20T00:00:00Z'),
        completedAt: asIsoDateTime('2026-11-05T00:00:00Z'),
      },
      // Created IN cohort, completed IN period (10h lead time)
      {
        taskId: TASK_2,
        projectId: PROJECT_1,
        status: TASK_STATUSES.DONE,
        createdAt: asIsoDateTime('2026-11-10T00:00:00Z'),
        completedAt: asIsoDateTime('2026-11-10T10:00:00Z'),
      },
      // Created IN cohort, NOT completed
      {
        taskId: TASK_3,
        projectId: PROJECT_1,
        status: TASK_STATUSES.IN_PROGRESS,
        createdAt: asIsoDateTime('2026-11-12T00:00:00Z'),
      },
    ];

    // Reopened task TASK_2 completed twice inside the period
    const cycles: AnalyticsTaskCycleSnapshot[] = [
      {
        cycleId: 'cycle-1',
        taskId: TASK_2,
        startedAt: asIsoDateTime('2026-11-10T02:00:00Z'),
        effectiveStartedAt: asIsoDateTime('2026-11-10T02:00:00Z'),
        completedAt: asIsoDateTime('2026-11-10T10:00:00Z'), // 8h total
      },
      {
        cycleId: 'cycle-2',
        taskId: TASK_2,
        startedAt: asIsoDateTime('2026-11-15T08:00:00Z'),
        effectiveStartedAt: asIsoDateTime('2026-11-15T08:00:00Z'),
        completedAt: asIsoDateTime('2026-11-15T12:00:00Z'), // 4h total
      },
    ];
    const pauses: AnalyticsPauseSnapshot[] = [
      {
        cycleId: 'cycle-1',
        startedAt: asIsoDateTime('2026-11-10T04:00:00Z'),
        endedAt: asIsoDateTime('2026-11-10T06:00:00Z'), // 2h paused
      },
    ];

    // Cycle Time: TOTAL = avg(8h, 4h) = 6h; EFFECTIVE = avg(6h, 4h) = 5h
    expect(calculateCycleTimeMs(cycles, pauses, period, 'TOTAL')).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 6 * HOUR_MS,
    });
    expect(calculateCycleTimeMs(cycles, pauses, period, 'EFFECTIVE')).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 5 * HOUR_MS,
    });

    // Throughput = 2 cycles; Unique completed tasks = 1 distinct task ID
    expect(calculateThroughput(cycles, period)).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 2,
    });
    expect(countUniqueCompletedTasks(cycles, period)).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 1,
    });
    expect(countPeriodCompletions(cycles, period)).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 2,
    });

    // Cohort completion rate: 2 tasks created in Nov (TASK_2, TASK_3), 1 completed by Nov 30 => 0.5
    expect(
      calculateCohortCompletionRate(tasks, period, asIsoDateTime('2026-11-30T23:59:59Z')),
    ).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 0.5,
    });

    // Lead time available for the 2 completed tasks in period
    const leadTime = calculateLeadTimeMs(tasks, period);
    expect(leadTime.status).toBe(METRIC_AVAILABILITY_STATUSES.AVAILABLE);
  });

  it('returns UNAVAILABLE (never implicit zero) when data is insufficient or denominator is zero', () => {
    const period = createDateRange(
      asIsoDateTime('2026-11-01T00:00:00Z'),
      asIsoDateTime('2026-11-30T23:59:59Z'),
    );

    const leadTimeEmpty = calculateLeadTimeMs([], period);
    expect(leadTimeEmpty).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });
    expect('value' in leadTimeEmpty).toBe(false);

    const cycleTimeEmpty = calculateCycleTimeMs([], [], period);
    expect(cycleTimeEmpty).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.NO_COMPLETED_CYCLES,
    });

    const throughputEmpty = calculateThroughput([], period);
    expect(throughputEmpty).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });

    const uniqueEmpty = countUniqueCompletedTasks([], period);
    expect(uniqueEmpty).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });

    const cohortZeroDenominator = calculateCohortCompletionRate([], period, NOW);
    expect(cohortZeroDenominator).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.ZERO_DENOMINATOR,
    });
    expect('value' in cohortZeroDenominator).toBe(false);
  });
});
