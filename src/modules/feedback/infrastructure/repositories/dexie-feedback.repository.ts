import Dexie from 'dexie';
import { ConflictError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  parseIsoDateTimeMs,
  type AttachmentId,
  type FeedbackContestId,
  type FeedbackCycleId,
  type FeedbackId,
  type OrganizationId,
  type UserId,
} from '@/shared/kernel';
import {
  appendImmutableEntity,
  filterSoftDeleted,
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
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
} from '../../application/ports/feedback-repository.port';
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
  FeedbackContestAnalysisId,
  FeedbackContestDecision,
  FeedbackContestDecisionId,
  FeedbackContestReason,
  FeedbackContestReasonId,
  FeedbackContestReasonVersion,
  FeedbackContestReasonVersionId,
  FeedbackCycle,
  FeedbackInternalNote,
  FeedbackInternalNoteId,
  FeedbackMessage,
  FeedbackMessageId,
  FeedbackReopenRequest,
  FeedbackReopenRequestId,
  FeedbackSlaSnapshot,
  FeedbackSlaSnapshotId,
  FeedbackStatus,
  ReopenRequestStatus,
} from '../../domain/feedback';

export class DexieFeedbackRepository implements FeedbackRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Feedback, FeedbackId>(TRANSACTION_RESOURCES.FEEDBACKS);
  }

  async findById(organizationId: OrganizationId, feedbackId: FeedbackId): Promise<Feedback | null> {
    return findOrganizationScopedById(this.table, organizationId, feedbackId, 'Feedback');
  }

  async listByOrganization(
    organizationId: OrganizationId,
    filters?: {
      readonly authorUserId?: UserId;
      readonly assigneeId?: UserId;
      readonly status?: FeedbackStatus;
    },
  ): Promise<readonly Feedback[]> {
    return withPersistenceErrorHandling('Feedback.listByOrganization', async () => {
      let records: Feedback[];

      if (filters?.authorUserId !== undefined) {
        records = await this.table
          .where('[organizationId+authorUserId]')
          .equals([organizationId, filters.authorUserId])
          .toArray();
      } else if (filters?.assigneeId !== undefined) {
        records = await this.table
          .where('[organizationId+assigneeId]')
          .equals([organizationId, filters.assigneeId])
          .toArray();
      } else if (filters?.status !== undefined) {
        records = await this.table
          .where('[organizationId+status]')
          .equals([organizationId, filters.status])
          .toArray();
      } else {
        records = await this.table.where('organizationId').equals(organizationId).toArray();
      }

      if (filters?.authorUserId !== undefined && filters?.assigneeId !== undefined) {
        records = records.filter((item) => item.assigneeId === filters.assigneeId);
      }

      if (
        filters?.status !== undefined &&
        (filters?.authorUserId !== undefined || filters?.assigneeId !== undefined)
      ) {
        records = records.filter((item) => item.status === filters.status);
      }

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(feedback: Feedback): Promise<void> {
    await saveOrganizationScopedEntity(this.table, feedback, 'Feedback');
  }
}

export class DexieFeedbackCycleRepository implements FeedbackCycleRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FeedbackCycle, FeedbackCycleId>(TRANSACTION_RESOURCES.FEEDBACK_CYCLES);
  }

  async findById(
    organizationId: OrganizationId,
    cycleId: FeedbackCycleId,
  ): Promise<FeedbackCycle | null> {
    return findOrganizationScopedById(this.table, organizationId, cycleId, 'FeedbackCycle');
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly FeedbackCycle[]> {
    return withPersistenceErrorHandling('FeedbackCycle.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.startedAt) - parseIsoDateTimeMs(b.startedAt) ||
          a.cycleNumber - b.cycleNumber ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackCycle[]> {
    return withPersistenceErrorHandling('FeedbackCycle.listByFeedback', async () => {
      const records = await this.table
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort((a, b) => a.cycleNumber - b.cycleNumber);
    });
  }

  async save(cycle: FeedbackCycle): Promise<void> {
    await saveOrganizationScopedEntity(this.table, cycle, 'FeedbackCycle');
  }
}

export class DexieFeedbackCategoryRepository implements FeedbackCategoryRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get categoryTable() {
    return this.db.getTable<FeedbackCategory, FeedbackCategoryId>(
      TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES,
    );
  }

  private get versionTable() {
    return this.db.getTable<FeedbackCategoryVersion, FeedbackCategoryVersionId>(
      TRANSACTION_RESOURCES.FEEDBACK_CATEGORY_VERSIONS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    categoryId: FeedbackCategoryId,
  ): Promise<FeedbackCategory | null> {
    return findOrganizationScopedById(
      this.categoryTable,
      organizationId,
      categoryId,
      'FeedbackCategory',
    );
  }

  async findByCode(organizationId: OrganizationId, code: string): Promise<FeedbackCategory | null> {
    return withPersistenceErrorHandling('FeedbackCategory.findByCode', async () => {
      const record = await this.categoryTable
        .where('[organizationId+code]')
        .equals([organizationId, code])
        .first();
      return record ?? null;
    });
  }

  async findVersionById(
    organizationId: OrganizationId,
    versionId: FeedbackCategoryVersionId,
  ): Promise<FeedbackCategoryVersion | null> {
    return findOrganizationScopedById(
      this.versionTable,
      organizationId,
      versionId,
      'FeedbackCategoryVersion',
    );
  }

  async listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeInactive?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly FeedbackCategory[]> {
    return withPersistenceErrorHandling('FeedbackCategory.listByOrganization', async () => {
      const records = await this.categoryTable
        .where('organizationId')
        .equals(organizationId)
        .toArray();

      const afterSoftDelete = filterSoftDeleted(records, options?.includeDeleted);
      const filtered =
        options?.includeInactive === true
          ? afterSoftDelete
          : afterSoftDelete.filter((category) => category.active);

      return filtered.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    });
  }

  async listVersions(
    organizationId: OrganizationId,
    categoryId: FeedbackCategoryId,
  ): Promise<readonly FeedbackCategoryVersion[]> {
    return withPersistenceErrorHandling('FeedbackCategory.listVersions', async () => {
      const records = await this.versionTable
        .where('[organizationId+categoryId]')
        .equals([organizationId, categoryId])
        .toArray();

      return records.sort((a, b) => a.versionNumber - b.versionNumber);
    });
  }

  async listAllVersionsByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly FeedbackCategoryVersion[]> {
    return withPersistenceErrorHandling(
      'FeedbackCategory.listAllVersionsByOrganization',
      async () => {
        const records = await this.versionTable
          .where('[organizationId+categoryId]')
          .between([organizationId, Dexie.minKey], [organizationId, Dexie.maxKey], true, true)
          .toArray();

        return records.sort(
          (a, b) => a.categoryId.localeCompare(b.categoryId) || a.versionNumber - b.versionNumber,
        );
      },
    );
  }

  async saveCategory(category: FeedbackCategory): Promise<void> {
    await withPersistenceErrorHandling('FeedbackCategory.saveCategory', async () => {
      const existingByCode = await this.categoryTable
        .where('[organizationId+code]')
        .equals([category.organizationId, category.code])
        .first();
      if (existingByCode !== undefined && existingByCode.id !== category.id) {
        throw new ConflictError(
          `FeedbackCategory code "${category.code}" already exists in organization "${category.organizationId}".`,
          {
            details: {
              organizationId: category.organizationId,
              code: category.code,
            },
          },
        );
      }
    });

    await saveOrganizationScopedEntity(this.categoryTable, category, 'FeedbackCategory');
  }

  async saveVersion(version: FeedbackCategoryVersion): Promise<void> {
    await withPersistenceErrorHandling('FeedbackCategoryVersion.saveVersion', async () => {
      const existingVersion = await this.versionTable
        .where('[organizationId+categoryId+versionNumber]')
        .equals([version.organizationId, version.categoryId, version.versionNumber])
        .first();
      if (existingVersion !== undefined) {
        throw new ConflictError(
          `FeedbackCategoryVersion #${version.versionNumber} already exists for category "${version.categoryId}".`,
          {
            details: {
              organizationId: version.organizationId,
              categoryId: version.categoryId,
              versionNumber: version.versionNumber,
            },
          },
        );
      }
    });

    await appendImmutableEntity(this.versionTable, version, 'FeedbackCategoryVersion');
  }
}

export class DexieFeedbackMessageRepository implements FeedbackMessageRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FeedbackMessage, FeedbackMessageId>(
      TRANSACTION_RESOURCES.FEEDBACK_MESSAGES,
    );
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackMessage[]> {
    return withPersistenceErrorHandling('FeedbackMessage.listByFeedback', async () => {
      const records = await this.table
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async append(message: FeedbackMessage): Promise<void> {
    await appendImmutableEntity(this.table, message, 'FeedbackMessage');
  }
}

export class DexieFeedbackInternalNoteRepository implements FeedbackInternalNoteRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FeedbackInternalNote, FeedbackInternalNoteId>(
      TRANSACTION_RESOURCES.FEEDBACK_INTERNAL_NOTES,
    );
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackInternalNote[]> {
    return withPersistenceErrorHandling('FeedbackInternalNote.listByFeedback', async () => {
      const records = await this.table
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async append(note: FeedbackInternalNote): Promise<void> {
    await appendImmutableEntity(this.table, note, 'FeedbackInternalNote');
  }
}

export class DexieFeedbackAttachmentRepository implements FeedbackAttachmentRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FeedbackAttachment, AttachmentId>(
      TRANSACTION_RESOURCES.FEEDBACK_ATTACHMENTS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    attachmentId: AttachmentId,
  ): Promise<FeedbackAttachment | null> {
    return findOrganizationScopedById(
      this.table,
      organizationId,
      attachmentId,
      'FeedbackAttachment',
    );
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackAttachment[]> {
    return withPersistenceErrorHandling('FeedbackAttachment.listByFeedback', async () => {
      const records = await this.table
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.uploadedAt) - parseIsoDateTimeMs(b.uploadedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(attachment: FeedbackAttachment): Promise<void> {
    await saveOrganizationScopedEntity(this.table, attachment, 'FeedbackAttachment');
  }
}

export class DexieFeedbackContestRepository implements FeedbackContestRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get contestTable() {
    return this.db.getTable<FeedbackContest, FeedbackContestId>(
      TRANSACTION_RESOURCES.FEEDBACK_CONTESTS,
    );
  }

  private get analysisTable() {
    return this.db.getTable<FeedbackContestAnalysis, FeedbackContestAnalysisId>(
      TRANSACTION_RESOURCES.FEEDBACK_CONTEST_ANALYSES,
    );
  }

  private get decisionTable() {
    return this.db.getTable<FeedbackContestDecision, FeedbackContestDecisionId>(
      TRANSACTION_RESOURCES.FEEDBACK_CONTEST_DECISIONS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    contestId: FeedbackContestId,
  ): Promise<FeedbackContest | null> {
    return findOrganizationScopedById(
      this.contestTable,
      organizationId,
      contestId,
      'FeedbackContest',
    );
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackContest[]> {
    return withPersistenceErrorHandling('FeedbackContest.listByFeedback', async () => {
      const records = await this.contestTable
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.openedAt) - parseIsoDateTimeMs(b.openedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByCycle(
    organizationId: OrganizationId,
    cycleId: FeedbackCycleId,
  ): Promise<readonly FeedbackContest[]> {
    return withPersistenceErrorHandling('FeedbackContest.listByCycle', async () => {
      const records = await this.contestTable
        .where('[organizationId+cycleId]')
        .equals([organizationId, cycleId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.openedAt) - parseIsoDateTimeMs(b.openedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByOrganization(
    organizationId: OrganizationId,
    filters?: { readonly status?: ContestStatus },
  ): Promise<readonly FeedbackContest[]> {
    return withPersistenceErrorHandling('FeedbackContest.listByOrganization', async () => {
      const records =
        filters?.status !== undefined
          ? await this.contestTable
              .where('[organizationId+status]')
              .equals([organizationId, filters.status])
              .toArray()
          : await this.contestTable.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.openedAt) - parseIsoDateTimeMs(b.openedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listAnalyses(
    organizationId: OrganizationId,
    contestId: FeedbackContestId,
  ): Promise<readonly FeedbackContestAnalysis[]> {
    return withPersistenceErrorHandling('FeedbackContest.listAnalyses', async () => {
      const records = await this.analysisTable
        .where('[organizationId+contestId]')
        .equals([organizationId, contestId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listDecisions(
    organizationId: OrganizationId,
    contestId: FeedbackContestId,
  ): Promise<readonly FeedbackContestDecision[]> {
    return withPersistenceErrorHandling('FeedbackContest.listDecisions', async () => {
      const records = await this.decisionTable
        .where('[organizationId+contestId]')
        .equals([organizationId, contestId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.decidedAt) - parseIsoDateTimeMs(b.decidedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listDecisionsByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly FeedbackContestDecision[]> {
    return withPersistenceErrorHandling('FeedbackContest.listDecisionsByOrganization', async () => {
      const records = await this.decisionTable
        .where('organizationId')
        .equals(organizationId)
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.decidedAt) - parseIsoDateTimeMs(b.decidedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async saveContest(contest: FeedbackContest): Promise<void> {
    await saveOrganizationScopedEntity(this.contestTable, contest, 'FeedbackContest');
  }

  async appendAnalysis(analysis: FeedbackContestAnalysis): Promise<void> {
    await appendImmutableEntity(this.analysisTable, analysis, 'FeedbackContestAnalysis');
  }

  async appendDecision(decision: FeedbackContestDecision): Promise<void> {
    await appendImmutableEntity(this.decisionTable, decision, 'FeedbackContestDecision');
  }
}

export class DexieFeedbackContestReasonRepository implements FeedbackContestReasonRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get reasonTable() {
    return this.db.getTable<FeedbackContestReason, FeedbackContestReasonId>(
      TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS,
    );
  }

  private get versionTable() {
    return this.db.getTable<FeedbackContestReasonVersion, FeedbackContestReasonVersionId>(
      TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASON_VERSIONS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    reasonId: FeedbackContestReasonId,
  ): Promise<FeedbackContestReason | null> {
    return findOrganizationScopedById(
      this.reasonTable,
      organizationId,
      reasonId,
      'FeedbackContestReason',
    );
  }

  async findByCode(
    organizationId: OrganizationId,
    code: string,
  ): Promise<FeedbackContestReason | null> {
    return withPersistenceErrorHandling('FeedbackContestReason.findByCode', async () => {
      const record = await this.reasonTable
        .where('[organizationId+code]')
        .equals([organizationId, code])
        .first();
      return record ?? null;
    });
  }

  async findVersionById(
    organizationId: OrganizationId,
    versionId: FeedbackContestReasonVersionId,
  ): Promise<FeedbackContestReasonVersion | null> {
    return findOrganizationScopedById(
      this.versionTable,
      organizationId,
      versionId,
      'FeedbackContestReasonVersion',
    );
  }

  async listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeInactive?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly FeedbackContestReason[]> {
    return withPersistenceErrorHandling('FeedbackContestReason.listByOrganization', async () => {
      const records = await this.reasonTable
        .where('organizationId')
        .equals(organizationId)
        .toArray();

      const afterSoftDelete = filterSoftDeleted(records, options?.includeDeleted);
      const filtered =
        options?.includeInactive === true
          ? afterSoftDelete
          : afterSoftDelete.filter((reason) => reason.active);

      return filtered.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    });
  }

  async listVersions(
    organizationId: OrganizationId,
    reasonId: FeedbackContestReasonId,
  ): Promise<readonly FeedbackContestReasonVersion[]> {
    return withPersistenceErrorHandling('FeedbackContestReason.listVersions', async () => {
      const records = await this.versionTable
        .where('[organizationId+reasonId]')
        .equals([organizationId, reasonId])
        .toArray();

      return records.sort((a, b) => a.versionNumber - b.versionNumber);
    });
  }

  async listAllVersionsByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly FeedbackContestReasonVersion[]> {
    return withPersistenceErrorHandling(
      'FeedbackContestReason.listAllVersionsByOrganization',
      async () => {
        const records = await this.versionTable
          .where('[organizationId+reasonId]')
          .between([organizationId, Dexie.minKey], [organizationId, Dexie.maxKey], true, true)
          .toArray();

        return records.sort(
          (a, b) => a.reasonId.localeCompare(b.reasonId) || a.versionNumber - b.versionNumber,
        );
      },
    );
  }

  async saveReason(reason: FeedbackContestReason): Promise<void> {
    await withPersistenceErrorHandling('FeedbackContestReason.saveReason', async () => {
      const existingByCode = await this.reasonTable
        .where('[organizationId+code]')
        .equals([reason.organizationId, reason.code])
        .first();
      if (existingByCode !== undefined && existingByCode.id !== reason.id) {
        throw new ConflictError(
          `FeedbackContestReason code "${reason.code}" already exists in organization "${reason.organizationId}".`,
          {
            details: {
              organizationId: reason.organizationId,
              code: reason.code,
            },
          },
        );
      }
    });

    await saveOrganizationScopedEntity(this.reasonTable, reason, 'FeedbackContestReason');
  }

  async saveVersion(version: FeedbackContestReasonVersion): Promise<void> {
    await withPersistenceErrorHandling('FeedbackContestReasonVersion.saveVersion', async () => {
      const existingVersion = await this.versionTable
        .where('[organizationId+reasonId+versionNumber]')
        .equals([version.organizationId, version.reasonId, version.versionNumber])
        .first();
      if (existingVersion !== undefined) {
        throw new ConflictError(
          `FeedbackContestReasonVersion #${version.versionNumber} already exists for reason "${version.reasonId}".`,
          {
            details: {
              organizationId: version.organizationId,
              reasonId: version.reasonId,
              versionNumber: version.versionNumber,
            },
          },
        );
      }
    });

    await appendImmutableEntity(this.versionTable, version, 'FeedbackContestReasonVersion');
  }
}

export class DexieFeedbackSlaSnapshotRepository implements FeedbackSlaSnapshotRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FeedbackSlaSnapshot, FeedbackSlaSnapshotId>(
      TRANSACTION_RESOURCES.FEEDBACK_SLA_SNAPSHOTS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    snapshotId: FeedbackSlaSnapshotId,
  ): Promise<FeedbackSlaSnapshot | null> {
    return findOrganizationScopedById(
      this.table,
      organizationId,
      snapshotId,
      'FeedbackSlaSnapshot',
    );
  }

  async findByCycleId(
    organizationId: OrganizationId,
    cycleId: FeedbackCycleId,
  ): Promise<FeedbackSlaSnapshot | null> {
    return withPersistenceErrorHandling('FeedbackSlaSnapshot.findByCycleId', async () => {
      const record = await this.table
        .where('[organizationId+cycleId]')
        .equals([organizationId, cycleId])
        .first();
      return record ?? null;
    });
  }

  async listByOrganization(
    organizationId: OrganizationId,
  ): Promise<readonly FeedbackSlaSnapshot[]> {
    return withPersistenceErrorHandling('FeedbackSlaSnapshot.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.capturedAt) - parseIsoDateTimeMs(b.capturedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackSlaSnapshot[]> {
    return withPersistenceErrorHandling('FeedbackSlaSnapshot.listByFeedback', async () => {
      const records = await this.table
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.capturedAt) - parseIsoDateTimeMs(b.capturedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(snapshot: FeedbackSlaSnapshot): Promise<void> {
    await withPersistenceErrorHandling('FeedbackSlaSnapshot.save', async () => {
      const existingForCycle = await this.table
        .where('[organizationId+cycleId]')
        .equals([snapshot.organizationId, snapshot.cycleId])
        .first();
      if (existingForCycle !== undefined) {
        throw new ConflictError(
          `FeedbackSlaSnapshot for cycle "${snapshot.cycleId}" already exists and is immutable.`,
          {
            details: {
              organizationId: snapshot.organizationId,
              cycleId: snapshot.cycleId,
            },
          },
        );
      }
    });

    await appendImmutableEntity(this.table, snapshot, 'FeedbackSlaSnapshot');
  }
}

export class DexieFeedbackReopenRequestRepository implements FeedbackReopenRequestRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FeedbackReopenRequest, FeedbackReopenRequestId>(
      TRANSACTION_RESOURCES.FEEDBACK_REOPEN_REQUESTS,
    );
  }

  async findById(
    organizationId: OrganizationId,
    requestId: FeedbackReopenRequestId,
  ): Promise<FeedbackReopenRequest | null> {
    return findOrganizationScopedById(
      this.table,
      organizationId,
      requestId,
      'FeedbackReopenRequest',
    );
  }

  async listByFeedback(
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ): Promise<readonly FeedbackReopenRequest[]> {
    return withPersistenceErrorHandling('FeedbackReopenRequest.listByFeedback', async () => {
      const records = await this.table
        .where('[organizationId+feedbackId]')
        .equals([organizationId, feedbackId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.requestedAt) - parseIsoDateTimeMs(b.requestedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByOrganization(
    organizationId: OrganizationId,
    filters?: { readonly status?: ReopenRequestStatus },
  ): Promise<readonly FeedbackReopenRequest[]> {
    return withPersistenceErrorHandling('FeedbackReopenRequest.listByOrganization', async () => {
      const records =
        filters?.status !== undefined
          ? await this.table
              .where('[organizationId+status]')
              .equals([organizationId, filters.status])
              .toArray()
          : await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.requestedAt) - parseIsoDateTimeMs(b.requestedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(request: FeedbackReopenRequest): Promise<void> {
    await saveOrganizationScopedEntity(this.table, request, 'FeedbackReopenRequest');
  }
}
