import { ValidationError } from '@/shared/errors';
import {
  PRIORITIES,
  TASK_STATUSES,
  parseBrandedUuid,
  parseIsoDateTimeMs,
  type Brand,
  type IsoDateTime,
  type OrganizationScoped,
  type Priority,
  type ProjectId,
  type TaskId,
  type TaskStatus,
  type UserId,
} from '@/shared/kernel';

export type FocusPreferenceId = Brand<string, 'FocusPreferenceId'>;

export function asFocusPreferenceId(
  value: string,
  fieldName = 'focusPreferenceId',
): FocusPreferenceId {
  return parseBrandedUuid<'FocusPreferenceId'>(value, fieldName);
}

export const FOCUS_MODES = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const;

export type FocusMode = (typeof FOCUS_MODES)[keyof typeof FOCUS_MODES];

/**
 * Individual Focus Mode preference (PRD.md §13).
 * Pinning, hiding or manually reordering affects ONLY the individual view,
 * never the official Kanban order or official task priority.
 */
export interface FocusPreference extends OrganizationScoped {
  readonly id: FocusPreferenceId;
  readonly userId: UserId;
  readonly mode: FocusMode;
  readonly pinnedTaskIds: readonly TaskId[];
  readonly hiddenTaskIds: readonly TaskId[];
  readonly manualOrderTaskIds: readonly TaskId[];
  readonly updatedAt: IsoDateTime;
}

export interface FocusScoringWeights {
  readonly priority: number;
  readonly deadline: number;
  readonly dependencies: number;
  readonly inactivity: number;
  readonly workloadCompatibility: number;
}

/**
 * Initial calibratable weights for Focus Mode scoring (PRD.md §13):
 * official priority 30%, deadline/delay 30%, available dependencies 20%,
 * inactivity 10%, workload compatibility 10%.
 */
export const DEFAULT_FOCUS_WEIGHTS: Readonly<FocusScoringWeights> = Object.freeze({
  priority: 0.3,
  deadline: 0.3,
  dependencies: 0.2,
  inactivity: 0.1,
  workloadCompatibility: 0.1,
});

export type FocusBlockingReasonCode = 'OPEN_IMPEDIMENT' | 'PENDING_DEPENDENCY' | 'PAUSED' | 'OTHER';

export interface FocusBlockingReason {
  readonly code: FocusBlockingReasonCode;
  readonly description: string;
  readonly unblockCondition: string;
}

export type FocusTaskEffort = 'LOW' | 'MEDIUM' | 'HIGH';

/** Pure anti-corruption input snapshot consumed by Focus Mode ranking (ADR-0006 §3.2). */
export interface FocusTaskCandidate extends OrganizationScoped {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly lastMovedAt: IsoDateTime;
  readonly inactivityThresholdDays: number;
  readonly hasPendingRequiredDependencies: boolean;
  readonly isBlocked: boolean;
  readonly blockingReasons: readonly FocusBlockingReason[];
  readonly currentUserWorkloadScore: number;
  readonly effort?: FocusTaskEffort;
}

export interface FocusScoreBreakdown {
  readonly priorityScore: number;
  readonly deadlineScore: number;
  readonly dependencyScore: number;
  readonly inactivityScore: number;
  readonly workloadCompatibilityScore: number;
}

export interface RankedFocusTask {
  readonly candidate: FocusTaskCandidate;
  readonly isPinned: boolean;
  readonly score: number;
  readonly factors: FocusScoreBreakdown;
}

export interface BlockedFocusTask {
  readonly candidate: FocusTaskCandidate;
  readonly reasons: readonly FocusBlockingReason[];
}

export interface FocusRankingResult {
  readonly mode: FocusMode;
  readonly actionableTasks: readonly RankedFocusTask[];
  readonly blockedTasks: readonly BlockedFocusTask[];
  readonly weightsUsed: FocusScoringWeights;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRIORITY_SCORES: Readonly<Record<Priority, number>> = {
  [PRIORITIES.LOW]: 25,
  [PRIORITIES.MEDIUM]: 50,
  [PRIORITIES.HIGH]: 75,
  [PRIORITIES.CRITICAL]: 100,
};

function assertValidWeights(weights: FocusScoringWeights): void {
  const sum =
    weights.priority +
    weights.deadline +
    weights.dependencies +
    weights.inactivity +
    weights.workloadCompatibility;

  if (Math.abs(sum - 1) > 0.001) {
    throw new ValidationError('Focus scoring weights must sum to 1.0.', {
      details: { sum },
    });
  }
}

function computeDeadlineScore(dueDate: IsoDateTime | undefined, nowMs: number): number {
  if (dueDate === undefined) {
    return 20;
  }

  const remainingDays = (parseIsoDateTimeMs(dueDate) - nowMs) / MS_PER_DAY;
  if (remainingDays <= 0) {
    return 100;
  }
  if (remainingDays <= 1) {
    return 90;
  }
  if (remainingDays <= 3) {
    return 75;
  }
  if (remainingDays <= 7) {
    return 55;
  }
  return 30;
}

function computeInactivityScore(
  lastMovedAt: IsoDateTime,
  thresholdDays: number,
  nowMs: number,
): number {
  const elapsedDays = Math.max(0, (nowMs - parseIsoDateTimeMs(lastMovedAt)) / MS_PER_DAY);
  const safeThreshold = Math.max(1, thresholdDays);
  const ratio = Math.min(1, elapsedDays / safeThreshold);
  return Math.round(ratio * 100);
}

function computeWorkloadCompatibilityScore(
  currentUserWorkloadScore: number,
  effort: FocusTaskEffort = 'MEDIUM',
): number {
  const clampedLoad = Math.max(0, Math.min(100, currentUserWorkloadScore));

  if (clampedLoad >= 75) {
    return effort === 'LOW' ? 100 : effort === 'MEDIUM' ? 50 : 20;
  }
  if (clampedLoad >= 50) {
    return effort === 'LOW' ? 90 : effort === 'MEDIUM' ? 75 : 45;
  }
  return effort === 'HIGH' ? 95 : effort === 'MEDIUM' ? 85 : 70;
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic and explainable Focus Mode ranking service (PRD.md §13).
 * Separates blocked tasks with explicit reasons/unblock conditions from actionable tasks.
 */
export function rankFocusTasks(
  candidates: readonly FocusTaskCandidate[],
  preference: FocusPreference | null,
  now: IsoDateTime,
  weights: FocusScoringWeights = DEFAULT_FOCUS_WEIGHTS,
): FocusRankingResult {
  assertValidWeights(weights);

  const nowMs = parseIsoDateTimeMs(now);
  const mode: FocusMode = preference?.mode ?? FOCUS_MODES.AUTO;
  const hiddenSet = new Set<TaskId>(preference?.hiddenTaskIds ?? []);
  const pinnedOrder = new Map<TaskId, number>();
  (preference?.pinnedTaskIds ?? []).forEach((taskId, index) => pinnedOrder.set(taskId, index));

  const manualOrder = new Map<TaskId, number>();
  (preference?.manualOrderTaskIds ?? []).forEach((taskId, index) => manualOrder.set(taskId, index));

  const actionable: RankedFocusTask[] = [];
  const blocked: BlockedFocusTask[] = [];

  for (const candidate of candidates) {
    if (
      hiddenSet.has(candidate.taskId) ||
      candidate.status === TASK_STATUSES.DONE ||
      candidate.status === TASK_STATUSES.CANCELLED
    ) {
      continue;
    }

    const isBlocked =
      candidate.isBlocked ||
      candidate.status === TASK_STATUSES.BLOCKED ||
      candidate.blockingReasons.length > 0;

    if (isBlocked) {
      const reasons: readonly FocusBlockingReason[] =
        candidate.blockingReasons.length > 0
          ? candidate.blockingReasons
          : [
              {
                code: 'OTHER',
                description: 'Task is currently blocked.',
                unblockCondition: 'Resolve blocking condition to return to actionable focus.',
              },
            ];

      blocked.push(Object.freeze({ candidate, reasons: Object.freeze([...reasons]) }));
      continue;
    }

    const factors: FocusScoreBreakdown = Object.freeze({
      priorityScore: PRIORITY_SCORES[candidate.priority],
      deadlineScore: computeDeadlineScore(candidate.dueDate, nowMs),
      dependencyScore: candidate.hasPendingRequiredDependencies ? 0 : 100,
      inactivityScore: computeInactivityScore(
        candidate.lastMovedAt,
        candidate.inactivityThresholdDays,
        nowMs,
      ),
      workloadCompatibilityScore: computeWorkloadCompatibilityScore(
        candidate.currentUserWorkloadScore,
        candidate.effort,
      ),
    });

    const totalScore = roundTwoDecimals(
      factors.priorityScore * weights.priority +
        factors.deadlineScore * weights.deadline +
        factors.dependencyScore * weights.dependencies +
        factors.inactivityScore * weights.inactivity +
        factors.workloadCompatibilityScore * weights.workloadCompatibility,
    );

    actionable.push(
      Object.freeze({
        candidate,
        isPinned: pinnedOrder.has(candidate.taskId),
        score: totalScore,
        factors,
      }),
    );
  }

  actionable.sort((a, b) => {
    const pinA = pinnedOrder.get(a.candidate.taskId);
    const pinB = pinnedOrder.get(b.candidate.taskId);
    if (pinA !== undefined && pinB !== undefined) {
      return pinA - pinB;
    }
    if (pinA !== undefined) {
      return -1;
    }
    if (pinB !== undefined) {
      return 1;
    }

    if (mode === FOCUS_MODES.MANUAL) {
      const manA = manualOrder.get(a.candidate.taskId);
      const manB = manualOrder.get(b.candidate.taskId);
      if (manA !== undefined && manB !== undefined) {
        return manA - manB;
      }
      if (manA !== undefined) {
        return -1;
      }
      if (manB !== undefined) {
        return 1;
      }
    }

    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const dueA = a.candidate.dueDate
      ? parseIsoDateTimeMs(a.candidate.dueDate)
      : Number.MAX_SAFE_INTEGER;
    const dueB = b.candidate.dueDate
      ? parseIsoDateTimeMs(b.candidate.dueDate)
      : Number.MAX_SAFE_INTEGER;
    if (dueA !== dueB) {
      return dueA - dueB;
    }

    return a.candidate.taskId.localeCompare(b.candidate.taskId);
  });

  blocked.sort((a, b) => a.candidate.taskId.localeCompare(b.candidate.taskId));

  return Object.freeze({
    mode,
    actionableTasks: Object.freeze(actionable),
    blockedTasks: Object.freeze(blocked),
    weightsUsed: Object.freeze({ ...weights }),
  });
}
