import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { GRANT_STATUSES, PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import {
  CONTEST_RECOMMENDATIONS,
  CONTEST_STATUSES,
  CYCLE_ORIGINS,
  FEEDBACK_CLOSURE_REASONS,
  FEEDBACK_STATUSES,
  REOPEN_REQUEST_STATUSES,
  type FeedbackCategoryWithVersion,
  type FeedbackContestReasonWithVersion,
} from '@/modules/feedback';
import { asOrganizationMemberId } from '@/modules/organizations';
import {
  AuthorizationError,
  ConflictError,
  InfrastructureError,
  ValidationError,
} from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  asAttachmentId,
  asCorrelationId,
  asEntityId,
  asIsoDate,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
  type OrganizationId,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

const BASE_NOW = asIsoDateTime('2026-11-16T09:00:00.000Z'); // Monday 09:00 UTC
const HOUR_MS = 60 * 60 * 1000;

describe('FeedbackService Integration (Dexie, SLA, Segregation DN-01..DN-07, Attachments, Contests, Reopen, Export & Cross-Org)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = BASE_NOW;
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_feedback_svc_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.db.isOpen()) {
      container.db.close();
    }
    await container.db.delete();
  });

  async function registerUser(email: string, displayName: string) {
    return container.services.auth.registerUser({
      email,
      password: 'PasswordForte!2026',
      displayName,
      acceptTerms: true,
      persistent: true,
    });
  }

  async function setupTwoOrgsFixture() {
    const adminA = await registerUser('admin.a@feedback.local', 'Admin Org A');
    const managerA1 = await registerUser('manager.a1@feedback.local', 'Gestor A1');
    const managerA2 = await registerUser('manager.a2@feedback.local', 'Gestor A2');
    const memberA1 = await registerUser('member.a1@feedback.local', 'Membro A1');
    const memberA2 = await registerUser('member.a2@feedback.local', 'Membro A2');
    const adminB = await registerUser('admin.b@feedback.local', 'Admin Org B');

    const { organization: orgA } = await container.services.organizations.createOrganization(
      adminA.user.id,
      {
        name: 'Feedback Org A',
        slug: 'feedback-org-a',
      },
    );
    const { organization: orgB } = await container.services.organizations.createOrganization(
      adminB.user.id,
      {
        name: 'Feedback Org B',
        slug: 'feedback-org-b',
      },
    );

    for (const [userId, role] of [
      [managerA1.user.id, ORGANIZATION_ROLES.MANAGER],
      [managerA2.user.id, ORGANIZATION_ROLES.MANAGER],
      [memberA1.user.id, ORGANIZATION_ROLES.MEMBER],
      [memberA2.user.id, ORGANIZATION_ROLES.MEMBER],
    ] as const) {
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: orgA.id,
        userId,
        role,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });
    }

    const catBug: FeedbackCategoryWithVersion =
      await container.services.feedback.createFeedbackCategory(adminA.user.id, orgA.id, {
        code: 'BUG_ERROR',
        name: 'Bug / Erro',
      });
    const catImprovement: FeedbackCategoryWithVersion =
      await container.services.feedback.createFeedbackCategory(adminA.user.id, orgA.id, {
        code: 'IMPROVEMENT',
        name: 'Melhoria',
      });
    const reasonPersists: FeedbackContestReasonWithVersion =
      await container.services.feedback.createFeedbackContestReason(adminA.user.id, orgA.id, {
        code: 'PROBLEM_PERSISTS',
        name: 'Problema persiste',
      });

    const catOrgB = await container.services.feedback.createFeedbackCategory(
      adminB.user.id,
      orgB.id,
      {
        code: 'ORG_B_CAT',
        name: 'Categoria Org B',
      },
    );

    return {
      orgAId: orgA.id,
      orgBId: orgB.id,
      adminAId: adminA.user.id,
      managerA1Id: managerA1.user.id,
      managerA2Id: managerA2.user.id,
      memberA1Id: memberA1.user.id,
      memberA2Id: memberA2.user.id,
      adminBId: adminB.user.id,
      catBugId: catBug.category.id,
      catImprovementId: catImprovement.category.id,
      reasonPersistsId: reasonPersists.reason.id,
      catOrgBId: catOrgB.category.id,
    };
  }

  async function expectEventsRecordedFor(
    orgId: OrganizationId,
    expectedTypes: readonly string[],
    correlationId: string,
  ) {
    const page = await container.repositories.audit.auditEvents.listByOrganization(orgId, {
      page: 1,
      pageSize: 100,
    });
    const matching = page.items.filter((evt) => evt.correlationId === correlationId);
    expect(matching.map((evt) => evt.eventType)).toEqual(
      expect.arrayContaining([...expectedTypes]),
    );
    return matching;
  }

  it('covers all 7 canonical states, invalid transitions, orthogonal closure (author confirmation vs expiration preserving RESOLVED) and post-commit events', async () => {
    const f = await setupTwoOrgsFixture();
    const publishedEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      publishedEvents.push(event);
    });

    const corr1 = asCorrelationId(crypto.randomUUID());
    const created = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'kanban',
      categoryId: f.catBugId,
      title: 'Erro ao arrastar cartão entre colunas',
      description: 'O cartão retorna para a coluna original quando o WIP está no limite.',
      priority: PRIORITIES.HIGH,
      correlationId: corr1,
    });
    expect(created.status).toBe(FEEDBACK_STATUSES.RECEIVED);

    // Cannot transition to ASSIGNED without assigneeId
    await expect(
      container.services.feedback.transitionFeedbackStatus(f.adminAId, f.orgAId, created.id, {
        targetStatus: FEEDBACK_STATUSES.ASSIGNED,
      }),
    ).rejects.toThrow(ConflictError);

    // 1 -> 2: RECEIVED -> IN_ANALYSIS
    const inAnalysis = await container.services.feedback.transitionFeedbackStatus(
      f.adminAId,
      f.orgAId,
      created.id,
      { targetStatus: FEEDBACK_STATUSES.IN_ANALYSIS },
    );
    expect(inAnalysis.status).toBe(FEEDBACK_STATUSES.IN_ANALYSIS);

    // 2 -> 3: assignFeedback transitions IN_ANALYSIS -> ASSIGNED
    const assigned = await container.services.feedback.assignFeedback(
      f.adminAId,
      f.orgAId,
      created.id,
      { assigneeId: f.managerA1Id },
    );
    expect(assigned.status).toBe(FEEDBACK_STATUSES.ASSIGNED);
    expect(assigned.assigneeId).toBe(f.managerA1Id);

    // Same-status transition rejected
    await expect(
      container.services.feedback.transitionFeedbackStatus(f.managerA1Id, f.orgAId, created.id, {
        targetStatus: FEEDBACK_STATUSES.ASSIGNED,
      }),
    ).rejects.toThrow(ConflictError);

    // 3 -> 4: ASSIGNED -> IN_PROGRESS
    currentNow = asIsoDateTime('2026-11-16T10:00:00.000Z');
    const inProgress = await container.services.feedback.transitionFeedbackStatus(
      f.managerA1Id,
      f.orgAId,
      created.id,
      { targetStatus: FEEDBACK_STATUSES.IN_PROGRESS },
    );
    expect(inProgress.status).toBe(FEEDBACK_STATUSES.IN_PROGRESS);

    // 4 -> 5: IN_PROGRESS -> WAITING_INFO
    currentNow = asIsoDateTime('2026-11-16T11:00:00.000Z');
    const waiting = await container.services.feedback.transitionFeedbackStatus(
      f.managerA1Id,
      f.orgAId,
      created.id,
      { targetStatus: FEEDBACK_STATUSES.WAITING_INFO },
    );
    expect(waiting.status).toBe(FEEDBACK_STATUSES.WAITING_INFO);

    // Transition to RESOLVED requires non-empty resolutionDescription
    await expect(
      container.services.feedback.transitionFeedbackStatus(f.managerA1Id, f.orgAId, created.id, {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: '   ',
      }),
    ).rejects.toThrow(ValidationError);

    // 5 -> 6: WAITING_INFO -> RESOLVED (closes waitingInfoPause)
    currentNow = asIsoDateTime('2026-11-16T12:00:00.000Z');
    const resolved = await container.services.feedback.transitionFeedbackStatus(
      f.managerA1Id,
      f.orgAId,
      created.id,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Ajustada validação de limite WIP na borda do quadro.',
      },
    );
    expect(resolved.status).toBe(FEEDBACK_STATUSES.RESOLVED);

    // MANAGER cannot administratively transition RESOLVED -> CLOSED
    await expect(
      container.services.feedback.transitionFeedbackStatus(f.managerA1Id, f.orgAId, created.id, {
        targetStatus: FEEDBACK_STATUSES.CLOSED,
      }),
    ).rejects.toThrow(AuthorizationError);

    // Non-author cannot confirm resolution
    await expect(
      container.services.feedback.confirmFeedbackResolution(f.adminAId, f.orgAId, created.id),
    ).rejects.toThrow(AuthorizationError);

    // 6 -> 7: Author confirms resolution -> CLOSED + authorConfirmedResolution = true
    currentNow = asIsoDateTime('2026-11-16T13:00:00.000Z');
    const closedByAuthor = await container.services.feedback.confirmFeedbackResolution(
      f.memberA1Id,
      f.orgAId,
      created.id,
    );
    expect(closedByAuthor.status).toBe(FEEDBACK_STATUSES.CLOSED);
    expect(closedByAuthor.closedAt).toBe(currentNow);
    expect(closedByAuthor.closureReason).toBe(FEEDBACK_CLOSURE_REASONS.CONFIRMED_BY_AUTHOR);
    expect(closedByAuthor.authorConfirmedResolution).toBe(true);

    // Terminal state CLOSED blocks further transitions and messages
    await expect(
      container.services.feedback.transitionFeedbackStatus(f.adminAId, f.orgAId, created.id, {
        targetStatus: FEEDBACK_STATUSES.IN_PROGRESS,
      }),
    ).rejects.toThrow(ConflictError);
    await expect(
      container.services.feedback.addFeedbackMessage(f.memberA1Id, f.orgAId, created.id, {
        body: 'Tentativa após encerramento',
      }),
    ).rejects.toThrow(ConflictError);

    // Second feedback: orthogonal auto-closure by expiration preserves status = RESOLVED & authorConfirmedResolution = false
    currentNow = BASE_NOW;
    const second = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'tasks',
      categoryId: f.catImprovementId,
      title: 'Feedback para expiração sem contestação',
      description: 'Validando preservação do status RESOLVED ao expirar janela.',
      priority: PRIORITIES.LOW,
    });
    await container.services.feedback.transitionFeedbackStatus(f.adminAId, f.orgAId, second.id, {
      targetStatus: FEEDBACK_STATUSES.RESOLVED,
      resolutionDescription: 'Implementado conforme especificado.',
    });

    const settings = await container.services.feedback.getFeedbackSlaSettings(f.adminAId, f.orgAId);
    const maxWindowMs = Math.max(
      settings.feedbackManifestationWindowMs,
      settings.feedbackContestWindowMs,
    );
    currentNow = asIsoDateTime(
      new Date(Date.parse(BASE_NOW) + maxWindowMs + HOUR_MS).toISOString(),
    );
    const evalRes = await container.services.feedback.evaluateFeedbackSlas(f.adminAId, f.orgAId);
    expect(evalRes.autoClosedCount).toBe(1);

    const secondDetail = await container.services.feedback.getFeedbackDetail(
      f.memberA1Id,
      f.orgAId,
      second.id,
    );
    expect(secondDetail.feedback.status).toBe(FEEDBACK_STATUSES.RESOLVED);
    expect(secondDetail.feedback.closedAt).toBe(currentNow);
    expect(secondDetail.feedback.closureReason).toBe(
      FEEDBACK_CLOSURE_REASONS.EXPIRED_WITHOUT_CONTEST,
    );
    expect(secondDetail.feedback.authorConfirmedResolution).toBe(false);

    // Verify audit events & post-commit events
    const corrAudit = await expectEventsRecordedFor(f.orgAId, ['feedback.created'], corr1);
    expect(corrAudit[0]?.category).toBe(AUDIT_CATEGORIES.FEEDBACK);
    expect(publishedEvents.some((e) => e.eventType === 'feedback.resolution.confirmed')).toBe(true);
    expect(publishedEvents.some((e) => e.eventType === 'feedback.sla.evaluated')).toBe(true);
  });

  it('suspends RESOLUTION (never FIRST_RESPONSE) on WAITING_INFO, auto-resumes only on author message (DN-06), evaluates CONTINUOUS vs BUSINESS_HOURS, deduplicates escalation without altering assignee, and keeps SLA snapshot immutable (DN-03)', async () => {
    const f = await setupTwoOrgsFixture();

    // Configure BUSINESS_HOURS with lunch break 12-13 UTC and Tuesday holiday 2026-11-17
    await container.services.feedback.updateFeedbackSlaSettings(f.adminAId, f.orgAId, {
      calendar: {
        mode: 'BUSINESS_HOURS',
        workDaysOfWeekUtc: [1, 2, 3, 4, 5],
        workStartHourUtc: 9,
        workEndHourUtc: 18,
        breakIntervalsUtc: [{ startHour: 12, endHour: 13 }],
        holidayDates: [asIsoDate('2026-11-17')],
      },
      slaPoliciesByPriority: {
        CRITICAL: {
          firstResponseTargetMs: 2 * HOUR_MS,
          resolutionTargetMs: 6 * HOUR_MS,
        },
      },
    });

    // Feedback 1: stays RECEIVED so we verify FIRST_RESPONSE WARNING (0.8 * 2h = 1h36m) & BREACHED (>2h) + escalatedAt deduplication
    currentNow = asIsoDateTime('2026-11-16T09:00:00.000Z'); // Mon 09:00
    const fbFirstResp = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'analytics',
      categoryId: f.catBugId,
      title: 'Monitoramento de alerta preventivo e violação de 1ª resposta',
      description: 'Testando limiar 0.8 e deduplicação de escalonamento.',
      priority: PRIORITIES.CRITICAL,
    });
    await container.services.feedback.assignFeedback(f.adminAId, f.orgAId, fbFirstResp.id, {
      assigneeId: f.managerA1Id,
    });

    // At Mon 10:40 UTC (1h40m elapsed >= 1h36m = 80% of 2h) -> WARNING
    currentNow = asIsoDateTime('2026-11-16T10:40:00.000Z');
    const warnEval = await container.services.feedback.evaluateFeedbackSlas(f.adminAId, f.orgAId);
    expect(warnEval.warningCount).toBeGreaterThanOrEqual(1);
    const detailWarn = await container.services.feedback.getFeedbackDetail(
      f.adminAId,
      f.orgAId,
      fbFirstResp.id,
    );
    const frWarningAt = detailWarn.currentCycle.firstResponseWarningAt;
    expect(frWarningAt).toBe(currentNow);
    expect(detailWarn.currentCycle.firstResponseBreachedAt).toBeUndefined();
    expect(detailWarn.currentCycle.escalatedAt).toBeUndefined();

    // At Mon 11:30 UTC (2h30m > 2h) -> BREACHED + escalatedAt WITHOUT changing assigneeId
    currentNow = asIsoDateTime('2026-11-16T11:30:00.000Z');
    await container.services.feedback.evaluateFeedbackSlas(f.adminAId, f.orgAId);
    const detailBreach1 = await container.services.feedback.getFeedbackDetail(
      f.adminAId,
      f.orgAId,
      fbFirstResp.id,
    );
    expect(detailBreach1.currentCycle.firstResponseBreachedAt).toBe(currentNow);
    expect(detailBreach1.currentCycle.escalatedAt).toBe(currentNow);
    expect(detailBreach1.feedback.assigneeId).toBe(f.managerA1Id);

    // Re-evaluating later never overwrites deduplicated timestamps
    currentNow = asIsoDateTime('2026-11-16T14:00:00.000Z');
    await container.services.feedback.evaluateFeedbackSlas(f.adminAId, f.orgAId);
    const detailBreach2 = await container.services.feedback.getFeedbackDetail(
      f.adminAId,
      f.orgAId,
      fbFirstResp.id,
    );
    expect(detailBreach2.currentCycle.firstResponseWarningAt).toBe(frWarningAt);
    expect(detailBreach2.currentCycle.firstResponseBreachedAt).toBe(
      detailBreach1.currentCycle.firstResponseBreachedAt,
    );
    expect(detailBreach2.currentCycle.escalatedAt).toBe(detailBreach1.currentCycle.escalatedAt);

    // Feedback 2: WAITING_INFO pause freezes RESOLUTION elapsed, non-author message keeps WAITING_INFO, author message auto-resumes IN_PROGRESS
    currentNow = asIsoDateTime('2026-11-16T09:00:00.000Z');
    const fbPause = await container.services.feedback.createFeedback(f.memberA2Id, f.orgAId, {
      moduleKey: 'focus',
      categoryId: f.catBugId,
      title: 'Feedback com pausa WAITING_INFO e feriado',
      description: 'Pausa deve congelar SLA de resolução e retomar apenas com mensagem do autor.',
      priority: PRIORITIES.CRITICAL,
    });
    await container.services.feedback.assignFeedback(f.adminAId, f.orgAId, fbPause.id, {
      assigneeId: f.managerA2Id,
    });

    // Mon 10:00 -> WAITING_INFO (1h elapsed)
    currentNow = asIsoDateTime('2026-11-16T10:00:00.000Z');
    await container.services.feedback.transitionFeedbackStatus(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
      {
        targetStatus: FEEDBACK_STATUSES.WAITING_INFO,
      },
    );

    // Advance into Wed 10:00 (skipping Mon 10-18, Tue holiday, Wed 09-10): RESOLUTION elapsed remains frozen at 1h!
    currentNow = asIsoDateTime('2026-11-18T10:00:00.000Z');
    const pausedDetail = await container.services.feedback.getFeedbackDetail(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
    );
    expect(pausedDetail.slaStatus.resolutionElapsedMs).toBe(1 * HOUR_MS);

    // Non-author (assigned MANAGER) sends public message -> does NOT resume WAITING_INFO
    const managerMsgRes = await container.services.feedback.addFeedbackMessage(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
      { body: 'Ainda aguardando print da tela.' },
    );
    expect(managerMsgRes.resumedFromWaitingInfo).toBe(false);
    expect(managerMsgRes.feedback.status).toBe(FEEDBACK_STATUSES.WAITING_INFO);
    expect(managerMsgRes.cycle.waitingInfoPauses).toHaveLength(1);
    expect(managerMsgRes.cycle.waitingInfoPauses?.[0]?.endedAt).toBeUndefined();

    // Author sends public message at Wed 11:00 -> auto-resumes IN_PROGRESS and closes pause (DN-06)
    currentNow = asIsoDateTime('2026-11-18T11:00:00.000Z');
    const authorMsgRes = await container.services.feedback.addFeedbackMessage(
      f.memberA2Id,
      f.orgAId,
      fbPause.id,
      { body: 'Segue print solicitado.' },
    );
    expect(authorMsgRes.resumedFromWaitingInfo).toBe(true);
    expect(authorMsgRes.feedback.status).toBe(FEEDBACK_STATUSES.IN_PROGRESS);
    expect(authorMsgRes.cycle.waitingInfoPauses).toEqual([
      {
        startedAt: '2026-11-16T10:00:00.000Z',
        endedAt: '2026-11-18T11:00:00.000Z',
      },
    ]);

    // At Wed 14:00 (1h Mon 09-10 + 1h Wed 11-12 + 1h Wed 13-14 = 3h effective)
    currentNow = asIsoDateTime('2026-11-18T14:00:00.000Z');
    const resumedDetail = await container.services.feedback.getFeedbackDetail(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
    );
    expect(resumedDetail.slaStatus.resolutionElapsedMs).toBe(3 * HOUR_MS);

    // DN-03: Assigned MANAGER without explicit grant has canUpdateTriage === false and cannot triage;
    // with explicit FEEDBACK_STATUS_MANAGE grant has canUpdateTriage === true and CAN triage while SLA snapshot stays immutable;
    // ExplicitDenyRule overrides the explicit grant.
    expect(resumedDetail.capabilities.canManageStatus).toBe(true);
    expect(resumedDetail.capabilities.canUpdateTriage).toBe(false);
    await expect(
      container.services.feedback.updateFeedbackTriage(f.managerA2Id, f.orgAId, fbPause.id, {
        priority: PRIORITIES.LOW,
      }),
    ).rejects.toThrow(AuthorizationError);

    await container.services.authorization.grantPermission(f.adminAId, f.orgAId, {
      granteeUserId: f.managerA2Id,
      permission: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(fbPause.id),
      reason: 'Autorizar triagem pontual para gestor atribuído (DN-03)',
    });

    const detailWithTriageGrant = await container.services.feedback.getFeedbackDetail(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
    );
    expect(detailWithTriageGrant.capabilities.canUpdateTriage).toBe(true);

    const snapBefore = resumedDetail.currentSlaSnapshot;
    const triaged = await container.services.feedback.updateFeedbackTriage(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
      { priority: PRIORITIES.LOW, categoryId: f.catImprovementId },
    );
    expect(triaged.priority).toBe(PRIORITIES.LOW);
    expect(triaged.categoryId).toBe(f.catImprovementId);
    const afterTriageDetail = await container.services.feedback.getFeedbackDetail(
      f.adminAId,
      f.orgAId,
      fbPause.id,
    );
    expect(afterTriageDetail.currentCycle.prioritySnapshot).toBe(PRIORITIES.CRITICAL);
    expect(afterTriageDetail.currentSlaSnapshot).toEqual(snapBefore);

    const triageDenyRule = await container.services.authorization.createExplicitDenyRule(
      f.adminAId,
      f.orgAId,
      {
        targetUserId: f.managerA2Id,
        permission: PERMISSION_CODES.FEEDBACK_STATUS_MANAGE,
        scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
        scopeId: asEntityId(fbPause.id),
        reason: 'ExplicitDenyRule deve sobrescrever grant explícito de triagem (DN-03)',
      },
    );
    const detailWithTriageDeny = await container.services.feedback.getFeedbackDetail(
      f.managerA2Id,
      f.orgAId,
      fbPause.id,
    );
    expect(detailWithTriageDeny.capabilities.canManageStatus).toBe(false);
    expect(detailWithTriageDeny.capabilities.canUpdateTriage).toBe(false);
    await expect(
      container.services.feedback.updateFeedbackTriage(f.managerA2Id, f.orgAId, fbPause.id, {
        priority: PRIORITIES.HIGH,
      }),
    ).rejects.toThrow(AuthorizationError);
    await container.services.authorization.revokeExplicitDenyRule(
      f.adminAId,
      f.orgAId,
      triageDenyRule.id,
    );

    // Switch settings to CONTINUOUS mode -> new feedback counts 24/7 including weekend
    await container.services.feedback.updateFeedbackSlaSettings(f.adminAId, f.orgAId, {
      calendar: {
        mode: 'CONTINUOUS',
        workDaysOfWeekUtc: [0, 1, 2, 3, 4, 5, 6],
        workStartHourUtc: 0,
        workEndHourUtc: 24,
        breakIntervalsUtc: [],
        holidayDates: [],
      },
    });

    currentNow = asIsoDateTime('2026-11-21T10:00:00.000Z'); // Saturday
    const fbContinuous = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'kanban',
      categoryId: f.catBugId,
      title: 'Feedback em regime CONTINUOUS',
      description: 'Deve contar horas corridas inclusive no fim de semana.',
      priority: PRIORITIES.CRITICAL,
    });
    currentNow = asIsoDateTime('2026-11-22T10:00:00.000Z'); // Sunday (+24h)
    const continuousDetail = await container.services.feedback.getFeedbackDetail(
      f.adminAId,
      f.orgAId,
      fbContinuous.id,
    );
    expect(continuousDetail.slaStatus.firstResponseElapsedMs).toBe(24 * HOUR_MS);
    expect(continuousDetail.slaStatus.firstResponseStatus).toBe('BREACHED');
  });

  it('enforces DN-04 segregation on assign, delegate, internal notes and @mentions (mentions never grant access)', async () => {
    const f = await setupTwoOrgsFixture();

    const managerOwnedFeedback = await container.services.feedback.createFeedback(
      f.managerA1Id,
      f.orgAId,
      {
        moduleKey: 'projects',
        categoryId: f.catBugId,
        title: 'Feedback aberto por MANAGER para testar segregação DN-04',
        description: 'Gestor autor não pode ser atribuído nem ler notas internas.',
        priority: PRIORITIES.HIGH,
      },
    );

    // DN-04: assignFeedback rejects non-ADMIN author (managerA1Id) and MEMBER (memberA1Id)
    await expect(
      container.services.feedback.assignFeedback(f.adminAId, f.orgAId, managerOwnedFeedback.id, {
        assigneeId: f.managerA1Id,
      }),
    ).rejects.toThrow(ConflictError);

    await expect(
      container.services.feedback.assignFeedback(f.adminAId, f.orgAId, managerOwnedFeedback.id, {
        assigneeId: f.memberA1Id,
      }),
    ).rejects.toThrow(ConflictError);

    // ADMIN author CAN be assigned to own feedback
    const adminOwnedFeedback = await container.services.feedback.createFeedback(
      f.adminAId,
      f.orgAId,
      {
        moduleKey: 'settings',
        categoryId: f.catBugId,
        title: 'Feedback aberto pelo próprio ADMIN',
        description: 'ADMIN pode atender e ver notas internas.',
        priority: PRIORITIES.MEDIUM,
      },
    );
    const adminAssigned = await container.services.feedback.assignFeedback(
      f.adminAId,
      f.orgAId,
      adminOwnedFeedback.id,
      { assigneeId: f.adminAId },
    );
    expect(adminAssigned.assigneeId).toBe(f.adminAId);

    // Assign managerOwnedFeedback to managerA2Id
    await container.services.feedback.assignFeedback(
      f.adminAId,
      f.orgAId,
      managerOwnedFeedback.id,
      { assigneeId: f.managerA2Id },
    );

    // managerA2Id creates internal note mentioning managerA1Id (author) and memberA2Id (outsider)
    await container.services.feedback.addFeedbackInternalNote(
      f.managerA2Id,
      f.orgAId,
      managerOwnedFeedback.id,
      {
        body: 'Nota confidencial mencionando @Membro e @GestorAutor.',
        mentionedUserIds: [f.managerA1Id, f.memberA2Id],
      },
    );

    // @mention NEVER grants FEEDBACK_VIEW to memberA2Id
    await expect(
      container.services.feedback.getFeedbackDetail(
        f.memberA2Id,
        f.orgAId,
        managerOwnedFeedback.id,
      ),
    ).rejects.toThrow(AuthorizationError);

    // @mention NEVER grants internal note access to non-ADMIN author managerA1Id (even with explicit grant)
    await container.services.authorization.grantPermission(f.adminAId, f.orgAId, {
      granteeUserId: f.managerA1Id,
      permission: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(managerOwnedFeedback.id),
      reason: 'Teste negativo DN-04',
    });

    const authorDetail = await container.services.feedback.getFeedbackDetail(
      f.managerA1Id,
      f.orgAId,
      managerOwnedFeedback.id,
    );
    expect(authorDetail.canViewInternalNotes).toBe(false);
    expect(authorDetail.internalNotes).toEqual([]);

    // MEMBER and non-ADMIN author cannot create internal notes
    await expect(
      container.services.feedback.addFeedbackInternalNote(
        f.memberA1Id,
        f.orgAId,
        managerOwnedFeedback.id,
        { body: 'Membro externo tentando criar nota' },
      ),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      container.services.feedback.addFeedbackInternalNote(
        f.managerA1Id,
        f.orgAId,
        managerOwnedFeedback.id,
        { body: 'Gestor autor tentando criar nota no próprio feedback' },
      ),
    ).rejects.toThrow(AuthorizationError);

    // Resolve and open contest on managerOwnedFeedback -> delegateFeedbackContestAnalysis also blocks non-ADMIN author
    await container.services.feedback.transitionFeedbackStatus(
      f.managerA2Id,
      f.orgAId,
      managerOwnedFeedback.id,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Corrigido para validar delegação DN-04.',
      },
    );
    const contest = await container.services.feedback.openFeedbackContest(
      f.managerA1Id,
      f.orgAId,
      managerOwnedFeedback.id,
      {
        reasonId: f.reasonPersistsId,
        justification: 'Abertura pelo gestor autor para validar bloqueio de delegação.',
      },
    );
    await expect(
      container.services.feedback.delegateFeedbackContestAnalysis(
        f.adminAId,
        f.orgAId,
        managerOwnedFeedback.id,
        contest.id,
        { analystUserId: f.managerA1Id },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('validates binary attachments (internalNoteId segregation, disallowed MIME with charset, pre-tx SHA-256, 15MB/50MB/10 limits, download revalidation before getBlob, and non-destructive QuotaExceededError)', async () => {
    const f = await setupTwoOrgsFixture();

    const fb = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'kanban',
      categoryId: f.catBugId,
      title: 'Feedback com anexos públicos e internos',
      description: 'Validar segurança de anexos binários.',
      priority: PRIORITIES.MEDIUM,
    });
    await container.services.feedback.assignFeedback(f.adminAId, f.orgAId, fb.id, {
      assigneeId: f.managerA1Id,
    });

    const msgRes = await container.services.feedback.addFeedbackMessage(
      f.memberA1Id,
      f.orgAId,
      fb.id,
      {
        body: 'Mensagem pública com anexo.',
      },
    );
    const note = await container.services.feedback.addFeedbackInternalNote(
      f.managerA1Id,
      f.orgAId,
      fb.id,
      { body: 'Nota interna com anexo sigiloso.' },
    );

    // Cannot pass both messageId and internalNoteId
    await expect(
      container.services.feedback.uploadFeedbackAttachment(f.managerA1Id, f.orgAId, fb.id, {
        fileName: 'ambos.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('x'),
        messageId: msgRes.message.id,
        internalNoteId: note.id,
      }),
    ).rejects.toThrow(ValidationError);

    // MEMBER (author) cannot upload attachment linked to internalNoteId
    await expect(
      container.services.feedback.uploadFeedbackAttachment(f.memberA1Id, f.orgAId, fb.id, {
        fileName: 'autor-interno.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('tentativa'),
        internalNoteId: note.id,
      }),
    ).rejects.toThrow(AuthorizationError);

    // Disallowed MIME types (including parameters like '; charset=utf-8')
    for (const badMime of [
      'image/svg+xml',
      'text/html; charset=utf-8',
      'application/x-msdownload',
      'application/javascript; charset=utf-8',
    ]) {
      await expect(
        container.services.feedback.uploadFeedbackAttachment(f.memberA1Id, f.orgAId, fb.id, {
          fileName: 'blocked.dat',
          mimeType: badMime,
          bytes: new TextEncoder().encode('payload'),
        }),
      ).rejects.toThrow(ValidationError);
    }

    // SHA-256 computed BEFORE TransactionPort.run
    const callOrder: string[] = [];
    const origRun = container.transactionPort.run.bind(container.transactionPort);
    vi.spyOn(container.transactionPort, 'run').mockImplementation(async (resources, work) => {
      callOrder.push('tx.start');
      return origRun(resources, work);
    });
    const origDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (alg, data) => {
      callOrder.push('sha256.digest');
      return origDigest(alg, data);
    });

    const publicBytes = new TextEncoder().encode('conteudo publico binario');
    const publicAtt = await container.services.feedback.uploadFeedbackAttachment(
      f.memberA1Id,
      f.orgAId,
      fb.id,
      {
        fileName: 'publico.txt',
        mimeType: 'text/plain',
        bytes: publicBytes,
        messageId: msgRes.message.id,
      },
    );
    expect(callOrder.indexOf('sha256.digest')).toBeLessThan(callOrder.indexOf('tx.start'));
    expect(publicAtt.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    vi.restoreAllMocks();

    // Internal attachment uploaded by assigned MANAGER
    const internalAtt = await container.services.feedback.uploadFeedbackAttachment(
      f.managerA1Id,
      f.orgAId,
      fb.id,
      {
        fileName: 'interno.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('segredo tecnico'),
        internalNoteId: note.id,
      },
    );

    // Listing segregates internalAttachment from MEMBER author and unassigned MANAGER
    const memberDetail = await container.services.feedback.getFeedbackDetail(
      f.memberA1Id,
      f.orgAId,
      fb.id,
    );
    expect(memberDetail.publicAttachments.map((a) => a.id)).toEqual([publicAtt.id]);
    expect(memberDetail.internalAttachments).toEqual([]);

    // Download revalidates BEFORE calling attachmentBlobStore.getBlob
    const getBlobSpy = vi.spyOn(container.attachmentBlobStore, 'getBlob');
    await expect(
      container.services.feedback.getFeedbackAttachmentContent(
        f.memberA1Id,
        f.orgAId,
        fb.id,
        internalAtt.id,
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.feedback.getFeedbackAttachmentContent(
        f.managerA2Id,
        f.orgAId,
        fb.id,
        internalAtt.id,
      ),
    ).rejects.toThrow(AuthorizationError);
    expect(getBlobSpy).not.toHaveBeenCalled();

    // Tampered/disallowed MIME stored directly in metadata also fails validation before getBlob
    const tamperedId = asAttachmentId(crypto.randomUUID());
    await container.repositories.feedback.feedbackAttachments.save({
      ...publicAtt,
      id: tamperedId,
      mimeType: 'text/html; charset=utf-8',
    });
    await expect(
      container.services.feedback.getFeedbackAttachmentContent(
        f.adminAId,
        f.orgAId,
        fb.id,
        tamperedId,
      ),
    ).rejects.toThrow(ValidationError);
    expect(getBlobSpy).not.toHaveBeenCalled();

    // QuotaExceededError is non-destructive (STORAGE_QUOTA_EXCEEDED)
    vi.spyOn(container.attachmentBlobStore, 'putBlob').mockRejectedValueOnce(
      Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }),
    );
    let quotaErr: unknown;
    try {
      await container.services.feedback.uploadFeedbackAttachment(f.memberA1Id, f.orgAId, fb.id, {
        fileName: 'falha-cota.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('nao deve gravar'),
      });
    } catch (error) {
      quotaErr = error;
    }
    expect(quotaErr).toBeInstanceOf(InfrastructureError);
    expect((quotaErr as InfrastructureError).details?.reason).toBe('STORAGE_QUOTA_EXCEEDED');

    // Existing attachments remain intact
    const downloadedPublic = await container.services.feedback.getFeedbackAttachmentContent(
      f.memberA1Id,
      f.orgAId,
      fb.id,
      publicAtt.id,
    );
    expect(new TextDecoder().decode(downloadedPublic.bytes)).toBe('conteudo publico binario');

    // File > 15 MB rejected
    await expect(
      container.services.feedback.uploadFeedbackAttachment(f.memberA1Id, f.orgAId, fb.id, {
        fileName: 'grande.bin',
        mimeType: 'application/octet-stream',
        bytes: new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1),
      }),
    ).rejects.toThrow(ValidationError);

    // 50 MB accumulated limit rejected on a dedicated feedback
    const fbQuota50 = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'kanban',
      categoryId: f.catBugId,
      title: 'Feedback limite acumulado 50MB',
      description: 'Testando limite acumulado de 50 MB no contexto.',
      priority: PRIORITIES.LOW,
    });
    const chunk14Mb = new Uint8Array(14 * 1024 * 1024);
    for (let i = 0; i < 3; i += 1) {
      await container.services.feedback.uploadFeedbackAttachment(
        f.memberA1Id,
        f.orgAId,
        fbQuota50.id,
        {
          fileName: `part-${i + 1}.bin`,
          mimeType: 'application/octet-stream',
          bytes: chunk14Mb,
        },
      );
    }
    // 42 MB uploaded so far; +9 MB = 51 MB > 50 MB -> ValidationError
    await expect(
      container.services.feedback.uploadFeedbackAttachment(f.memberA1Id, f.orgAId, fbQuota50.id, {
        fileName: 'part-4.bin',
        mimeType: 'application/octet-stream',
        bytes: new Uint8Array(9 * 1024 * 1024),
      }),
    ).rejects.toThrow(ValidationError);

    // 10 attachments count limit rejected on 11th upload
    const fbCount10 = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'kanban',
      categoryId: f.catBugId,
      title: 'Feedback limite de 10 anexos',
      description: 'Testando limite máximo de 10 anexos por feedback.',
      priority: PRIORITIES.LOW,
    });
    const tinyBytes = new TextEncoder().encode('ok');
    for (let i = 0; i < 10; i += 1) {
      await container.services.feedback.uploadFeedbackAttachment(
        f.memberA1Id,
        f.orgAId,
        fbCount10.id,
        {
          fileName: `item-${i + 1}.txt`,
          mimeType: 'text/plain',
          bytes: tinyBytes,
        },
      );
    }
    await expect(
      container.services.feedback.uploadFeedbackAttachment(f.memberA1Id, f.orgAId, fbCount10.id, {
        fileName: 'item-11.txt',
        mimeType: 'text/plain',
        bytes: tinyBytes,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('orchestrates contestations (deadline/pending 409, PermissionGrant atomic delegation/revocation, immutable analysis, ADMIN decision & divergence, CONTESTATION_REOPEN) and exceptional reopen', async () => {
    const f = await setupTwoOrgsFixture();

    const fb = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'dependencies',
      categoryId: f.catBugId,
      title: 'Contestação e reabertura excepcional completas',
      description: 'Validando fluxo de contestação, delegação, decisão e reabertura.',
      priority: PRIORITIES.HIGH,
    });
    await container.services.feedback.assignFeedback(f.adminAId, f.orgAId, fb.id, {
      assigneeId: f.managerA1Id,
    });
    await container.services.feedback.transitionFeedbackStatus(f.managerA1Id, f.orgAId, fb.id, {
      targetStatus: FEEDBACK_STATUSES.RESOLVED,
      resolutionDescription: 'Entrega inicial marcada como resolvida.',
    });

    // Non-author cannot open contest (403)
    await expect(
      container.services.feedback.openFeedbackContest(f.managerA2Id, f.orgAId, fb.id, {
        reasonId: f.reasonPersistsId,
        justification: 'Não sou o autor.',
      }),
    ).rejects.toThrow(AuthorizationError);

    // Author opens contest within deadline
    const contest1 = await container.services.feedback.openFeedbackContest(
      f.memberA1Id,
      f.orgAId,
      fb.id,
      {
        reasonId: f.reasonPersistsId,
        justification: 'Bug continua acontecendo em produção local.',
      },
    );
    expect(contest1.status).toBe(CONTEST_STATUSES.OPEN);

    // Second pending contest rejected (409)
    await expect(
      container.services.feedback.openFeedbackContest(f.memberA1Id, f.orgAId, fb.id, {
        reasonId: f.reasonPersistsId,
        justification: 'Duplicada enquanto pendente.',
      }),
    ).rejects.toThrow(ConflictError);

    // Cannot auto-close while contest is pending
    const settings = await container.services.feedback.getFeedbackSlaSettings(f.adminAId, f.orgAId);
    const pastDeadline = asIsoDateTime(
      new Date(Date.parse(BASE_NOW) + settings.feedbackContestWindowMs + HOUR_MS).toISOString(),
    );
    const savedNow = currentNow;
    currentNow = pastDeadline;
    const evalWhilePending = await container.services.feedback.evaluateFeedbackSlas(
      f.adminAId,
      f.orgAId,
    );
    expect(evalWhilePending.autoClosedCount).toBe(0);
    currentNow = savedNow;

    // Delegate to managerA1 -> atomic grant; re-delegate to managerA2 -> revokes managerA1 grant
    await container.services.feedback.delegateFeedbackContestAnalysis(
      f.adminAId,
      f.orgAId,
      fb.id,
      contest1.id,
      { analystUserId: f.managerA1Id },
    );
    await container.services.feedback.delegateFeedbackContestAnalysis(
      f.adminAId,
      f.orgAId,
      fb.id,
      contest1.id,
      { analystUserId: f.managerA2Id },
    );

    const m1Grants =
      await container.repositories.authorization.permissionGrants.listActiveByGrantee(
        f.orgAId,
        f.managerA1Id,
        currentNow,
      );
    expect(m1Grants.some((g) => g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE)).toBe(
      false,
    );
    const m2Grants =
      await container.repositories.authorization.permissionGrants.listActiveByGrantee(
        f.orgAId,
        f.managerA2Id,
        currentNow,
      );
    expect(
      m2Grants.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE &&
          g.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
          g.scopeId === asEntityId(fb.id),
      ),
    ).toBe(true);
    expect(
      m2Grants.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_VIEW &&
          g.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
          g.scopeId === asEntityId(fb.id) &&
          g.reason.startsWith('Delegated contest analysis view for feedback "'),
      ),
    ).toBe(true);
    expect(
      m2Grants.some((g) => g.permission === PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW),
    ).toBe(false);

    // Delegated non-assignee analyst can read feedback detail via paired FEEDBACK_VIEW without seeing internal notes
    const delegatedAnalystDetail = await container.services.feedback.getFeedbackDetail(
      f.managerA2Id,
      f.orgAId,
      fb.id,
    );
    expect(delegatedAnalystDetail.canViewInternalNotes).toBe(false);
    expect(delegatedAnalystDetail.internalNotes).toEqual([]);

    // Non-delegated managerA1 cannot submit analysis; delegated managerA2 submits once and cannot submit twice
    await expect(
      container.services.feedback.submitFeedbackContestAnalysis(
        f.managerA1Id,
        f.orgAId,
        fb.id,
        contest1.id,
        { recommendation: CONTEST_RECOMMENDATIONS.RESUME_SERVICE, summary: 'Não delegado.' },
      ),
    ).rejects.toThrow(AuthorizationError);

    const analysis1 = await container.services.feedback.submitFeedbackContestAnalysis(
      f.managerA2Id,
      f.orgAId,
      fb.id,
      contest1.id,
      {
        recommendation: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
        summary: 'Comportamento condizente com critério anterior.',
      },
    );
    expect(analysis1.recommendation).toBe(CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION);

    await expect(
      container.services.feedback.submitFeedbackContestAnalysis(
        f.managerA2Id,
        f.orgAId,
        fb.id,
        contest1.id,
        {
          recommendation: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
          summary: 'Tentativa de sobrescrever parecer imutável.',
        },
      ),
    ).rejects.toThrow(ConflictError);

    // MANAGER cannot decide contest (403); ADMIN diverging without justification throws ValidationError
    await expect(
      container.services.feedback.decideFeedbackContest(
        f.managerA2Id,
        f.orgAId,
        fb.id,
        contest1.id,
        { outcome: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION, justification: 'Sem permissão.' },
      ),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      container.services.feedback.decideFeedbackContest(f.adminAId, f.orgAId, fb.id, contest1.id, {
        outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        justification: '  ',
      }),
    ).rejects.toThrow(ValidationError);

    // ADMIN accepts contest (diverging from analysis) -> revokes grant, closes contest, spawns cycle #2 CONTESTATION_REOPEN
    const accepted = await container.services.feedback.decideFeedbackContest(
      f.adminAId,
      f.orgAId,
      fb.id,
      contest1.id,
      {
        outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        justification: 'Evidências complementares confirmaram falha intermitente.',
      },
    );
    expect(accepted.contest.status).toBe(CONTEST_STATUSES.CLOSED);
    expect(accepted.decision.divergedFromAnalysis).toBe(true);
    expect(accepted.feedback.status).toBe(FEEDBACK_STATUSES.IN_PROGRESS);
    expect(accepted.newCycle?.origin).toBe(CYCLE_ORIGINS.CONTESTATION_REOPEN);
    expect(accepted.newCycle?.cycleNumber).toBe(2);
    expect(accepted.newSlaSnapshot?.cycleId).toBe(accepted.newCycle?.id);

    const m2GrantsAfter = await container.repositories.authorization.permissionGrants.listByGrantee(
      f.orgAId,
      f.managerA2Id,
    );
    expect(
      m2GrantsAfter.some((g) => g.permission === PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE),
    ).toBe(true);
    expect(
      m2GrantsAfter.some(
        (g) =>
          g.permission === PERMISSION_CODES.FEEDBACK_VIEW &&
          g.reason.startsWith('Delegated contest analysis view for feedback "'),
      ),
    ).toBe(true);
    expect(m2GrantsAfter.every((g) => g.status === GRANT_STATUSES.REVOKED)).toBe(true);

    // Resolve cycle #2 and let deadline expire -> contest outside window throws 409; auto-close triggers
    await container.services.feedback.transitionFeedbackStatus(f.managerA1Id, f.orgAId, fb.id, {
      targetStatus: FEEDBACK_STATUSES.RESOLVED,
      resolutionDescription: 'Correção do ciclo 2 aplicada.',
    });

    currentNow = asIsoDateTime(
      new Date(Date.parse(currentNow) + settings.feedbackContestWindowMs + HOUR_MS).toISOString(),
    );
    await expect(
      container.services.feedback.openFeedbackContest(f.memberA1Id, f.orgAId, fb.id, {
        reasonId: f.reasonPersistsId,
        justification: 'Fora do prazo de contestação.',
      }),
    ).rejects.toThrow(ConflictError);

    await container.services.feedback.evaluateFeedbackSlas(f.adminAId, f.orgAId);

    // Exceptional reopen request after expiration -> ADMIN rejects first? No, test pending uniqueness & approval preserving assignee/priority
    const reopenReq = await container.services.feedback.requestExceptionalReopen(
      f.memberA1Id,
      f.orgAId,
      fb.id,
      { justification: 'Estava de férias durante a janela padrão.' },
    );
    await expect(
      container.services.feedback.requestExceptionalReopen(f.memberA1Id, f.orgAId, fb.id, {
        justification: 'Segunda solicitação enquanto pendente.',
      }),
    ).rejects.toThrow(ConflictError);

    // MANAGER cannot decide exceptional reopen
    await expect(
      container.services.feedback.decideExceptionalReopen(
        f.managerA1Id,
        f.orgAId,
        fb.id,
        reopenReq.id,
        { decision: REOPEN_REQUEST_STATUSES.APPROVED, justification: 'Sem permissão.' },
      ),
    ).rejects.toThrow(AuthorizationError);

    // ADMIN approves exceptional reopen -> cycle #3 EXCEPTIONAL_REOPEN preserving previous assignee & priority
    const reopenApproved = await container.services.feedback.decideExceptionalReopen(
      f.adminAId,
      f.orgAId,
      fb.id,
      reopenReq.id,
      {
        decision: REOPEN_REQUEST_STATUSES.APPROVED,
        justification: 'Reabertura aprovada excepcionalmente.',
      },
    );
    expect(reopenApproved.newCycle?.cycleNumber).toBe(3);
    expect(reopenApproved.newCycle?.origin).toBe(CYCLE_ORIGINS.EXCEPTIONAL_REOPEN);
    expect(reopenApproved.newCycle?.initialAssigneeId).toBe(f.managerA1Id);
    expect(reopenApproved.newCycle?.assigneeId).toBe(f.managerA1Id);
    expect(reopenApproved.newCycle?.prioritySnapshot).toBe(PRIORITIES.HIGH);
    expect(reopenApproved.newSlaSnapshot?.cycleId).toBe(reopenApproved.newCycle?.id);
  });

  it('enforces catalog versioning/soft-delete protection (DN-02), ADMIN-only SLA settings, segmented JSON/CSV export (DN-07), cross-org isolation, and no events on aborted tx', async () => {
    const f = await setupTwoOrgsFixture();
    const emittedEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      emittedEvents.push(event);
    });

    // Non-ADMIN cannot access SLA settings or catalog mutations
    await expect(
      container.services.feedback.getFeedbackSlaSettings(f.managerA1Id, f.orgAId),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.feedback.createFeedbackCategory(f.managerA1Id, f.orgAId, {
        code: 'NOPE',
        name: 'Não permitido',
      }),
    ).rejects.toThrow(AuthorizationError);

    // Create feedback with catBugId and open/resolve/contest with reasonPersistsId -> marks both hasBeenUsed = true
    const fbMember1 = await container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
      moduleKey: 'reports',
      categoryId: f.catBugId,
      title: 'Feedback membro 1 para exportação',
      description: 'Contém nota interna que não pode vazar na exportação do autor.',
      priority: PRIORITIES.MEDIUM,
    });
    const fbMember2 = await container.services.feedback.createFeedback(f.memberA2Id, f.orgAId, {
      moduleKey: 'trash',
      categoryId: f.catImprovementId,
      title: 'Feedback membro 2 secreto',
      description: 'Não pode aparecer na exportação do membro 1.',
      priority: PRIORITIES.LOW,
    });
    await container.services.feedback.assignFeedback(f.adminAId, f.orgAId, fbMember1.id, {
      assigneeId: f.managerA1Id,
    });
    const note = await container.services.feedback.addFeedbackInternalNote(
      f.managerA1Id,
      f.orgAId,
      fbMember1.id,
      { body: 'Nota sigilosa para filtrar na exportação.' },
    );
    await container.services.feedback.uploadFeedbackAttachment(
      f.managerA1Id,
      f.orgAId,
      fbMember1.id,
      {
        fileName: 'anexo-sigiloso.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('segredo export'),
        internalNoteId: note.id,
      },
    );
    await container.services.feedback.transitionFeedbackStatus(
      f.managerA1Id,
      f.orgAId,
      fbMember1.id,
      { targetStatus: FEEDBACK_STATUSES.RESOLVED, resolutionDescription: 'Resolvido.' },
    );
    await container.services.feedback.openFeedbackContest(f.memberA1Id, f.orgAId, fbMember1.id, {
      reasonId: f.reasonPersistsId,
      justification: 'Marcar motivo como utilizado.',
    });

    // Used category & used reason cannot be deleted (409)
    await expect(
      container.services.feedback.deleteFeedbackCategory(f.adminAId, f.orgAId, f.catBugId),
    ).rejects.toThrow(ConflictError);
    await expect(
      container.services.feedback.deleteFeedbackContestReason(
        f.adminAId,
        f.orgAId,
        f.reasonPersistsId,
      ),
    ).rejects.toThrow(ConflictError);

    // Unused category & unused reason CAN be soft-deleted
    const unusedCat = await container.services.feedback.createFeedbackCategory(
      f.adminAId,
      f.orgAId,
      { code: 'UNUSED_CAT', name: 'Categoria Não Usada' },
    );
    const deletedCat = await container.services.feedback.deleteFeedbackCategory(
      f.adminAId,
      f.orgAId,
      unusedCat.category.id,
      { reason: 'Limpeza de catálogo' },
    );
    expect(deletedCat.deletedAt).toBe(currentNow);
    expect(deletedCat.deletionReason).toBe('Limpeza de catálogo');

    const unusedReason = await container.services.feedback.createFeedbackContestReason(
      f.adminAId,
      f.orgAId,
      { code: 'UNUSED_REASON', name: 'Motivo Não Usado' },
    );
    const deletedReason = await container.services.feedback.deleteFeedbackContestReason(
      f.adminAId,
      f.orgAId,
      unusedReason.reason.id,
      { reason: 'Descontinuado' },
    );
    expect(deletedReason.deletedAt).toBe(currentNow);

    // Segmented Export (DN-07): memberA1 exports JSON/CSV -> sees ONLY fbMember1 (never fbMember2), zero internalNotes & internalAttachments
    const memberExport = await container.services.feedback.exportFeedbacks(f.memberA1Id, f.orgAId, {
      format: 'JSON',
    });
    expect(memberExport.totalCount).toBe(1);
    expect(memberExport.items[0]?.feedback.id).toBe(fbMember1.id);
    expect(memberExport.items.some((i) => i.feedback.id === fbMember2.id)).toBe(false);
    expect(memberExport.items[0]?.internalNotes).toEqual([]);
    expect(memberExport.items[0]?.internalAttachments).toEqual([]);

    const memberCsv = await container.services.feedback.exportFeedbacks(f.memberA1Id, f.orgAId, {
      format: 'CSV',
    });
    expect(memberCsv.content).not.toContain('Nota sigilosa');
    expect(memberCsv.content).not.toContain('Feedback membro 2 secreto');

    // Assigned managerA1 exports CSV -> sees fbMember1 WITH internalNotesCount = 1
    const managerCsv = await container.services.feedback.exportFeedbacks(f.managerA1Id, f.orgAId, {
      format: 'CSV',
    });
    expect(managerCsv.totalCount).toBe(1);
    expect(managerCsv.items[0]?.internalNotes).toHaveLength(1);
    expect(managerCsv.items[0]?.internalAttachments).toHaveLength(1);
    expect(managerCsv.content).toContain(',1,1');

    // Audit categories verification: ORGANIZATION for catalog/SLA, EXPORT for exports
    const orgAudits = await container.repositories.audit.auditEvents.listByOrganization(f.orgAId, {
      page: 1,
      pageSize: 100,
    });
    expect(orgAudits.items.some((e) => e.category === AUDIT_CATEGORIES.ORGANIZATION)).toBe(true);
    expect(orgAudits.items.some((e) => e.category === AUDIT_CATEGORIES.EXPORT)).toBe(true);

    // Cross-org isolation: adminA (no membership in Org B) receives AuthorizationError on every Org B operation
    const orgBOps: Array<() => Promise<unknown>> = [
      () => container.services.feedback.listFeedbacks(f.adminAId, f.orgBId),
      () =>
        container.services.feedback.createFeedback(f.adminAId, f.orgBId, {
          moduleKey: 'general',
          categoryId: f.catOrgBId,
          title: 'Cross-org attempt',
          description: 'Tentativa em outra organização.',
        }),
      () => container.services.feedback.getFeedbackSlaSettings(f.adminAId, f.orgBId),
      () =>
        container.services.feedback.createFeedbackCategory(f.adminAId, f.orgBId, {
          code: 'X_ORG',
          name: 'Cross Org',
        }),
      () => container.services.feedback.evaluateFeedbackSlas(f.adminAId, f.orgBId),
      () => container.services.feedback.exportFeedbacks(f.adminAId, f.orgBId, { format: 'JSON' }),
    ];
    for (const op of orgBOps) {
      await expect(op()).rejects.toThrow(AuthorizationError);
    }

    // Post-commit guarantee: aborted transaction must NOT emit domain events
    const countBeforeRollback = emittedEvents.length;
    vi.spyOn(container.repositories.audit.auditEvents, 'append').mockRejectedValueOnce(
      new Error('Simulated Dexie abort'),
    );
    await expect(
      container.services.feedback.createFeedback(f.memberA1Id, f.orgAId, {
        moduleKey: 'kanban',
        categoryId: f.catBugId,
        title: 'Rollback test feedback',
        description: 'Transação abortada não deve publicar evento.',
      }),
    ).rejects.toThrow('Simulated Dexie abort');
    expect(emittedEvents).toHaveLength(countBeforeRollback);
  });
});
