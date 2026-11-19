import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  ORGANIZATION_ROLES,
  parseIsoDateTimeMs,
  type FeedbackCycleId,
  type IsoDateTime,
  type OrganizationRole,
  type UserId,
} from '@/shared/kernel';
import {
  CONTEST_RECOMMENDATIONS,
  CONTEST_STATUSES,
  CYCLE_ORIGINS,
  FEEDBACK_CLOSURE_REASONS,
  FEEDBACK_STATUSES,
  type ContestRecommendation,
  type ContestStatus,
  type CycleOrigin,
  type FeedbackContestAnalysis,
  type FeedbackCycle,
  type FeedbackSlaSnapshotId,
  type FeedbackStatus,
} from './feedback';

export interface OpenContestCheckInput {
  readonly cycle: FeedbackCycle;
  readonly hasPendingContest: boolean;
  readonly reasonVersionActive: boolean;
  readonly justification: string;
  readonly now: IsoDateTime;
}

export interface ContestDecisionCheckInput {
  readonly actorRole: OrganizationRole;
  readonly outcome: ContestRecommendation;
  readonly analysis?: FeedbackContestAnalysis;
  readonly justification: string;
}

export interface ContestDecisionOutcome {
  readonly contestStatus: ContestStatus;
  readonly nextFeedbackStatus: FeedbackStatus;
  readonly divergedFromAnalysis: boolean;
  readonly createsNewCycle: boolean;
  readonly newCycleOrigin?: CycleOrigin;
}

export interface ExceptionalReopenCheckInput {
  readonly cycle: FeedbackCycle;
  readonly hasPendingReopenRequest: boolean;
  readonly justification: string;
}

/**
 * Checks whether a resolved feedback cycle is eligible for automatic expiration closure (PRD.md §15.6).
 * Pending contests block auto-closure; both manifestation and contest deadlines must be expired.
 */
export function canAutoCloseResolvedFeedback(
  cycle: FeedbackCycle,
  hasPendingContest: boolean,
  now: IsoDateTime,
): boolean {
  if (cycle.status !== FEEDBACK_STATUSES.RESOLVED || cycle.closedAt !== undefined) {
    return false;
  }

  if (hasPendingContest) {
    return false;
  }

  if (cycle.manifestationDeadlineAt === undefined || cycle.contestDeadlineAt === undefined) {
    return false;
  }

  const nowMs = parseIsoDateTimeMs(now);
  const manifestationMs = parseIsoDateTimeMs(cycle.manifestationDeadlineAt);
  const contestMs = parseIsoDateTimeMs(cycle.contestDeadlineAt);

  return nowMs >= Math.max(manifestationMs, contestMs);
}

/**
 * Applies automatic expiration closure per PRD.md §15.6 and ADR-0006 §4:
 * closes the cycle while PRESERVING operational status as RESOLVED and authorConfirmedResolution = false.
 */
export function autoCloseResolvedFeedback(
  cycle: FeedbackCycle,
  hasPendingContest: boolean,
  now: IsoDateTime,
): FeedbackCycle {
  if (!canAutoCloseResolvedFeedback(cycle, hasPendingContest, now)) {
    throw new ConflictError(
      'Feedback cycle is not eligible for automatic expiration closure (check status, deadlines or pending contests).',
      { details: { cycleId: cycle.id } },
    );
  }

  return Object.freeze({
    ...cycle,
    status: FEEDBACK_STATUSES.RESOLVED,
    closedAt: now,
    closureReason: FEEDBACK_CLOSURE_REASONS.EXPIRED_WITHOUT_CONTEST,
    authorConfirmedResolution: false,
  });
}

/**
 * Explicit author confirmation transitions status to CLOSED and sets authorConfirmedResolution = true (ADR-0006 §4).
 */
export function confirmFeedbackResolution(
  cycle: FeedbackCycle,
  actorUserId: UserId,
  feedbackAuthorUserId: UserId,
  hasPendingContest: boolean,
  now: IsoDateTime,
): FeedbackCycle {
  if (actorUserId !== feedbackAuthorUserId) {
    throw new AuthorizationError('Only the feedback author may confirm its resolution.');
  }

  if (cycle.status !== FEEDBACK_STATUSES.RESOLVED || cycle.closedAt !== undefined) {
    throw new ConflictError('Only an open RESOLVED feedback cycle can be confirmed.');
  }

  if (hasPendingContest) {
    throw new ConflictError('Cannot confirm resolution while a contestation is still pending.');
  }

  return Object.freeze({
    ...cycle,
    status: FEEDBACK_STATUSES.CLOSED,
    closedAt: now,
    closureReason: FEEDBACK_CLOSURE_REASONS.CONFIRMED_BY_AUTHOR,
    authorConfirmedResolution: true,
  });
}

/**
 * Validates opening a new contestation (PRD.md §15.7 / docs/modules/feedback-contestation.md):
 * requires resolved origin, versioned reason, non-empty justification, valid contest window, and no active contest.
 */
export function assertContestCanBeOpened(input: OpenContestCheckInput): void {
  if (input.cycle.status !== FEEDBACK_STATUSES.RESOLVED || input.cycle.resolvedAt === undefined) {
    throw new ConflictError('A contestation can only be opened against a resolved feedback cycle.');
  }

  if (input.cycle.closedAt !== undefined) {
    throw new ConflictError('Cannot open a standard contestation on an already closed cycle.');
  }

  if (input.hasPendingContest) {
    throw new ConflictError(
      'A new contestation cannot be opened while a previous contestation is still pending.',
    );
  }

  if (!input.reasonVersionActive) {
    throw new ValidationError('Selected contestation reason version must be active.');
  }

  if (input.justification.trim().length === 0) {
    throw new ValidationError('Opening a contestation requires a non-empty justification.', {
      details: { field: 'justification' },
    });
  }

  if (input.cycle.contestDeadlineAt === undefined) {
    throw new ConflictError('Cycle does not have a contestation deadline snapshot.');
  }

  if (parseIsoDateTimeMs(input.now) > parseIsoDateTimeMs(input.cycle.contestDeadlineAt)) {
    throw new ConflictError('The contestation deadline window has expired for this resolution.');
  }
}

/**
 * Validates administrative contestation decision (PRD.md §15.7 / permission-matrix.md §5.7):
 * - exclusive to ADMIN;
 * - diverging from delegated analysis recommendation requires explicit non-empty justification;
 * - automatically closes the contestation;
 * - rejection keeps RESOLVED, acceptance returns IN_PROGRESS and spawns CONTESTATION_REOPEN cycle.
 */
export function assertContestDecisionValid(
  input: ContestDecisionCheckInput,
): ContestDecisionOutcome {
  if (input.actorRole !== ORGANIZATION_ROLES.ADMIN) {
    throw new AuthorizationError('Only an organization ADMIN may issue final contest decisions.');
  }

  const divergedFromAnalysis =
    input.analysis !== undefined && input.analysis.recommendation !== input.outcome;

  if (input.justification.trim().length === 0) {
    throw new ValidationError(
      divergedFromAnalysis
        ? 'Diverging from the delegated analysis recommendation requires a non-empty justification.'
        : 'Final contest decision requires a non-empty justification.',
      { details: { field: 'justification', divergedFromAnalysis } },
    );
  }

  if (input.outcome === CONTEST_RECOMMENDATIONS.RESUME_SERVICE) {
    return Object.freeze({
      contestStatus: CONTEST_STATUSES.CLOSED,
      nextFeedbackStatus: FEEDBACK_STATUSES.IN_PROGRESS,
      divergedFromAnalysis,
      createsNewCycle: true,
      newCycleOrigin: CYCLE_ORIGINS.CONTESTATION_REOPEN,
    });
  }

  return Object.freeze({
    contestStatus: CONTEST_STATUSES.CLOSED,
    nextFeedbackStatus: FEEDBACK_STATUSES.RESOLVED,
    divergedFromAnalysis,
    createsNewCycle: false,
  });
}

/**
 * Validates exceptional reopen request after expiration closure (PRD.md §15.8 / ADR-0006 §4).
 */
export function assertExceptionalReopenAllowed(input: ExceptionalReopenCheckInput): void {
  const closedByExpiration =
    input.cycle.closedAt !== undefined &&
    (input.cycle.closureReason === FEEDBACK_CLOSURE_REASONS.EXPIRED_WITHOUT_CONTEST ||
      input.cycle.closureReason === FEEDBACK_CLOSURE_REASONS.CONTEST_REJECTED_EXPIRED);

  if (!closedByExpiration) {
    throw new ConflictError(
      'Exceptional reopen requests are only allowed after expiration closure.',
      { details: { cycleId: input.cycle.id, closureReason: input.cycle.closureReason } },
    );
  }

  if (input.hasPendingReopenRequest) {
    throw new ConflictError('An exceptional reopen request is already pending for this cycle.');
  }

  if (input.justification.trim().length === 0) {
    throw new ValidationError('Exceptional reopen request requires a non-empty justification.', {
      details: { field: 'justification' },
    });
  }
}

/**
 * Spawns a new FeedbackCycle upon CONTESTATION_REOPEN or EXCEPTIONAL_REOPEN (PRD.md §15.8):
 * preserves previous assignee and priority as initial values while binding a new SLA snapshot.
 */
export function createReopenedFeedbackCycle(
  previousCycle: FeedbackCycle,
  newCycleId: FeedbackCycleId,
  origin: typeof CYCLE_ORIGINS.CONTESTATION_REOPEN | typeof CYCLE_ORIGINS.EXCEPTIONAL_REOPEN,
  newSlaSnapshotId: FeedbackSlaSnapshotId,
  now: IsoDateTime,
): FeedbackCycle {
  return Object.freeze({
    id: newCycleId,
    organizationId: previousCycle.organizationId,
    feedbackId: previousCycle.feedbackId,
    cycleNumber: previousCycle.cycleNumber + 1,
    origin,
    status: FEEDBACK_STATUSES.IN_PROGRESS,
    prioritySnapshot: previousCycle.prioritySnapshot,
    ...(previousCycle.assigneeId !== undefined
      ? {
          initialAssigneeId: previousCycle.assigneeId,
          assigneeId: previousCycle.assigneeId,
        }
      : {}),
    slaSnapshotId: newSlaSnapshotId,
    startedAt: now,
    authorConfirmedResolution: false,
  });
}

/**
 * Used categories can only be deactivated, never deleted (PRD.md §15.1 / DOMAIN.md).
 */
export function assertCategoryDeletionAllowed(hasBeenUsed: boolean): void {
  if (hasBeenUsed) {
    throw new ConflictError(
      'Categories that have already been used cannot be deleted; deactivate them instead.',
    );
  }
}
