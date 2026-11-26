import type {
  AttachmentId,
  FeedbackContestId,
  FeedbackCycleId,
  FeedbackId,
  OrganizationId,
  UserId,
} from '@/shared/kernel';
import type {
  ContestStatus,
  Feedback,
  FeedbackAttachment,
  FeedbackCategory,
  FeedbackCategoryId,
  FeedbackCategoryVersion,
  FeedbackCategoryVersionId,
  FeedbackContest,
  FeedbackContestAnalysis,
  FeedbackContestDecision,
  FeedbackContestReason,
  FeedbackContestReasonId,
  FeedbackContestReasonVersion,
  FeedbackContestReasonVersionId,
  FeedbackCycle,
  FeedbackInternalNote,
  FeedbackMessage,
  FeedbackReopenRequest,
  FeedbackReopenRequestId,
  FeedbackSlaSnapshot,
  FeedbackSlaSnapshotId,
  FeedbackStatus,
  ReopenRequestStatus,
} from '../../domain/feedback';

export interface FeedbackRepositoryPort {
  findById(organizationId: OrganizationId, feedbackId: FeedbackId): Promise<Feedback | null>;
  listByOrganization(
    organizationId: OrganizationId,
    filters?: {
      readonly authorUserId?: UserId;
      readonly assigneeId?: UserId;
      readonly status?: FeedbackStatus;
    },
  ): Promise<readonly Feedback[]>;
  save(feedback: Feedback): Promise<void>;
}

export interface FeedbackCycleRepositoryPort {
  findById(organizationId: OrganizationId, cycleId: FeedbackCycleId): Promise<FeedbackCycle | null>;
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackCycle[]>;
  save(cycle: FeedbackCycle): Promise<void>;
}

export interface FeedbackCategoryRepositoryPort {
  findById(
    organizationId: OrganizationId,
    categoryId: FeedbackCategoryId,
  ): Promise<FeedbackCategory | null>;
  findByCode(organizationId: OrganizationId, code: string): Promise<FeedbackCategory | null>;
  findVersionById(
    organizationId: OrganizationId,
    versionId: FeedbackCategoryVersionId,
  ): Promise<FeedbackCategoryVersion | null>;
  listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeInactive?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly FeedbackCategory[]>;
  listVersions(
    organizationId: OrganizationId,
    categoryId: FeedbackCategoryId,
  ): Promise<readonly FeedbackCategoryVersion[]>;
  saveCategory(category: FeedbackCategory): Promise<void>;
  saveVersion(version: FeedbackCategoryVersion): Promise<void>;
}

export interface FeedbackMessageRepositoryPort {
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackMessage[]>;
  append(message: FeedbackMessage): Promise<void>;
}

export interface FeedbackInternalNoteRepositoryPort {
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackInternalNote[]>;
  append(note: FeedbackInternalNote): Promise<void>;
}

export interface FeedbackAttachmentRepositoryPort {
  findById(
    organizationId: OrganizationId,
    attachmentId: AttachmentId,
  ): Promise<FeedbackAttachment | null>;
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackAttachment[]>;
  save(attachment: FeedbackAttachment): Promise<void>;
}

export interface FeedbackContestRepositoryPort {
  findById(
    organizationId: OrganizationId,
    contestId: FeedbackContestId,
  ): Promise<FeedbackContest | null>;
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackContest[]>;
  listByCycle(
    organizationId: OrganizationId,
    cycleId: FeedbackCycleId,
  ): Promise<readonly FeedbackContest[]>;
  listByOrganization(
    organizationId: OrganizationId,
    filters?: { readonly status?: ContestStatus },
  ): Promise<readonly FeedbackContest[]>;
  listAnalyses(
    organizationId: OrganizationId,
    contestId: FeedbackContestId,
  ): Promise<readonly FeedbackContestAnalysis[]>;
  listDecisions(
    organizationId: OrganizationId,
    contestId: FeedbackContestId,
  ): Promise<readonly FeedbackContestDecision[]>;
  saveContest(contest: FeedbackContest): Promise<void>;
  appendAnalysis(analysis: FeedbackContestAnalysis): Promise<void>;
  appendDecision(decision: FeedbackContestDecision): Promise<void>;
}

export interface FeedbackContestReasonRepositoryPort {
  findById(
    organizationId: OrganizationId,
    reasonId: FeedbackContestReasonId,
  ): Promise<FeedbackContestReason | null>;
  findByCode(organizationId: OrganizationId, code: string): Promise<FeedbackContestReason | null>;
  findVersionById(
    organizationId: OrganizationId,
    versionId: FeedbackContestReasonVersionId,
  ): Promise<FeedbackContestReasonVersion | null>;
  listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeInactive?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly FeedbackContestReason[]>;
  listVersions(
    organizationId: OrganizationId,
    reasonId: FeedbackContestReasonId,
  ): Promise<readonly FeedbackContestReasonVersion[]>;
  saveReason(reason: FeedbackContestReason): Promise<void>;
  saveVersion(version: FeedbackContestReasonVersion): Promise<void>;
}

export interface FeedbackSlaSnapshotRepositoryPort {
  findById(
    organizationId: OrganizationId,
    snapshotId: FeedbackSlaSnapshotId,
  ): Promise<FeedbackSlaSnapshot | null>;
  findByCycleId(
    organizationId: OrganizationId,
    cycleId: FeedbackCycleId,
  ): Promise<FeedbackSlaSnapshot | null>;
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackSlaSnapshot[]>;
  save(snapshot: FeedbackSlaSnapshot): Promise<void>;
}

export interface FeedbackReopenRequestRepositoryPort {
  findById(
    organizationId: OrganizationId,
    requestId: FeedbackReopenRequestId,
  ): Promise<FeedbackReopenRequest | null>;
  listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackReopenRequest[]>;
  listByOrganization(
    organizationId: OrganizationId,
    filters?: { readonly status?: ReopenRequestStatus },
  ): Promise<readonly FeedbackReopenRequest[]>;
  save(request: FeedbackReopenRequest): Promise<void>;
}
