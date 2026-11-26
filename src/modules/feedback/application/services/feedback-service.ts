import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import {
  GRANT_STATUSES,
  PERMISSION_CODES,
  PERMISSION_SCOPE_TYPES,
  assertAuthorized,
  evaluateAuthorization,
  isDenyRuleActiveAt,
  type AuthorizationActor,
  type AuthorizationPolicyConfig,
  type AuthorizationResource,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionCode,
  type PermissionGrant,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import type {
  OrganizationMemberRepositoryPort,
  OrganizationRepositoryPort,
} from '@/modules/organizations';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationCalendarConfig,
  type OrganizationSettings,
  type OrganizationSettingsRepositoryPort,
  type SlaPriorityPolicy,
} from '@/modules/settings';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TRANSACTION_RESOURCES,
  asAttachmentId,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asFeedbackContestId,
  asFeedbackCycleId,
  asFeedbackId,
  asGrantId,
  asIsoDate,
  asIsoDateTime,
  asOrganizationId,
  asUserId,
  createDomainEvent,
  isDisallowedAttachmentMimeType,
  isIsoDate,
  isSoftDeleted,
  isUuid,
  parseIsoDateTimeMs,
  validateAttachmentQuota,
  type AttachmentBlobStorePort,
  type AttachmentId,
  type CorrelationId,
  type DomainEventPublisherPort,
  type FeedbackId,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationRole,
  type Priority,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  CONTEST_RECOMMENDATIONS,
  CONTEST_STATUSES,
  CYCLE_ORIGINS,
  FEEDBACK_CLOSURE_REASONS,
  FEEDBACK_MODULE_KEYS,
  FEEDBACK_STATUSES,
  REOPEN_REQUEST_STATUSES,
  asFeedbackCategoryId,
  asFeedbackCategoryVersionId,
  asFeedbackContestAnalysisId,
  asFeedbackContestDecisionId,
  asFeedbackContestReasonId,
  asFeedbackContestReasonVersionId,
  asFeedbackInternalNoteId,
  asFeedbackMessageId,
  asFeedbackReopenRequestId,
  asFeedbackSlaSnapshotId,
  type ContestRecommendation,
  type Feedback,
  type FeedbackAttachment,
  type FeedbackCategory,
  type FeedbackCategoryId,
  type FeedbackCategoryVersion,
  type FeedbackContest,
  type FeedbackContestAnalysis,
  type FeedbackContestDecision,
  type FeedbackContestReason,
  type FeedbackContestReasonId,
  type FeedbackContestReasonVersion,
  type FeedbackCycle,
  type FeedbackInternalNote,
  type FeedbackInternalNoteId,
  type FeedbackMessage,
  type FeedbackMessageId,
  type FeedbackReopenRequest,
  type FeedbackReopenRequestId,
  type FeedbackSlaSnapshot,
  type FeedbackStatus,
  type SlaPauseInterval,
} from '../../domain/feedback';
import {
  assertCategoryDeletionAllowed,
  assertContestCanBeOpened,
  assertContestDecisionValid,
  assertExceptionalReopenAllowed,
  autoCloseResolvedFeedback,
  canAutoCloseResolvedFeedback,
  confirmFeedbackResolution as confirmFeedbackResolutionPolicy,
  createReopenedFeedbackCycle,
} from '../../domain/feedback-policies';
import {
  calculateSlaElapsedMs,
  evaluateSlaStatus,
  type SlaEvaluationStatus,
} from '../../domain/sla-calculator';
import type { FeedbackActorProfile, FeedbackContextPort } from '../ports/feedback-context.port';
import type {
  FeedbackAttachmentRepositoryPort,
  FeedbackCategoryRepositoryPort,
  FeedbackContestReasonRepositoryPort,
  FeedbackContestRepositoryPort,
  FeedbackCycleRepositoryPort,
  FeedbackInternalNoteRepositoryPort,
  FeedbackMessageRepositoryPort,
  FeedbackReopenRequestRepositoryPort,
  FeedbackRepositoryPort,
  FeedbackSlaSnapshotRepositoryPort,
} from '../ports/feedback-repository.port';

const SLA_WARNING_THRESHOLD_RATIO = 0.8;

const prioritySchema = z.enum([
  PRIORITIES.LOW,
  PRIORITIES.MEDIUM,
  PRIORITIES.HIGH,
  PRIORITIES.CRITICAL,
]);

const feedbackStatusSchema = z.enum([
  FEEDBACK_STATUSES.RECEIVED,
  FEEDBACK_STATUSES.IN_ANALYSIS,
  FEEDBACK_STATUSES.ASSIGNED,
  FEEDBACK_STATUSES.IN_PROGRESS,
  FEEDBACK_STATUSES.WAITING_INFO,
  FEEDBACK_STATUSES.RESOLVED,
  FEEDBACK_STATUSES.CLOSED,
]);

const feedbackModuleKeySchema = z.enum(FEEDBACK_MODULE_KEYS);

const contestRecommendationSchema = z.enum([
  CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
  CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
]);

const reopenDecisionSchema = z.enum([
  REOPEN_REQUEST_STATUSES.APPROVED,
  REOPEN_REQUEST_STATUSES.REJECTED,
]);

const createFeedbackInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    moduleKey: feedbackModuleKeySchema,
    categoryId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(5).max(8000),
    priority: prioritySchema.default(PRIORITIES.MEDIUM),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const assignFeedbackInputSchema = z
  .object({
    assigneeId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const updateFeedbackTriageInputSchema = z
  .object({
    priority: prioritySchema.optional(),
    categoryId: z.string().uuid().optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => data.priority !== undefined || data.categoryId !== undefined,
    'At least one triage field ("priority" or "categoryId") must be provided.',
  );

const transitionFeedbackStatusInputSchema = z
  .object({
    targetStatus: feedbackStatusSchema,
    resolutionDescription: z.string().trim().max(8000).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const addMessageInputSchema = z
  .object({
    body: z.string().trim().min(1).max(8000),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const addInternalNoteInputSchema = z
  .object({
    body: z.string().trim().min(1).max(8000),
    mentionedUserIds: z.array(z.string().uuid()).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const createCatalogItemInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const updateCatalogItemInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.union([z.string().trim().max(500), z.null()]).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.active !== undefined ||
      data.sortOrder !== undefined,
    'At least one updatable catalog field ("name", "description", "active", or "sortOrder") must be provided.',
  );

const reorderCatalogIdsSchema = z
  .object({
    orderedIds: z.array(z.string().uuid()).min(1),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const calendarBreakSchema = z
  .object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((value) => value.endHour > value.startHour, 'Break endHour must exceed startHour.');

const calendarConfigSchema = z
  .object({
    mode: z.enum(['CONTINUOUS', 'BUSINESS_HOURS']),
    workDaysOfWeekUtc: z.array(z.number().int().min(0).max(6)),
    workStartHourUtc: z.number().int().min(0).max(23),
    workEndHourUtc: z.number().int().min(1).max(24),
    breakIntervalsUtc: z.array(calendarBreakSchema),
    holidayDates: z.array(z.string().refine(isIsoDate, 'Holiday must be a valid YYYY-MM-DD date.')),
  })
  .strict()
  .superRefine((cal, ctx) => {
    if (cal.mode === 'BUSINESS_HOURS' && cal.workDaysOfWeekUtc.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workDaysOfWeekUtc'],
        message: 'BUSINESS_HOURS mode requires at least one work day.',
      });
    }
    if (cal.workEndHourUtc <= cal.workStartHourUtc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workEndHourUtc'],
        message: 'workEndHourUtc must be greater than workStartHourUtc.',
      });
    }
    for (const brk of cal.breakIntervalsUtc) {
      if (brk.startHour < cal.workStartHourUtc || brk.endHour > cal.workEndHourUtc) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['breakIntervalsUtc'],
          message: 'Break intervals must fall within workStartHourUtc..workEndHourUtc.',
        });
      }
    }
  });

const slaPolicyPatchSchema = z
  .object({
    firstResponseTargetMs: z.number().int().positive(),
    resolutionTargetMs: z.number().int().positive(),
  })
  .strict();

const updateSlaSettingsInputSchema = z
  .object({
    calendar: calendarConfigSchema.optional(),
    slaPoliciesByPriority: z
      .object({
        LOW: slaPolicyPatchSchema.optional(),
        MEDIUM: slaPolicyPatchSchema.optional(),
        HIGH: slaPolicyPatchSchema.optional(),
        CRITICAL: slaPolicyPatchSchema.optional(),
      })
      .strict()
      .optional(),
    feedbackManifestationWindowMs: z.number().int().positive().optional(),
    feedbackContestWindowMs: z.number().int().positive().optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.calendar !== undefined ||
      data.slaPoliciesByPriority !== undefined ||
      data.feedbackManifestationWindowMs !== undefined ||
      data.feedbackContestWindowMs !== undefined,
    'At least one SLA settings field must be provided.',
  );

const openContestInputSchema = z
  .object({
    reasonId: z.string().uuid(),
    justification: z.string(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const delegateContestInputSchema = z
  .object({
    analystUserId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const submitContestAnalysisInputSchema = z
  .object({
    recommendation: contestRecommendationSchema,
    summary: z.string().trim().min(1).max(8000),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const decideContestInputSchema = z
  .object({
    outcome: contestRecommendationSchema,
    justification: z.string(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const requestReopenInputSchema = z
  .object({
    justification: z.string(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const decideReopenInputSchema = z
  .object({
    decision: reopenDecisionSchema,
    justification: z.string(),
    assigneeId: z.string().uuid().optional(),
    priority: prioritySchema.optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const exportFeedbacksOptionsSchema = z
  .object({
    format: z.enum(['JSON', 'CSV']).default('JSON'),
    status: feedbackStatusSchema.optional(),
    assigneeId: z.string().uuid().optional(),
    authorUserId: z.string().uuid().optional(),
    feedbackId: z.string().uuid().optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

export interface FeedbackServiceDependencies {
  readonly feedbacks: FeedbackRepositoryPort;
  readonly feedbackCycles: FeedbackCycleRepositoryPort;
  readonly feedbackCategories: FeedbackCategoryRepositoryPort;
  readonly feedbackMessages: FeedbackMessageRepositoryPort;
  readonly feedbackInternalNotes: FeedbackInternalNoteRepositoryPort;
  readonly feedbackAttachments: FeedbackAttachmentRepositoryPort;
  readonly feedbackContests: FeedbackContestRepositoryPort;
  readonly feedbackContestReasons: FeedbackContestReasonRepositoryPort;
  readonly feedbackSlaSnapshots: FeedbackSlaSnapshotRepositoryPort;
  readonly feedbackReopenRequests: FeedbackReopenRequestRepositoryPort;
  readonly attachmentBlobStore: AttachmentBlobStorePort;
  readonly feedbackContext: FeedbackContextPort;
  readonly organizations: OrganizationRepositoryPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly organizationSettings: OrganizationSettingsRepositoryPort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface FeedbackOperationOptions {
  readonly reason?: string;
  readonly correlationId?: CorrelationId;
}

export interface FeedbackSlaLiveStatus {
  readonly evaluatedAt: IsoDateTime;
  readonly firstResponseElapsedMs: number;
  readonly firstResponseTargetMs: number;
  readonly firstResponseStatus: SlaEvaluationStatus;
  readonly firstResponseCompleted: boolean;
  readonly resolutionElapsedMs: number;
  readonly resolutionTargetMs: number;
  readonly resolutionStatus: SlaEvaluationStatus;
  readonly resolutionCompleted: boolean;
}

export interface ListFeedbacksFilters {
  readonly status?: FeedbackStatus;
  readonly assigneeId?: UserId;
  readonly authorUserId?: UserId;
  readonly moduleKey?: string;
  readonly categoryId?: FeedbackCategoryId;
  readonly priority?: Priority;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface FeedbackListItem {
  readonly feedback: Feedback;
  readonly currentCycle: FeedbackCycle;
  readonly slaSnapshot: FeedbackSlaSnapshot;
  readonly slaStatus: FeedbackSlaLiveStatus;
  readonly categoryCode?: string;
  readonly categoryName?: string;
  readonly authorProfile?: FeedbackActorProfile;
  readonly assigneeProfile?: FeedbackActorProfile;
  readonly hasPendingContest: boolean;
  readonly hasPendingReopenRequest: boolean;
}

export interface FeedbackListResult {
  readonly organizationId: OrganizationId;
  readonly items: readonly FeedbackListItem[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly countsByStatus: Readonly<Record<FeedbackStatus, number>>;
}

export interface FeedbackContestDetail {
  readonly contest: FeedbackContest;
  readonly reasonCode?: string;
  readonly reasonName?: string;
  readonly reasonVersionNumber?: number;
  readonly delegatedAnalystProfile?: FeedbackActorProfile;
  readonly analyses: readonly FeedbackContestAnalysis[];
  readonly decisions: readonly FeedbackContestDecision[];
}

export interface FeedbackCapabilities {
  readonly canManageStatus: boolean;
  readonly canAssign: boolean;
  readonly canUpdateTriage: boolean;
  readonly canSendMessage: boolean;
  readonly canViewInternalNotes: boolean;
  readonly canCreateInternalNote: boolean;
  readonly canConfirmResolution: boolean;
  readonly canOpenContest: boolean;
  readonly canRequestReopen: boolean;
  readonly canDecideReopen: boolean;
  readonly canExport: boolean;
}

export interface FeedbackDetail {
  readonly feedback: Feedback;
  readonly category: {
    readonly id: FeedbackCategoryId;
    readonly code: string;
    readonly name: string;
    readonly versionId: FeedbackCategoryVersion['id'];
    readonly versionNumber: number;
  };
  readonly authorProfile?: FeedbackActorProfile;
  readonly assigneeProfile?: FeedbackActorProfile;
  readonly currentCycle: FeedbackCycle;
  readonly cycles: readonly FeedbackCycle[];
  readonly slaSnapshots: readonly FeedbackSlaSnapshot[];
  readonly currentSlaSnapshot: FeedbackSlaSnapshot;
  readonly slaStatus: FeedbackSlaLiveStatus;
  readonly messages: readonly FeedbackMessage[];
  readonly canViewInternalNotes: boolean;
  readonly internalNotes: readonly FeedbackInternalNote[];
  readonly publicAttachments: readonly FeedbackAttachment[];
  readonly internalAttachments: readonly FeedbackAttachment[];
  readonly contests: readonly FeedbackContestDetail[];
  readonly reopenRequests: readonly FeedbackReopenRequest[];
  readonly actorProfiles: Readonly<Record<string, FeedbackActorProfile>>;
  readonly capabilities: FeedbackCapabilities;
}

export interface FeedbackAttachmentContentResult {
  readonly attachment: FeedbackAttachment;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface CreateFeedbackInput {
  readonly id?: FeedbackId;
  readonly moduleKey: string;
  readonly categoryId: FeedbackCategoryId;
  readonly title: string;
  readonly description: string;
  readonly priority?: Priority;
  readonly correlationId?: CorrelationId;
}

export interface AssignFeedbackInput {
  readonly assigneeId: UserId;
  readonly correlationId?: CorrelationId;
}

export interface UpdateFeedbackTriageInput {
  readonly priority?: Priority;
  readonly categoryId?: FeedbackCategoryId;
  readonly correlationId?: CorrelationId;
}

export interface TransitionFeedbackStatusInput {
  readonly targetStatus: FeedbackStatus;
  readonly resolutionDescription?: string;
  readonly correlationId?: CorrelationId;
}

export interface AddFeedbackMessageInput {
  readonly body: string;
  readonly correlationId?: CorrelationId;
}

export interface AddFeedbackMessageResult {
  readonly message: FeedbackMessage;
  readonly feedback: Feedback;
  readonly cycle: FeedbackCycle;
  readonly resumedFromWaitingInfo: boolean;
}

export interface AddFeedbackInternalNoteInput {
  readonly body: string;
  readonly mentionedUserIds?: readonly UserId[];
  readonly correlationId?: CorrelationId;
}

export interface UploadFeedbackAttachmentInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly messageId?: FeedbackMessageId;
  readonly internalNoteId?: FeedbackInternalNoteId;
  readonly correlationId?: CorrelationId;
}

export interface FeedbackCategoryWithVersion {
  readonly category: FeedbackCategory;
  readonly currentVersion: FeedbackCategoryVersion;
  readonly versions: readonly FeedbackCategoryVersion[];
}

export interface FeedbackContestReasonWithVersion {
  readonly reason: FeedbackContestReason;
  readonly currentVersion: FeedbackContestReasonVersion;
  readonly versions: readonly FeedbackContestReasonVersion[];
}

export interface CreateCatalogItemInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly active?: boolean;
  readonly sortOrder?: number;
  readonly correlationId?: CorrelationId;
}

export interface UpdateCatalogItemInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly active?: boolean;
  readonly sortOrder?: number;
  readonly correlationId?: CorrelationId;
}

export interface ReorderFeedbackCategoriesInput {
  readonly orderedIds: readonly FeedbackCategoryId[];
  readonly correlationId?: CorrelationId;
}

export interface ReorderFeedbackContestReasonsInput {
  readonly orderedIds: readonly FeedbackContestReasonId[];
  readonly correlationId?: CorrelationId;
}

export interface FeedbackSlaSettingsView {
  readonly organizationId: OrganizationId;
  readonly calendar: OrganizationCalendarConfig;
  readonly slaPoliciesByPriority: Readonly<Record<Priority, SlaPriorityPolicy>>;
  readonly feedbackManifestationWindowMs: number;
  readonly feedbackContestWindowMs: number;
  readonly updatedAt: IsoDateTime;
}

export interface UpdateFeedbackSlaSettingsInput {
  readonly calendar?: OrganizationCalendarConfig;
  readonly slaPoliciesByPriority?: Partial<
    Readonly<
      Record<
        Priority,
        { readonly firstResponseTargetMs: number; readonly resolutionTargetMs: number }
      >
    >
  >;
  readonly feedbackManifestationWindowMs?: number;
  readonly feedbackContestWindowMs?: number;
  readonly correlationId?: CorrelationId;
}

export interface EvaluateFeedbackSlasResult {
  readonly organizationId: OrganizationId;
  readonly evaluatedAt: IsoDateTime;
  readonly evaluatedCount: number;
  readonly updatedCycleCount: number;
  readonly warningCount: number;
  readonly breachedCount: number;
  readonly escalatedCount: number;
  readonly autoClosedCount: number;
}

export interface OpenFeedbackContestInput {
  readonly reasonId: FeedbackContestReasonId;
  readonly justification: string;
  readonly correlationId?: CorrelationId;
}

export interface DelegateContestAnalysisInput {
  readonly analystUserId: UserId;
  readonly reason?: string;
  readonly correlationId?: CorrelationId;
}

export interface SubmitContestAnalysisInput {
  readonly recommendation: ContestRecommendation;
  readonly summary: string;
  readonly correlationId?: CorrelationId;
}

export interface DecideContestInput {
  readonly outcome: ContestRecommendation;
  readonly justification: string;
  readonly correlationId?: CorrelationId;
}

export interface DecideContestResult {
  readonly contest: FeedbackContest;
  readonly decision: FeedbackContestDecision;
  readonly feedback: Feedback;
  readonly newCycle?: FeedbackCycle;
  readonly newSlaSnapshot?: FeedbackSlaSnapshot;
}

export interface RequestExceptionalReopenInput {
  readonly justification: string;
  readonly correlationId?: CorrelationId;
}

export interface DecideExceptionalReopenInput {
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly justification: string;
  readonly assigneeId?: UserId;
  readonly priority?: Priority;
  readonly correlationId?: CorrelationId;
}

export interface DecideExceptionalReopenResult {
  readonly request: FeedbackReopenRequest;
  readonly feedback: Feedback;
  readonly newCycle?: FeedbackCycle;
  readonly newSlaSnapshot?: FeedbackSlaSnapshot;
}

export type FeedbackExportFormat = 'JSON' | 'CSV';

export interface ExportFeedbacksOptions {
  readonly format?: FeedbackExportFormat;
  readonly status?: FeedbackStatus;
  readonly assigneeId?: UserId;
  readonly authorUserId?: UserId;
  readonly feedbackId?: FeedbackId;
  readonly correlationId?: CorrelationId;
}

export interface FeedbackExportItem {
  readonly feedback: Feedback;
  readonly cycles: readonly FeedbackCycle[];
  readonly slaSnapshots: readonly FeedbackSlaSnapshot[];
  readonly messages: readonly FeedbackMessage[];
  readonly internalNotes: readonly FeedbackInternalNote[];
  readonly publicAttachments: readonly FeedbackAttachment[];
  readonly internalAttachments: readonly FeedbackAttachment[];
  readonly contests: readonly FeedbackContest[];
  readonly contestAnalyses: readonly FeedbackContestAnalysis[];
  readonly contestDecisions: readonly FeedbackContestDecision[];
  readonly reopenRequests: readonly FeedbackReopenRequest[];
}

export interface FeedbackExportResult {
  readonly organizationId: OrganizationId;
  readonly format: FeedbackExportFormat;
  readonly mimeType: 'application/json' | 'text/csv';
  readonly fileName: string;
  readonly exportedAt: IsoDateTime;
  readonly totalCount: number;
  readonly content: string;
  readonly items: readonly FeedbackExportItem[];
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<FeedbackStatus, readonly FeedbackStatus[]>> = {
  [FEEDBACK_STATUSES.RECEIVED]: [
    FEEDBACK_STATUSES.IN_ANALYSIS,
    FEEDBACK_STATUSES.ASSIGNED,
    FEEDBACK_STATUSES.IN_PROGRESS,
    FEEDBACK_STATUSES.WAITING_INFO,
    FEEDBACK_STATUSES.RESOLVED,
  ],
  [FEEDBACK_STATUSES.IN_ANALYSIS]: [
    FEEDBACK_STATUSES.ASSIGNED,
    FEEDBACK_STATUSES.IN_PROGRESS,
    FEEDBACK_STATUSES.WAITING_INFO,
    FEEDBACK_STATUSES.RESOLVED,
  ],
  [FEEDBACK_STATUSES.ASSIGNED]: [
    FEEDBACK_STATUSES.IN_ANALYSIS,
    FEEDBACK_STATUSES.IN_PROGRESS,
    FEEDBACK_STATUSES.WAITING_INFO,
    FEEDBACK_STATUSES.RESOLVED,
  ],
  [FEEDBACK_STATUSES.IN_PROGRESS]: [
    FEEDBACK_STATUSES.IN_ANALYSIS,
    FEEDBACK_STATUSES.WAITING_INFO,
    FEEDBACK_STATUSES.RESOLVED,
  ],
  [FEEDBACK_STATUSES.WAITING_INFO]: [
    FEEDBACK_STATUSES.IN_PROGRESS,
    FEEDBACK_STATUSES.IN_ANALYSIS,
    FEEDBACK_STATUSES.RESOLVED,
  ],
  [FEEDBACK_STATUSES.RESOLVED]: [FEEDBACK_STATUSES.CLOSED],
  [FEEDBACK_STATUSES.CLOSED]: [],
};

function defaultNowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

function defaultUuidGenerator(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

function addMillisecondsToIso(iso: IsoDateTime, deltaMs: number): IsoDateTime {
  const baseMs = parseIsoDateTimeMs(iso);
  return asIsoDateTime(new Date(baseMs + deltaMs).toISOString());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes SHA-256 hex digest over binary attachment bytes.
 * Must ALWAYS be called strictly BEFORE opening any `TransactionPort.run(...)` (ADR-0013 §2.3).
 */
async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
    return bytesToHex(new Uint8Array(digest));
  }

  throw new ValidationError('WebCrypto SHA-256 digest is unavailable in this environment.');
}

function parseWithZod<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  input: unknown,
  message = 'Invalid feedback input payload.',
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(message, {
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

function buildFeedbackResource(
  organizationId: OrganizationId,
  feedbackId: FeedbackId,
  feedback: Feedback | null,
  kind: 'FEEDBACK' | 'FEEDBACK_CONTEST' | 'FEEDBACK_REOPEN' = 'FEEDBACK',
): AuthorizationResource {
  return {
    kind,
    id: asEntityId(feedbackId),
    feedbackId,
    exists: feedback !== null,
    organizationId,
    ...(feedback?.authorUserId !== undefined ? { createdBy: feedback.authorUserId } : {}),
    ...(feedback?.assigneeId !== undefined ? { assigneeId: feedback.assigneeId } : {}),
    ...(feedback?.status !== undefined ? { status: feedback.status } : {}),
  };
}

function buildOrganizationResource(
  organizationId: OrganizationId,
  orgExists: boolean,
): AuthorizationResource {
  return {
    kind: 'FEEDBACK',
    id: asEntityId(organizationId),
    exists: orgExists,
    organizationId,
  };
}

/**
 * Enforces DN-04 segregation: non-ADMIN authors can NEVER view or create internal notes
 * or internal attachments on their own feedback, regardless of role or resource grants.
 */
function isAuthorBlockedFromInternalNotes(feedback: Feedback, actor: AuthorizationActor): boolean {
  const role = actor.organizationMembership?.role;
  return feedback.authorUserId === actor.userId && role !== ORGANIZATION_ROLES.ADMIN;
}

function createEmptyCountsByStatus(): Record<FeedbackStatus, number> {
  return {
    [FEEDBACK_STATUSES.RECEIVED]: 0,
    [FEEDBACK_STATUSES.IN_ANALYSIS]: 0,
    [FEEDBACK_STATUSES.ASSIGNED]: 0,
    [FEEDBACK_STATUSES.IN_PROGRESS]: 0,
    [FEEDBACK_STATUSES.WAITING_INFO]: 0,
    [FEEDBACK_STATUSES.RESOLVED]: 0,
    [FEEDBACK_STATUSES.CLOSED]: 0,
  };
}

function createSlaSnapshotFromSettings(input: {
  readonly id: FeedbackSlaSnapshot['id'];
  readonly organizationId: OrganizationId;
  readonly feedbackId: FeedbackId;
  readonly cycleId: FeedbackCycle['id'];
  readonly priority: Priority;
  readonly settings: OrganizationSettings;
  readonly now: IsoDateTime;
}): FeedbackSlaSnapshot {
  const policy = input.settings.slaPoliciesByPriority[input.priority];
  return Object.freeze({
    id: input.id,
    organizationId: input.organizationId,
    feedbackId: input.feedbackId,
    cycleId: input.cycleId,
    prioritySnapshot: input.priority,
    calendarMode: input.settings.calendar.mode,
    workDaysOfWeekUtc: [...input.settings.calendar.workDaysOfWeekUtc],
    workStartHourUtc: input.settings.calendar.workStartHourUtc,
    workEndHourUtc: input.settings.calendar.workEndHourUtc,
    breakIntervalsUtc: input.settings.calendar.breakIntervalsUtc.map((brk) => ({ ...brk })),
    holidayDates: input.settings.calendar.holidayDates.map((day) => asIsoDate(day)),
    firstResponseTargetMs: policy.firstResponseTargetMs,
    resolutionTargetMs: policy.resolutionTargetMs,
    manifestationWindowMs: input.settings.feedbackManifestationWindowMs,
    contestWindowMs: input.settings.feedbackContestWindowMs,
    capturedAt: input.now,
  });
}

function computeLiveSlaStatus(
  cycle: FeedbackCycle,
  snapshot: FeedbackSlaSnapshot,
  evaluatedAt: IsoDateTime,
): FeedbackSlaLiveStatus {
  const firstResponseEvalAt =
    cycle.firstRespondedAt !== undefined
      ? cycle.firstRespondedAt
      : cycle.closedAt !== undefined
        ? cycle.closedAt
        : evaluatedAt;
  const clampedFirstResponseEvalAt =
    parseIsoDateTimeMs(firstResponseEvalAt) < parseIsoDateTimeMs(cycle.startedAt)
      ? cycle.startedAt
      : firstResponseEvalAt;

  const firstResponseElapsedMs = calculateSlaElapsedMs({
    target: 'FIRST_RESPONSE',
    snapshot,
    startedAt: cycle.startedAt,
    evaluatedAt: clampedFirstResponseEvalAt,
  });

  const resolutionEvalAt =
    cycle.resolvedAt !== undefined
      ? cycle.resolvedAt
      : cycle.closedAt !== undefined
        ? cycle.closedAt
        : evaluatedAt;
  const clampedResolutionEvalAt =
    parseIsoDateTimeMs(resolutionEvalAt) < parseIsoDateTimeMs(cycle.startedAt)
      ? cycle.startedAt
      : resolutionEvalAt;

  const resolutionElapsedMs = calculateSlaElapsedMs({
    target: 'RESOLUTION',
    snapshot,
    startedAt: cycle.startedAt,
    evaluatedAt: clampedResolutionEvalAt,
    waitingInfoPauses: cycle.waitingInfoPauses,
  });

  return Object.freeze({
    evaluatedAt,
    firstResponseElapsedMs,
    firstResponseTargetMs: snapshot.firstResponseTargetMs,
    firstResponseStatus: evaluateSlaStatus(
      firstResponseElapsedMs,
      snapshot.firstResponseTargetMs,
      SLA_WARNING_THRESHOLD_RATIO,
    ),
    firstResponseCompleted: cycle.firstRespondedAt !== undefined,
    resolutionElapsedMs,
    resolutionTargetMs: snapshot.resolutionTargetMs,
    resolutionStatus: evaluateSlaStatus(
      resolutionElapsedMs,
      snapshot.resolutionTargetMs,
      SLA_WARNING_THRESHOLD_RATIO,
    ),
    resolutionCompleted: cycle.resolvedAt !== undefined,
  });
}

function closeOpenWaitingInfoPauses(
  pauses: readonly SlaPauseInterval[] | undefined,
  endedAt: IsoDateTime,
): readonly SlaPauseInterval[] | undefined {
  if (pauses === undefined || pauses.length === 0) {
    return pauses;
  }

  let modified = false;
  const next = pauses.map((pause) => {
    if (pause.endedAt === undefined) {
      modified = true;
      return Object.freeze({
        startedAt: pause.startedAt,
        endedAt,
      });
    }
    return pause;
  });

  return modified ? Object.freeze(next) : pauses;
}

function openWaitingInfoPause(
  pauses: readonly SlaPauseInterval[] | undefined,
  startedAt: IsoDateTime,
): readonly SlaPauseInterval[] {
  const existing = pauses ?? [];
  if (existing.some((pause) => pause.endedAt === undefined)) {
    return existing;
  }
  return Object.freeze([...existing, Object.freeze({ startedAt })]);
}

function isFeedbackClosedForOperationalMutations(
  feedback: Feedback,
  cycle: FeedbackCycle,
): boolean {
  return feedback.status === FEEDBACK_STATUSES.CLOSED || cycle.closedAt !== undefined;
}

function escapeCsvCell(value: string | number | undefined): string {
  const raw = value === undefined ? '' : String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export class FeedbackService {
  private readonly deps: FeedbackServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: FeedbackServiceDependencies) {
    this.deps = deps;
    this.now = deps.now ?? defaultNowIso;
    this.nextUuid = deps.generateUuid ?? defaultUuidGenerator;
  }

  private resolveCorrelationId(candidate?: string): CorrelationId {
    if (candidate && isUuid(candidate)) {
      return asCorrelationId(candidate);
    }
    return asCorrelationId(this.nextUuid());
  }

  private async loadActorContext(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<{
    readonly orgExists: boolean;
    readonly actor: AuthorizationActor;
    readonly settings: OrganizationSettings;
    readonly policyConfig: AuthorizationPolicyConfig;
  }> {
    const [org, membership, grants, explicitDenies, persistedSettings] = await Promise.all([
      this.deps.organizations.findById(organizationId),
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
      this.deps.organizationSettings.findByOrganization(organizationId),
    ]);

    const settings = persistedSettings ?? createDefaultOrganizationSettings(organizationId, now);
    const policyConfig = toAuthorizationPolicyConfig(settings);
    const orgExists = org !== null && !isSoftDeleted(org);

    const actor: AuthorizationActor = {
      isAuthenticated: true,
      userId: actorUserId,
      ...(membership !== null
        ? {
            organizationMembership: {
              organizationId: membership.organizationId,
              role: membership.role,
              status: membership.status,
            },
          }
        : {}),
      grants,
      explicitDenies,
    };

    return { orgExists, actor, settings, policyConfig };
  }

  private assertActiveOrganizationAccess(
    actor: AuthorizationActor,
    orgExists: boolean,
    organizationId: OrganizationId,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
    action: PermissionCode = PERMISSION_CODES.FEEDBACK_VIEW,
  ): void {
    if (!orgExists) {
      throw new NotFoundError(`Organization "${organizationId}" was not found.`);
    }

    if (
      !actor.organizationMembership ||
      actor.organizationMembership.status !== MEMBERSHIP_STATUSES.ACTIVE
    ) {
      assertAuthorized({
        actor,
        action,
        resource: buildOrganizationResource(organizationId, true),
        context: { now, policyConfig },
      });
    }
  }

  private async assertTargetHandlerEligible(
    organizationId: OrganizationId,
    targetUserId: UserId,
    feedback: Feedback,
  ): Promise<{ readonly role: OrganizationRole }> {
    const [profile, membership] = await Promise.all([
      this.deps.feedbackContext.findActorProfile(organizationId, targetUserId),
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, targetUserId),
    ]);

    if (!profile || !membership) {
      throw new NotFoundError(
        `Target user "${targetUserId}" is not a member of organization "${organizationId}".`,
      );
    }

    if (membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new ConflictError(
        `Target user "${targetUserId}" does not have an ACTIVE membership in organization "${organizationId}".`,
      );
    }

    if (
      membership.role !== ORGANIZATION_ROLES.ADMIN &&
      membership.role !== ORGANIZATION_ROLES.MANAGER
    ) {
      throw new ConflictError(
        'Only ACTIVE ADMIN or MANAGER members are eligible for feedback assignment or contest analysis delegation.',
      );
    }

    // DN-04: Prohibit assigning feedback or delegating contest analysis to a non-ADMIN author
    if (targetUserId === feedback.authorUserId && membership.role !== ORGANIZATION_ROLES.ADMIN) {
      throw new ConflictError(
        'Cannot assign a feedback or delegate contest analysis to its own non-ADMIN author (DN-04).',
        {
          details: {
            feedbackId: feedback.id,
            targetUserId,
            targetRole: membership.role,
          },
        },
      );
    }

    return { role: membership.role };
  }

  private async revokeContestAnalyzeGrantsForFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    revokedByUserId: UserId,
    now: IsoDateTime,
  ): Promise<void> {
    const orgGrants = await this.deps.permissionGrants.listByOrganization(organizationId);
    const matching = orgGrants.filter(
      (grant) =>
        grant.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE &&
        grant.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
        (grant.scopeId as string | undefined) === (feedbackId as string) &&
        grant.revokedAt === undefined &&
        grant.status !== GRANT_STATUSES.REVOKED,
    );

    for (const grant of matching) {
      await this.deps.permissionGrants.revoke(organizationId, grant.id, revokedByUserId, now);
    }
  }

  private canViewFeedbackInternalNotes(
    actor: AuthorizationActor,
    organizationId: OrganizationId,
    feedback: Feedback,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
  ): boolean {
    if (isAuthorBlockedFromInternalNotes(feedback, actor)) {
      return false;
    }

    return evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
      resource: buildFeedbackResource(organizationId, feedback.id, feedback),
      context: { now, policyConfig },
    }).allowed;
  }

  private canCreateFeedbackInternalNotes(
    actor: AuthorizationActor,
    organizationId: OrganizationId,
    feedback: Feedback,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
  ): boolean {
    if (isAuthorBlockedFromInternalNotes(feedback, actor)) {
      return false;
    }

    return evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE,
      resource: buildFeedbackResource(organizationId, feedback.id, feedback),
      context: { now, policyConfig },
    }).allowed;
  }

  // ===========================================================================
  // Consultas e Listagens
  // ===========================================================================

  async listAssignableHandlers(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<readonly FeedbackActorProfile[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_ASSIGN,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    return this.deps.feedbackContext.listAssignableHandlers(validatedOrgId);
  }

  async listFeedbacks(
    actorUserId: UserId,
    organizationId: OrganizationId,
    filters: ListFeedbacksFilters = {},
  ): Promise<FeedbackListResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );
    this.assertActiveOrganizationAccess(actor, orgExists, validatedOrgId, now, policyConfig);

    const validatedAuthorFilter =
      filters.authorUserId !== undefined
        ? asUserId(filters.authorUserId, 'authorUserId')
        : undefined;
    const validatedAssigneeFilter =
      filters.assigneeId !== undefined ? asUserId(filters.assigneeId, 'assigneeId') : undefined;
    const validatedCategoryFilter =
      filters.categoryId !== undefined
        ? asFeedbackCategoryId(filters.categoryId, 'categoryId')
        : undefined;

    const [allFeedbacks, allCycles, allSnapshots, allCategories, allContests, allReopenRequests] =
      await Promise.all([
        this.deps.feedbacks.listByOrganization(validatedOrgId, {
          ...(validatedAuthorFilter !== undefined ? { authorUserId: validatedAuthorFilter } : {}),
          ...(validatedAssigneeFilter !== undefined ? { assigneeId: validatedAssigneeFilter } : {}),
        }),
        this.deps.feedbackCycles.listByOrganization(validatedOrgId),
        this.deps.feedbackSlaSnapshots.listByOrganization(validatedOrgId),
        this.deps.feedbackCategories.listByOrganization(validatedOrgId, {
          includeInactive: true,
          includeDeleted: true,
        }),
        this.deps.feedbackContests.listByOrganization(validatedOrgId),
        this.deps.feedbackReopenRequests.listByOrganization(validatedOrgId),
      ]);

    // Item-by-item ABAC authorization BEFORE any totals, counts or pagination (ADR-0013 §2.2)
    const authorizedFeedbacks = allFeedbacks.filter(
      (feedback) =>
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.FEEDBACK_VIEW,
          resource: buildFeedbackResource(validatedOrgId, feedback.id, feedback),
          context: { now, policyConfig },
        }).allowed,
    );

    const countsByStatus = createEmptyCountsByStatus();
    for (const feedback of authorizedFeedbacks) {
      countsByStatus[feedback.status] += 1;
    }

    const searchQuery = filters.search?.trim().toLowerCase();
    const filtered = authorizedFeedbacks.filter((feedback) => {
      if (filters.status !== undefined && feedback.status !== filters.status) {
        return false;
      }
      if (filters.moduleKey !== undefined && feedback.moduleKey !== filters.moduleKey) {
        return false;
      }
      if (
        validatedCategoryFilter !== undefined &&
        feedback.categoryId !== validatedCategoryFilter
      ) {
        return false;
      }
      if (filters.priority !== undefined && feedback.priority !== filters.priority) {
        return false;
      }
      if (searchQuery && searchQuery.length > 0) {
        const titleMatch = feedback.title.toLowerCase().includes(searchQuery);
        const descMatch = feedback.description.toLowerCase().includes(searchQuery);
        if (!titleMatch && !descMatch) {
          return false;
        }
      }
      return true;
    });

    const totalCount = filtered.length;
    const pageSize = Math.max(1, Math.min(100, Math.trunc(filters.pageSize ?? 20)));
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.max(1, Math.min(totalPages, Math.trunc(filters.page ?? 1)));
    const offset = (page - 1) * pageSize;
    const pagedFeedbacks = filtered.slice(offset, offset + pageSize);

    const cycleById = new Map(allCycles.map((cycle) => [cycle.id, cycle]));
    const snapshotById = new Map(allSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const snapshotByCycleId = new Map(allSnapshots.map((snapshot) => [snapshot.cycleId, snapshot]));
    const categoryById = new Map(allCategories.map((category) => [category.id, category]));

    const pendingContestFeedbackIds = new Set(
      allContests
        .filter(
          (contest) =>
            contest.status === CONTEST_STATUSES.OPEN ||
            contest.status === CONTEST_STATUSES.IN_ANALYSIS,
        )
        .map((contest) => contest.feedbackId),
    );
    const pendingReopenFeedbackIds = new Set(
      allReopenRequests
        .filter((req) => req.status === REOPEN_REQUEST_STATUSES.PENDING)
        .map((req) => req.feedbackId),
    );

    const userIdsToResolve: UserId[] = [];
    const categoryVersionIdsToResolve = new Map<
      FeedbackCategoryVersion['id'],
      FeedbackCategoryVersion | null
    >();
    for (const item of pagedFeedbacks) {
      userIdsToResolve.push(item.authorUserId);
      if (item.assigneeId !== undefined) {
        userIdsToResolve.push(item.assigneeId);
      }
      categoryVersionIdsToResolve.set(item.categoryVersionId, null);
    }

    const [actorProfileMap, resolvedCategoryVersions] = await Promise.all([
      this.deps.feedbackContext.listActorProfiles(validatedOrgId, userIdsToResolve),
      Promise.all(
        [...categoryVersionIdsToResolve.keys()].map((versionId) =>
          this.deps.feedbackCategories.findVersionById(validatedOrgId, versionId),
        ),
      ),
    ]);

    const categoryVersionById = new Map<string, FeedbackCategoryVersion>();
    for (const version of resolvedCategoryVersions) {
      if (version) {
        categoryVersionById.set(version.id, version);
      }
    }

    const items: FeedbackListItem[] = [];
    for (const feedback of pagedFeedbacks) {
      const currentCycle = cycleById.get(feedback.currentCycleId);
      if (!currentCycle) {
        continue;
      }
      const slaSnapshot =
        snapshotById.get(currentCycle.slaSnapshotId) ?? snapshotByCycleId.get(currentCycle.id);
      if (!slaSnapshot) {
        continue;
      }

      const category = categoryById.get(feedback.categoryId);
      const categoryVersion = categoryVersionById.get(feedback.categoryVersionId);
      const authorProfile = actorProfileMap.get(feedback.authorUserId);
      const assigneeProfile =
        feedback.assigneeId !== undefined ? actorProfileMap.get(feedback.assigneeId) : undefined;

      items.push({
        feedback,
        currentCycle,
        slaSnapshot,
        slaStatus: computeLiveSlaStatus(currentCycle, slaSnapshot, now),
        ...(category !== undefined ? { categoryCode: category.code } : {}),
        ...(categoryVersion !== undefined ? { categoryName: categoryVersion.name } : {}),
        ...(authorProfile !== undefined ? { authorProfile } : {}),
        ...(assigneeProfile !== undefined ? { assigneeProfile } : {}),
        hasPendingContest: pendingContestFeedbackIds.has(feedback.id),
        hasPendingReopenRequest: pendingReopenFeedbackIds.has(feedback.id),
      });
    }

    return {
      organizationId: validatedOrgId,
      items,
      totalCount,
      page,
      pageSize,
      totalPages,
      countsByStatus,
    };
  }

  async getFeedbackDetail(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<FeedbackDetail> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const now = this.now();

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_VIEW,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const canViewInternalNotes = this.canViewFeedbackInternalNotes(
      actor,
      validatedOrgId,
      feedback,
      now,
      policyConfig,
    );

    const [
      cycles,
      slaSnapshots,
      messages,
      rawInternalNotes,
      allAttachments,
      contests,
      reopenRequests,
      category,
      categoryVersion,
      allReasons,
    ] = await Promise.all([
      this.deps.feedbackCycles.listByFeedback(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackSlaSnapshots.listByFeedback(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackMessages.listByFeedback(validatedOrgId, validatedFeedbackId),
      canViewInternalNotes
        ? this.deps.feedbackInternalNotes.listByFeedback(validatedOrgId, validatedFeedbackId)
        : Promise.resolve([]),
      this.deps.feedbackAttachments.listByFeedback(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackContests.listByFeedback(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackReopenRequests.listByFeedback(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackCategories.findById(validatedOrgId, feedback.categoryId),
      this.deps.feedbackCategories.findVersionById(validatedOrgId, feedback.categoryVersionId),
      this.deps.feedbackContestReasons.listByOrganization(validatedOrgId, {
        includeInactive: true,
        includeDeleted: true,
      }),
    ]);

    const currentCycle =
      cycles.find((cycle) => cycle.id === feedback.currentCycleId) ?? cycles[cycles.length - 1];
    if (!currentCycle) {
      throw new ConflictError(
        `Current cycle "${feedback.currentCycleId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    const currentSlaSnapshot =
      slaSnapshots.find((snap) => snap.id === currentCycle.slaSnapshotId) ??
      slaSnapshots.find((snap) => snap.cycleId === currentCycle.id);
    if (!currentSlaSnapshot) {
      throw new ConflictError(
        `SLA snapshot "${currentCycle.slaSnapshotId}" was not found for cycle "${currentCycle.id}".`,
      );
    }

    const publicAttachments = allAttachments.filter(
      (attachment) => attachment.internalNoteId === undefined,
    );
    const internalAttachments = canViewInternalNotes
      ? allAttachments.filter((attachment) => attachment.internalNoteId !== undefined)
      : [];

    const reasonById = new Map(allReasons.map((reason) => [reason.id, reason]));
    const [contestAnalysesList, contestDecisionsList, reasonVersionsList] = await Promise.all([
      Promise.all(
        contests.map((contest) =>
          this.deps.feedbackContests.listAnalyses(validatedOrgId, contest.id),
        ),
      ),
      Promise.all(
        contests.map((contest) =>
          this.deps.feedbackContests.listDecisions(validatedOrgId, contest.id),
        ),
      ),
      Promise.all(
        contests.map((contest) =>
          this.deps.feedbackContestReasons.findVersionById(validatedOrgId, contest.reasonVersionId),
        ),
      ),
    ]);

    const userIdsToResolve: UserId[] = [feedback.authorUserId];
    if (feedback.assigneeId !== undefined) {
      userIdsToResolve.push(feedback.assigneeId);
    }
    for (const msg of messages) {
      userIdsToResolve.push(msg.authorUserId);
    }
    for (const att of publicAttachments) {
      userIdsToResolve.push(att.uploadedBy);
    }
    if (canViewInternalNotes) {
      for (const note of rawInternalNotes) {
        userIdsToResolve.push(note.authorUserId);
        for (const mentioned of note.mentionedUserIds) {
          userIdsToResolve.push(mentioned);
        }
      }
      for (const att of internalAttachments) {
        userIdsToResolve.push(att.uploadedBy);
      }
    }
    contests.forEach((contest, index) => {
      userIdsToResolve.push(contest.openedByUserId);
      if (contest.delegatedAnalystUserId !== undefined) {
        userIdsToResolve.push(contest.delegatedAnalystUserId);
      }
      for (const analysis of contestAnalysesList[index] ?? []) {
        userIdsToResolve.push(analysis.analystUserId);
      }
      for (const decision of contestDecisionsList[index] ?? []) {
        userIdsToResolve.push(decision.decidedByAdminUserId);
      }
    });
    for (const req of reopenRequests) {
      userIdsToResolve.push(req.requestedByUserId);
      if (req.decidedByAdminUserId !== undefined) {
        userIdsToResolve.push(req.decidedByAdminUserId);
      }
    }

    const profileMap = await this.deps.feedbackContext.listActorProfiles(
      validatedOrgId,
      userIdsToResolve,
    );

    const actorProfilesRecord: Record<string, FeedbackActorProfile> = {};
    for (const [uid, profile] of profileMap.entries()) {
      actorProfilesRecord[uid] = profile;
    }

    const contestDetails: FeedbackContestDetail[] = contests.map((contest, index) => {
      const reason = reasonById.get(contest.reasonId);
      const reasonVersion = reasonVersionsList[index] ?? null;
      const delegatedAnalystProfile =
        contest.delegatedAnalystUserId !== undefined
          ? profileMap.get(contest.delegatedAnalystUserId)
          : undefined;
      return {
        contest,
        ...(reason !== undefined ? { reasonCode: reason.code } : {}),
        ...(reasonVersion !== null
          ? { reasonName: reasonVersion.name, reasonVersionNumber: reasonVersion.versionNumber }
          : {}),
        ...(delegatedAnalystProfile !== undefined ? { delegatedAnalystProfile } : {}),
        analyses: contestAnalysesList[index] ?? [],
        decisions: contestDecisionsList[index] ?? [],
      };
    });

    const isClosed = isFeedbackClosedForOperationalMutations(feedback, currentCycle);
    const hasPendingContest = contests.some(
      (c) => c.status === CONTEST_STATUSES.OPEN || c.status === CONTEST_STATUSES.IN_ANALYSIS,
    );
    const hasPendingReopenRequest = reopenRequests.some(
      (r) => r.closedCycleId === currentCycle.id && r.status === REOPEN_REQUEST_STATUSES.PENDING,
    );

    const statusManageDecision = evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    const capabilities: FeedbackCapabilities = {
      canManageStatus: !isClosed && statusManageDecision.allowed,
      canAssign:
        !isClosed &&
        feedback.status !== FEEDBACK_STATUSES.RESOLVED &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.FEEDBACK_ASSIGN,
          resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
          context: { now, policyConfig },
        }).allowed,
      canUpdateTriage:
        !isClosed &&
        statusManageDecision.allowed &&
        (actor.organizationMembership?.role === ORGANIZATION_ROLES.ADMIN ||
          statusManageDecision.matchedGrantId !== undefined),
      canSendMessage:
        !isClosed &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.FEEDBACK_MESSAGE_CREATE,
          resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
          context: { now, policyConfig },
        }).allowed,
      canViewInternalNotes,
      canCreateInternalNote:
        !isClosed &&
        this.canCreateFeedbackInternalNotes(actor, validatedOrgId, feedback, now, policyConfig),
      canConfirmResolution:
        !isClosed &&
        feedback.status === FEEDBACK_STATUSES.RESOLVED &&
        feedback.authorUserId === validatedActorId &&
        !hasPendingContest,
      canOpenContest:
        !isClosed &&
        feedback.status === FEEDBACK_STATUSES.RESOLVED &&
        feedback.authorUserId === validatedActorId &&
        !hasPendingContest &&
        currentCycle.contestDeadlineAt !== undefined &&
        parseIsoDateTimeMs(now) <= parseIsoDateTimeMs(currentCycle.contestDeadlineAt),
      canRequestReopen:
        currentCycle.closedAt !== undefined &&
        (currentCycle.closureReason === FEEDBACK_CLOSURE_REASONS.EXPIRED_WITHOUT_CONTEST ||
          currentCycle.closureReason === FEEDBACK_CLOSURE_REASONS.CONTEST_REJECTED_EXPIRED) &&
        !hasPendingReopenRequest &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.FEEDBACK_REOPEN_REQUEST,
          resource: buildFeedbackResource(
            validatedOrgId,
            validatedFeedbackId,
            feedback,
            'FEEDBACK_REOPEN',
          ),
          context: { now, policyConfig },
        }).allowed,
      canDecideReopen:
        hasPendingReopenRequest &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.FEEDBACK_REOPEN_DECIDE,
          resource: buildFeedbackResource(
            validatedOrgId,
            validatedFeedbackId,
            feedback,
            'FEEDBACK_REOPEN',
          ),
          context: { now, policyConfig },
        }).allowed,
      canExport: evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.FEEDBACK_EXPORT,
        resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
        context: { now, policyConfig },
      }).allowed,
    };

    const authorProfile = profileMap.get(feedback.authorUserId);
    const assigneeProfile =
      feedback.assigneeId !== undefined ? profileMap.get(feedback.assigneeId) : undefined;

    return {
      feedback,
      category: {
        id: feedback.categoryId,
        code: category?.code ?? 'UNKNOWN',
        name: categoryVersion?.name ?? category?.code ?? 'Unknown Category',
        versionId: feedback.categoryVersionId,
        versionNumber: categoryVersion?.versionNumber ?? 1,
      },
      ...(authorProfile !== undefined ? { authorProfile } : {}),
      ...(assigneeProfile !== undefined ? { assigneeProfile } : {}),
      currentCycle,
      cycles,
      slaSnapshots,
      currentSlaSnapshot,
      slaStatus: computeLiveSlaStatus(currentCycle, currentSlaSnapshot, now),
      messages,
      canViewInternalNotes,
      internalNotes: rawInternalNotes,
      publicAttachments,
      internalAttachments,
      contests: contestDetails,
      reopenRequests,
      actorProfiles: actorProfilesRecord,
      capabilities,
    };
  }

  async getFeedbackAttachmentContent(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    attachmentId: AttachmentId,
  ): Promise<FeedbackAttachmentContentResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const validatedAttachmentId = asAttachmentId(attachmentId, 'attachmentId');
    const now = this.now();

    const [{ orgExists, actor, policyConfig }, feedback, attachment] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackAttachments.findById(validatedOrgId, validatedAttachmentId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    const isInternalAttachment = attachment !== null && attachment.internalNoteId !== undefined;

    if (isInternalAttachment) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
        resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
        context: { now, policyConfig },
      });

      if (feedback && isAuthorBlockedFromInternalNotes(feedback, actor)) {
        throw new AuthorizationError(
          'Feedback authors cannot download attachments linked to internal notes (DN-04).',
          {
            details: {
              action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
              reasonCode: 'DENIED_AUTHOR_INTERNAL_NOTE_SEGREGATION',
            },
          },
        );
      }
    } else {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_VIEW,
        resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
        context: { now, policyConfig },
      });
    }

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    if (!attachment || attachment.feedbackId !== validatedFeedbackId) {
      throw new NotFoundError(
        `Attachment "${validatedAttachmentId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    if (isDisallowedAttachmentMimeType(attachment.mimeType)) {
      throw new ValidationError(
        `Attachment MIME type "${attachment.mimeType}" is disallowed for download.`,
        {
          details: {
            field: 'mimeType',
            reason: 'DISALLOWED_MIME_TYPE',
            mimeType: attachment.mimeType,
          },
        },
      );
    }

    // Read binary payload strictly AFTER authorization and MIME validation (ADR-0013 §2.3)
    const blob = await this.deps.attachmentBlobStore.getBlob(validatedOrgId, validatedAttachmentId);
    if (!blob || blob.organizationId !== validatedOrgId) {
      throw new NotFoundError(
        `Binary payload for attachment "${validatedAttachmentId}" is missing.`,
      );
    }

    return {
      attachment,
      mimeType: attachment.mimeType,
      bytes: blob.bytes,
    };
  }

  // ===========================================================================
  // Ciclo de Vida e Ciclos Imutáveis
  // ===========================================================================

  async createFeedback(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateFeedbackInput,
  ): Promise<Feedback> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      createFeedbackInputSchema,
      input,
      'Invalid feedback creation payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, settings, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CREATE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const categoryId = asFeedbackCategoryId(parsed.categoryId, 'categoryId');
    const category = await this.deps.feedbackCategories.findById(validatedOrgId, categoryId);
    if (!category || isSoftDeleted(category)) {
      throw new NotFoundError(`FeedbackCategory "${categoryId}" was not found.`);
    }
    if (!category.active) {
      throw new ValidationError(`FeedbackCategory "${category.code}" is inactive.`, {
        details: { field: 'categoryId', categoryId },
      });
    }

    const categoryVersion = await this.deps.feedbackCategories.findVersionById(
      validatedOrgId,
      category.currentVersionId,
    );
    if (!categoryVersion || !categoryVersion.active) {
      throw new ValidationError(
        `Current version of FeedbackCategory "${category.code}" is unavailable or inactive.`,
        {
          details: { field: 'categoryId', categoryId },
        },
      );
    }

    const feedbackId = parsed.id ? asFeedbackId(parsed.id, 'id') : asFeedbackId(this.nextUuid());
    const cycleId = asFeedbackCycleId(this.nextUuid());
    const slaSnapshotId = asFeedbackSlaSnapshotId(this.nextUuid());

    const feedback: Feedback = Object.freeze({
      id: feedbackId,
      organizationId: validatedOrgId,
      authorUserId: validatedActorId,
      moduleKey: parsed.moduleKey,
      categoryId,
      categoryVersionId: categoryVersion.id,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      status: FEEDBACK_STATUSES.RECEIVED,
      currentCycleId: cycleId,
      authorConfirmedResolution: false,
      createdAt: now,
      updatedAt: now,
    });

    const cycle: FeedbackCycle = Object.freeze({
      id: cycleId,
      organizationId: validatedOrgId,
      feedbackId,
      cycleNumber: 1,
      origin: CYCLE_ORIGINS.INITIAL,
      status: FEEDBACK_STATUSES.RECEIVED,
      prioritySnapshot: parsed.priority,
      slaSnapshotId,
      startedAt: now,
      authorConfirmedResolution: false,
    });

    const snapshot = createSlaSnapshotFromSettings({
      id: slaSnapshotId,
      organizationId: validatedOrgId,
      feedbackId,
      cycleId,
      priority: parsed.priority,
      settings,
      now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.FEEDBACK_SLA_SNAPSHOTS,
        TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbacks.save(feedback);
        await this.deps.feedbackCycles.save(cycle);
        await this.deps.feedbackSlaSnapshots.save(snapshot);

        if (!category.hasBeenUsed) {
          await this.deps.feedbackCategories.saveCategory({
            ...category,
            hasBeenUsed: true,
            updatedAt: now,
          });
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.created',
          resourceType: 'Feedback',
          resourceId: feedbackId,
          after: {
            moduleKey: feedback.moduleKey,
            categoryId: feedback.categoryId,
            categoryVersionId: feedback.categoryVersionId,
            priority: feedback.priority,
            status: feedback.status,
            cycleId,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Feedback',
            aggregateId: feedbackId,
            payload: {
              feedbackId,
              cycleId,
              moduleKey: feedback.moduleKey,
              priority: feedback.priority,
              status: feedback.status,
            },
          }),
        );
      },
    );

    return feedback;
  }

  async assignFeedback(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: AssignFeedbackInput,
  ): Promise<Feedback> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(
      assignFeedbackInputSchema,
      input,
      'Invalid feedback assignment payload.',
    );
    const targetAssigneeId = asUserId(parsed.assigneeId, 'assigneeId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_ASSIGN,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const currentCycle = await this.deps.feedbackCycles.findById(
      validatedOrgId,
      feedback.currentCycleId,
    );
    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (
      isFeedbackClosedForOperationalMutations(feedback, currentCycle) ||
      feedback.status === FEEDBACK_STATUSES.RESOLVED
    ) {
      throw new ConflictError('Cannot assign a feedback that is already RESOLVED or CLOSED.');
    }

    await this.assertTargetHandlerEligible(validatedOrgId, targetAssigneeId, feedback);

    const nextStatus =
      feedback.status === FEEDBACK_STATUSES.RECEIVED ||
      feedback.status === FEEDBACK_STATUSES.IN_ANALYSIS
        ? FEEDBACK_STATUSES.ASSIGNED
        : feedback.status;

    const updatedFeedback: Feedback = Object.freeze({
      ...feedback,
      assigneeId: targetAssigneeId,
      status: nextStatus,
      updatedAt: now,
    });

    const updatedCycle: FeedbackCycle = Object.freeze({
      ...currentCycle,
      assigneeId: targetAssigneeId,
      initialAssigneeId: currentCycle.initialAssigneeId ?? targetAssigneeId,
      status: nextStatus,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbacks.save(updatedFeedback);
        await this.deps.feedbackCycles.save(updatedCycle);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.assigned',
          resourceType: 'Feedback',
          resourceId: validatedFeedbackId,
          before: {
            assigneeId: feedback.assigneeId ?? null,
            status: feedback.status,
          },
          after: {
            assigneeId: updatedFeedback.assigneeId,
            status: updatedFeedback.status,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.assigned',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Feedback',
            aggregateId: validatedFeedbackId,
            payload: {
              feedbackId: validatedFeedbackId,
              assigneeId: targetAssigneeId,
              status: nextStatus,
            },
          }),
        );
      },
    );

    return updatedFeedback;
  }

  async updateFeedbackTriage(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: UpdateFeedbackTriageInput,
  ): Promise<Feedback> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(
      updateFeedbackTriageInputSchema,
      input,
      'Invalid feedback triage payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    const request = {
      actor,
      action: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    };

    assertAuthorized(request);
    const decision = evaluateAuthorization(request);

    // DN-03: Changing priority/category is restricted to ADMIN by default,
    // or an explicit active PermissionGrant for FEEDBACK_STATUS_MANAGE.
    if (
      actor.organizationMembership?.role !== ORGANIZATION_ROLES.ADMIN &&
      decision.matchedGrantId === undefined
    ) {
      throw new AuthorizationError(
        'Updating feedback priority or category is restricted to organization ADMINs or an explicit FEEDBACK_STATUS_MANAGE grant (DN-03).',
        {
          details: {
            action: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
            reasonCode: 'DENIED_INSUFFICIENT_ROLE',
          },
        },
      );
    }

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const currentCycle = await this.deps.feedbackCycles.findById(
      validatedOrgId,
      feedback.currentCycleId,
    );
    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (isFeedbackClosedForOperationalMutations(feedback, currentCycle)) {
      throw new ConflictError('Cannot update triage metadata on a closed feedback.');
    }

    let nextCategoryId = feedback.categoryId;
    let nextCategoryVersionId = feedback.categoryVersionId;
    let categoryToMarkUsed: FeedbackCategory | null = null;

    if (parsed.categoryId !== undefined) {
      const targetCategoryId = asFeedbackCategoryId(parsed.categoryId, 'categoryId');
      const category = await this.deps.feedbackCategories.findById(
        validatedOrgId,
        targetCategoryId,
      );
      if (!category || isSoftDeleted(category)) {
        throw new NotFoundError(`FeedbackCategory "${targetCategoryId}" was not found.`);
      }
      if (!category.active) {
        throw new ValidationError(`FeedbackCategory "${category.code}" is inactive.`, {
          details: { field: 'categoryId', categoryId: targetCategoryId },
        });
      }
      const version = await this.deps.feedbackCategories.findVersionById(
        validatedOrgId,
        category.currentVersionId,
      );
      if (!version || !version.active) {
        throw new ValidationError(`FeedbackCategory "${category.code}" has no active version.`);
      }
      nextCategoryId = category.id;
      nextCategoryVersionId = version.id;
      if (!category.hasBeenUsed) {
        categoryToMarkUsed = {
          ...category,
          hasBeenUsed: true,
          updatedAt: now,
        };
      }
    }

    const nextPriority = parsed.priority ?? feedback.priority;

    // DN-03: Preserve currentCycle.prioritySnapshot and FeedbackSlaSnapshot 100% immutable!
    const updatedFeedback: Feedback = Object.freeze({
      ...feedback,
      priority: nextPriority,
      categoryId: nextCategoryId,
      categoryVersionId: nextCategoryVersionId,
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbacks.save(updatedFeedback);
        if (categoryToMarkUsed !== null) {
          await this.deps.feedbackCategories.saveCategory(categoryToMarkUsed);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.triage.updated',
          resourceType: 'Feedback',
          resourceId: validatedFeedbackId,
          before: {
            priority: feedback.priority,
            categoryId: feedback.categoryId,
            categoryVersionId: feedback.categoryVersionId,
          },
          after: {
            priority: updatedFeedback.priority,
            categoryId: updatedFeedback.categoryId,
            categoryVersionId: updatedFeedback.categoryVersionId,
            slaSnapshotPreserved: true,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.triage.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Feedback',
            aggregateId: validatedFeedbackId,
            payload: {
              feedbackId: validatedFeedbackId,
              priority: updatedFeedback.priority,
              categoryId: updatedFeedback.categoryId,
            },
          }),
        );
      },
    );

    return updatedFeedback;
  }

  async transitionFeedbackStatus(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: TransitionFeedbackStatusInput,
  ): Promise<Feedback> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(
      transitionFeedbackStatusInputSchema,
      input,
      'Invalid feedback status transition payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const [currentCycle, contests] = await Promise.all([
      this.deps.feedbackCycles.findById(validatedOrgId, feedback.currentCycleId),
      this.deps.feedbackContests.listByCycle(validatedOrgId, feedback.currentCycleId),
    ]);

    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (isFeedbackClosedForOperationalMutations(feedback, currentCycle)) {
      throw new ConflictError(
        'Cannot transition status of a closed feedback; use exceptional reopen workflow.',
      );
    }

    const targetStatus = parsed.targetStatus;
    if (targetStatus === feedback.status) {
      throw new ConflictError(`Feedback is already in status "${targetStatus}".`);
    }

    const allowedTargets = ALLOWED_STATUS_TRANSITIONS[feedback.status];
    if (!allowedTargets.includes(targetStatus)) {
      throw new ConflictError(
        `Invalid feedback status transition from "${feedback.status}" to "${targetStatus}".`,
        { details: { fromStatus: feedback.status, toStatus: targetStatus } },
      );
    }

    if (targetStatus === FEEDBACK_STATUSES.ASSIGNED && feedback.assigneeId === undefined) {
      throw new ConflictError(
        'Cannot transition feedback to ASSIGNED without an assigned handler.',
      );
    }

    if (targetStatus === FEEDBACK_STATUSES.CLOSED) {
      if (actor.organizationMembership?.role !== ORGANIZATION_ROLES.ADMIN) {
        throw new AuthorizationError(
          'Only an organization ADMIN may administratively close a resolved feedback.',
        );
      }
      const hasPendingContest = contests.some(
        (c) => c.status === CONTEST_STATUSES.OPEN || c.status === CONTEST_STATUSES.IN_ANALYSIS,
      );
      if (hasPendingContest) {
        throw new ConflictError('Cannot close feedback while a contestation is pending.');
      }
    }

    let nextWaitingInfoPauses = currentCycle.waitingInfoPauses;
    if (targetStatus === FEEDBACK_STATUSES.WAITING_INFO) {
      nextWaitingInfoPauses = openWaitingInfoPause(nextWaitingInfoPauses, now);
    } else if (feedback.status === FEEDBACK_STATUSES.WAITING_INFO) {
      nextWaitingInfoPauses = closeOpenWaitingInfoPauses(nextWaitingInfoPauses, now);
    }

    const shouldRecordFirstResponse =
      currentCycle.firstRespondedAt === undefined &&
      (targetStatus === FEEDBACK_STATUSES.IN_PROGRESS ||
        targetStatus === FEEDBACK_STATUSES.WAITING_INFO ||
        targetStatus === FEEDBACK_STATUSES.RESOLVED);

    let resolvedFields: Partial<FeedbackCycle> = {};
    let closureFields: Partial<FeedbackCycle> = {};
    let feedbackClosureFields: Partial<Feedback> = {};

    if (targetStatus === FEEDBACK_STATUSES.RESOLVED) {
      const resolutionDescription = parsed.resolutionDescription?.trim() ?? '';
      if (resolutionDescription.length === 0) {
        throw new ValidationError(
          'Transitioning a feedback to RESOLVED requires a non-empty resolutionDescription (PRD §15.6).',
          { details: { field: 'resolutionDescription' } },
        );
      }

      const snapshot = await this.deps.feedbackSlaSnapshots.findById(
        validatedOrgId,
        currentCycle.slaSnapshotId,
      );
      if (!snapshot) {
        throw new ConflictError(
          `SLA snapshot "${currentCycle.slaSnapshotId}" was not found for cycle "${currentCycle.id}".`,
        );
      }

      resolvedFields = {
        resolvedAt: now,
        resolutionDescription,
        manifestationDeadlineAt: addMillisecondsToIso(now, snapshot.manifestationWindowMs),
        contestDeadlineAt: addMillisecondsToIso(now, snapshot.contestWindowMs),
      };
    }

    if (targetStatus === FEEDBACK_STATUSES.CLOSED) {
      closureFields = {
        closedAt: now,
        closureReason: FEEDBACK_CLOSURE_REASONS.ADMIN_CLOSED,
        authorConfirmedResolution: false,
      };
      feedbackClosureFields = {
        closedAt: now,
        closureReason: FEEDBACK_CLOSURE_REASONS.ADMIN_CLOSED,
        authorConfirmedResolution: false,
      };
    }

    const updatedCycle: FeedbackCycle = Object.freeze({
      ...currentCycle,
      status: targetStatus,
      ...(shouldRecordFirstResponse ? { firstRespondedAt: now } : {}),
      ...(nextWaitingInfoPauses !== undefined ? { waitingInfoPauses: nextWaitingInfoPauses } : {}),
      ...resolvedFields,
      ...closureFields,
    });

    const updatedFeedback: Feedback = Object.freeze({
      ...feedback,
      status: targetStatus,
      ...feedbackClosureFields,
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbacks.save(updatedFeedback);
        await this.deps.feedbackCycles.save(updatedCycle);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.status.transitioned',
          resourceType: 'Feedback',
          resourceId: validatedFeedbackId,
          before: { status: feedback.status },
          after: {
            status: updatedFeedback.status,
            ...(updatedCycle.manifestationDeadlineAt !== undefined
              ? { manifestationDeadlineAt: updatedCycle.manifestationDeadlineAt }
              : {}),
            ...(updatedCycle.contestDeadlineAt !== undefined
              ? { contestDeadlineAt: updatedCycle.contestDeadlineAt }
              : {}),
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.status.transitioned',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Feedback',
            aggregateId: validatedFeedbackId,
            payload: {
              feedbackId: validatedFeedbackId,
              fromStatus: feedback.status,
              toStatus: updatedFeedback.status,
              cycleId: currentCycle.id,
            },
          }),
        );
      },
    );

    return updatedFeedback;
  }

  async confirmFeedbackResolution(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    options: FeedbackOperationOptions = {},
  ): Promise<Feedback> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_VIEW,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const [currentCycle, contests] = await Promise.all([
      this.deps.feedbackCycles.findById(validatedOrgId, feedback.currentCycleId),
      this.deps.feedbackContests.listByCycle(validatedOrgId, feedback.currentCycleId),
    ]);

    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    const hasPendingContest = contests.some(
      (c) => c.status === CONTEST_STATUSES.OPEN || c.status === CONTEST_STATUSES.IN_ANALYSIS,
    );

    const closedCycle = confirmFeedbackResolutionPolicy(
      currentCycle,
      validatedActorId,
      feedback.authorUserId,
      hasPendingContest,
      now,
    );

    const closedFeedback: Feedback = Object.freeze({
      ...feedback,
      status: FEEDBACK_STATUSES.CLOSED,
      closedAt: now,
      closureReason: FEEDBACK_CLOSURE_REASONS.CONFIRMED_BY_AUTHOR,
      authorConfirmedResolution: true,
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbacks.save(closedFeedback);
        await this.deps.feedbackCycles.save(closedCycle);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.resolution.confirmed',
          resourceType: 'Feedback',
          resourceId: validatedFeedbackId,
          before: { status: feedback.status },
          after: {
            status: closedFeedback.status,
            closedAt: now,
            closureReason: FEEDBACK_CLOSURE_REASONS.CONFIRMED_BY_AUTHOR,
            authorConfirmedResolution: true,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.resolution.confirmed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Feedback',
            aggregateId: validatedFeedbackId,
            payload: {
              feedbackId: validatedFeedbackId,
              cycleId: currentCycle.id,
              closedAt: now,
            },
          }),
        );
      },
    );

    return closedFeedback;
  }

  // ===========================================================================
  // Comunicação e Anexos (append-only, DN-02, DN-04, DN-06)
  // ===========================================================================

  async addFeedbackMessage(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: AddFeedbackMessageInput,
  ): Promise<AddFeedbackMessageResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(addMessageInputSchema, input, 'Invalid feedback message payload.');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_MESSAGE_CREATE,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const currentCycle = await this.deps.feedbackCycles.findById(
      validatedOrgId,
      feedback.currentCycleId,
    );
    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (isFeedbackClosedForOperationalMutations(feedback, currentCycle)) {
      throw new ConflictError('Cannot post public messages on a closed feedback.');
    }

    const message: FeedbackMessage = Object.freeze({
      id: asFeedbackMessageId(this.nextUuid()),
      organizationId: validatedOrgId,
      feedbackId: validatedFeedbackId,
      cycleId: currentCycle.id,
      authorUserId: validatedActorId,
      body: parsed.body,
      createdAt: now,
    });

    const resumedFromWaitingInfo =
      feedback.authorUserId === validatedActorId &&
      feedback.status === FEEDBACK_STATUSES.WAITING_INFO;

    const shouldRecordFirstResponse =
      feedback.authorUserId !== validatedActorId && currentCycle.firstRespondedAt === undefined;

    const nextCycle: FeedbackCycle = Object.freeze({
      ...currentCycle,
      ...(resumedFromWaitingInfo
        ? {
            status: FEEDBACK_STATUSES.IN_PROGRESS,
            waitingInfoPauses: closeOpenWaitingInfoPauses(currentCycle.waitingInfoPauses, now),
          }
        : {}),
      ...(shouldRecordFirstResponse ? { firstRespondedAt: now } : {}),
    });

    const nextFeedback: Feedback = Object.freeze({
      ...feedback,
      ...(resumedFromWaitingInfo ? { status: FEEDBACK_STATUSES.IN_PROGRESS } : {}),
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_MESSAGES,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackMessages.append(message);
        await this.deps.feedbacks.save(nextFeedback);
        if (resumedFromWaitingInfo || shouldRecordFirstResponse) {
          await this.deps.feedbackCycles.save(nextCycle);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.message.created',
          resourceType: 'FeedbackMessage',
          resourceId: message.id,
          after: {
            feedbackId: validatedFeedbackId,
            cycleId: currentCycle.id,
            resumedFromWaitingInfo,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.message.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackMessage',
            aggregateId: message.id,
            payload: {
              feedbackId: validatedFeedbackId,
              cycleId: currentCycle.id,
              messageId: message.id,
              resumedFromWaitingInfo,
            },
          }),
        );
      },
    );

    return {
      message,
      feedback: nextFeedback,
      cycle: nextCycle,
      resumedFromWaitingInfo,
    };
  }

  async addFeedbackInternalNote(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: AddFeedbackInternalNoteInput,
  ): Promise<FeedbackInternalNote> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(
      addInternalNoteInputSchema,
      input,
      'Invalid feedback internal note payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE,
      resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    // DN-04: Non-ADMIN author can never view or create internal notes on their own feedback
    if (isAuthorBlockedFromInternalNotes(feedback, actor)) {
      throw new AuthorizationError(
        'Feedback authors cannot create or view internal notes on their own feedback unless they are organization ADMINs (DN-04).',
        {
          details: {
            action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE,
            reasonCode: 'DENIED_AUTHOR_INTERNAL_NOTE_SEGREGATION',
          },
        },
      );
    }

    const currentCycle = await this.deps.feedbackCycles.findById(
      validatedOrgId,
      feedback.currentCycleId,
    );
    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (isFeedbackClosedForOperationalMutations(feedback, currentCycle)) {
      throw new ConflictError('Cannot add internal notes to a closed feedback.');
    }

    const mentionedUserIds = [
      ...new Set((parsed.mentionedUserIds ?? []).map((id) => asUserId(id, 'mentionedUserIds'))),
    ];

    const note: FeedbackInternalNote = Object.freeze({
      id: asFeedbackInternalNoteId(this.nextUuid()),
      organizationId: validatedOrgId,
      feedbackId: validatedFeedbackId,
      cycleId: currentCycle.id,
      authorUserId: validatedActorId,
      body: parsed.body,
      mentionedUserIds,
      createdAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_INTERNAL_NOTES,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackInternalNotes.append(note);
        await this.deps.feedbacks.save({ ...feedback, updatedAt: now });

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.internal_note.created',
          resourceType: 'FeedbackInternalNote',
          resourceId: note.id,
          after: {
            feedbackId: validatedFeedbackId,
            cycleId: currentCycle.id,
            mentionedCount: mentionedUserIds.length,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.internal_note.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackInternalNote',
            aggregateId: note.id,
            payload: {
              feedbackId: validatedFeedbackId,
              cycleId: currentCycle.id,
              internalNoteId: note.id,
            },
          }),
        );
      },
    );

    return note;
  }

  async uploadFeedbackAttachment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: UploadFeedbackAttachmentInput,
  ): Promise<FeedbackAttachment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(input.correlationId);

    if (Object.prototype.toString.call(input.bytes) !== '[object Uint8Array]') {
      throw new ValidationError('Attachment "bytes" must be a Uint8Array.', {
        details: { field: 'bytes' },
      });
    }

    if (input.messageId !== undefined && input.internalNoteId !== undefined) {
      throw new ValidationError(
        'An attachment cannot reference both "messageId" and "internalNoteId".',
      );
    }

    const validatedMessageId =
      input.messageId !== undefined ? asFeedbackMessageId(input.messageId, 'messageId') : undefined;
    const validatedInternalNoteId =
      input.internalNoteId !== undefined
        ? asFeedbackInternalNoteId(input.internalNoteId, 'internalNoteId')
        : undefined;

    const [{ orgExists, actor, settings, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    if (validatedInternalNoteId !== undefined) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE,
        resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
        context: { now, policyConfig },
      });

      if (feedback && isAuthorBlockedFromInternalNotes(feedback, actor)) {
        throw new AuthorizationError(
          'Feedback authors cannot upload internal note attachments on their own feedback unless they are organization ADMINs (DN-04).',
          {
            details: {
              action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE,
              reasonCode: 'DENIED_AUTHOR_INTERNAL_NOTE_SEGREGATION',
            },
          },
        );
      }
    } else {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_MESSAGE_CREATE,
        resource: buildFeedbackResource(validatedOrgId, validatedFeedbackId, feedback),
        context: { now, policyConfig },
      });
    }

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const [currentCycle, existingAttachments, messages, internalNotes] = await Promise.all([
      this.deps.feedbackCycles.findById(validatedOrgId, feedback.currentCycleId),
      this.deps.feedbackAttachments.listByFeedback(validatedOrgId, validatedFeedbackId),
      validatedMessageId !== undefined
        ? this.deps.feedbackMessages.listByFeedback(validatedOrgId, validatedFeedbackId)
        : Promise.resolve([]),
      validatedInternalNoteId !== undefined
        ? this.deps.feedbackInternalNotes.listByFeedback(validatedOrgId, validatedFeedbackId)
        : Promise.resolve([]),
    ]);

    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (isFeedbackClosedForOperationalMutations(feedback, currentCycle)) {
      throw new ConflictError('Cannot upload attachments to a closed feedback.');
    }

    if (
      validatedMessageId !== undefined &&
      !messages.some((message) => message.id === validatedMessageId)
    ) {
      throw new NotFoundError(
        `FeedbackMessage "${validatedMessageId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    if (
      validatedInternalNoteId !== undefined &&
      !internalNotes.some((note) => note.id === validatedInternalNoteId)
    ) {
      throw new NotFoundError(
        `FeedbackInternalNote "${validatedInternalNoteId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    const defaults = settings.pendingPermissionDefaults;
    if (existingAttachments.length >= defaults.maxAttachmentsPerContext) {
      throw new ValidationError(
        `Maximum attachment count (${defaults.maxAttachmentsPerContext}) reached for this feedback.`,
        {
          details: {
            field: 'attachments',
            currentCount: existingAttachments.length,
            maxAttachmentsPerContext: defaults.maxAttachmentsPerContext,
          },
        },
      );
    }

    const existingTotalBytes = existingAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
    const trimmedFileName = input.fileName.trim();
    const normalizedMimeType = input.mimeType.trim().toLowerCase();
    const defensiveBytes = new Uint8Array(input.bytes);

    validateAttachmentQuota({
      fileName: trimmedFileName,
      mimeType: normalizedMimeType,
      sizeBytes: defensiveBytes.byteLength,
      existingContextTotalBytes: existingTotalBytes,
      maxFileSizeBytes: Math.min(MAX_ATTACHMENT_SIZE_BYTES, defaults.maxAttachmentSizeBytes),
      maxContextTotalBytes: Math.min(
        MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
        defaults.maxContextAttachmentsSizeBytes,
      ),
    });

    // CRITICAL (ADR-0013 §2.3): SHA-256 digest computed strictly BEFORE TransactionPort.run
    const checksumSha256 = await computeSha256Hex(defensiveBytes);
    const attachmentId = asAttachmentId(this.nextUuid());

    const attachment: FeedbackAttachment = Object.freeze({
      id: attachmentId,
      organizationId: validatedOrgId,
      feedbackId: validatedFeedbackId,
      cycleId: currentCycle.id,
      ...(validatedMessageId !== undefined ? { messageId: validatedMessageId } : {}),
      ...(validatedInternalNoteId !== undefined ? { internalNoteId: validatedInternalNoteId } : {}),
      fileName: trimmedFileName,
      mimeType: normalizedMimeType,
      sizeBytes: defensiveBytes.byteLength,
      checksumSha256,
      uploadedBy: validatedActorId,
      uploadedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_ATTACHMENTS,
        TRANSACTION_RESOURCES.ATTACHMENT_BLOBS,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackAttachments.save(attachment);
        await this.deps.attachmentBlobStore.putBlob({
          attachmentId,
          organizationId: validatedOrgId,
          mimeType: normalizedMimeType,
          bytes: defensiveBytes,
        });
        await this.deps.feedbacks.save({ ...feedback, updatedAt: now });

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.attachment.uploaded',
          resourceType: 'FeedbackAttachment',
          resourceId: attachmentId,
          after: {
            feedbackId: validatedFeedbackId,
            cycleId: currentCycle.id,
            isInternal: validatedInternalNoteId !== undefined,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            checksumSha256,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.attachment.uploaded',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackAttachment',
            aggregateId: attachmentId,
            payload: {
              feedbackId: validatedFeedbackId,
              attachmentId,
              isInternal: validatedInternalNoteId !== undefined,
              sizeBytes: attachment.sizeBytes,
            },
          }),
        );
      },
    );

    return attachment;
  }

  // ===========================================================================
  // Catálogos Versionados: Categorias e Motivos de Contestação
  // ===========================================================================

  async listFeedbackCategories(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: { readonly includeInactive?: boolean } = {},
  ): Promise<readonly FeedbackCategoryWithVersion[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    if (options.includeInactive === true) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
        resource: buildOrganizationResource(validatedOrgId, orgExists),
        context: { now, policyConfig },
      });
    } else {
      this.assertActiveOrganizationAccess(actor, orgExists, validatedOrgId, now, policyConfig);
    }

    const categories = await this.deps.feedbackCategories.listByOrganization(validatedOrgId, {
      includeInactive: options.includeInactive === true,
      includeDeleted: false,
    });

    const versionsList = await Promise.all(
      categories.map((category) =>
        this.deps.feedbackCategories.listVersions(validatedOrgId, category.id),
      ),
    );

    return categories.flatMap((category, index) => {
      const versions = versionsList[index] ?? [];
      const currentVersion =
        versions.find((v) => v.id === category.currentVersionId) ?? versions[versions.length - 1];
      if (!currentVersion) {
        return [];
      }
      return [{ category, currentVersion, versions }];
    });
  }

  async createFeedbackCategory(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateCatalogItemInput,
  ): Promise<FeedbackCategoryWithVersion> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      createCatalogItemInputSchema,
      input,
      'Invalid feedback category payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const normalizedCode = parsed.code.toUpperCase();
    const [existingByCode, existingCategories] = await Promise.all([
      this.deps.feedbackCategories.findByCode(validatedOrgId, normalizedCode),
      this.deps.feedbackCategories.listByOrganization(validatedOrgId, {
        includeInactive: true,
        includeDeleted: true,
      }),
    ]);

    if (existingByCode !== null) {
      throw new ConflictError(
        `FeedbackCategory code "${normalizedCode}" already exists in organization "${validatedOrgId}".`,
      );
    }

    const categoryId = asFeedbackCategoryId(this.nextUuid());
    const versionId = asFeedbackCategoryVersionId(this.nextUuid());
    const nextSortOrder =
      parsed.sortOrder ??
      existingCategories.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;

    const category: FeedbackCategory = Object.freeze({
      id: categoryId,
      organizationId: validatedOrgId,
      code: normalizedCode,
      currentVersionId: versionId,
      active: parsed.active,
      sortOrder: nextSortOrder,
      hasBeenUsed: false,
      createdAt: now,
      updatedAt: now,
    });

    const version: FeedbackCategoryVersion = Object.freeze({
      id: versionId,
      organizationId: validatedOrgId,
      categoryId,
      versionNumber: 1,
      name: parsed.name,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      active: parsed.active,
      createdByUserId: validatedActorId,
      createdAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES,
        TRANSACTION_RESOURCES.FEEDBACK_CATEGORY_VERSIONS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackCategories.saveCategory(category);
        await this.deps.feedbackCategories.saveVersion(version);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.category.created',
          resourceType: 'FeedbackCategory',
          resourceId: categoryId,
          after: {
            code: category.code,
            name: version.name,
            versionNumber: 1,
            active: category.active,
            sortOrder: category.sortOrder,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.category.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackCategory',
            aggregateId: categoryId,
            payload: { categoryId, code: category.code, versionId },
          }),
        );
      },
    );

    return { category, currentVersion: version, versions: [version] };
  }

  async updateFeedbackCategory(
    actorUserId: UserId,
    organizationId: OrganizationId,
    categoryId: FeedbackCategoryId,
    input: UpdateCatalogItemInput,
  ): Promise<FeedbackCategoryWithVersion> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedCategoryId = asFeedbackCategoryId(categoryId, 'categoryId');
    const parsed = parseWithZod(
      updateCatalogItemInputSchema,
      input,
      'Invalid feedback category update payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const [category, existingVersions] = await Promise.all([
      this.deps.feedbackCategories.findById(validatedOrgId, validatedCategoryId),
      this.deps.feedbackCategories.listVersions(validatedOrgId, validatedCategoryId),
    ]);

    if (!category || isSoftDeleted(category)) {
      throw new NotFoundError(`FeedbackCategory "${validatedCategoryId}" was not found.`);
    }

    const latestVersion =
      existingVersions.find((v) => v.id === category.currentVersionId) ??
      existingVersions[existingVersions.length - 1];
    if (!latestVersion) {
      throw new ConflictError(`No version found for FeedbackCategory "${validatedCategoryId}".`);
    }

    const nextName = parsed.name ?? latestVersion.name;
    const nextDescription =
      parsed.description === null
        ? undefined
        : parsed.description !== undefined
          ? parsed.description
          : latestVersion.description;
    const nextActive = parsed.active ?? category.active;
    const nextSortOrder = parsed.sortOrder ?? category.sortOrder;

    const needsNewVersion =
      nextName !== latestVersion.name ||
      nextDescription !== latestVersion.description ||
      nextActive !== latestVersion.active;

    const newVersion: FeedbackCategoryVersion | null = needsNewVersion
      ? Object.freeze({
          id: asFeedbackCategoryVersionId(this.nextUuid()),
          organizationId: validatedOrgId,
          categoryId: validatedCategoryId,
          versionNumber: latestVersion.versionNumber + 1,
          name: nextName,
          ...(nextDescription !== undefined && nextDescription.length > 0
            ? { description: nextDescription }
            : {}),
          active: nextActive,
          createdByUserId: validatedActorId,
          createdAt: now,
        })
      : null;

    const updatedCategory: FeedbackCategory = Object.freeze({
      ...category,
      currentVersionId: newVersion?.id ?? category.currentVersionId,
      active: nextActive,
      sortOrder: nextSortOrder,
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES,
        TRANSACTION_RESOURCES.FEEDBACK_CATEGORY_VERSIONS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackCategories.saveCategory(updatedCategory);
        if (newVersion !== null) {
          await this.deps.feedbackCategories.saveVersion(newVersion);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.category.updated',
          resourceType: 'FeedbackCategory',
          resourceId: validatedCategoryId,
          before: {
            currentVersionId: category.currentVersionId,
            active: category.active,
            sortOrder: category.sortOrder,
          },
          after: {
            currentVersionId: updatedCategory.currentVersionId,
            active: updatedCategory.active,
            sortOrder: updatedCategory.sortOrder,
            versionCreated: newVersion !== null,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.category.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackCategory',
            aggregateId: validatedCategoryId,
            payload: {
              categoryId: validatedCategoryId,
              currentVersionId: updatedCategory.currentVersionId,
              active: updatedCategory.active,
            },
          }),
        );
      },
    );

    const allVersions = newVersion !== null ? [...existingVersions, newVersion] : existingVersions;
    return {
      category: updatedCategory,
      currentVersion: newVersion ?? latestVersion,
      versions: allVersions,
    };
  }

  async reorderFeedbackCategories(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: ReorderFeedbackCategoriesInput,
  ): Promise<readonly FeedbackCategory[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      reorderCatalogIdsSchema,
      input,
      'Invalid feedback category reorder payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const existing = await this.deps.feedbackCategories.listByOrganization(validatedOrgId, {
      includeInactive: true,
      includeDeleted: false,
    });

    const orderedIds = parsed.orderedIds.map((id) => asFeedbackCategoryId(id, 'orderedIds'));
    const existingSet = new Set(existing.map((c) => c.id));
    const orderedSet = new Set(orderedIds);
    if (
      orderedIds.length !== existing.length ||
      orderedSet.size !== existing.length ||
      orderedIds.some((id) => !existingSet.has(id))
    ) {
      throw new ValidationError(
        'orderedIds must be an exact permutation of all non-deleted feedback categories.',
        { details: { field: 'orderedIds' } },
      );
    }

    const byId = new Map(existing.map((c) => [c.id, c]));
    const updated = orderedIds.map((id, index) => {
      const cat = byId.get(id)!;
      return Object.freeze({
        ...cat,
        sortOrder: index + 1,
        updatedAt: now,
      });
    });

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        for (const cat of updated) {
          await this.deps.feedbackCategories.saveCategory(cat);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.category.reordered',
          resourceType: 'Organization',
          resourceId: validatedOrgId,
          after: { orderedIds },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.category.reordered',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Organization',
            aggregateId: validatedOrgId,
            payload: { orderedIds },
          }),
        );
      },
    );

    return updated;
  }

  async deleteFeedbackCategory(
    actorUserId: UserId,
    organizationId: OrganizationId,
    categoryId: FeedbackCategoryId,
    options: FeedbackOperationOptions = {},
  ): Promise<FeedbackCategory> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedCategoryId = asFeedbackCategoryId(categoryId, 'categoryId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const [category, feedbacks] = await Promise.all([
      this.deps.feedbackCategories.findById(validatedOrgId, validatedCategoryId),
      this.deps.feedbacks.listByOrganization(validatedOrgId),
    ]);

    if (!category || isSoftDeleted(category)) {
      throw new NotFoundError(`FeedbackCategory "${validatedCategoryId}" was not found.`);
    }

    const referencedByFeedback = feedbacks.some((f) => f.categoryId === validatedCategoryId);
    assertCategoryDeletionAllowed(category.hasBeenUsed || referencedByFeedback);

    const deletedCategory: FeedbackCategory = Object.freeze({
      ...category,
      active: false,
      deletedAt: now,
      deletedBy: validatedActorId,
      ...(options.reason !== undefined && options.reason.trim().length > 0
        ? { deletionReason: options.reason.trim() }
        : {}),
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.feedbackCategories.saveCategory(deletedCategory);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.category.deleted',
          resourceType: 'FeedbackCategory',
          resourceId: validatedCategoryId,
          before: { active: category.active },
          after: { deletedAt: now },
          ...(deletedCategory.deletionReason !== undefined
            ? { justification: deletedCategory.deletionReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.category.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackCategory',
            aggregateId: validatedCategoryId,
            payload: { categoryId: validatedCategoryId, deletedAt: now },
          }),
        );
      },
    );

    return deletedCategory;
  }

  async listFeedbackContestReasons(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: { readonly includeInactive?: boolean } = {},
  ): Promise<readonly FeedbackContestReasonWithVersion[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    if (options.includeInactive === true) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
        resource: buildOrganizationResource(validatedOrgId, orgExists),
        context: { now, policyConfig },
      });
    } else {
      this.assertActiveOrganizationAccess(actor, orgExists, validatedOrgId, now, policyConfig);
    }

    const reasons = await this.deps.feedbackContestReasons.listByOrganization(validatedOrgId, {
      includeInactive: options.includeInactive === true,
      includeDeleted: false,
    });

    const versionsList = await Promise.all(
      reasons.map((reason) =>
        this.deps.feedbackContestReasons.listVersions(validatedOrgId, reason.id),
      ),
    );

    return reasons.flatMap((reason, index) => {
      const versions = versionsList[index] ?? [];
      const currentVersion =
        versions.find((v) => v.id === reason.currentVersionId) ?? versions[versions.length - 1];
      if (!currentVersion) {
        return [];
      }
      return [{ reason, currentVersion, versions }];
    });
  }

  async createFeedbackContestReason(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateCatalogItemInput,
  ): Promise<FeedbackContestReasonWithVersion> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      createCatalogItemInputSchema,
      input,
      'Invalid feedback contest reason payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const normalizedCode = parsed.code.toUpperCase();
    const [existingByCode, existingReasons] = await Promise.all([
      this.deps.feedbackContestReasons.findByCode(validatedOrgId, normalizedCode),
      this.deps.feedbackContestReasons.listByOrganization(validatedOrgId, {
        includeInactive: true,
        includeDeleted: true,
      }),
    ]);

    if (existingByCode !== null) {
      throw new ConflictError(
        `FeedbackContestReason code "${normalizedCode}" already exists in organization "${validatedOrgId}".`,
      );
    }

    const reasonId = asFeedbackContestReasonId(this.nextUuid());
    const versionId = asFeedbackContestReasonVersionId(this.nextUuid());
    const nextSortOrder =
      parsed.sortOrder ??
      existingReasons.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;

    const reason: FeedbackContestReason = Object.freeze({
      id: reasonId,
      organizationId: validatedOrgId,
      code: normalizedCode,
      currentVersionId: versionId,
      active: parsed.active,
      sortOrder: nextSortOrder,
      hasBeenUsed: false,
      createdAt: now,
      updatedAt: now,
    });

    const version: FeedbackContestReasonVersion = Object.freeze({
      id: versionId,
      organizationId: validatedOrgId,
      reasonId,
      versionNumber: 1,
      name: parsed.name,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      active: parsed.active,
      createdByUserId: validatedActorId,
      createdAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS,
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASON_VERSIONS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackContestReasons.saveReason(reason);
        await this.deps.feedbackContestReasons.saveVersion(version);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.contest_reason.created',
          resourceType: 'FeedbackContestReason',
          resourceId: reasonId,
          after: {
            code: reason.code,
            name: version.name,
            versionNumber: 1,
            active: reason.active,
            sortOrder: reason.sortOrder,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest_reason.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContestReason',
            aggregateId: reasonId,
            payload: { reasonId, code: reason.code, versionId },
          }),
        );
      },
    );

    return { reason, currentVersion: version, versions: [version] };
  }

  async updateFeedbackContestReason(
    actorUserId: UserId,
    organizationId: OrganizationId,
    reasonId: FeedbackContestReasonId,
    input: UpdateCatalogItemInput,
  ): Promise<FeedbackContestReasonWithVersion> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedReasonId = asFeedbackContestReasonId(reasonId, 'reasonId');
    const parsed = parseWithZod(
      updateCatalogItemInputSchema,
      input,
      'Invalid feedback contest reason update payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const [reason, existingVersions] = await Promise.all([
      this.deps.feedbackContestReasons.findById(validatedOrgId, validatedReasonId),
      this.deps.feedbackContestReasons.listVersions(validatedOrgId, validatedReasonId),
    ]);

    if (!reason || isSoftDeleted(reason)) {
      throw new NotFoundError(`FeedbackContestReason "${validatedReasonId}" was not found.`);
    }

    const latestVersion =
      existingVersions.find((v) => v.id === reason.currentVersionId) ??
      existingVersions[existingVersions.length - 1];
    if (!latestVersion) {
      throw new ConflictError(`No version found for FeedbackContestReason "${validatedReasonId}".`);
    }

    const nextName = parsed.name ?? latestVersion.name;
    const nextDescription =
      parsed.description === null
        ? undefined
        : parsed.description !== undefined
          ? parsed.description
          : latestVersion.description;
    const nextActive = parsed.active ?? reason.active;
    const nextSortOrder = parsed.sortOrder ?? reason.sortOrder;

    const needsNewVersion =
      nextName !== latestVersion.name ||
      nextDescription !== latestVersion.description ||
      nextActive !== latestVersion.active;

    const newVersion: FeedbackContestReasonVersion | null = needsNewVersion
      ? Object.freeze({
          id: asFeedbackContestReasonVersionId(this.nextUuid()),
          organizationId: validatedOrgId,
          reasonId: validatedReasonId,
          versionNumber: latestVersion.versionNumber + 1,
          name: nextName,
          ...(nextDescription !== undefined && nextDescription.length > 0
            ? { description: nextDescription }
            : {}),
          active: nextActive,
          createdByUserId: validatedActorId,
          createdAt: now,
        })
      : null;

    const updatedReason: FeedbackContestReason = Object.freeze({
      ...reason,
      currentVersionId: newVersion?.id ?? reason.currentVersionId,
      active: nextActive,
      sortOrder: nextSortOrder,
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS,
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASON_VERSIONS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackContestReasons.saveReason(updatedReason);
        if (newVersion !== null) {
          await this.deps.feedbackContestReasons.saveVersion(newVersion);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.contest_reason.updated',
          resourceType: 'FeedbackContestReason',
          resourceId: validatedReasonId,
          before: {
            currentVersionId: reason.currentVersionId,
            active: reason.active,
            sortOrder: reason.sortOrder,
          },
          after: {
            currentVersionId: updatedReason.currentVersionId,
            active: updatedReason.active,
            sortOrder: updatedReason.sortOrder,
            versionCreated: newVersion !== null,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest_reason.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContestReason',
            aggregateId: validatedReasonId,
            payload: {
              reasonId: validatedReasonId,
              currentVersionId: updatedReason.currentVersionId,
              active: updatedReason.active,
            },
          }),
        );
      },
    );

    const allVersions = newVersion !== null ? [...existingVersions, newVersion] : existingVersions;
    return {
      reason: updatedReason,
      currentVersion: newVersion ?? latestVersion,
      versions: allVersions,
    };
  }

  async reorderFeedbackContestReasons(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: ReorderFeedbackContestReasonsInput,
  ): Promise<readonly FeedbackContestReason[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      reorderCatalogIdsSchema,
      input,
      'Invalid feedback contest reason reorder payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const existing = await this.deps.feedbackContestReasons.listByOrganization(validatedOrgId, {
      includeInactive: true,
      includeDeleted: false,
    });

    const orderedIds = parsed.orderedIds.map((id) => asFeedbackContestReasonId(id, 'orderedIds'));
    const existingSet = new Set(existing.map((r) => r.id));
    const orderedSet = new Set(orderedIds);
    if (
      orderedIds.length !== existing.length ||
      orderedSet.size !== existing.length ||
      orderedIds.some((id) => !existingSet.has(id))
    ) {
      throw new ValidationError(
        'orderedIds must be an exact permutation of all non-deleted contestation reasons.',
        { details: { field: 'orderedIds' } },
      );
    }

    const byId = new Map(existing.map((r) => [r.id, r]));
    const updated = orderedIds.map((id, index) => {
      const reason = byId.get(id)!;
      return Object.freeze({
        ...reason,
        sortOrder: index + 1,
        updatedAt: now,
      });
    });

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        for (const reason of updated) {
          await this.deps.feedbackContestReasons.saveReason(reason);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.contest_reason.reordered',
          resourceType: 'Organization',
          resourceId: validatedOrgId,
          after: { orderedIds },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest_reason.reordered',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Organization',
            aggregateId: validatedOrgId,
            payload: { orderedIds },
          }),
        );
      },
    );

    return updated;
  }

  async deleteFeedbackContestReason(
    actorUserId: UserId,
    organizationId: OrganizationId,
    reasonId: FeedbackContestReasonId,
    options: FeedbackOperationOptions = {},
  ): Promise<FeedbackContestReason> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedReasonId = asFeedbackContestReasonId(reasonId, 'reasonId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const [reason, contests] = await Promise.all([
      this.deps.feedbackContestReasons.findById(validatedOrgId, validatedReasonId),
      this.deps.feedbackContests.listByOrganization(validatedOrgId),
    ]);

    if (!reason || isSoftDeleted(reason)) {
      throw new NotFoundError(`FeedbackContestReason "${validatedReasonId}" was not found.`);
    }

    const referencedByContest = contests.some((c) => c.reasonId === validatedReasonId);
    assertCategoryDeletionAllowed(reason.hasBeenUsed || referencedByContest);

    const deletedReason: FeedbackContestReason = Object.freeze({
      ...reason,
      active: false,
      deletedAt: now,
      deletedBy: validatedActorId,
      ...(options.reason !== undefined && options.reason.trim().length > 0
        ? { deletionReason: options.reason.trim() }
        : {}),
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.feedbackContestReasons.saveReason(deletedReason);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.contest_reason.deleted',
          resourceType: 'FeedbackContestReason',
          resourceId: validatedReasonId,
          before: { active: reason.active },
          after: { deletedAt: now },
          ...(deletedReason.deletionReason !== undefined
            ? { justification: deletedReason.deletionReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest_reason.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContestReason',
            aggregateId: validatedReasonId,
            payload: { reasonId: validatedReasonId, deletedAt: now },
          }),
        );
      },
    );

    return deletedReason;
  }

  // ===========================================================================
  // Configurações SLA & Avaliação Persistente Sob Demanda (DN-01, DN-05)
  // ===========================================================================

  async getFeedbackSlaSettings(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<FeedbackSlaSettingsView> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const { orgExists, actor, settings, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_SLA_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    return {
      organizationId: validatedOrgId,
      calendar: settings.calendar,
      slaPoliciesByPriority: settings.slaPoliciesByPriority,
      feedbackManifestationWindowMs: settings.feedbackManifestationWindowMs,
      feedbackContestWindowMs: settings.feedbackContestWindowMs,
      updatedAt: settings.updatedAt,
    };
  }

  async updateFeedbackSlaSettings(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: UpdateFeedbackSlaSettingsInput,
  ): Promise<FeedbackSlaSettingsView> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      updateSlaSettingsInputSchema,
      input,
      'Invalid feedback SLA settings payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, settings, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_SLA_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const nextCalendar: OrganizationCalendarConfig = parsed.calendar
      ? Object.freeze({
          mode: parsed.calendar.mode,
          workDaysOfWeekUtc: Object.freeze([...new Set(parsed.calendar.workDaysOfWeekUtc)].sort()),
          workStartHourUtc: parsed.calendar.workStartHourUtc,
          workEndHourUtc: parsed.calendar.workEndHourUtc,
          breakIntervalsUtc: Object.freeze(
            parsed.calendar.breakIntervalsUtc.map((brk) => Object.freeze({ ...brk })),
          ),
          holidayDates: Object.freeze(
            [...new Set(parsed.calendar.holidayDates.map((d) => asIsoDate(d)))].sort(),
          ),
        })
      : settings.calendar;

    const mergedPolicies: Record<Priority, SlaPriorityPolicy> = {
      [PRIORITIES.CRITICAL]: parsed.slaPoliciesByPriority?.CRITICAL
        ? Object.freeze({
            priority: PRIORITIES.CRITICAL,
            firstResponseTargetMs: parsed.slaPoliciesByPriority.CRITICAL.firstResponseTargetMs,
            resolutionTargetMs: parsed.slaPoliciesByPriority.CRITICAL.resolutionTargetMs,
          })
        : settings.slaPoliciesByPriority[PRIORITIES.CRITICAL],
      [PRIORITIES.HIGH]: parsed.slaPoliciesByPriority?.HIGH
        ? Object.freeze({
            priority: PRIORITIES.HIGH,
            firstResponseTargetMs: parsed.slaPoliciesByPriority.HIGH.firstResponseTargetMs,
            resolutionTargetMs: parsed.slaPoliciesByPriority.HIGH.resolutionTargetMs,
          })
        : settings.slaPoliciesByPriority[PRIORITIES.HIGH],
      [PRIORITIES.MEDIUM]: parsed.slaPoliciesByPriority?.MEDIUM
        ? Object.freeze({
            priority: PRIORITIES.MEDIUM,
            firstResponseTargetMs: parsed.slaPoliciesByPriority.MEDIUM.firstResponseTargetMs,
            resolutionTargetMs: parsed.slaPoliciesByPriority.MEDIUM.resolutionTargetMs,
          })
        : settings.slaPoliciesByPriority[PRIORITIES.MEDIUM],
      [PRIORITIES.LOW]: parsed.slaPoliciesByPriority?.LOW
        ? Object.freeze({
            priority: PRIORITIES.LOW,
            firstResponseTargetMs: parsed.slaPoliciesByPriority.LOW.firstResponseTargetMs,
            resolutionTargetMs: parsed.slaPoliciesByPriority.LOW.resolutionTargetMs,
          })
        : settings.slaPoliciesByPriority[PRIORITIES.LOW],
    };

    const updatedSettings: OrganizationSettings = Object.freeze({
      ...settings,
      calendar: nextCalendar,
      slaPoliciesByPriority: Object.freeze(mergedPolicies),
      feedbackManifestationWindowMs:
        parsed.feedbackManifestationWindowMs ?? settings.feedbackManifestationWindowMs,
      feedbackContestWindowMs: parsed.feedbackContestWindowMs ?? settings.feedbackContestWindowMs,
      updatedAt: now,
    });

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.organizationSettings.save(updatedSettings);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'feedback.sla_settings.updated',
          resourceType: 'OrganizationSettings',
          resourceId: validatedOrgId,
          before: {
            calendarMode: settings.calendar.mode,
            feedbackManifestationWindowMs: settings.feedbackManifestationWindowMs,
            feedbackContestWindowMs: settings.feedbackContestWindowMs,
          },
          after: {
            calendarMode: updatedSettings.calendar.mode,
            feedbackManifestationWindowMs: updatedSettings.feedbackManifestationWindowMs,
            feedbackContestWindowMs: updatedSettings.feedbackContestWindowMs,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.sla_settings.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'OrganizationSettings',
            aggregateId: validatedOrgId,
            payload: {
              organizationId: validatedOrgId,
              calendarMode: updatedSettings.calendar.mode,
            },
          }),
        );
      },
    );

    return {
      organizationId: validatedOrgId,
      calendar: updatedSettings.calendar,
      slaPoliciesByPriority: updatedSettings.slaPoliciesByPriority,
      feedbackManifestationWindowMs: updatedSettings.feedbackManifestationWindowMs,
      feedbackContestWindowMs: updatedSettings.feedbackContestWindowMs,
      updatedAt: updatedSettings.updatedAt,
    };
  }

  async evaluateFeedbackSlas(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: FeedbackOperationOptions = {},
  ): Promise<EvaluateFeedbackSlasResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_SLA_MANAGE,
      resource: buildOrganizationResource(validatedOrgId, orgExists),
      context: { now, policyConfig },
    });

    const [feedbacks, cycles, snapshots, contests] = await Promise.all([
      this.deps.feedbacks.listByOrganization(validatedOrgId),
      this.deps.feedbackCycles.listByOrganization(validatedOrgId),
      this.deps.feedbackSlaSnapshots.listByOrganization(validatedOrgId),
      this.deps.feedbackContests.listByOrganization(validatedOrgId),
    ]);

    const cycleById = new Map(cycles.map((c) => [c.id, c]));
    const snapshotById = new Map(snapshots.map((s) => [s.id, s]));
    const snapshotByCycleId = new Map(snapshots.map((s) => [s.cycleId, s]));
    const pendingContestCycleIds = new Set(
      contests
        .filter(
          (c) => c.status === CONTEST_STATUSES.OPEN || c.status === CONTEST_STATUSES.IN_ANALYSIS,
        )
        .map((c) => c.cycleId),
    );

    const modifiedCycles: FeedbackCycle[] = [];
    const modifiedFeedbacks: Feedback[] = [];
    let evaluatedCount = 0;
    let warningCount = 0;
    let breachedCount = 0;
    let escalatedCount = 0;
    let autoClosedCount = 0;

    for (const feedback of feedbacks) {
      if (feedback.status === FEEDBACK_STATUSES.CLOSED) {
        continue;
      }

      const cycle = cycleById.get(feedback.currentCycleId);
      if (!cycle || cycle.closedAt !== undefined) {
        continue;
      }

      const snapshot = snapshotById.get(cycle.slaSnapshotId) ?? snapshotByCycleId.get(cycle.id);
      if (!snapshot) {
        continue;
      }

      evaluatedCount += 1;
      const live = computeLiveSlaStatus(cycle, snapshot, now);

      let nextFirstResponseWarningAt = cycle.firstResponseWarningAt;
      let nextFirstResponseBreachedAt = cycle.firstResponseBreachedAt;
      let nextResolutionWarningAt = cycle.resolutionWarningAt;
      let nextResolutionBreachedAt = cycle.resolutionBreachedAt;
      let nextEscalatedAt = cycle.escalatedAt;
      let cycleChanged = false;

      // Deduplicated SLA milestones (never overwrite previously recorded timestamps)
      if (!live.firstResponseCompleted) {
        if (
          (live.firstResponseStatus === 'WARNING' || live.firstResponseStatus === 'BREACHED') &&
          nextFirstResponseWarningAt === undefined
        ) {
          nextFirstResponseWarningAt = now;
          warningCount += 1;
          cycleChanged = true;
        }
        if (live.firstResponseStatus === 'BREACHED' && nextFirstResponseBreachedAt === undefined) {
          nextFirstResponseBreachedAt = now;
          breachedCount += 1;
          cycleChanged = true;
        }
      }

      if (!live.resolutionCompleted) {
        if (
          (live.resolutionStatus === 'WARNING' || live.resolutionStatus === 'BREACHED') &&
          nextResolutionWarningAt === undefined
        ) {
          nextResolutionWarningAt = now;
          warningCount += 1;
          cycleChanged = true;
        }
        if (live.resolutionStatus === 'BREACHED' && nextResolutionBreachedAt === undefined) {
          nextResolutionBreachedAt = now;
          breachedCount += 1;
          cycleChanged = true;
        }
      }

      const anyBreached =
        nextFirstResponseBreachedAt !== undefined || nextResolutionBreachedAt !== undefined;
      if (anyBreached && nextEscalatedAt === undefined) {
        // Escalation signals ADMIN WITHOUT ever altering assigneeId (PRD §15.5, DN-05)
        nextEscalatedAt = now;
        escalatedCount += 1;
        cycleChanged = true;
      }

      let updatedCycle: FeedbackCycle = Object.freeze({
        ...cycle,
        ...(nextFirstResponseWarningAt !== undefined
          ? { firstResponseWarningAt: nextFirstResponseWarningAt }
          : {}),
        ...(nextFirstResponseBreachedAt !== undefined
          ? { firstResponseBreachedAt: nextFirstResponseBreachedAt }
          : {}),
        ...(nextResolutionWarningAt !== undefined
          ? { resolutionWarningAt: nextResolutionWarningAt }
          : {}),
        ...(nextResolutionBreachedAt !== undefined
          ? { resolutionBreachedAt: nextResolutionBreachedAt }
          : {}),
        ...(nextEscalatedAt !== undefined ? { escalatedAt: nextEscalatedAt } : {}),
      });

      const hasPendingContest = pendingContestCycleIds.has(cycle.id);
      if (canAutoCloseResolvedFeedback(updatedCycle, hasPendingContest, now)) {
        updatedCycle = autoCloseResolvedFeedback(updatedCycle, hasPendingContest, now);
        cycleChanged = true;
        autoClosedCount += 1;

        // Keep operational status RESOLVED per PRD §15.6 & ADR-0006 §4
        modifiedFeedbacks.push(
          Object.freeze({
            ...feedback,
            status: FEEDBACK_STATUSES.RESOLVED,
            closedAt: updatedCycle.closedAt,
            closureReason: updatedCycle.closureReason,
            authorConfirmedResolution: false,
            updatedAt: now,
          }),
        );
      }

      if (cycleChanged) {
        modifiedCycles.push(updatedCycle);
      }
    }

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        for (const cycle of modifiedCycles) {
          await this.deps.feedbackCycles.save(cycle);
        }
        for (const feedback of modifiedFeedbacks) {
          await this.deps.feedbacks.save(feedback);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.sla.evaluated',
          resourceType: 'Organization',
          resourceId: validatedOrgId,
          after: {
            evaluatedCount,
            updatedCycleCount: modifiedCycles.length,
            warningCount,
            breachedCount,
            escalatedCount,
            autoClosedCount,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.sla.evaluated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Organization',
            aggregateId: validatedOrgId,
            payload: {
              evaluatedCount,
              updatedCycleCount: modifiedCycles.length,
              warningCount,
              breachedCount,
              escalatedCount,
              autoClosedCount,
            },
          }),
        );
      },
    );

    return {
      organizationId: validatedOrgId,
      evaluatedAt: now,
      evaluatedCount,
      updatedCycleCount: modifiedCycles.length,
      warningCount,
      breachedCount,
      escalatedCount,
      autoClosedCount,
    };
  }

  // ===========================================================================
  // Contestações e Reabertura Excepcional (DN-04, PermissionGrant Sync)
  // ===========================================================================

  async openFeedbackContest(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: OpenFeedbackContestInput,
  ): Promise<FeedbackContest> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(openContestInputSchema, input, 'Invalid contestation payload.');
    const reasonId = asFeedbackContestReasonId(parsed.reasonId, 'reasonId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_VIEW,
      resource: buildFeedbackResource(
        validatedOrgId,
        validatedFeedbackId,
        feedback,
        'FEEDBACK_CONTEST',
      ),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    // DN-04: Contest opening is strictly restricted to the feedback author
    if (feedback.authorUserId !== validatedActorId) {
      throw new AuthorizationError('Only the feedback author may open a contestation.', {
        details: { feedbackId: validatedFeedbackId },
      });
    }

    const [currentCycle, cycleContests, reason] = await Promise.all([
      this.deps.feedbackCycles.findById(validatedOrgId, feedback.currentCycleId),
      this.deps.feedbackContests.listByCycle(validatedOrgId, feedback.currentCycleId),
      this.deps.feedbackContestReasons.findById(validatedOrgId, reasonId),
    ]);

    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    if (!reason || isSoftDeleted(reason)) {
      throw new NotFoundError(`FeedbackContestReason "${reasonId}" was not found.`);
    }

    const reasonVersion = await this.deps.feedbackContestReasons.findVersionById(
      validatedOrgId,
      reason.currentVersionId,
    );

    const hasPendingContest = cycleContests.some(
      (c) => c.status === CONTEST_STATUSES.OPEN || c.status === CONTEST_STATUSES.IN_ANALYSIS,
    );

    assertContestCanBeOpened({
      cycle: currentCycle,
      hasPendingContest,
      reasonVersionActive: reason.active && reasonVersion !== null && reasonVersion.active,
      justification: parsed.justification,
      now,
    });

    const contest: FeedbackContest = Object.freeze({
      id: asFeedbackContestId(this.nextUuid()),
      organizationId: validatedOrgId,
      feedbackId: validatedFeedbackId,
      cycleId: currentCycle.id,
      originResolvedAt: currentCycle.resolvedAt!,
      reasonId: reason.id,
      reasonVersionId: reasonVersion!.id,
      justification: parsed.justification.trim(),
      status: CONTEST_STATUSES.OPEN,
      openedByUserId: validatedActorId,
      openedAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CONTESTS,
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackContests.saveContest(contest);
        if (!reason.hasBeenUsed) {
          await this.deps.feedbackContestReasons.saveReason({
            ...reason,
            hasBeenUsed: true,
            updatedAt: now,
          });
        }
        await this.deps.feedbacks.save({ ...feedback, updatedAt: now });

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.contest.opened',
          resourceType: 'FeedbackContest',
          resourceId: contest.id,
          after: {
            feedbackId: validatedFeedbackId,
            cycleId: currentCycle.id,
            reasonId: reason.id,
            reasonVersionId: reasonVersion!.id,
            status: contest.status,
          },
          justification: contest.justification,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest.opened',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContest',
            aggregateId: contest.id,
            payload: {
              feedbackId: validatedFeedbackId,
              contestId: contest.id,
              cycleId: currentCycle.id,
              reasonId: reason.id,
            },
          }),
        );
      },
    );

    return contest;
  }

  async delegateFeedbackContestAnalysis(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    contestId: FeedbackContest['id'],
    input: DelegateContestAnalysisInput,
  ): Promise<FeedbackContest> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const validatedContestId = asFeedbackContestId(contestId, 'contestId');
    const parsed = parseWithZod(
      delegateContestInputSchema,
      input,
      'Invalid contest delegation payload.',
    );
    const targetAnalystId = asUserId(parsed.analystUserId, 'analystUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback, contest] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
      this.deps.feedbackContests.findById(validatedOrgId, validatedContestId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE,
      resource: buildFeedbackResource(
        validatedOrgId,
        validatedFeedbackId,
        feedback,
        'FEEDBACK_CONTEST',
      ),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    if (!contest || contest.feedbackId !== validatedFeedbackId) {
      throw new NotFoundError(
        `FeedbackContest "${validatedContestId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    if (contest.status === CONTEST_STATUSES.CLOSED || contest.status === CONTEST_STATUSES.DECIDED) {
      throw new ConflictError('Cannot delegate analysis for an already decided or closed contest.');
    }

    await this.assertTargetHandlerEligible(validatedOrgId, targetAnalystId, feedback);

    const updatedContest: FeedbackContest = Object.freeze({
      ...contest,
      delegatedAnalystUserId: targetAnalystId,
      status: CONTEST_STATUSES.IN_ANALYSIS,
    });

    const newGrant: PermissionGrant = Object.freeze({
      id: asGrantId(this.nextUuid()),
      organizationId: validatedOrgId,
      granteeUserId: targetAnalystId,
      permission: PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(validatedFeedbackId),
      grantedByUserId: validatedActorId,
      grantedByRole: actor.organizationMembership!.role,
      grantedAt: now,
      reason:
        parsed.reason && parsed.reason.length > 0
          ? parsed.reason
          : `Delegated analysis for feedback contest "${validatedContestId}".`,
      status: GRANT_STATUSES.ACTIVE,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CONTESTS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.revokeContestAnalyzeGrantsForFeedback(
          validatedOrgId,
          validatedFeedbackId,
          validatedActorId,
          now,
        );
        await this.deps.permissionGrants.save(newGrant);
        await this.deps.feedbackContests.saveContest(updatedContest);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.contest.delegated',
          resourceType: 'FeedbackContest',
          resourceId: validatedContestId,
          before: {
            delegatedAnalystUserId: contest.delegatedAnalystUserId ?? null,
            status: contest.status,
          },
          after: {
            delegatedAnalystUserId: targetAnalystId,
            status: updatedContest.status,
            permissionGrantId: newGrant.id,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest.delegated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContest',
            aggregateId: validatedContestId,
            payload: {
              feedbackId: validatedFeedbackId,
              contestId: validatedContestId,
              delegatedAnalystUserId: targetAnalystId,
              permissionGrantId: newGrant.id,
            },
          }),
        );
      },
    );

    return updatedContest;
  }

  async submitFeedbackContestAnalysis(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    contestId: FeedbackContest['id'],
    input: SubmitContestAnalysisInput,
  ): Promise<FeedbackContestAnalysis> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const validatedContestId = asFeedbackContestId(contestId, 'contestId');
    const parsed = parseWithZod(
      submitContestAnalysisInputSchema,
      input,
      'Invalid contest analysis payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback, contest, existingAnalyses] =
      await Promise.all([
        this.loadActorContext(validatedActorId, validatedOrgId, now),
        this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
        this.deps.feedbackContests.findById(validatedOrgId, validatedContestId),
        this.deps.feedbackContests.listAnalyses(validatedOrgId, validatedContestId),
      ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE,
      resource: buildFeedbackResource(
        validatedOrgId,
        validatedFeedbackId,
        feedback,
        'FEEDBACK_CONTEST',
      ),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    if (!contest || contest.feedbackId !== validatedFeedbackId) {
      throw new NotFoundError(
        `FeedbackContest "${validatedContestId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    if (contest.status === CONTEST_STATUSES.CLOSED || contest.status === CONTEST_STATUSES.DECIDED) {
      throw new ConflictError('Cannot submit analysis for an already decided or closed contest.');
    }

    // DN-04: Non-ADMIN author cannot analyze their own feedback contest
    if (isAuthorBlockedFromInternalNotes(feedback, actor)) {
      throw new AuthorizationError(
        'Non-ADMIN feedback authors cannot submit contestation analyses for their own feedback (DN-04).',
      );
    }

    if (
      actor.organizationMembership?.role !== ORGANIZATION_ROLES.ADMIN &&
      contest.delegatedAnalystUserId !== validatedActorId
    ) {
      throw new AuthorizationError(
        'Only the currently delegated analyst or an organization ADMIN may submit a contest analysis.',
      );
    }

    if (existingAnalyses.some((analysis) => analysis.analystUserId === validatedActorId)) {
      throw new ConflictError(
        'This analyst has already submitted an immutable analysis for this contestation.',
      );
    }

    const analysis: FeedbackContestAnalysis = Object.freeze({
      id: asFeedbackContestAnalysisId(this.nextUuid()),
      organizationId: validatedOrgId,
      contestId: validatedContestId,
      analystUserId: validatedActorId,
      recommendation: parsed.recommendation,
      summary: parsed.summary,
      createdAt: now,
    });

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_ANALYSES,
        TRANSACTION_RESOURCES.FEEDBACK_CONTESTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackContests.appendAnalysis(analysis);
        if (contest.status === CONTEST_STATUSES.OPEN) {
          await this.deps.feedbackContests.saveContest({
            ...contest,
            status: CONTEST_STATUSES.IN_ANALYSIS,
          });
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.contest.analysis_submitted',
          resourceType: 'FeedbackContestAnalysis',
          resourceId: analysis.id,
          after: {
            feedbackId: validatedFeedbackId,
            contestId: validatedContestId,
            recommendation: analysis.recommendation,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest.analysis_submitted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContestAnalysis',
            aggregateId: analysis.id,
            payload: {
              feedbackId: validatedFeedbackId,
              contestId: validatedContestId,
              analysisId: analysis.id,
              recommendation: analysis.recommendation,
            },
          }),
        );
      },
    );

    return analysis;
  }

  async decideFeedbackContest(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    contestId: FeedbackContest['id'],
    input: DecideContestInput,
  ): Promise<DecideContestResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const validatedContestId = asFeedbackContestId(contestId, 'contestId');
    const parsed = parseWithZod(
      decideContestInputSchema,
      input,
      'Invalid contest decision payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, settings, policyConfig }, feedback, contest, analyses] =
      await Promise.all([
        this.loadActorContext(validatedActorId, validatedOrgId, now),
        this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
        this.deps.feedbackContests.findById(validatedOrgId, validatedContestId),
        this.deps.feedbackContests.listAnalyses(validatedOrgId, validatedContestId),
      ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE,
      resource: buildFeedbackResource(
        validatedOrgId,
        validatedFeedbackId,
        feedback,
        'FEEDBACK_CONTEST',
      ),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    if (!contest || contest.feedbackId !== validatedFeedbackId) {
      throw new NotFoundError(
        `FeedbackContest "${validatedContestId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    if (contest.status === CONTEST_STATUSES.CLOSED || contest.status === CONTEST_STATUSES.DECIDED) {
      throw new ConflictError('This contestation has already been decided and closed.');
    }

    const currentCycle = await this.deps.feedbackCycles.findById(validatedOrgId, contest.cycleId);
    if (!currentCycle) {
      throw new ConflictError(`Cycle "${contest.cycleId}" was not found.`);
    }

    const latestAnalysis = analyses[analyses.length - 1];
    const outcomeSpec = assertContestDecisionValid({
      actorRole: actor.organizationMembership!.role,
      outcome: parsed.outcome,
      ...(latestAnalysis !== undefined ? { analysis: latestAnalysis } : {}),
      justification: parsed.justification,
    });

    const decision: FeedbackContestDecision = Object.freeze({
      id: asFeedbackContestDecisionId(this.nextUuid()),
      organizationId: validatedOrgId,
      contestId: validatedContestId,
      decidedByAdminUserId: validatedActorId,
      outcome: parsed.outcome,
      divergedFromAnalysis: outcomeSpec.divergedFromAnalysis,
      justification: parsed.justification.trim(),
      decidedAt: now,
    });

    const updatedContest: FeedbackContest = Object.freeze({
      ...contest,
      status: outcomeSpec.contestStatus,
      closedAt: now,
    });

    let newCycle: FeedbackCycle | undefined;
    let newSlaSnapshot: FeedbackSlaSnapshot | undefined;
    let updatedFeedback: Feedback;

    if (outcomeSpec.createsNewCycle) {
      const newCycleId = asFeedbackCycleId(this.nextUuid());
      const newSnapshotId = asFeedbackSlaSnapshotId(this.nextUuid());
      const effectivePriority = feedback.priority;

      newSlaSnapshot = createSlaSnapshotFromSettings({
        id: newSnapshotId,
        organizationId: validatedOrgId,
        feedbackId: validatedFeedbackId,
        cycleId: newCycleId,
        priority: effectivePriority,
        settings,
        now,
      });

      const baseReopenedCycle = createReopenedFeedbackCycle(
        currentCycle,
        newCycleId,
        CYCLE_ORIGINS.CONTESTATION_REOPEN,
        newSnapshotId,
        now,
      );

      newCycle = Object.freeze({
        ...baseReopenedCycle,
        prioritySnapshot: effectivePriority,
      });

      updatedFeedback = Object.freeze({
        ...feedback,
        status: outcomeSpec.nextFeedbackStatus,
        currentCycleId: newCycle.id,
        authorConfirmedResolution: false,
        updatedAt: now,
      });
    } else {
      updatedFeedback = Object.freeze({
        ...feedback,
        status: outcomeSpec.nextFeedbackStatus,
        updatedAt: now,
      });
    }

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_CONTESTS,
        TRANSACTION_RESOURCES.FEEDBACK_CONTEST_DECISIONS,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.FEEDBACK_SLA_SNAPSHOTS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackContests.appendDecision(decision);
        await this.deps.feedbackContests.saveContest(updatedContest);
        await this.revokeContestAnalyzeGrantsForFeedback(
          validatedOrgId,
          validatedFeedbackId,
          validatedActorId,
          now,
        );
        await this.deps.feedbacks.save(updatedFeedback);
        if (newSlaSnapshot !== undefined && newCycle !== undefined) {
          await this.deps.feedbackSlaSnapshots.save(newSlaSnapshot);
          await this.deps.feedbackCycles.save(newCycle);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.contest.decided',
          resourceType: 'FeedbackContestDecision',
          resourceId: decision.id,
          after: {
            feedbackId: validatedFeedbackId,
            contestId: validatedContestId,
            outcome: decision.outcome,
            divergedFromAnalysis: decision.divergedFromAnalysis,
            nextFeedbackStatus: updatedFeedback.status,
            ...(newCycle !== undefined ? { newCycleId: newCycle.id } : {}),
          },
          justification: decision.justification,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.contest.decided',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackContest',
            aggregateId: validatedContestId,
            payload: {
              feedbackId: validatedFeedbackId,
              contestId: validatedContestId,
              decisionId: decision.id,
              outcome: decision.outcome,
              nextFeedbackStatus: updatedFeedback.status,
              ...(newCycle !== undefined ? { newCycleId: newCycle.id } : {}),
            },
          }),
        );
      },
    );

    return {
      contest: updatedContest,
      decision,
      feedback: updatedFeedback,
      ...(newCycle !== undefined ? { newCycle } : {}),
      ...(newSlaSnapshot !== undefined ? { newSlaSnapshot } : {}),
    };
  }

  async requestExceptionalReopen(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    input: RequestExceptionalReopenInput,
  ): Promise<FeedbackReopenRequest> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const parsed = parseWithZod(
      requestReopenInputSchema,
      input,
      'Invalid exceptional reopen request payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, policyConfig }, feedback] = await Promise.all([
      this.loadActorContext(validatedActorId, validatedOrgId, now),
      this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
    ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_REOPEN_REQUEST,
      resource: buildFeedbackResource(
        validatedOrgId,
        validatedFeedbackId,
        feedback,
        'FEEDBACK_REOPEN',
      ),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    const [currentCycle, existingRequests] = await Promise.all([
      this.deps.feedbackCycles.findById(validatedOrgId, feedback.currentCycleId),
      this.deps.feedbackReopenRequests.listByFeedback(validatedOrgId, validatedFeedbackId),
    ]);

    if (!currentCycle) {
      throw new ConflictError(`Current cycle "${feedback.currentCycleId}" was not found.`);
    }

    const hasPendingReopenRequest = existingRequests.some(
      (req) =>
        req.closedCycleId === currentCycle.id && req.status === REOPEN_REQUEST_STATUSES.PENDING,
    );

    assertExceptionalReopenAllowed({
      cycle: currentCycle,
      hasPendingReopenRequest,
      justification: parsed.justification,
    });

    const requestRecord: FeedbackReopenRequest = Object.freeze({
      id: asFeedbackReopenRequestId(this.nextUuid()),
      organizationId: validatedOrgId,
      feedbackId: validatedFeedbackId,
      closedCycleId: currentCycle.id,
      requestedByUserId: validatedActorId,
      justification: parsed.justification.trim(),
      status: REOPEN_REQUEST_STATUSES.PENDING,
      requestedAt: now,
    });

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FEEDBACK_REOPEN_REQUESTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.feedbackReopenRequests.save(requestRecord);

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType: 'feedback.reopen.requested',
          resourceType: 'FeedbackReopenRequest',
          resourceId: requestRecord.id,
          after: {
            feedbackId: validatedFeedbackId,
            closedCycleId: currentCycle.id,
            status: requestRecord.status,
          },
          justification: requestRecord.justification,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.reopen.requested',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackReopenRequest',
            aggregateId: requestRecord.id,
            payload: {
              feedbackId: validatedFeedbackId,
              requestId: requestRecord.id,
              closedCycleId: currentCycle.id,
            },
          }),
        );
      },
    );

    return requestRecord;
  }

  async decideExceptionalReopen(
    actorUserId: UserId,
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
    requestId: FeedbackReopenRequestId,
    input: DecideExceptionalReopenInput,
  ): Promise<DecideExceptionalReopenResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedFeedbackId = asFeedbackId(feedbackId, 'feedbackId');
    const validatedRequestId = asFeedbackReopenRequestId(requestId, 'requestId');
    const parsed = parseWithZod(
      decideReopenInputSchema,
      input,
      'Invalid exceptional reopen decision payload.',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ orgExists, actor, settings, policyConfig }, feedback, reopenRequest] =
      await Promise.all([
        this.loadActorContext(validatedActorId, validatedOrgId, now),
        this.deps.feedbacks.findById(validatedOrgId, validatedFeedbackId),
        this.deps.feedbackReopenRequests.findById(validatedOrgId, validatedRequestId),
      ]);

    if (!orgExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FEEDBACK_REOPEN_DECIDE,
      resource: buildFeedbackResource(
        validatedOrgId,
        validatedFeedbackId,
        feedback,
        'FEEDBACK_REOPEN',
      ),
      context: { now, policyConfig },
    });

    if (!feedback) {
      throw new NotFoundError(`Feedback "${validatedFeedbackId}" was not found.`);
    }

    if (!reopenRequest || reopenRequest.feedbackId !== validatedFeedbackId) {
      throw new NotFoundError(
        `FeedbackReopenRequest "${validatedRequestId}" was not found for feedback "${validatedFeedbackId}".`,
      );
    }

    if (reopenRequest.status !== REOPEN_REQUEST_STATUSES.PENDING) {
      throw new ConflictError('This exceptional reopen request has already been decided.');
    }

    const trimmedJustification = parsed.justification.trim();
    if (trimmedJustification.length === 0) {
      throw new ValidationError(
        'Deciding an exceptional reopen request requires a non-empty justification.',
        { details: { field: 'justification' } },
      );
    }

    const closedCycle = await this.deps.feedbackCycles.findById(
      validatedOrgId,
      reopenRequest.closedCycleId,
    );
    if (!closedCycle) {
      throw new ConflictError(`Closed cycle "${reopenRequest.closedCycleId}" was not found.`);
    }

    const updatedRequest: FeedbackReopenRequest = Object.freeze({
      ...reopenRequest,
      status: parsed.decision,
      decidedByAdminUserId: validatedActorId,
      decisionJustification: trimmedJustification,
      decidedAt: now,
    });

    let newCycle: FeedbackCycle | undefined;
    let newSlaSnapshot: FeedbackSlaSnapshot | undefined;
    let updatedFeedback: Feedback = feedback;

    if (parsed.decision === REOPEN_REQUEST_STATUSES.APPROVED) {
      let effectiveAssigneeId = closedCycle.assigneeId;
      if (parsed.assigneeId !== undefined) {
        const candidateAssigneeId = asUserId(parsed.assigneeId, 'assigneeId');
        await this.assertTargetHandlerEligible(validatedOrgId, candidateAssigneeId, feedback);
        effectiveAssigneeId = candidateAssigneeId;
      }

      const effectivePriority = parsed.priority ?? closedCycle.prioritySnapshot;
      const newCycleId = asFeedbackCycleId(this.nextUuid());
      const newSnapshotId = asFeedbackSlaSnapshotId(this.nextUuid());

      newSlaSnapshot = createSlaSnapshotFromSettings({
        id: newSnapshotId,
        organizationId: validatedOrgId,
        feedbackId: validatedFeedbackId,
        cycleId: newCycleId,
        priority: effectivePriority,
        settings,
        now,
      });

      const baseCycle = createReopenedFeedbackCycle(
        closedCycle,
        newCycleId,
        CYCLE_ORIGINS.EXCEPTIONAL_REOPEN,
        newSnapshotId,
        now,
      );

      // PRD §15.8: preserve previous assignee & priority as initial values; allow ADMIN override
      newCycle = Object.freeze({
        ...baseCycle,
        prioritySnapshot: effectivePriority,
        ...(closedCycle.assigneeId !== undefined
          ? { initialAssigneeId: closedCycle.assigneeId }
          : {}),
        ...(effectiveAssigneeId !== undefined ? { assigneeId: effectiveAssigneeId } : {}),
      });

      updatedFeedback = Object.freeze({
        ...feedback,
        status: FEEDBACK_STATUSES.IN_PROGRESS,
        priority: effectivePriority,
        ...(effectiveAssigneeId !== undefined ? { assigneeId: effectiveAssigneeId } : {}),
        currentCycleId: newCycle.id,
        authorConfirmedResolution: false,
        closedAt: undefined,
        closureReason: undefined,
        updatedAt: now,
      });
    }

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.FEEDBACK_REOPEN_REQUESTS,
        TRANSACTION_RESOURCES.FEEDBACKS,
        TRANSACTION_RESOURCES.FEEDBACK_CYCLES,
        TRANSACTION_RESOURCES.FEEDBACK_SLA_SNAPSHOTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.feedbackReopenRequests.save(updatedRequest);
        if (
          parsed.decision === REOPEN_REQUEST_STATUSES.APPROVED &&
          newSlaSnapshot !== undefined &&
          newCycle !== undefined
        ) {
          await this.deps.feedbackSlaSnapshots.save(newSlaSnapshot);
          await this.deps.feedbackCycles.save(newCycle);
          await this.deps.feedbacks.save(updatedFeedback);
        }

        await this.deps.auditEvents.append({
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.FEEDBACK,
          eventType:
            parsed.decision === REOPEN_REQUEST_STATUSES.APPROVED
              ? 'feedback.reopen.approved'
              : 'feedback.reopen.rejected',
          resourceType: 'FeedbackReopenRequest',
          resourceId: validatedRequestId,
          after: {
            feedbackId: validatedFeedbackId,
            decision: parsed.decision,
            ...(newCycle !== undefined ? { newCycleId: newCycle.id } : {}),
            ...(newSlaSnapshot !== undefined ? { newSlaSnapshotId: newSlaSnapshot.id } : {}),
          },
          justification: trimmedJustification,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'feedback.reopen.decided',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'FeedbackReopenRequest',
            aggregateId: validatedRequestId,
            payload: {
              feedbackId: validatedFeedbackId,
              requestId: validatedRequestId,
              decision: parsed.decision,
              ...(newCycle !== undefined ? { newCycleId: newCycle.id } : {}),
            },
          }),
        );
      },
    );

    return {
      request: updatedRequest,
      feedback: updatedFeedback,
      ...(newCycle !== undefined ? { newCycle } : {}),
      ...(newSlaSnapshot !== undefined ? { newSlaSnapshot } : {}),
    };
  }

  // ===========================================================================
  // Exportação Segmentada Nativa (JSON e CSV — DN-07)
  // ===========================================================================

  async exportFeedbacks(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: ExportFeedbacksOptions = {},
  ): Promise<FeedbackExportResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      exportFeedbacksOptionsSchema,
      options,
      'Invalid feedback export options (only JSON and CSV are supported in Phase 09).',
    );
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { orgExists, actor, policyConfig } = await this.loadActorContext(
      validatedActorId,
      validatedOrgId,
      now,
    );

    this.assertActiveOrganizationAccess(
      actor,
      orgExists,
      validatedOrgId,
      now,
      policyConfig,
      PERMISSION_CODES.FEEDBACK_EXPORT,
    );

    const requestedFeedbackId =
      parsed.feedbackId !== undefined ? asFeedbackId(parsed.feedbackId, 'feedbackId') : undefined;

    const orgDeny = actor.explicitDenies?.find(
      (rule) =>
        rule.organizationId === validatedOrgId &&
        rule.targetUserId === validatedActorId &&
        (rule.permission === '*' || rule.permission === PERMISSION_CODES.FEEDBACK_EXPORT) &&
        rule.scopeType === PERMISSION_SCOPE_TYPES.ORGANIZATION &&
        isDenyRuleActiveAt(rule, now),
    );
    if (orgDeny !== undefined) {
      throw new AuthorizationError(
        `Actor is not authorized for action "${PERMISSION_CODES.FEEDBACK_EXPORT}" (DENIED_EXPLICIT_DENY).`,
        {
          details: {
            action: PERMISSION_CODES.FEEDBACK_EXPORT,
            reasonCode: 'DENIED_EXPLICIT_DENY',
            matchedDenyId: orgDeny.id,
          },
        },
      );
    }

    let singleFeedback: Feedback | null = null;
    if (requestedFeedbackId !== undefined) {
      singleFeedback = await this.deps.feedbacks.findById(validatedOrgId, requestedFeedbackId);
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_VIEW,
        resource: buildFeedbackResource(validatedOrgId, requestedFeedbackId, singleFeedback),
        context: { now, policyConfig },
      });
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.FEEDBACK_EXPORT,
        resource: buildFeedbackResource(validatedOrgId, requestedFeedbackId, singleFeedback),
        context: { now, policyConfig },
      });
    }

    const candidates =
      requestedFeedbackId !== undefined
        ? singleFeedback !== null
          ? [singleFeedback]
          : []
        : await this.deps.feedbacks.listByOrganization(validatedOrgId, {
            ...(parsed.status !== undefined ? { status: parsed.status } : {}),
            ...(parsed.assigneeId !== undefined
              ? { assigneeId: asUserId(parsed.assigneeId, 'assigneeId') }
              : {}),
            ...(parsed.authorUserId !== undefined
              ? { authorUserId: asUserId(parsed.authorUserId, 'authorUserId') }
              : {}),
          });

    // Item-by-item authorization for both FEEDBACK_VIEW and FEEDBACK_EXPORT (DN-07)
    const visibleFeedbacks = candidates.filter((feedback) => {
      const resource = buildFeedbackResource(validatedOrgId, feedback.id, feedback);
      const canView = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.FEEDBACK_VIEW,
        resource,
        context: { now, policyConfig },
      }).allowed;
      const canExport = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.FEEDBACK_EXPORT,
        resource,
        context: { now, policyConfig },
      }).allowed;
      return canView && canExport;
    });

    const exportItems: FeedbackExportItem[] = [];
    for (const feedback of visibleFeedbacks) {
      const canViewInternalNotes = this.canViewFeedbackInternalNotes(
        actor,
        validatedOrgId,
        feedback,
        now,
        policyConfig,
      );

      const [
        cycles,
        slaSnapshots,
        messages,
        internalNotes,
        allAttachments,
        contests,
        reopenRequests,
      ] = await Promise.all([
        this.deps.feedbackCycles.listByFeedback(validatedOrgId, feedback.id),
        this.deps.feedbackSlaSnapshots.listByFeedback(validatedOrgId, feedback.id),
        this.deps.feedbackMessages.listByFeedback(validatedOrgId, feedback.id),
        canViewInternalNotes
          ? this.deps.feedbackInternalNotes.listByFeedback(validatedOrgId, feedback.id)
          : Promise.resolve([]),
        this.deps.feedbackAttachments.listByFeedback(validatedOrgId, feedback.id),
        this.deps.feedbackContests.listByFeedback(validatedOrgId, feedback.id),
        this.deps.feedbackReopenRequests.listByFeedback(validatedOrgId, feedback.id),
      ]);

      const [analysesPerContest, decisionsPerContest] = await Promise.all([
        Promise.all(
          contests.map((contest) =>
            this.deps.feedbackContests.listAnalyses(validatedOrgId, contest.id),
          ),
        ),
        Promise.all(
          contests.map((contest) =>
            this.deps.feedbackContests.listDecisions(validatedOrgId, contest.id),
          ),
        ),
      ]);

      const publicAttachments = allAttachments.filter((att) => att.internalNoteId === undefined);
      const internalAttachments = canViewInternalNotes
        ? allAttachments.filter((att) => att.internalNoteId !== undefined)
        : [];

      exportItems.push({
        feedback,
        cycles,
        slaSnapshots,
        messages,
        internalNotes,
        publicAttachments,
        internalAttachments,
        contests,
        contestAnalyses: analysesPerContest.flat(),
        contestDecisions: decisionsPerContest.flat(),
        reopenRequests,
      });
    }

    let content: string;
    let mimeType: 'application/json' | 'text/csv';
    let fileName: string;

    if (parsed.format === 'CSV') {
      mimeType = 'text/csv';
      fileName = `feedbacks-export-${validatedOrgId}.csv`;
      const header = [
        'feedbackId',
        'title',
        'moduleKey',
        'categoryId',
        'priority',
        'status',
        'authorUserId',
        'assigneeId',
        'cyclesCount',
        'createdAt',
        'closedAt',
        'closureReason',
        'messagesCount',
        'internalNotesCount',
        'contestsCount',
      ].join(',');

      const rows = exportItems.map((item) => {
        const canSeeInternal = this.canViewFeedbackInternalNotes(
          actor,
          validatedOrgId,
          item.feedback,
          now,
          policyConfig,
        );
        return [
          escapeCsvCell(item.feedback.id),
          escapeCsvCell(item.feedback.title),
          escapeCsvCell(item.feedback.moduleKey),
          escapeCsvCell(item.feedback.categoryId),
          escapeCsvCell(item.feedback.priority),
          escapeCsvCell(item.feedback.status),
          escapeCsvCell(item.feedback.authorUserId),
          escapeCsvCell(item.feedback.assigneeId),
          escapeCsvCell(item.cycles.length),
          escapeCsvCell(item.feedback.createdAt),
          escapeCsvCell(item.feedback.closedAt),
          escapeCsvCell(item.feedback.closureReason),
          escapeCsvCell(item.messages.length),
          escapeCsvCell(canSeeInternal ? item.internalNotes.length : ''),
          escapeCsvCell(item.contests.length),
        ].join(',');
      });

      content = [header, ...rows].join('\n');
    } else {
      mimeType = 'application/json';
      fileName = `feedbacks-export-${validatedOrgId}.json`;
      content = JSON.stringify(
        {
          exportedAt: now,
          organizationId: validatedOrgId,
          totalCount: exportItems.length,
          items: exportItems,
        },
        null,
        2,
      );
    }

    await this.deps.transactionPort.run([TRANSACTION_RESOURCES.AUDIT_EVENTS], async () => {
      await this.deps.auditEvents.append({
        id: asAuditEventId(this.nextUuid()),
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        occurredAt: now,
        category: AUDIT_CATEGORIES.EXPORT,
        eventType: 'feedback.exported',
        resourceType: requestedFeedbackId !== undefined ? 'Feedback' : 'Organization',
        resourceId: requestedFeedbackId ?? validatedOrgId,
        after: {
          format: parsed.format,
          exportedCount: exportItems.length,
        },
        result: AUDIT_RESULTS.SUCCESS,
        correlationId,
      });

      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'feedback.exported',
          occurredAt: now,
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          correlationId,
          aggregateType: requestedFeedbackId !== undefined ? 'Feedback' : 'Organization',
          aggregateId: requestedFeedbackId ?? validatedOrgId,
          payload: {
            format: parsed.format,
            exportedCount: exportItems.length,
          },
        }),
      );
    });

    return {
      organizationId: validatedOrgId,
      format: parsed.format,
      mimeType,
      fileName,
      exportedAt: now,
      totalCount: exportItems.length,
      content,
      items: exportItems,
    };
  }
}
