import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  isSoftDeleted,
  parseIsoDateTimeMs,
  validateAttachmentQuota,
  type ImpedimentId,
  type IsoDateTime,
  type TaskId,
} from '@/shared/kernel';
import {
  SUBTASK_STATUSES,
  type Subtask,
  type TaskComment,
  type TaskExecutionCycle,
  type TaskExecutionCycleId,
  type TaskPause,
} from './task';

export interface DependencyExceptionInput {
  readonly authorized: boolean;
  readonly justification: string;
}

export interface TaskCompletionCheckInput {
  readonly requiredSubtasks: readonly Subtask[];
  readonly pendingRequiredDependencyIds: readonly TaskId[];
  readonly openBlockingImpedimentIds: readonly ImpedimentId[];
  readonly dependencyException?: DependencyExceptionInput;
}

export interface TaskCompletionCheckResult {
  readonly allowed: true;
  readonly usedDependencyException: boolean;
  readonly requiresAudit: boolean;
}

export interface TaskEffectiveDurationResult {
  readonly totalDurationMs: number;
  readonly pausedDurationMs: number;
  readonly effectiveDurationMs: number;
}

/**
 * Validates task completion invariants (PRD.md §10, §11):
 * - all required subtasks must be DONE or CANCELLED;
 * - no open blocking impediments may remain;
 * - pending required dependencies block completion unless an authorized, justified exception is supplied.
 */
export function assertTaskCanBeCompleted(
  input: TaskCompletionCheckInput,
): TaskCompletionCheckResult {
  const incompleteRequiredSubtasks = input.requiredSubtasks.filter(
    (subtask) =>
      subtask.required &&
      subtask.status !== SUBTASK_STATUSES.DONE &&
      subtask.status !== SUBTASK_STATUSES.CANCELLED,
  );

  if (incompleteRequiredSubtasks.length > 0) {
    throw new ConflictError('Cannot complete task while required subtasks remain open.', {
      details: {
        incompleteSubtaskIds: incompleteRequiredSubtasks.map((subtask) => subtask.id),
      },
    });
  }

  if (input.openBlockingImpedimentIds.length > 0) {
    throw new ConflictError('Cannot complete task while blocking impediments remain open.', {
      details: {
        openBlockingImpedimentIds: [...input.openBlockingImpedimentIds],
      },
    });
  }

  if (input.pendingRequiredDependencyIds.length === 0) {
    return Object.freeze({
      allowed: true,
      usedDependencyException: false,
      requiresAudit: false,
    });
  }

  if (!input.dependencyException) {
    throw new ConflictError('Cannot complete task while required dependencies remain pending.', {
      details: {
        pendingRequiredDependencyIds: [...input.pendingRequiredDependencyIds],
      },
    });
  }

  if (!input.dependencyException.authorized) {
    throw new AuthorizationError(
      'Actor is not authorized to bypass pending required dependencies.',
    );
  }

  if (input.dependencyException.justification.trim().length === 0) {
    throw new ValidationError(
      'A non-empty justification is required when overriding pending required dependencies.',
      {
        details: { field: 'justification' },
      },
    );
  }

  return Object.freeze({
    allowed: true,
    usedDependencyException: true,
    requiresAudit: true,
  });
}

export function assertTaskCanBeCancelled(justification: string): void {
  if (justification.trim().length === 0) {
    throw new ValidationError('Task cancellation requires a non-empty justification.', {
      details: { field: 'justification' },
    });
  }
}

export function assertTaskPauseJustification(reason: string): void {
  if (reason.trim().length === 0) {
    throw new ValidationError('Task pause requires a non-empty justification reason.', {
      details: { field: 'reason' },
    });
  }
}

export function assertTaskCommentEditable(comment: TaskComment): void {
  if (comment.isSystem) {
    throw new ConflictError('System-generated task comments are immutable.', {
      details: { commentId: comment.id },
    });
  }

  if (isSoftDeleted(comment)) {
    throw new ConflictError('Deleted task comments cannot be edited.', {
      details: { commentId: comment.id },
    });
  }
}

/**
 * Computes total, paused and effective execution duration for a task cycle
 * (PRD.md §14 / docs/contracts/metric-definitions.md).
 * Rejects negative intervals or overlapping pauses.
 */
export function calculateTaskEffectiveDurationMs(
  cycle: TaskExecutionCycle,
  pauses: readonly TaskPause[],
  now: IsoDateTime,
): TaskEffectiveDurationResult {
  const startIso = cycle.effectiveStartedAt ?? cycle.startedAt;
  const endIso = cycle.completedAt ?? now;

  const cycleStartMs = parseIsoDateTimeMs(startIso);
  const cycleEndMs = parseIsoDateTimeMs(endIso);

  if (cycleEndMs < cycleStartMs) {
    throw new ValidationError('Task execution cycle end time cannot precede its start time.', {
      details: { cycleId: cycle.id },
    });
  }

  const cyclePauses = pauses.filter((pause) => pause.cycleId === cycle.id);
  const parsedIntervals: { readonly startMs: number; readonly endMs: number }[] = [];

  for (const pause of cyclePauses) {
    const pauseStartMs = parseIsoDateTimeMs(pause.startedAt);
    const pauseEndMs = parseIsoDateTimeMs(pause.endedAt ?? endIso);

    if (pauseEndMs < pauseStartMs) {
      throw new ValidationError('Task pause end time cannot precede its start time.', {
        details: { pauseId: pause.id },
      });
    }

    parsedIntervals.push({ startMs: pauseStartMs, endMs: pauseEndMs });
  }

  parsedIntervals.sort((a, b) => a.startMs - b.startMs);

  for (let index = 1; index < parsedIntervals.length; index += 1) {
    const previous = parsedIntervals[index - 1];
    const current = parsedIntervals[index];
    if (previous !== undefined && current !== undefined && current.startMs < previous.endMs) {
      throw new ValidationError('Task pauses within the same execution cycle cannot overlap.', {
        details: { cycleId: cycle.id },
      });
    }
  }

  let pausedDurationMs = 0;
  for (const interval of parsedIntervals) {
    const clampedStart = Math.max(interval.startMs, cycleStartMs);
    const clampedEnd = Math.min(interval.endMs, cycleEndMs);
    if (clampedEnd > clampedStart) {
      pausedDurationMs += clampedEnd - clampedStart;
    }
  }

  const totalDurationMs = cycleEndMs - cycleStartMs;
  const effectiveDurationMs = Math.max(0, totalDurationMs - pausedDurationMs);

  return Object.freeze({
    totalDurationMs,
    pausedDurationMs,
    effectiveDurationMs,
  });
}

export function validateTaskAttachmentSize(
  existingTotalBytes: number,
  newFileSizeBytes: number,
  fileName = 'attachment',
  mimeType = 'application/octet-stream',
): void {
  validateAttachmentQuota({
    fileName,
    mimeType,
    sizeBytes: newFileSizeBytes,
    existingContextTotalBytes: existingTotalBytes,
  });
}

/**
 * Reopening a completed task always appends a new TaskExecutionCycle while preserving
 * all previous cycles immutably in history (PRD.md §14, docs/contracts/metric-definitions.md).
 */
export function assertTaskReopenCreatesNewCycle(
  currentCycles: readonly TaskExecutionCycle[],
  now: IsoDateTime,
  newCycleId: TaskExecutionCycleId,
  reopenReason?: string,
): TaskExecutionCycle {
  if (currentCycles.length === 0) {
    throw new ConflictError('Cannot reopen a task that has no completed execution cycle.');
  }

  const hasOpenCycle = currentCycles.some((cycle) => cycle.completedAt === undefined);
  if (hasOpenCycle) {
    throw new ConflictError('Cannot reopen a task while an active execution cycle is still open.');
  }

  const sortedCycles = [...currentCycles].sort((a, b) => a.cycleNumber - b.cycleNumber);
  const latestCycle = sortedCycles[sortedCycles.length - 1];
  if (!latestCycle) {
    throw new ConflictError('Cannot resolve latest completed execution cycle.');
  }

  const trimmedReason = reopenReason?.trim();

  return Object.freeze({
    id: newCycleId,
    organizationId: latestCycle.organizationId,
    taskId: latestCycle.taskId,
    cycleNumber: latestCycle.cycleNumber + 1,
    startedAt: now,
    effectiveStartedAt: now,
    reopenedFromCycleId: latestCycle.id,
    ...(trimmedReason !== undefined && trimmedReason.length > 0
      ? { reopenReason: trimmedReason }
      : {}),
  });
}
