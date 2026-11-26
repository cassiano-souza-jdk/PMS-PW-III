import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { GRANT_STATUSES, PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import {
  CONTEST_RECOMMENDATIONS,
  CONTEST_STATUSES,
  CYCLE_ORIGINS,
  FEEDBACK_CLOSURE_REASONS,
  FEEDBACK_STATUSES,
  REOPEN_REQUEST_STATUSES,
  type AddFeedbackMessageResult,
  type DecideContestResult,
  type DecideExceptionalReopenResult,
  type EvaluateFeedbackSlasResult,
  type Feedback,
  type FeedbackActorProfile,
  type FeedbackAttachment,
  type FeedbackCategory,
  type FeedbackCategoryWithVersion,
  type FeedbackContest,
  type FeedbackContestAnalysis,
  type FeedbackContestReason,
  type FeedbackContestReasonWithVersion,
  type FeedbackDetail,
  type FeedbackExportResult,
  type FeedbackInternalNote,
  type FeedbackListResult,
  type FeedbackReopenRequest,
  type FeedbackSlaSettingsView,
} from '@/modules/feedback';
import { asOrganizationMemberId } from '@/modules/organizations';
import {
  AuthorizationError,
  ConflictError,
  InfrastructureError,
  ValidationError,
} from '@/shared/errors';
import {
  PRIORITIES,
  asCorrelationId,
  asEntityId,
  asIsoDate,
  asIsoDateTime,
  asOrganizationId,
  asUserId,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_FEEDBACK_IDS,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  createAppContainer,
  createMswHandlers,
  type AppCompositionContainer,
} from './index';

const BASE_NOW = asIsoDateTime('2026-05-04T09:00:00.000Z'); // Monday 09:00 UTC
const SECOND_MANAGER_ID = asUserId('11111111-1111-4111-8111-111111111288');
const OTHER_MEMBER_ID = asUserId('11111111-1111-4111-8111-111111111289');
const OTHER_ORG_ID = asOrganizationId('99999999-9999-4999-8999-999999999901');

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function fromBase64(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8');
}

describe('Phase 09 — FeedbackService, Anti-Cycle Adapter, Dexie Complements & MSW §12 Integration', () => {
  let server: SetupServer;
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeAll(() => {
    server = setupServer();
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    currentNow = BASE_NOW;
    container = createAppContainer({
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_f09_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
      now: () => currentNow,
    });
    await ensureDatabaseOpen(container.db);
    await container.seedDemoOrganization(BASE_NOW);

    server.use(
      ...createMswHandlers({
        repositories: container.repositories,
        transactionPort: container.transactionPort,
        eventBus: container.eventBus,
        simulationController: container.simulationController,
        attachmentBlobStore: container.attachmentBlobStore,
        now: () => currentNow,
      }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    server.resetHandlers();
    container.simulationController.clearRules();
    if (container.db.isOpen()) {
      container.db.close();
    }
    await container.db.delete();
  });

  async function seedAdditionalMembers(): Promise<void> {
    await container.repositories.users.users.save({
      id: SECOND_MANAGER_ID,
      email: 'manager2@pms.demo',
      displayName: 'Segundo Gestor Demo',
      acceptedTermsAt: BASE_NOW,
      emailVerifiedSimulated: true,
      createdAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
    await container.repositories.organizations.organizationMembers.save({
      id: asOrganizationMemberId('11111111-1111-4111-8111-111111111388'),
      organizationId: DEMO_ORG_ID,
      userId: SECOND_MANAGER_ID,
      role: 'MANAGER',
      status: 'ACTIVE',
      joinedAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });

    await container.repositories.users.users.save({
      id: OTHER_MEMBER_ID,
      email: 'member2@pms.demo',
      displayName: 'Segundo Membro Demo',
      acceptedTermsAt: BASE_NOW,
      emailVerifiedSimulated: true,
      createdAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
    await container.repositories.organizations.organizationMembers.save({
      id: asOrganizationMemberId('11111111-1111-4111-8111-111111111389'),
      organizationId: DEMO_ORG_ID,
      userId: OTHER_MEMBER_ID,
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
  }

  async function getActiveCategoryId(code = 'SECURITY'): Promise<string> {
    const categories = await container.httpClient.get<readonly FeedbackCategoryWithVersion[]>(
      `/organizations/${DEMO_ORG_ID}/feedback-categories`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    const found = categories.find((item) => item.category.code === code) ?? categories[0];
    if (!found) {
      throw new Error('Expected seeded feedback category.');
    }
    return found.category.id;
  }

  async function getActiveReasonId(code = 'PROBLEM_PERSISTS'): Promise<string> {
    const reasons = await container.httpClient.get<readonly FeedbackContestReasonWithVersion[]>(
      `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    const found = reasons.find((item) => item.reason.code === code) ?? reasons[0];
    if (!found) {
      throw new Error('Expected seeded contest reason.');
    }
    return found.reason.id;
  }

  it('filters feedbacks item-by-item by FEEDBACK_VIEW before totals/counts, blocks cross-org, and calculates SLA live without Dexie writes', async () => {
    await seedAdditionalMembers();
    const securityCategoryId = await getActiveCategoryId('SECURITY');

    const member2Feedback = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      {
        moduleKey: 'tasks',
        categoryId: securityCategoryId,
        title: 'Feedback exclusivo do segundo membro',
        description: 'Este feedback nao deve vazar para outro membro ou gestor nao atribuido.',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: OTHER_MEMBER_ID },
    );

    const managerFeedback = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      {
        moduleKey: 'projects',
        categoryId: securityCategoryId,
        title: 'Feedback aberto pelo gestor 2',
        description: 'Apenas gestor 2 e admin visualizam este item.',
        priority: PRIORITIES.LOW,
      },
      { actorUserId: SECOND_MANAGER_ID },
    );

    const saveCycleSpy = vi.spyOn(container.repositories.feedback.feedbackCycles, 'save');
    const saveFeedbackSpy = vi.spyOn(container.repositories.feedback.feedbacks, 'save');

    // Advance time to verify live SLA calculation without writing to Dexie (DN-05)
    currentNow = asIsoDateTime('2026-05-04T15:00:00.000Z');

    const adminList = await container.httpClient.get<FeedbackListResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(adminList.totalCount).toBe(4); // 2 demo seeded + 2 created

    const member1List = await container.httpClient.get<FeedbackListResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(member1List.totalCount).toBe(2);
    expect(member1List.items.map((item) => item.feedback.id)).not.toContain(member2Feedback.id);
    expect(member1List.items.map((item) => item.feedback.id)).not.toContain(managerFeedback.id);

    const member2List = await container.httpClient.get<FeedbackListResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      { actorUserId: OTHER_MEMBER_ID },
    );
    expect(member2List.totalCount).toBe(1);
    expect(member2List.countsByStatus.RECEIVED).toBe(1);
    expect(member2List.countsByStatus.IN_PROGRESS).toBe(0);
    expect(member2List.items[0]?.feedback.id).toBe(member2Feedback.id);
    expect(member2List.items[0]?.slaStatus.firstResponseStatus).toBe('BREACHED');

    const manager1List = await container.httpClient.get<FeedbackListResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(manager1List.totalCount).toBe(1);
    expect(manager1List.items[0]?.feedback.id).toBe(DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG);

    // Pure GET reads must NEVER write to Dexie (DN-05)
    expect(saveCycleSpy).not.toHaveBeenCalled();
    expect(saveFeedbackSpy).not.toHaveBeenCalled();

    // Cross-organization access rejected
    await expect(
      container.httpClient.get<FeedbackListResult>(`/organizations/${OTHER_ORG_ID}/feedbacks`, {
        actorUserId: DEMO_ADMIN_USER_ID,
      }),
    ).rejects.toThrow();

    await expect(
      container.httpClient.get<FeedbackDetail>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${member2Feedback.id}`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it('enforces DN-04 segregation on assignFeedback, internal notes, internal attachments and DN-03 immutable SLA snapshot on triage', async () => {
    await seedAdditionalMembers();
    const securityCategoryId = await getActiveCategoryId('SECURITY');
    const usabilityCategoryId = await getActiveCategoryId('USABILITY');

    // MANAGER 2 opens a feedback
    const created = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      {
        moduleKey: 'kanban',
        categoryId: securityCategoryId,
        title: 'Validacao de segregacao de funcoes em feedback de gestor',
        description: 'Gestor autor nao pode ser atribuido nem ler notas internas.',
        priority: PRIORITIES.CRITICAL,
      },
      { actorUserId: SECOND_MANAGER_ID },
    );

    // DN-04: ADMIN cannot assign feedback to non-ADMIN author (ConflictError 409)
    await expect(
      container.httpClient.post<Feedback>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/assign`,
        { assigneeId: SECOND_MANAGER_ID },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    // ADMIN cannot assign to MEMBER
    await expect(
      container.httpClient.post<Feedback>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/assign`,
        { assigneeId: DEMO_MEMBER_USER_ID },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    // ADMIN assigns to MANAGER 1
    const assigned = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/assign`,
      { assigneeId: DEMO_MANAGER_USER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(assigned.status).toBe(FEEDBACK_STATUSES.ASSIGNED);
    expect(assigned.assigneeId).toBe(DEMO_MANAGER_USER_ID);

    // DN-03: Assigned MANAGER without explicit FEEDBACK_STATUS_MANAGE grant cannot change priority/category (403)
    await expect(
      container.httpClient.patch<Feedback>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/triage`,
        { priority: PRIORITIES.LOW },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    // ADMIN changes priority & category -> SLA snapshot and cycle.prioritySnapshot stay 100% immutable (DN-03)
    const detailBefore = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    const triaged = await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/triage`,
      { priority: PRIORITIES.LOW, categoryId: usabilityCategoryId },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(triaged.priority).toBe(PRIORITIES.LOW);
    expect(triaged.categoryId).toBe(usabilityCategoryId);

    const detailAfterTriage = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(detailAfterTriage.currentCycle.prioritySnapshot).toBe(PRIORITIES.CRITICAL);
    expect(detailAfterTriage.currentSlaSnapshot).toEqual(detailBefore.currentSlaSnapshot);

    // Assigned MANAGER creates an internal note + internal attachment
    const internalNote = await container.httpClient.post<FeedbackInternalNote>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/internal-notes`,
      {
        body: 'Analise interna confidencial com mencao ao autor.',
        mentionedUserIds: [SECOND_MANAGER_ID],
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(internalNote.mentionedUserIds).toEqual([SECOND_MANAGER_ID]);

    const internalAttachment = await container.httpClient.post<FeedbackAttachment>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/attachments`,
      {
        fileName: 'diagnostico-interno.txt',
        mimeType: 'text/plain',
        contentBase64: toBase64('log secreto interno'),
        internalNoteId: internalNote.id,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(internalAttachment.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // Even with a resource grant on FEEDBACK_INTERNAL_NOTE_VIEW, non-ADMIN author (SECOND_MANAGER_ID) is blocked (DN-04)
    await container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
      granteeUserId: SECOND_MANAGER_ID,
      permission: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(created.id),
      reason: 'Attempted grant test for DN-04 author segregation',
    });

    const authorView = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}`,
      { actorUserId: SECOND_MANAGER_ID },
    );
    expect(authorView.canViewInternalNotes).toBe(false);
    expect(authorView.internalNotes).toEqual([]);
    expect(authorView.internalAttachments).toEqual([]);

    // Author blocked from creating internal note or downloading internal attachment
    await expect(
      container.httpClient.post<FeedbackInternalNote>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/internal-notes`,
        { body: 'Autor tentando escrever nota interna' },
        { actorUserId: SECOND_MANAGER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const getBlobSpy = vi.spyOn(container.attachmentBlobStore, 'getBlob');
    await expect(
      container.httpClient.get(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/attachments/${internalAttachment.id}/download`,
        { actorUserId: SECOND_MANAGER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    expect(getBlobSpy).not.toHaveBeenCalled();

    // Assigned MANAGER CAN download internal attachment and Base64 roundtrip matches
    const downloaded = await container.httpClient.get<{
      readonly attachment: FeedbackAttachment;
      readonly mimeType: string;
      readonly contentBase64: string;
    }>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/attachments/${internalAttachment.id}/download`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(fromBase64(downloaded.contentBase64)).toBe('log secreto interno');

    // Disallowed MIME type rejected with ValidationError (422)
    await expect(
      container.httpClient.post<FeedbackAttachment>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/attachments`,
        {
          fileName: 'xss.svg',
          mimeType: 'image/svg+xml',
          contentBase64: toBase64('<svg onload="alert(1)"/>'),
        },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    // QuotaExceededError handled non-destructively without deleting existing data
    vi.spyOn(container.attachmentBlobStore, 'putBlob').mockRejectedValueOnce(
      Object.assign(new Error('QuotaExceededError: Storage quota exceeded'), {
        name: 'QuotaExceededError',
      }),
    );

    await expect(
      container.httpClient.post<FeedbackAttachment>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}/attachments`,
        {
          fileName: 'evidencia.txt',
          mimeType: 'text/plain',
          contentBase64: toBase64('conteudo valido'),
        },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(InfrastructureError);

    const afterQuotaFailure = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${created.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(afterQuotaFailure.internalNotes).toHaveLength(1);
    expect(afterQuotaFailure.internalAttachments).toHaveLength(1);
  });

  it('handles WAITING_INFO pauses, author auto-resume, SLA evaluation with escalation & auto-close preserving RESOLVED, and catalog soft-delete protection', async () => {
    const securityCategoryId = await getActiveCategoryId('SECURITY');

    // Configure SLA settings (ADMIN-only)
    await expect(
      container.httpClient.patch<FeedbackSlaSettingsView>(
        `/organizations/${DEMO_ORG_ID}/settings/feedback-sla`,
        { feedbackManifestationWindowMs: 24 * 60 * 60 * 1000 },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const updatedSla = await container.httpClient.patch<FeedbackSlaSettingsView>(
      `/organizations/${DEMO_ORG_ID}/settings/feedback-sla`,
      {
        calendar: {
          mode: 'BUSINESS_HOURS',
          workDaysOfWeekUtc: [1, 2, 3, 4, 5],
          workStartHourUtc: 9,
          workEndHourUtc: 18,
          breakIntervalsUtc: [{ startHour: 12, endHour: 13 }],
          holidayDates: [asIsoDate('2026-05-05')], // Tuesday holiday
        },
        slaPoliciesByPriority: {
          HIGH: {
            firstResponseTargetMs: 2 * 60 * 60 * 1000, // 2h
            resolutionTargetMs: 6 * 60 * 60 * 1000, // 6h
          },
        },
        feedbackManifestationWindowMs: 24 * 60 * 60 * 1000, // 1 day
        feedbackContestWindowMs: 48 * 60 * 60 * 1000, // 2 days
      },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(updatedSla.calendar.holidayDates).toEqual(['2026-05-05']);

    // Create feedback at Mon 09:00 UTC
    currentNow = asIsoDateTime('2026-05-04T09:00:00.000Z');
    const feedback = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      {
        moduleKey: 'analytics',
        categoryId: securityCategoryId,
        title: 'Fluxo SLA com WAITING_INFO e feriado',
        description: 'Testando pausa e retomada automatica ao responder.',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );

    await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/assign`,
      { assigneeId: DEMO_MANAGER_USER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    // At Mon 10:00 UTC: move to WAITING_INFO -> records open pause + firstRespondedAt
    currentNow = asIsoDateTime('2026-05-04T10:00:00.000Z');
    const waiting = await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
      { targetStatus: FEEDBACK_STATUSES.WAITING_INFO },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(waiting.status).toBe(FEEDBACK_STATUSES.WAITING_INFO);

    // At Wed 10:00 UTC (Tue was holiday): author sends public message -> auto-resumes IN_PROGRESS and closes pause!
    currentNow = asIsoDateTime('2026-05-06T10:00:00.000Z');
    const messageResult = await container.httpClient.post<AddFeedbackMessageResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/messages`,
      { body: 'Aqui estao os prints solicitados.' },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(messageResult.resumedFromWaitingInfo).toBe(true);
    expect(messageResult.feedback.status).toBe(FEEDBACK_STATUSES.IN_PROGRESS);
    expect(messageResult.cycle.waitingInfoPauses).toEqual([
      {
        startedAt: '2026-05-04T10:00:00.000Z',
        endedAt: '2026-05-06T10:00:00.000Z',
      },
    ]);

    // At Wed 15:00 UTC: elapsed resolution = 1h (Mon 9-10) + 4h (Wed 10-12 + 13-15) = 5h of 6h -> 83.3% WARNING
    currentNow = asIsoDateTime('2026-05-06T15:00:00.000Z');
    const evalWarning = await container.httpClient.post<EvaluateFeedbackSlasResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/evaluate-sla`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(evalWarning.warningCount).toBeGreaterThanOrEqual(1);

    const detailAfterWarning = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const firstWarningTimestamp = detailAfterWarning.currentCycle.resolutionWarningAt;
    expect(firstWarningTimestamp).toBe(currentNow);

    // At Wed 17:00 UTC: elapsed resolution = 7h > 6h -> BREACHED + escalatedAt WITHOUT changing assigneeId
    currentNow = asIsoDateTime('2026-05-06T17:00:00.000Z');
    await container.httpClient.post<EvaluateFeedbackSlasResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/evaluate-sla`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const detailAfterBreach = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(detailAfterBreach.currentCycle.resolutionWarningAt).toBe(firstWarningTimestamp); // deduplicated!
    expect(detailAfterBreach.currentCycle.resolutionBreachedAt).toBe(currentNow);
    expect(detailAfterBreach.currentCycle.escalatedAt).toBe(currentNow);
    expect(detailAfterBreach.feedback.assigneeId).toBe(DEMO_MANAGER_USER_ID);

    // Transition to RESOLVED requires resolutionDescription (422 if missing)
    await expect(
      container.httpClient.patch<Feedback>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
        { targetStatus: FEEDBACK_STATUSES.RESOLVED, resolutionDescription: '   ' },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    const resolved = await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Painel de analytics atualizado.',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(resolved.status).toBe(FEEDBACK_STATUSES.RESOLVED);

    // Advance past 48h contest window -> evaluate-sla auto-closes preserving status = RESOLVED & authorConfirmedResolution = false
    currentNow = asIsoDateTime('2026-05-09T18:00:00.000Z');
    const evalAutoClose = await container.httpClient.post<EvaluateFeedbackSlasResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/evaluate-sla`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(evalAutoClose.autoClosedCount).toBeGreaterThanOrEqual(1);

    const detailAfterAutoClose = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailAfterAutoClose.feedback.status).toBe(FEEDBACK_STATUSES.RESOLVED);
    expect(detailAfterAutoClose.feedback.closedAt).toBe(currentNow);
    expect(detailAfterAutoClose.feedback.closureReason).toBe(
      FEEDBACK_CLOSURE_REASONS.EXPIRED_WITHOUT_CONTEST,
    );
    expect(detailAfterAutoClose.feedback.authorConfirmedResolution).toBe(false);

    // Catalog versioning & soft-delete protection (DN-02): used category -> 409; unused -> 200
    await expect(
      container.httpClient.delete(
        `/organizations/${DEMO_ORG_ID}/feedback-categories/${securityCategoryId}`,
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    const customCat = await container.httpClient.post<FeedbackCategoryWithVersion>(
      `/organizations/${DEMO_ORG_ID}/feedback-categories`,
      { code: 'TEMP_CAT', name: 'Categoria Temporaria' },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const updatedCat = await container.httpClient.patch<FeedbackCategoryWithVersion>(
      `/organizations/${DEMO_ORG_ID}/feedback-categories/${customCat.category.id}`,
      { name: 'Categoria Temporaria v2' },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(updatedCat.currentVersion.versionNumber).toBe(2);
    expect(updatedCat.versions).toHaveLength(2);

    const deletedCat = await container.httpClient.delete<FeedbackCategoryWithVersion['category']>(
      `/organizations/${DEMO_ORG_ID}/feedback-categories/${customCat.category.id}`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(deletedCat.deletedAt).toBe(currentNow);
  });

  it('orchestrates contestation delegation + PermissionGrant sync, ADMIN decision, exceptional reopen, and segmented JSON/CSV export', async () => {
    await seedAdditionalMembers();
    const emittedEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      emittedEvents.push(event);
    });

    const reasonId = await getActiveReasonId('PROBLEM_PERSISTS');
    const securityCategoryId = await getActiveCategoryId('SECURITY');

    const feedback = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      {
        moduleKey: 'dependencies',
        categoryId: securityCategoryId,
        title: 'Fluxo completo de contestacao e reabertura excepcional',
        description: 'Validar delegacao, parecer, decisao, reabertura e exportacao.',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );

    await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/assign`,
      { assigneeId: DEMO_MANAGER_USER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Ajuste inicial entregue.',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    // Author opens contest within deadline
    const contest = await container.httpClient.post<FeedbackContest>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests`,
      {
        reasonId,
        justification: 'O erro continua ocorrendo apos recarregar a pagina.',
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(contest.status).toBe(CONTEST_STATUSES.OPEN);

    // Used contest reason cannot be deleted (409 Conflict — DN-02)
    await expect(
      container.httpClient.delete(
        `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons/${reasonId}`,
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    // ADMIN delegates contest analysis to MANAGER 1 -> creates PermissionGrant atomically
    const delegated1 = await container.httpClient.post<FeedbackContest>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/delegate`,
      { analystUserId: DEMO_MANAGER_USER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(delegated1.delegatedAnalystUserId).toBe(DEMO_MANAGER_USER_ID);
    expect(delegated1.status).toBe(CONTEST_STATUSES.IN_ANALYSIS);

    const grantsAfterFirstDelegate =
      await container.repositories.authorization.permissionGrants.listActiveByGrantee(
        DEMO_ORG_ID,
        DEMO_MANAGER_USER_ID,
        currentNow,
      );
    expect(
      grantsAfterFirstDelegate.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE &&
          g.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
          g.scopeId === asEntityId(feedback.id),
      ),
    ).toBe(true);

    // Re-delegating to SECOND_MANAGER_ID atomically revokes MANAGER 1's grant
    await container.httpClient.post<FeedbackContest>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/delegate`,
      { analystUserId: SECOND_MANAGER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    const grantsManager1AfterRedelegate =
      await container.repositories.authorization.permissionGrants.listActiveByGrantee(
        DEMO_ORG_ID,
        DEMO_MANAGER_USER_ID,
        currentNow,
      );
    expect(
      grantsManager1AfterRedelegate.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE &&
          g.scopeId === asEntityId(feedback.id),
      ),
    ).toBe(false);

    // Delegated analyst submits structured immutable parecer
    const analysis = await container.httpClient.post<FeedbackContestAnalysis>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/analysis`,
      {
        recommendation: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
        summary: 'Em teste inicial nao reproduziu.',
      },
      { actorUserId: SECOND_MANAGER_ID },
    );
    expect(analysis.recommendation).toBe(CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION);

    // MANAGER cannot issue final decision (403)
    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/decision`,
        {
          outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
          justification: 'Tentativa sem papel ADMIN.',
        },
        { actorUserId: SECOND_MANAGER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    // ADMIN diverges from analysis -> must provide non-empty justification (422 if blank)
    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/decision`,
        {
          outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
          justification: '   ',
        },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    // ADMIN accepts contestation -> revokes analyst grant, closes contest, spawns cycle #2 CONTESTATION_REOPEN
    const decided = await container.httpClient.post<DecideContestResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/decision`,
      {
        outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        justification: 'Logs anexados comprovaram regressao; retomando atendimento.',
      },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(decided.contest.status).toBe(CONTEST_STATUSES.CLOSED);
    expect(decided.decision.divergedFromAnalysis).toBe(true);
    expect(decided.feedback.status).toBe(FEEDBACK_STATUSES.IN_PROGRESS);
    expect(decided.newCycle?.cycleNumber).toBe(2);
    expect(decided.newCycle?.origin).toBe(CYCLE_ORIGINS.CONTESTATION_REOPEN);
    expect(decided.newCycle?.initialAssigneeId).toBe(DEMO_MANAGER_USER_ID);

    const grantsManager2AfterDecision =
      await container.repositories.authorization.permissionGrants.listByGrantee(
        DEMO_ORG_ID,
        SECOND_MANAGER_ID,
      );
    expect(
      grantsManager2AfterDecision.every(
        (g) => g.scopeId !== asEntityId(feedback.id) || g.status === GRANT_STATUSES.REVOKED,
      ),
    ).toBe(true);

    // Resolve cycle #2, let it auto-close by expiration, then run Exceptional Reopen
    await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Correcao definitiva aplicada no ciclo 2.',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    currentNow = asIsoDateTime('2026-05-20T12:00:00.000Z');
    await container.httpClient.post<EvaluateFeedbackSlasResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/evaluate-sla`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    // Author requests exceptional reopen -> feedback remains closed while PENDING
    const reopenReq = await container.httpClient.post<FeedbackReopenRequest>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/reopen-requests`,
      { justification: 'Estava ausente e o sintoma retornou apos expiracao.' },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(reopenReq.status).toBe(REOPEN_REQUEST_STATUSES.PENDING);

    const whilePending = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(whilePending.feedback.closedAt).toBe(currentNow);

    // ADMIN approves exceptional reopen -> creates cycle #3 EXCEPTIONAL_REOPEN preserving initialAssigneeId
    const reopenDecision = await container.httpClient.post<DecideExceptionalReopenResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/reopen-requests/${reopenReq.id}/decision`,
      {
        decision: REOPEN_REQUEST_STATUSES.APPROVED,
        justification: 'Reabertura excepcional autorizada pela administracao.',
      },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(reopenDecision.feedback.status).toBe(FEEDBACK_STATUSES.IN_PROGRESS);
    expect(reopenDecision.newCycle?.cycleNumber).toBe(3);
    expect(reopenDecision.newCycle?.origin).toBe(CYCLE_ORIGINS.EXCEPTIONAL_REOPEN);
    expect(reopenDecision.newCycle?.initialAssigneeId).toBe(DEMO_MANAGER_USER_ID);
    expect(reopenDecision.newCycle?.assigneeId).toBe(DEMO_MANAGER_USER_ID);

    // Resolve cycle #3 and author confirms explicitly -> CLOSED + authorConfirmedResolution = true
    await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Validado em conjunto no ciclo 3.',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    const confirmed = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/confirm-resolution`,
      {},
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(confirmed.status).toBe(FEEDBACK_STATUSES.CLOSED);
    expect(confirmed.closureReason).toBe(FEEDBACK_CLOSURE_REASONS.CONFIRMED_BY_AUTHOR);
    expect(confirmed.authorConfirmedResolution).toBe(true);

    // Add an internal note on DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG is already seeded; verify segmented export (DN-07)
    const memberExportJson = await container.httpClient.get<FeedbackExportResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/export?format=JSON`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(memberExportJson.totalCount).toBe(3);
    for (const item of memberExportJson.items) {
      expect(item.internalNotes).toEqual([]);
      expect(item.internalAttachments).toEqual([]);
    }

    const adminExportCsv = await container.httpClient.get<FeedbackExportResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/export?format=CSV`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(adminExportCsv.mimeType).toBe('text/csv');
    expect(adminExportCsv.content).toContain('feedbackId,title,moduleKey');
    expect(adminExportCsv.items.some((item) => item.internalNotes.length > 0)).toBe(true);

    const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
      DEMO_ORG_ID,
      {
        page: 1,
        pageSize: 50,
      },
    );
    expect(auditPage.items.some((evt) => evt.category === AUDIT_CATEGORIES.EXPORT)).toBe(true);
    expect(emittedEvents.some((evt) => evt.eventType === 'feedback.exported')).toBe(true);
  });

  it('F09-T08: allows assigned MANAGER with explicit FEEDBACK_STATUS_MANAGE grant (DN-03), blocks under ExplicitDenyRule, and syncs paired FEEDBACK_VIEW grant on contest delegation', async () => {
    await seedAdditionalMembers();
    const securityCategoryId = await getActiveCategoryId('SECURITY');
    const usabilityCategoryId = await getActiveCategoryId('USABILITY');
    const reasonId = await getActiveReasonId('PROBLEM_PERSISTS');

    const feedback = await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks`,
      {
        moduleKey: 'kanban',
        categoryId: securityCategoryId,
        title: 'Regressao F09-T08 triagem DN-03 e delegacao contestacao',
        description:
          'Validar grant explicito para MANAGER atribuido e grant pareado de visualizacao.',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );

    await container.httpClient.post<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/assign`,
      { assigneeId: DEMO_MANAGER_USER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    // Assigned MANAGER without explicit grant -> canUpdateTriage is false
    const detailWithoutGrant = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(detailWithoutGrant.capabilities.canManageStatus).toBe(true);
    expect(detailWithoutGrant.capabilities.canUpdateTriage).toBe(false);

    // Grant explicit FEEDBACK_STATUS_MANAGE to already-assigned MANAGER
    await container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
      granteeUserId: DEMO_MANAGER_USER_ID,
      permission: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(feedback.id),
      reason: 'Explicit triage grant for assigned manager (DN-03)',
    });

    const detailWithGrant = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(detailWithGrant.capabilities.canUpdateTriage).toBe(true);

    const triagedByManager = await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/triage`,
      { priority: PRIORITIES.CRITICAL, categoryId: usabilityCategoryId },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(triagedByManager.priority).toBe(PRIORITIES.CRITICAL);
    expect(triagedByManager.categoryId).toBe(usabilityCategoryId);

    // ExplicitDenyRule overrides explicit grant on both capability and mutation
    const denyRule = await container.services.authorization.createExplicitDenyRule(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      {
        targetUserId: DEMO_MANAGER_USER_ID,
        permission: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
        scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
        scopeId: asEntityId(feedback.id),
        reason: 'Deny overrides explicit triage grant',
      },
    );

    const detailWithDeny = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(detailWithDeny.capabilities.canManageStatus).toBe(false);
    expect(detailWithDeny.capabilities.canUpdateTriage).toBe(false);

    await expect(
      container.httpClient.patch<Feedback>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/triage`,
        { priority: PRIORITIES.LOW },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    await container.services.authorization.revokeExplicitDenyRule(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      denyRule.id,
    );

    // Resolve and open contest
    await container.httpClient.patch<Feedback>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/status`,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Entrega inicial concluida.',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    const contest = await container.httpClient.post<FeedbackContest>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests`,
      {
        reasonId,
        justification: 'Ainda reproduz em ambiente de homologacao.',
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );

    // Manual FEEDBACK_VIEW grant must remain intact after delegation & decision revocations
    const manualViewGrant = await container.services.authorization.grantPermission(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      {
        granteeUserId: SECOND_MANAGER_ID,
        permission: PERMISSION_CODES.FEEDBACK_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
        scopeId: asEntityId(feedback.id),
        reason: 'Manual audit review access',
      },
    );

    // Delegate to SECOND_MANAGER_ID (non-ADMIN and not assigneeId) -> paired FEEDBACK_VIEW grant created
    await container.httpClient.post<FeedbackContest>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/delegate`,
      { analystUserId: SECOND_MANAGER_ID },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    const secondManagerActiveGrants =
      await container.repositories.authorization.permissionGrants.listActiveByGrantee(
        DEMO_ORG_ID,
        SECOND_MANAGER_ID,
        currentNow,
      );
    expect(
      secondManagerActiveGrants.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE &&
          g.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
          g.scopeId === asEntityId(feedback.id),
      ),
    ).toBe(true);
    expect(
      secondManagerActiveGrants.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_VIEW &&
          g.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
          g.scopeId === asEntityId(feedback.id) &&
          g.reason.startsWith('Delegated contest analysis view for feedback "'),
      ),
    ).toBe(true);
    expect(
      secondManagerActiveGrants.some(
        (g) => g.permission === PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
      ),
    ).toBe(false);

    // SECOND_MANAGER_ID can inspect feedback detail without internal notes
    const delegatedDetail = await container.httpClient.get<FeedbackDetail>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}`,
      { actorUserId: SECOND_MANAGER_ID },
    );
    expect(delegatedDetail.canViewInternalNotes).toBe(false);
    expect(delegatedDetail.internalNotes).toEqual([]);

    // Decide contest -> revokes analyze + delegated view grants, preserves manual view grant
    await container.httpClient.post<DecideContestResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${feedback.id}/contests/${contest.id}/decision`,
      {
        outcome: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
        justification: 'Validado em conjunto.',
      },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    const secondManagerGrantsAfterDecision =
      await container.repositories.authorization.permissionGrants.listByGrantee(
        DEMO_ORG_ID,
        SECOND_MANAGER_ID,
      );
    const delegatedViewAfterDecision = secondManagerGrantsAfterDecision.find((g) =>
      g.reason.startsWith('Delegated contest analysis view for feedback "'),
    );
    expect(delegatedViewAfterDecision?.status).toBe(GRANT_STATUSES.REVOKED);
    const analyzeAfterDecision = secondManagerGrantsAfterDecision.find(
      (g) => g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE,
    );
    expect(analyzeAfterDecision?.status).toBe(GRANT_STATUSES.REVOKED);
    const manualAfterDecision = secondManagerGrantsAfterDecision.find(
      (g) => g.id === manualViewGrant.id,
    );
    expect(manualAfterDecision?.status).toBe(GRANT_STATUSES.ACTIVE);
  });

  it('covers remaining §12 HTTP endpoints (assignable-handlers, GET settings/feedback-sla, catalog reorder & contest-reason CRUD, query filters, binary Base64<->Uint8Array roundtrip, invalid Base64/charset MIME 422, correlationId propagation, and persisted cross-org 403 isolation)', async () => {
    await seedAdditionalMembers();
    const correlationId = asCorrelationId('77777777-7777-4777-8777-777777777701');
    const emittedEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((evt) => {
      emittedEvents.push(evt);
    });

    // 1. GET assignable-handlers (ADMIN 200 vs MEMBER/MANAGER 403)
    await expect(
      container.httpClient.get<readonly FeedbackActorProfile[]>(
        `/organizations/${DEMO_ORG_ID}/feedbacks/assignable-handlers`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const handlers = await container.httpClient.get<readonly FeedbackActorProfile[]>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/assignable-handlers`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(handlers.some((h) => h.userId === DEMO_ADMIN_USER_ID)).toBe(true);
    expect(handlers.some((h) => h.userId === DEMO_MANAGER_USER_ID)).toBe(true);
    expect(handlers.some((h) => h.userId === DEMO_MEMBER_USER_ID)).toBe(false);

    // 2. GET settings/feedback-sla (ADMIN 200 vs MANAGER 403)
    await expect(
      container.httpClient.get<FeedbackSlaSettingsView>(
        `/organizations/${DEMO_ORG_ID}/settings/feedback-sla`,
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const slaSettings = await container.httpClient.get<FeedbackSlaSettingsView>(
      `/organizations/${DEMO_ORG_ID}/settings/feedback-sla`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(slaSettings.organizationId).toBe(DEMO_ORG_ID);

    // 3. Categories ?includeInactive=true & reorder
    await expect(
      container.httpClient.get<readonly FeedbackCategoryWithVersion[]>(
        `/organizations/${DEMO_ORG_ID}/feedback-categories?includeInactive=true`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const allCats = await container.httpClient.get<readonly FeedbackCategoryWithVersion[]>(
      `/organizations/${DEMO_ORG_ID}/feedback-categories?includeInactive=true`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const reversedCatIds = [...allCats].reverse().map((item) => item.category.id);
    const reorderedCats = await container.httpClient.post<readonly FeedbackCategory[]>(
      `/organizations/${DEMO_ORG_ID}/feedback-categories/reorder`,
      { orderedIds: reversedCatIds },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(reorderedCats.map((c) => c.id)).toEqual(reversedCatIds);

    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/feedback-categories/reorder`,
        { orderedIds: reversedCatIds.slice(0, 1) },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    // 4. Contest Reasons CRUD + ?includeInactive=true + reorder + soft-delete unused
    await expect(
      container.httpClient.get<readonly FeedbackContestReasonWithVersion[]>(
        `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons?includeInactive=true`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const createdReason = await container.httpClient.post<FeedbackContestReasonWithVersion>(
      `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons`,
      { code: 'NEW_EVIDENCE_E2E', name: 'Nova evidência técnica', active: true },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const updatedReason = await container.httpClient.patch<FeedbackContestReasonWithVersion>(
      `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons/${createdReason.reason.id}`,
      { name: 'Nova evidência técnica v2', active: false },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(updatedReason.currentVersion.versionNumber).toBe(2);
    expect(updatedReason.reason.active).toBe(false);

    const allReasons = await container.httpClient.get<readonly FeedbackContestReasonWithVersion[]>(
      `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons?includeInactive=true`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const reversedReasonIds = [...allReasons].reverse().map((r) => r.reason.id);
    const reorderedReasons = await container.httpClient.post<readonly FeedbackContestReason[]>(
      `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons/reorder`,
      { orderedIds: reversedReasonIds },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(reorderedReasons.map((r) => r.id)).toEqual(reversedReasonIds);

    const softDeletedReason = await container.httpClient.delete<FeedbackContestReason>(
      `/organizations/${DEMO_ORG_ID}/feedback-contest-reasons/${createdReason.reason.id}`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(softDeletedReason.deletedAt).toBe(currentNow);

    // 5. Binary Base64 <-> Uint8Array attachment roundtrip + invalid Base64 & charset MIME 422 + messageId link
    const messageResult = await container.httpClient.post<AddFeedbackMessageResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}/messages`,
      { body: 'Mensagem vinculada ao anexo binário PNG.' },
      { actorUserId: DEMO_MEMBER_USER_ID, correlationId },
    );
    expect(
      emittedEvents.some(
        (evt) =>
          evt.eventType === 'feedback.message.created' && evt.correlationId === correlationId,
      ),
    ).toBe(true);

    const pngHeaderBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff,
    ]);
    const pngBase64 = Buffer.from(pngHeaderBytes).toString('base64');

    const uploadedBin = await container.httpClient.post<FeedbackAttachment>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}/attachments`,
      {
        fileName: 'captura.png',
        mimeType: 'image/png',
        contentBase64: pngBase64,
        messageId: messageResult.message.id,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(uploadedBin.messageId).toBe(messageResult.message.id);

    const downloadedBin = await container.httpClient.get<{
      readonly attachment: FeedbackAttachment;
      readonly mimeType: string;
      readonly contentBase64: string;
    }>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}/attachments/${uploadedBin.id}/download`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(downloadedBin.mimeType).toBe('image/png');
    expect(new Uint8Array(Buffer.from(downloadedBin.contentBase64, 'base64'))).toEqual(
      pngHeaderBytes,
    );

    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}/attachments`,
        {
          fileName: 'invalido.txt',
          mimeType: 'text/plain',
          contentBase64: '!!!not-valid-base64!!!',
        },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/feedbacks/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}/attachments`,
        {
          fileName: 'payload.html',
          mimeType: 'text/html; charset=utf-8',
          contentBase64: toBase64('<script>alert(1)</script>'),
        },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    // 6. List query filters & single-feedback export filter
    const filteredList = await container.httpClient.get<FeedbackListResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks?status=IN_PROGRESS&moduleKey=kanban&priority=HIGH&search=WIP&page=1&pageSize=1`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(filteredList.totalCount).toBe(1);
    expect(filteredList.items[0]?.feedback.id).toBe(DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG);

    const singleExport = await container.httpClient.get<FeedbackExportResult>(
      `/organizations/${DEMO_ORG_ID}/feedbacks/export?format=JSON&feedbackId=${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(singleExport.totalCount).toBe(1);
    expect(singleExport.items[0]?.feedback.id).toBe(DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG);
    expect(singleExport.items[0]?.internalNotes).toEqual([]);

    // 7. Persisted second organization Org B -> strict 403 AuthorizationError cross-org isolation
    const { organization: orgB } = await container.services.organizations.createOrganization(
      SECOND_MANAGER_ID,
      { name: 'Second Org B', slug: 'second-org-b' },
    );
    const orgBCat = await container.services.feedback.createFeedbackCategory(
      SECOND_MANAGER_ID,
      orgB.id,
      { code: 'ORG_B_ONLY', name: 'Org B Only' },
    );

    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/feedbacks`, {
        actorUserId: DEMO_ADMIN_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.post(
        `/organizations/${orgB.id}/feedbacks`,
        {
          moduleKey: 'general',
          categoryId: orgBCat.category.id,
          title: 'Cross org attempt',
          description: 'Tentativa cross-org via MSW.',
        },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/settings/feedback-sla`, {
        actorUserId: DEMO_ADMIN_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.post(
        `/organizations/${orgB.id}/feedbacks/evaluate-sla`,
        {},
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/feedbacks/export?format=JSON`, {
        actorUserId: DEMO_ADMIN_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});
