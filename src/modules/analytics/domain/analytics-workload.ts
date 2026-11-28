import { ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  IMPEDIMENT_SEVERITIES,
  PRIORITIES,
  TASK_STATUSES,
  parseIsoDateTimeMs,
  type BottleneckSeverity,
  type ImpedimentSeverity,
  type IsoDateTime,
  type Priority,
  type TaskId,
  type TaskStatus,
} from '@/shared/kernel';

export interface AnalyticsWorkloadWeights {
  readonly priority: number;
  readonly delay: number;
  readonly impediments: number;
  readonly operationalState: number;
}

export interface AnalyticsWorkloadTaskInput {
  readonly taskId: TaskId;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly participantCount: number;
  readonly openImpedimentsMaxSeverity?: ImpedimentSeverity;
}

export interface AnalyticsWorkloadSubtaskInput {
  readonly subtaskId: string;
  readonly status: 'OPEN' | 'DONE' | 'CANCELLED';
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
}

export interface AnalyticsWorkloadCalculationOptions {
  readonly weights?: AnalyticsWorkloadWeights;
  readonly pausedFactor?: number;
  readonly capacityReferenceUnits?: number;
}

export interface AnalyticsWorkloadScoreResult {
  readonly score: number;
  readonly level: BottleneckSeverity;
  readonly activeTaskCount: number;
  readonly activeSubtaskCount: number;
  /** Explicitly states PRD.md §12.3: workload score does NOT represent occupied hours. */
  readonly representsHours: false;
}

export const DEFAULT_ANALYTICS_WORKLOAD_WEIGHTS: Readonly<AnalyticsWorkloadWeights> = Object.freeze(
  {
    priority: 0.3,
    delay: 0.3,
    impediments: 0.25,
    operationalState: 0.15,
  },
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRIORITY_VALUES: Readonly<Record<Priority, number>> = {
  [PRIORITIES.LOW]: 25,
  [PRIORITIES.MEDIUM]: 50,
  [PRIORITIES.HIGH]: 75,
  [PRIORITIES.CRITICAL]: 100,
};

const IMPEDIMENT_SEVERITY_VALUES: Readonly<Record<ImpedimentSeverity, number>> = {
  [IMPEDIMENT_SEVERITIES.LOW]: 25,
  [IMPEDIMENT_SEVERITIES.MEDIUM]: 50,
  [IMPEDIMENT_SEVERITIES.HIGH]: 75,
  [IMPEDIMENT_SEVERITIES.CRITICAL]: 100,
};

const TASK_STATE_VALUES: Readonly<Record<TaskStatus, number>> = {
  [TASK_STATUSES.TODO]: 40,
  [TASK_STATUSES.IN_PROGRESS]: 100,
  [TASK_STATUSES.BLOCKED]: 85,
  [TASK_STATUSES.PAUSED]: 60,
  [TASK_STATUSES.DONE]: 0,
  [TASK_STATUSES.CANCELLED]: 0,
};

export function classifyAnalyticsWorkloadScore(score: number): BottleneckSeverity {
  if (score >= 75) {
    return BOTTLENECK_SEVERITIES.CRITICAL;
  }
  if (score >= 50) {
    return BOTTLENECK_SEVERITIES.HIGH;
  }
  if (score >= 25) {
    return BOTTLENECK_SEVERITIES.MODERATE;
  }
  return BOTTLENECK_SEVERITIES.LOW;
}

function computeDelayValue(dueDate: IsoDateTime | undefined, nowMs: number): number {
  if (dueDate === undefined) {
    return 15;
  }

  const remainingDays = (parseIsoDateTimeMs(dueDate) - nowMs) / MS_PER_DAY;
  if (remainingDays < -7) {
    return 100;
  }
  if (remainingDays < 0) {
    return 85;
  }
  if (remainingDays <= 2) {
    return 65;
  }
  if (remainingDays <= 7) {
    return 40;
  }
  return 15;
}

/**
 * Pure Analytics-local workload calculator (0-100, `representsHours: false`) aligned with PRD.md §12.3.
 * Lives inside `analytics/domain` to preserve the acyclic DAG (`analytics` never imports `bottlenecks`).
 */
export function calculateAnalyticsWorkloadScore(
  tasks: readonly AnalyticsWorkloadTaskInput[],
  subtasks: readonly AnalyticsWorkloadSubtaskInput[],
  now: IsoDateTime,
  options: AnalyticsWorkloadCalculationOptions = {},
): AnalyticsWorkloadScoreResult {
  const weights = options.weights ?? DEFAULT_ANALYTICS_WORKLOAD_WEIGHTS;
  const pausedFactor = options.pausedFactor ?? 0.5;
  const capacityReferenceUnits = options.capacityReferenceUnits ?? 5;

  const weightSum =
    weights.priority + weights.delay + weights.impediments + weights.operationalState;
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new ValidationError('Workload scoring weights must sum to 1.0.', {
      details: { weightSum },
    });
  }

  if (pausedFactor < 0 || pausedFactor > 1) {
    throw new ValidationError('Workload "pausedFactor" must be within [0, 1].', {
      details: { pausedFactor },
    });
  }

  if (capacityReferenceUnits <= 0) {
    throw new ValidationError('Workload "capacityReferenceUnits" must be > 0.', {
      details: { capacityReferenceUnits },
    });
  }

  const nowMs = parseIsoDateTimeMs(now);
  let accumulatedUnits = 0;
  let activeTaskCount = 0;
  let activeSubtaskCount = 0;

  for (const task of tasks) {
    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      continue;
    }

    activeTaskCount += 1;
    const participantCount = Math.max(1, Math.floor(task.participantCount));
    const priorityComponent = PRIORITY_VALUES[task.priority] * weights.priority;
    const delayComponent = computeDelayValue(task.dueDate, nowMs) * weights.delay;
    const impedimentComponent =
      (task.openImpedimentsMaxSeverity !== undefined
        ? IMPEDIMENT_SEVERITY_VALUES[task.openImpedimentsMaxSeverity]
        : 0) * weights.impediments;
    const stateComponent = TASK_STATE_VALUES[task.status] * weights.operationalState;

    const rawItemScore = priorityComponent + delayComponent + impedimentComponent + stateComponent;
    const pauseMultiplier = task.status === TASK_STATUSES.PAUSED ? pausedFactor : 1;
    const sharedContribution = (rawItemScore * pauseMultiplier) / participantCount;

    accumulatedUnits += sharedContribution / 100;
  }

  for (const subtask of subtasks) {
    if (subtask.status !== 'OPEN') {
      continue;
    }

    activeSubtaskCount += 1;
    const priorityComponent = PRIORITY_VALUES[subtask.priority] * weights.priority;
    const delayComponent = computeDelayValue(subtask.dueDate, nowMs) * weights.delay;
    const stateComponent = 50 * weights.operationalState;
    const rawSubtaskScore = priorityComponent + delayComponent + stateComponent;

    accumulatedUnits += (rawSubtaskScore / 100) * 0.5;
  }

  const normalizedScore = Math.min(
    100,
    Math.round((accumulatedUnits / capacityReferenceUnits) * 100),
  );

  return Object.freeze({
    score: normalizedScore,
    level: classifyAnalyticsWorkloadScore(normalizedScore),
    activeTaskCount,
    activeSubtaskCount,
    representsHours: false,
  });
}
