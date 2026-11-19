import { ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  IMPEDIMENT_SEVERITIES,
  PRIORITIES,
  TASK_STATUSES,
  parseBrandedUuid,
  parseIsoDateTimeMs,
  type BottleneckSeverity,
  type Brand,
  type ImpedimentSeverity,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationScoped,
  type Priority,
  type ProjectId,
  type SubtaskId,
  type TaskId,
  type TaskStatus,
  type UserId,
} from '@/shared/kernel';

export type BottleneckAlertId = Brand<string, 'BottleneckAlertId'>;

export function asBottleneckAlertId(
  value: string,
  fieldName = 'bottleneckAlertId',
): BottleneckAlertId {
  return parseBrandedUuid<'BottleneckAlertId'>(value, fieldName);
}

export const BOTTLENECK_INDICATORS = {
  WIP: 'WIP',
  INACTIVITY: 'INACTIVITY',
  OVERDUE: 'OVERDUE',
  IMPEDIMENTS: 'IMPEDIMENTS',
  OVERLOAD: 'OVERLOAD',
} as const;

export type BottleneckIndicator =
  (typeof BOTTLENECK_INDICATORS)[keyof typeof BOTTLENECK_INDICATORS];

export const BOTTLENECK_ALERT_STATUSES = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
} as const;

export type BottleneckAlertStatus =
  (typeof BOTTLENECK_ALERT_STATUSES)[keyof typeof BOTTLENECK_ALERT_STATUSES];

export type BottleneckTargetEntityType = 'PROJECT' | 'BOARD_COLUMN' | 'TASK' | 'USER';

export interface BottleneckAlert extends OrganizationScoped {
  readonly id: BottleneckAlertId;
  readonly projectId?: ProjectId;
  readonly indicator: BottleneckIndicator;
  readonly severity: BottleneckSeverity;
  readonly status: BottleneckAlertStatus;
  readonly deduplicationKey: string;
  readonly targetEntityType: BottleneckTargetEntityType;
  readonly targetEntityId: string;
  readonly summary: string;
  readonly detectedAt: IsoDateTime;
  readonly lastSeenAt: IsoDateTime;
  readonly acknowledgedAt?: IsoDateTime;
  readonly acknowledgedByUserId?: UserId;
  readonly resolvedAt?: IsoDateTime;
  readonly resolvedByUserId?: UserId;
  readonly occurrenceCount: number;
}

export interface BottleneckAlertCandidate extends OrganizationScoped {
  readonly id: BottleneckAlertId;
  readonly projectId?: ProjectId;
  readonly indicator: BottleneckIndicator;
  readonly severity: BottleneckSeverity;
  readonly targetEntityType: BottleneckTargetEntityType;
  readonly targetEntityId: string;
  readonly summary: string;
}

export interface WorkloadScoringWeights {
  readonly priority: number;
  readonly delay: number;
  readonly impediments: number;
  readonly operationalState: number;
}

/**
 * Initial calibratable workload weights (PRD.md §12.3):
 * priority 30%, delay 30%, impediments 25%, operational state 15%.
 */
export const DEFAULT_WORKLOAD_WEIGHTS: Readonly<WorkloadScoringWeights> = Object.freeze({
  priority: 0.3,
  delay: 0.3,
  impediments: 0.25,
  operationalState: 0.15,
});

/** Initial paused-task workload reduction factor (50%, subject to calibration — PRD.md §12.3). */
export const DEFAULT_PAUSED_WORKLOAD_FACTOR = 0.5;

export interface WorkloadTaskSnapshot {
  readonly taskId: TaskId;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly participantCount: number;
  readonly openImpedimentsMaxSeverity?: ImpedimentSeverity;
}

export interface WorkloadSubtaskSnapshot {
  readonly subtaskId: SubtaskId;
  readonly status: 'OPEN' | 'DONE' | 'CANCELLED';
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
}

export interface WorkloadCalculationOptions {
  readonly weights?: WorkloadScoringWeights;
  readonly pausedFactor?: number;
  /** Reference weighted item capacity corresponding to 100 points (initial calibratable parameter). */
  readonly capacityReferenceUnits?: number;
}

export interface WorkloadScoreResult {
  readonly score: number;
  readonly level: BottleneckSeverity;
  readonly activeTaskCount: number;
  readonly activeSubtaskCount: number;
  /** Explicitly states PRD.md §12.3: workload score does NOT represent occupied hours. */
  readonly representsHours: false;
}

export interface InactivityTaskSnapshot {
  readonly taskId: TaskId;
  readonly status: TaskStatus;
  /** Based strictly on last movement, kept separate from lastActivityAt (PRD.md §12.1). */
  readonly lastMovedAt: IsoDateTime;
  readonly lastActivityAt: IsoDateTime;
  readonly inactivityThresholdDays: number;
}

export interface InactivityDetectionResult {
  readonly inactiveTaskIds: readonly TaskId[];
  readonly blockedTaskIds: readonly TaskId[];
}

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

/**
 * Classifies workload score 0-100 into official bands (PRD.md §12.3):
 * LOW 0-24, MODERATE 25-49, HIGH 50-74, CRITICAL 75-100.
 */
export function classifyWorkloadScore(score: number): BottleneckSeverity {
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
 * Deterministic weighted workload calculation (0-100) per PRD.md §12.3:
 * - DONE and CANCELLED tasks/subtasks contribute 0;
 * - PAUSED tasks apply calibrated reduction factor (default 50%);
 * - multi-participant tasks split contribution equally (1 / participantCount);
 * - subtasks are computed independently.
 */
export function calculateWorkloadScore(
  tasks: readonly WorkloadTaskSnapshot[],
  subtasks: readonly WorkloadSubtaskSnapshot[],
  now: IsoDateTime,
  options: WorkloadCalculationOptions = {},
): WorkloadScoreResult {
  const weights = options.weights ?? DEFAULT_WORKLOAD_WEIGHTS;
  const pausedFactor = options.pausedFactor ?? DEFAULT_PAUSED_WORKLOAD_FACTOR;
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
    level: classifyWorkloadScore(normalizedScore),
    activeTaskCount,
    activeSubtaskCount,
    representsHours: false,
  });
}

/**
 * Detects inactive tasks based strictly on lastMovedAt (PRD.md §12.1):
 * completed/cancelled tasks do not count; blocked tasks are differentiated from inactive tasks.
 */
export function detectInactiveTasks(
  tasks: readonly InactivityTaskSnapshot[],
  now: IsoDateTime,
): InactivityDetectionResult {
  const nowMs = parseIsoDateTimeMs(now);
  const inactiveTaskIds: TaskId[] = [];
  const blockedTaskIds: TaskId[] = [];

  for (const task of tasks) {
    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      continue;
    }

    if (task.status === TASK_STATUSES.BLOCKED) {
      blockedTaskIds.push(task.taskId);
      continue;
    }

    const elapsedDays = (nowMs - parseIsoDateTimeMs(task.lastMovedAt)) / MS_PER_DAY;
    if (elapsedDays >= Math.max(1, task.inactivityThresholdDays)) {
      inactiveTaskIds.push(task.taskId);
    }
  }

  return Object.freeze({
    inactiveTaskIds: Object.freeze(inactiveTaskIds),
    blockedTaskIds: Object.freeze(blockedTaskIds),
  });
}

export function buildBottleneckDeduplicationKey(
  organizationId: OrganizationId,
  indicator: BottleneckIndicator,
  targetEntityType: BottleneckTargetEntityType,
  targetEntityId: string,
): string {
  return `${organizationId}:${indicator}:${targetEntityType}:${targetEntityId}`;
}

/** Acknowledging an alert does NOT resolve it (PRD.md §12.2). */
export function isBottleneckAlertResolved(alert: BottleneckAlert): boolean {
  return alert.status === BOTTLENECK_ALERT_STATUSES.RESOLVED;
}

/**
 * Updates an equivalent active alert (OPEN or ACKNOWLEDGED) in place instead of duplicating it (PRD.md §12.2).
 */
export function upsertBottleneckAlert(
  existingAlerts: readonly BottleneckAlert[],
  candidate: BottleneckAlertCandidate,
  now: IsoDateTime,
): BottleneckAlert {
  const deduplicationKey = buildBottleneckDeduplicationKey(
    candidate.organizationId,
    candidate.indicator,
    candidate.targetEntityType,
    candidate.targetEntityId,
  );

  const activeMatch = existingAlerts.find(
    (alert) =>
      alert.deduplicationKey === deduplicationKey &&
      alert.status !== BOTTLENECK_ALERT_STATUSES.RESOLVED,
  );

  if (activeMatch) {
    return Object.freeze({
      ...activeMatch,
      severity: candidate.severity,
      summary: candidate.summary,
      lastSeenAt: now,
      occurrenceCount: activeMatch.occurrenceCount + 1,
    });
  }

  return Object.freeze({
    id: candidate.id,
    organizationId: candidate.organizationId,
    ...(candidate.projectId !== undefined ? { projectId: candidate.projectId } : {}),
    indicator: candidate.indicator,
    severity: candidate.severity,
    status: BOTTLENECK_ALERT_STATUSES.OPEN,
    deduplicationKey,
    targetEntityType: candidate.targetEntityType,
    targetEntityId: candidate.targetEntityId,
    summary: candidate.summary,
    detectedAt: now,
    lastSeenAt: now,
    occurrenceCount: 1,
  });
}
