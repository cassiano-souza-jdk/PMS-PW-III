import {
  parseBrandedUuid,
  type AttachmentDescriptor,
  type AuditableTimestamps,
  type Brand,
  type FeedbackContestId,
  type FeedbackCycleId,
  type FeedbackId,
  type IsoDate,
  type IsoDateTime,
  type OrganizationScoped,
  type Priority,
  type SoftDeletable,
  type UserId,
} from '@/shared/kernel';

export type FeedbackCategoryId = Brand<string, 'FeedbackCategoryId'>;
export type FeedbackCategoryVersionId = Brand<string, 'FeedbackCategoryVersionId'>;
export type FeedbackMessageId = Brand<string, 'FeedbackMessageId'>;
export type FeedbackInternalNoteId = Brand<string, 'FeedbackInternalNoteId'>;
export type FeedbackContestReasonId = Brand<string, 'FeedbackContestReasonId'>;
export type FeedbackContestReasonVersionId = Brand<string, 'FeedbackContestReasonVersionId'>;
export type FeedbackContestAnalysisId = Brand<string, 'FeedbackContestAnalysisId'>;
export type FeedbackContestDecisionId = Brand<string, 'FeedbackContestDecisionId'>;
export type FeedbackSlaSnapshotId = Brand<string, 'FeedbackSlaSnapshotId'>;
export type FeedbackReopenRequestId = Brand<string, 'FeedbackReopenRequestId'>;

export function asFeedbackCategoryId(
  value: string,
  fieldName = 'feedbackCategoryId',
): FeedbackCategoryId {
  return parseBrandedUuid<'FeedbackCategoryId'>(value, fieldName);
}

export function asFeedbackCategoryVersionId(
  value: string,
  fieldName = 'feedbackCategoryVersionId',
): FeedbackCategoryVersionId {
  return parseBrandedUuid<'FeedbackCategoryVersionId'>(value, fieldName);
}

export function asFeedbackMessageId(
  value: string,
  fieldName = 'feedbackMessageId',
): FeedbackMessageId {
  return parseBrandedUuid<'FeedbackMessageId'>(value, fieldName);
}

export function asFeedbackInternalNoteId(
  value: string,
  fieldName = 'feedbackInternalNoteId',
): FeedbackInternalNoteId {
  return parseBrandedUuid<'FeedbackInternalNoteId'>(value, fieldName);
}

export function asFeedbackContestReasonId(
  value: string,
  fieldName = 'feedbackContestReasonId',
): FeedbackContestReasonId {
  return parseBrandedUuid<'FeedbackContestReasonId'>(value, fieldName);
}

export function asFeedbackContestReasonVersionId(
  value: string,
  fieldName = 'feedbackContestReasonVersionId',
): FeedbackContestReasonVersionId {
  return parseBrandedUuid<'FeedbackContestReasonVersionId'>(value, fieldName);
}

export function asFeedbackContestAnalysisId(
  value: string,
  fieldName = 'feedbackContestAnalysisId',
): FeedbackContestAnalysisId {
  return parseBrandedUuid<'FeedbackContestAnalysisId'>(value, fieldName);
}

export function asFeedbackContestDecisionId(
  value: string,
  fieldName = 'feedbackContestDecisionId',
): FeedbackContestDecisionId {
  return parseBrandedUuid<'FeedbackContestDecisionId'>(value, fieldName);
}

export function asFeedbackSlaSnapshotId(
  value: string,
  fieldName = 'feedbackSlaSnapshotId',
): FeedbackSlaSnapshotId {
  return parseBrandedUuid<'FeedbackSlaSnapshotId'>(value, fieldName);
}

export function asFeedbackReopenRequestId(
  value: string,
  fieldName = 'feedbackReopenRequestId',
): FeedbackReopenRequestId {
  return parseBrandedUuid<'FeedbackReopenRequestId'>(value, fieldName);
}

/** Exact 7 feedback operational statuses (PRD.md §15.3, ADR-0006 §4). */
export const FEEDBACK_STATUSES = {
  RECEIVED: 'RECEIVED',
  IN_ANALYSIS: 'IN_ANALYSIS',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_INFO: 'WAITING_INFO',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[keyof typeof FEEDBACK_STATUSES];

export const CYCLE_ORIGINS = {
  INITIAL: 'INITIAL',
  CONTESTATION_REOPEN: 'CONTESTATION_REOPEN',
  EXCEPTIONAL_REOPEN: 'EXCEPTIONAL_REOPEN',
} as const;

export type CycleOrigin = (typeof CYCLE_ORIGINS)[keyof typeof CYCLE_ORIGINS];

export const CONTEST_STATUSES = {
  OPEN: 'OPEN',
  IN_ANALYSIS: 'IN_ANALYSIS',
  DECIDED: 'DECIDED',
  CLOSED: 'CLOSED',
} as const;

export type ContestStatus = (typeof CONTEST_STATUSES)[keyof typeof CONTEST_STATUSES];

export const CONTEST_RECOMMENDATIONS = {
  KEEP_RESOLUTION: 'KEEP_RESOLUTION',
  RESUME_SERVICE: 'RESUME_SERVICE',
} as const;

export type ContestRecommendation =
  (typeof CONTEST_RECOMMENDATIONS)[keyof typeof CONTEST_RECOMMENDATIONS];

export const REOPEN_REQUEST_STATUSES = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ReopenRequestStatus =
  (typeof REOPEN_REQUEST_STATUSES)[keyof typeof REOPEN_REQUEST_STATUSES];

/** Orthogonal closure reasons reconciling PRD.md §15.3, §15.6 and §15.8 (ADR-0006 §4). */
export const FEEDBACK_CLOSURE_REASONS = {
  CONFIRMED_BY_AUTHOR: 'CONFIRMED_BY_AUTHOR',
  EXPIRED_WITHOUT_CONTEST: 'EXPIRED_WITHOUT_CONTEST',
  CONTEST_REJECTED_EXPIRED: 'CONTEST_REJECTED_EXPIRED',
  ADMIN_CLOSED: 'ADMIN_CLOSED',
} as const;

export type FeedbackClosureReason =
  (typeof FEEDBACK_CLOSURE_REASONS)[keyof typeof FEEDBACK_CLOSURE_REASONS];

/** Initial 8 feedback category codes (PRD.md §15.1). */
export const INITIAL_FEEDBACK_CATEGORIES = {
  BUG_ERROR: 'BUG_ERROR',
  IMPROVEMENT: 'IMPROVEMENT',
  NEW_FEATURE: 'NEW_FEATURE',
  USABILITY: 'USABILITY',
  PERFORMANCE: 'PERFORMANCE',
  SECURITY: 'SECURITY',
  QUESTION_SUPPORT: 'QUESTION_SUPPORT',
  OTHER: 'OTHER',
} as const;

export type InitialFeedbackCategoryCode =
  (typeof INITIAL_FEEDBACK_CATEGORIES)[keyof typeof INITIAL_FEEDBACK_CATEGORIES];

/** Initial 8 contestation reason codes (PRD.md §15.7). */
export const INITIAL_CONTEST_REASONS = {
  SOLUTION_DID_NOT_RESOLVE: 'SOLUTION_DID_NOT_RESOLVE',
  PARTIALLY_APPLIED: 'PARTIALLY_APPLIED',
  PROBLEM_RETURNED: 'PROBLEM_RETURNED',
  DIFFERENT_FROM_REQUESTED: 'DIFFERENT_FROM_REQUESTED',
  PROBLEM_PERSISTS: 'PROBLEM_PERSISTS',
  NEW_EVIDENCE: 'NEW_EVIDENCE',
  DISAGREEMENT: 'DISAGREEMENT',
  OTHER: 'OTHER',
} as const;

export type InitialContestReasonCode =
  (typeof INITIAL_CONTEST_REASONS)[keyof typeof INITIAL_CONTEST_REASONS];

export type SlaCalendarMode = 'CONTINUOUS' | 'BUSINESS_HOURS';

export interface SlaBreakIntervalUtc {
  readonly startHour: number;
  readonly endHour: number;
}

export interface FeedbackSlaSnapshot extends OrganizationScoped {
  readonly id: FeedbackSlaSnapshotId;
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycleId;
  readonly prioritySnapshot: Priority;
  readonly calendarMode: SlaCalendarMode;
  readonly workDaysOfWeekUtc: readonly number[];
  readonly workStartHourUtc: number;
  readonly workEndHourUtc: number;
  readonly breakIntervalsUtc: readonly SlaBreakIntervalUtc[];
  readonly holidayDates: readonly IsoDate[];
  readonly firstResponseTargetMs: number;
  readonly resolutionTargetMs: number;
  readonly manifestationWindowMs: number;
  readonly contestWindowMs: number;
  readonly capturedAt: IsoDateTime;
}

export interface Feedback extends OrganizationScoped, AuditableTimestamps {
  readonly id: FeedbackId;
  readonly authorUserId: UserId;
  readonly moduleKey: string;
  readonly categoryId: FeedbackCategoryId;
  readonly categoryVersionId: FeedbackCategoryVersionId;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly status: FeedbackStatus;
  readonly assigneeId?: UserId;
  readonly currentCycleId: FeedbackCycleId;
  readonly closedAt?: IsoDateTime;
  readonly closureReason?: FeedbackClosureReason;
  readonly authorConfirmedResolution: boolean;
}

export interface FeedbackCycle extends OrganizationScoped {
  readonly id: FeedbackCycleId;
  readonly feedbackId: FeedbackId;
  readonly cycleNumber: number;
  readonly origin: CycleOrigin;
  readonly status: FeedbackStatus;
  readonly prioritySnapshot: Priority;
  readonly initialAssigneeId?: UserId;
  readonly assigneeId?: UserId;
  readonly slaSnapshotId: FeedbackSlaSnapshotId;
  readonly startedAt: IsoDateTime;
  readonly firstRespondedAt?: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
  readonly resolutionDescription?: string;
  readonly manifestationDeadlineAt?: IsoDateTime;
  readonly contestDeadlineAt?: IsoDateTime;
  readonly closedAt?: IsoDateTime;
  readonly closureReason?: FeedbackClosureReason;
  readonly authorConfirmedResolution: boolean;
}

export interface FeedbackCategory extends OrganizationScoped, AuditableTimestamps, SoftDeletable {
  readonly id: FeedbackCategoryId;
  readonly code: string;
  readonly currentVersionId: FeedbackCategoryVersionId;
  readonly active: boolean;
  readonly sortOrder: number;
  readonly hasBeenUsed: boolean;
}

export interface FeedbackCategoryVersion extends OrganizationScoped {
  readonly id: FeedbackCategoryVersionId;
  readonly categoryId: FeedbackCategoryId;
  readonly versionNumber: number;
  readonly name: string;
  readonly description?: string;
  readonly active: boolean;
  readonly createdByUserId: UserId;
  readonly createdAt: IsoDateTime;
}

/** Immutable public feedback message between author and authorized assignees (PRD.md §15.2, §15.4). */
export interface FeedbackMessage extends OrganizationScoped {
  readonly id: FeedbackMessageId;
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycleId;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly createdAt: IsoDateTime;
}

/**
 * Immutable internal note visible ONLY to authorized admins/assigned managers — never to the author.
 * `@` mentions never grant access (PRD.md §15.4).
 */
export interface FeedbackInternalNote extends OrganizationScoped {
  readonly id: FeedbackInternalNoteId;
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycleId;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly mentionedUserIds: readonly UserId[];
  readonly createdAt: IsoDateTime;
}

export interface FeedbackAttachment extends AttachmentDescriptor {
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycleId;
  readonly messageId?: FeedbackMessageId;
  readonly internalNoteId?: FeedbackInternalNoteId;
}

export interface FeedbackContestReason extends OrganizationScoped, AuditableTimestamps {
  readonly id: FeedbackContestReasonId;
  readonly code: string;
  readonly currentVersionId: FeedbackContestReasonVersionId;
  readonly active: boolean;
  readonly sortOrder: number;
  readonly hasBeenUsed: boolean;
}

export interface FeedbackContestReasonVersion extends OrganizationScoped {
  readonly id: FeedbackContestReasonVersionId;
  readonly reasonId: FeedbackContestReasonId;
  readonly versionNumber: number;
  readonly name: string;
  readonly description?: string;
  readonly active: boolean;
  readonly createdByUserId: UserId;
  readonly createdAt: IsoDateTime;
}

export interface FeedbackContest extends OrganizationScoped {
  readonly id: FeedbackContestId;
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycleId;
  readonly originResolvedAt: IsoDateTime;
  readonly reasonId: FeedbackContestReasonId;
  readonly reasonVersionId: FeedbackContestReasonVersionId;
  readonly justification: string;
  readonly status: ContestStatus;
  readonly openedByUserId: UserId;
  readonly openedAt: IsoDateTime;
  readonly delegatedAnalystUserId?: UserId;
  readonly closedAt?: IsoDateTime;
}

/** Immutable structured technical opinion from a delegated analyst (PRD.md §15.7). */
export interface FeedbackContestAnalysis extends OrganizationScoped {
  readonly id: FeedbackContestAnalysisId;
  readonly contestId: FeedbackContestId;
  readonly analystUserId: UserId;
  readonly recommendation: ContestRecommendation;
  readonly summary: string;
  readonly createdAt: IsoDateTime;
}

/** Immutable final administrative decision — exclusive to ADMIN (PRD.md §15.7). */
export interface FeedbackContestDecision extends OrganizationScoped {
  readonly id: FeedbackContestDecisionId;
  readonly contestId: FeedbackContestId;
  readonly decidedByAdminUserId: UserId;
  readonly outcome: ContestRecommendation;
  readonly divergedFromAnalysis: boolean;
  readonly justification: string;
  readonly decidedAt: IsoDateTime;
}

export interface FeedbackReopenRequest extends OrganizationScoped {
  readonly id: FeedbackReopenRequestId;
  readonly feedbackId: FeedbackId;
  readonly closedCycleId: FeedbackCycleId;
  readonly requestedByUserId: UserId;
  readonly justification: string;
  readonly status: ReopenRequestStatus;
  readonly requestedAt: IsoDateTime;
  readonly decidedByAdminUserId?: UserId;
  readonly decisionJustification?: string;
  readonly decidedAt?: IsoDateTime;
}
