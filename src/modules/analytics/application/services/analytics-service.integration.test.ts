import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import {
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  asBottleneckAlertId,
} from '@/modules/bottlenecks';
import {
  CONTEST_RECOMMENDATIONS,
  CYCLE_ORIGINS,
  FEEDBACK_STATUSES,
  INITIAL_CONTEST_REASONS,
  INITIAL_FEEDBACK_CATEGORIES,
  REOPEN_REQUEST_STATUSES,
  asFeedbackCategoryId,
  asFeedbackContestReasonId,
} from '@/modules/feedback';
import { BOARD_COLUMN_ROLES } from '@/modules/kanban';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  MEMBERSHIP_STATUSES,
  METRIC_AVAILABILITY_STATUSES,
  METRIC_UNAVAILABLE_REASONS,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  asIsoDateTime,
  asOrganizationId,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  ANALYTICS_PERIOD_PRESETS,
  DASHBOARD_SCOPES,
  calculateCohortCompletionRate,
  calculateCycleTimeMs,
  calculateLeadTimeMs,
  calculateThroughput,
  countPeriodCompletions,
  countUniqueCompletedTasks,
  resolveEquivalentPreviousPeriod,
} from '../../index';

describe('AnalyticsService Integration (Dexie, Official Metrics, Feedback Versioning, ABAC/Privacy, DashboardPreference & DN-06 Calibration)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-09-20T12:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_analytics_service_${crypto.randomUUID()}`,
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

  async function setupOrgFixture() {
    currentNow = asIsoDateTime('2026-09-01T08:00:00.000Z');
    const admin = await registerUser('admin.analytics@pms.local', 'Admin Analytics');
    const managerA = await registerUser('managerA.analytics@pms.local', 'Gestor Projeto A');
    const managerB = await registerUser('managerB.analytics@pms.local', 'Gestor Projeto B');
    const member1 = await registerUser('member1.analytics@pms.local', 'Membro 1');
    const member2 = await registerUser('member2.analytics@pms.local', 'Membro 2');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Analytics Org A',
        slug: 'analytics-org-a',
      },
    );

    for (const [userId, role] of [
      [managerA.user.id, ORGANIZATION_ROLES.MANAGER],
      [managerB.user.id, ORGANIZATION_ROLES.MANAGER],
      [member1.user.id, ORGANIZATION_ROLES.MEMBER],
      [member2.user.id, ORGANIZATION_ROLES.MEMBER],
    ] as const) {
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId,
        role,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });
    }

    const projectA = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      {
        name: 'Projeto Alpha',
        ownerUserId: managerA.user.id,
      },
    );
    await container.services.projects.addProjectParticipant(
      managerA.user.id,
      organization.id,
      projectA.id,
      member1.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );
    await container.services.projects.addProjectParticipant(
      managerA.user.id,
      organization.id,
      projectA.id,
      member2.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    const projectB = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      {
        name: 'Projeto Beta Restrito',
        ownerUserId: managerB.user.id,
      },
    );

    const boardA = await container.services.kanban.getProjectBoard(
      managerA.user.id,
      organization.id,
      projectA.id,
    );
    const execColA = boardA.columns.find((c) => c.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL);
    if (execColA) {
      await container.services.kanban.updateColumn(
        managerA.user.id,
        organization.id,
        projectA.id,
        execColA.id,
        { wipLimit: 20 },
      );
    }

    return {
      admin,
      managerA,
      managerB,
      member1,
      member2,
      organization,
      projectA,
      projectB,
    };
  }

  it('computes official flow metrics: Lead Time, EFFECTIVE vs TOTAL Cycle Time, Throughput vs Unique Completed vs Cohort, status counts, and equivalent previous period', async () => {
    const { admin, managerA, member1, member2, organization, projectA } = await setupOrgFixture();

    // Task 1: created inside previous period (2026-08-10), completed in current period (2026-09-12)
    // Wait: to test both previous period & current period cleanly, let's use CUSTOM period:
    // Current:  2026-09-10T00:00:00.000Z .. 2026-09-20T00:00:00.000Z (10 days)
    // Previous: equivalent 10-day period resolved by resolveEquivalentPreviousPeriod
    const customPeriod = {
      start: asIsoDateTime('2026-09-10T00:00:00.000Z'),
      end: asIsoDateTime('2026-09-20T00:00:00.000Z'),
    };
    const expectedPrevious = resolveEquivalentPreviousPeriod(customPeriod);

    // Seed Task P0 in previous period (2026-09-02 .. 2026-09-04) so previousPeriod metrics are populated
    currentNow = asIsoDateTime('2026-09-02T08:00:00.000Z');
    const prevTask = await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Periodo Anterior',
        priority: PRIORITIES.MEDIUM,
        assigneeId: member1.user.id,
      },
    );
    currentNow = asIsoDateTime('2026-09-02T10:00:00.000Z');
    await container.services.tasks.startTask(managerA.user.id, organization.id, prevTask.id);
    currentNow = asIsoDateTime('2026-09-04T10:00:00.000Z'); // 48h cycle, 50h lead
    await container.services.tasks.completeTask(managerA.user.id, organization.id, prevTask.id);

    // Task 1 in current period: created 2026-09-10T08:00, started 2026-09-10T10:00,
    // paused 2026-09-10T12:00 .. 2026-09-10T15:00 (3h pause), completed 2026-09-10T18:00
    // => Lead Time = 10h, Total Cycle Time = 8h, Effective Cycle Time = 5h
    // Then reopened at 2026-09-11T08:00, started 2026-09-11T09:00, completed 2026-09-11T11:00
    // => Cycle 2: Total = 2h, Effective = 2h
    // For Task 1 alone:
    //   Throughput / periodCompletions = 2 cycles
    //   Unique completed tasks = 1 distinct task!
    currentNow = asIsoDateTime('2026-09-10T08:00:00.000Z');
    const task1 = await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Com Pausa e Reabertura',
        priority: PRIORITIES.HIGH,
        assigneeId: member1.user.id,
      },
    );
    currentNow = asIsoDateTime('2026-09-10T10:00:00.000Z');
    await container.services.tasks.startTask(managerA.user.id, organization.id, task1.id);
    currentNow = asIsoDateTime('2026-09-10T12:00:00.000Z');
    await container.services.tasks.pauseTask(managerA.user.id, organization.id, task1.id, {
      reason: 'Aguardando ambiente',
    });
    currentNow = asIsoDateTime('2026-09-10T15:00:00.000Z');
    await container.services.tasks.resumeTask(managerA.user.id, organization.id, task1.id);
    currentNow = asIsoDateTime('2026-09-10T18:00:00.000Z');
    await container.services.tasks.completeTask(managerA.user.id, organization.id, task1.id);

    // Reopen task1 at 09:00 (reopenTask places it in IN_PROGRESS and opens Cycle 2) and complete at 11:00
    currentNow = asIsoDateTime('2026-09-11T09:00:00.000Z');
    await container.services.tasks.reopenTask(managerA.user.id, organization.id, task1.id, {
      reason: 'Ajuste final pos-revisao',
    });
    currentNow = asIsoDateTime('2026-09-11T11:00:00.000Z');
    await container.services.tasks.completeTask(managerA.user.id, organization.id, task1.id);

    // Task 2 created in current period (2026-09-12) and remains IN_PROGRESS (for cohort denominator = 2, completed = 1 => 0.5)
    currentNow = asIsoDateTime('2026-09-12T08:00:00.000Z');
    const task2 = await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Em Andamento Coorte',
        priority: PRIORITIES.MEDIUM,
        assigneeId: member2.user.id,
      },
    );
    await container.services.tasks.startTask(managerA.user.id, organization.id, task2.id);

    currentNow = asIsoDateTime('2026-09-20T00:00:00.000Z');
    const overview = await container.services.analytics.getAnalyticsOverview(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        preset: ANALYTICS_PERIOD_PRESETS.CUSTOM,
        customRange: customPeriod,
        compareWithPreviousPeriod: true,
      },
    );

    expect(overview.previousPeriod).toEqual(expectedPrevious);
    // Task 1: createdAt 2026-09-10T08:00, final completedAt 2026-09-11T11:00 => 27h = 97_200_000 ms
    expect(overview.flow.leadTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 27 * 60 * 60 * 1000,
    });

    // Cycle 1: Total = 8h, Effective = 5h (3h pause)
    // Cycle 2: Total = 2h, Effective = 2h
    // Average Total Cycle Time = 5h; Average Effective Cycle Time = 3.5h
    const hourMs = 60 * 60 * 1000;
    expect(overview.flow.totalCycleTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 5 * hourMs,
    });
    expect(overview.flow.effectiveCycleTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 3.5 * hourMs,
    });
    expect(
      overview.flow.effectiveCycleTimeMs.status === 'AVAILABLE' &&
        overview.flow.totalCycleTimeMs.status === 'AVAILABLE' &&
        overview.flow.effectiveCycleTimeMs.value < overview.flow.totalCycleTimeMs.value,
    ).toBe(true);

    // Throughput & periodCompletions = 2 (two completed cycles), uniqueCompletedTasks = 1 (reopened task)
    expect(overview.flow.throughput).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 2,
    });
    expect(overview.flow.periodCompletions).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 2,
    });
    expect(overview.flow.uniqueCompletedTasks).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 1,
    });

    // Cohort created in 2026-09-10..2026-09-20: task1 (DONE) + task2 (IN_PROGRESS) => 1 / 2 = 0.5
    expect(overview.flow.cohortCompletionRate).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 0.5,
    });

    expect(overview.flow.totalVisibleTasks).toBe(3);
    expect(overview.flow.countsByStatus[TASK_STATUSES.DONE]).toBe(2);
    expect(overview.flow.countsByStatus[TASK_STATUSES.IN_PROGRESS]).toBe(1);

    // Previous period comparison populated accurately
    expect(overview.flow.previousPeriod).toBeDefined();
    expect(overview.flow.previousPeriod?.throughput).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 1,
    });
    expect(overview.flow.previousPeriod?.effectiveCycleTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
      value: 48 * hourMs,
    });

    // Cross-check domain pure functions directly against the same assertions
    expect(
      calculateLeadTimeMs(
        [
          {
            taskId: task1.id,
            projectId: projectA.id,
            status: TASK_STATUSES.DONE,
            createdAt: asIsoDateTime('2026-09-10T08:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-11T11:00:00.000Z'),
          },
        ],
        customPeriod,
      ),
    ).toEqual(overview.flow.leadTimeMs);
    expect(
      calculateCycleTimeMs(
        [
          {
            cycleId: 'c1',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-10T10:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-10T18:00:00.000Z'),
          },
        ],
        [
          {
            cycleId: 'c1',
            startedAt: asIsoDateTime('2026-09-10T12:00:00.000Z'),
            endedAt: asIsoDateTime('2026-09-10T15:00:00.000Z'),
          },
        ],
        customPeriod,
        'EFFECTIVE',
      ),
    ).toEqual({ status: 'AVAILABLE', value: 5 * hourMs });
    expect(
      countUniqueCompletedTasks(
        [
          {
            cycleId: 'c1',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-10T10:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-10T18:00:00.000Z'),
          },
          {
            cycleId: 'c2',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-11T09:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-11T11:00:00.000Z'),
          },
        ],
        customPeriod,
      ),
    ).toEqual({ status: 'AVAILABLE', value: 1 });
    expect(
      calculateThroughput(
        [
          {
            cycleId: 'c1',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-10T10:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-10T18:00:00.000Z'),
          },
          {
            cycleId: 'c2',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-11T09:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-11T11:00:00.000Z'),
          },
        ],
        customPeriod,
      ),
    ).toEqual({ status: 'AVAILABLE', value: 2 });
    expect(
      countPeriodCompletions(
        [
          {
            cycleId: 'c1',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-10T10:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-10T18:00:00.000Z'),
          },
          {
            cycleId: 'c2',
            taskId: task1.id,
            startedAt: asIsoDateTime('2026-09-11T09:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-11T11:00:00.000Z'),
          },
        ],
        customPeriod,
      ),
    ).toEqual({ status: 'AVAILABLE', value: 2 });
    expect(
      calculateCohortCompletionRate(
        [
          {
            taskId: task1.id,
            projectId: projectA.id,
            status: TASK_STATUSES.DONE,
            createdAt: asIsoDateTime('2026-09-10T08:00:00.000Z'),
            completedAt: asIsoDateTime('2026-09-11T11:00:00.000Z'),
          },
          {
            taskId: task2.id,
            projectId: projectA.id,
            status: TASK_STATUSES.IN_PROGRESS,
            createdAt: asIsoDateTime('2026-09-12T08:00:00.000Z'),
          },
        ],
        customPeriod,
        customPeriod.end,
      ),
    ).toEqual({ status: 'AVAILABLE', value: 0.5 });
  });

  it('returns explicit MetricValue UNAVAILABLE with reason (never implicit 0) when data is absent or unauthorized', async () => {
    const { admin, member1, organization, projectA } = await setupOrgFixture();

    // Empty dataset -> UNAVAILABLE with exact reasons
    const orgOverview = await container.services.analytics.getAnalyticsOverview(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );

    expect(orgOverview.flow.leadTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });
    expect(orgOverview.flow.effectiveCycleTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.NO_COMPLETED_CYCLES,
    });
    expect(orgOverview.flow.totalCycleTimeMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.NO_COMPLETED_CYCLES,
    });
    expect(orgOverview.flow.throughput).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });
    expect(orgOverview.flow.uniqueCompletedTasks).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });
    expect(orgOverview.flow.cohortCompletionRate).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.ZERO_DENOMINATOR,
    });
    expect(orgOverview.impediments.averageResolutionMs).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.INSUFFICIENT_DATA,
    });
    expect(orgOverview.feedback.resolutionRate).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.ZERO_DENOMINATOR,
    });
    expect(orgOverview.feedback.slaSummary.complianceRate).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.ZERO_DENOMINATOR,
    });

    // PERSONAL scope marks team workload average as UNAUTHORIZED
    const personalOverview = await container.services.analytics.getAnalyticsOverview(
      member1.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PERSONAL,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_7_DAYS,
      },
    );
    expect(personalOverview.workload.averageTeamWorkloadScore).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.UNAUTHORIZED,
    });

    // Cohort with no tasks created in period even if project has tasks elsewhere
    await container.services.tasks.createTask(admin.user.id, organization.id, projectA.id, {
      title: 'Tarefa criada em setembro',
      priority: PRIORITIES.LOW,
    });
    const futureOverview = await container.services.analytics.getAnalyticsOverview(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        preset: ANALYTICS_PERIOD_PRESETS.CUSTOM,
        customRange: {
          start: asIsoDateTime('2027-01-01T00:00:00.000Z'),
          end: asIsoDateTime('2027-01-31T23:59:59.000Z'),
        },
      },
    );
    expect(futureOverview.flow.cohortCompletionRate).toEqual({
      status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
      reason: METRIC_UNAVAILABLE_REASONS.ZERO_DENOMINATOR,
    });
  });

  it('preserves historical FeedbackCategoryVersion v1/v2 & ContestReasonVersion v1/v2, cycle origins, SLA statuses, and strictly excludes internal notes & internal attachments', async () => {
    const { admin, managerA, member1, member2, organization } = await setupOrgFixture();

    // Create Category v1 and ContestReason v1
    currentNow = asIsoDateTime('2026-09-02T09:00:00.000Z');
    const catV1 = await container.services.feedback.createFeedbackCategory(
      admin.user.id,
      organization.id,
      {
        code: 'CAT_ANALYTICS_HIST',
        name: 'Categoria Historica v1',
        description: 'Versao 1',
      },
    );
    const reasonV1 = await container.services.feedback.createFeedbackContestReason(
      admin.user.id,
      organization.id,
      {
        code: 'REASON_ANALYTICS_HIST',
        name: 'Motivo Historico v1',
        description: 'Versao 1 do motivo',
      },
    );

    // Feedback 1 created under Category v1 by member1, assigned to managerA
    currentNow = asIsoDateTime('2026-09-03T10:00:00.000Z');
    const fb1 = await container.services.feedback.createFeedback(member1.user.id, organization.id, {
      title: 'Feedback Ciclo Contestacao',
      description: 'Descricao publica do feedback 1',
      moduleKey: 'tasks',
      categoryId: catV1.category.id,
      priority: PRIORITIES.HIGH,
    });
    await container.services.feedback.transitionFeedbackStatus(
      admin.user.id,
      organization.id,
      fb1.id,
      { targetStatus: FEEDBACK_STATUSES.IN_ANALYSIS },
    );
    await container.services.feedback.assignFeedback(admin.user.id, organization.id, fb1.id, {
      assigneeId: managerA.user.id,
    });
    await container.services.feedback.transitionFeedbackStatus(
      managerA.user.id,
      organization.id,
      fb1.id,
      { targetStatus: FEEDBACK_STATUSES.IN_PROGRESS },
    );

    // Add confidential internal note + internal attachment (linked to internalNoteId) that MUST NOT appear in Analytics
    const secretNote = await container.services.feedback.addFeedbackInternalNote(
      admin.user.id,
      organization.id,
      fb1.id,
      {
        body: 'SEGREDO_INTERNO_DO_ATENDIMENTO_QUE_NAO_PODE_VAZAR',
      },
    );
    await container.services.feedback.uploadFeedbackAttachment(
      admin.user.id,
      organization.id,
      fb1.id,
      {
        fileName: 'segredo_interno_anexo.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('conteudo-interno-restrito'),
        internalNoteId: secretNote.id,
      },
    );

    // First response & resolve fb1
    currentNow = asIsoDateTime('2026-09-03T11:00:00.000Z');
    await container.services.feedback.addFeedbackMessage(
      managerA.user.id,
      organization.id,
      fb1.id,
      { body: 'Analise iniciada.' },
    );
    currentNow = asIsoDateTime('2026-09-03T14:00:00.000Z');
    await container.services.feedback.transitionFeedbackStatus(
      managerA.user.id,
      organization.id,
      fb1.id,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Resolvido no ciclo 1',
      },
    );

    // Member1 contests fb1 using ContestReason v1 -> Admin accepts and reopens (CONTESTATION_REOPEN)
    currentNow = asIsoDateTime('2026-09-04T09:00:00.000Z');
    const contest1 = await container.services.feedback.openFeedbackContest(
      member1.user.id,
      organization.id,
      fb1.id,
      {
        reasonId: reasonV1.reason.id,
        justification: 'Problema persiste apos teste',
      },
    );
    currentNow = asIsoDateTime('2026-09-04T11:00:00.000Z');
    await container.services.feedback.decideFeedbackContest(
      admin.user.id,
      organization.id,
      fb1.id,
      contest1.id,
      {
        outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        justification: 'Reaberto via contestacao',
      },
    );

    // Update Category to v2 and ContestReason to v2!
    currentNow = asIsoDateTime('2026-09-05T08:00:00.000Z');
    const catV2 = await container.services.feedback.updateFeedbackCategory(
      admin.user.id,
      organization.id,
      catV1.category.id,
      {
        name: 'Categoria Historica v2 Renomeada',
      },
    );
    const reasonV2 = await container.services.feedback.updateFeedbackContestReason(
      admin.user.id,
      organization.id,
      reasonV1.reason.id,
      {
        name: 'Motivo Historico v2 Renomeado',
      },
    );

    // Feedback 2 created under Category v2 by member2, resolved, expires contest window, then reopened via EXCEPTIONAL_REOPEN
    currentNow = asIsoDateTime('2026-09-06T09:00:00.000Z');
    const fb2 = await container.services.feedback.createFeedback(member2.user.id, organization.id, {
      title: 'Feedback Reabertura Excepcional',
      description: 'Descricao feedback 2',
      moduleKey: 'kanban',
      categoryId: catV1.category.id,
      priority: PRIORITIES.MEDIUM,
    });
    await container.services.feedback.transitionFeedbackStatus(
      admin.user.id,
      organization.id,
      fb2.id,
      { targetStatus: FEEDBACK_STATUSES.IN_ANALYSIS },
    );
    await container.services.feedback.assignFeedback(admin.user.id, organization.id, fb2.id, {
      assigneeId: admin.user.id,
    });
    // Advance clock > 10 days to force BREACHED SLA on fb2 cycle 1
    currentNow = asIsoDateTime('2026-09-12T10:00:00.000Z');
    await container.services.feedback.evaluateFeedbackSlas(admin.user.id, organization.id);
    await container.services.feedback.transitionFeedbackStatus(
      admin.user.id,
      organization.id,
      fb2.id,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Resolvido apos prazo',
      },
    );
    const slaSettings = await container.services.feedback.getFeedbackSlaSettings(
      admin.user.id,
      organization.id,
    );
    currentNow = asIsoDateTime(
      new Date(Date.parse(currentNow) + slaSettings.feedbackContestWindowMs + 60_000).toISOString(),
    );
    await container.services.feedback.evaluateFeedbackSlas(admin.user.id, organization.id);

    const reopenReq = await container.services.feedback.requestExceptionalReopen(
      member2.user.id,
      organization.id,
      fb2.id,
      { justification: 'Reincidencia critica apos fechamento' },
    );
    await container.services.feedback.decideExceptionalReopen(
      admin.user.id,
      organization.id,
      fb2.id,
      reopenReq.id,
      {
        decision: REOPEN_REQUEST_STATUSES.APPROVED,
        justification: 'Aprovada reabertura excepcional',
      },
    );

    // Feedback 3: create contest using ContestReason v2 (needs resolved feedback first)
    currentNow = asIsoDateTime('2026-09-18T14:00:00.000Z');
    const fb3 = await container.services.feedback.createFeedback(member1.user.id, organization.id, {
      title: 'Feedback Contestacao v2',
      description: 'Descricao feedback 3',
      moduleKey: 'reports',
      categoryId: catV1.category.id,
      priority: PRIORITIES.LOW,
    });
    await container.services.feedback.transitionFeedbackStatus(
      admin.user.id,
      organization.id,
      fb3.id,
      { targetStatus: FEEDBACK_STATUSES.IN_ANALYSIS },
    );
    await container.services.feedback.transitionFeedbackStatus(
      admin.user.id,
      organization.id,
      fb3.id,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Resolvido rapidamente',
      },
    );
    await container.services.feedback.openFeedbackContest(
      member1.user.id,
      organization.id,
      fb3.id,
      {
        reasonId: reasonV1.reason.id,
        justification: 'Contestado com motivo v2',
      },
    );

    // Unused initial categories/reasons exist, validate ADMIN overview
    currentNow = asIsoDateTime('2026-09-20T12:00:00.000Z');
    const overview = await container.services.analytics.getAnalyticsOverview(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );

    expect(overview.feedback.totalInPeriod).toBe(3);
    expect(overview.feedback.contestsInPeriod).toBe(2);
    expect(overview.feedback.reopeningsInPeriod).toBe(2); // 1 CONTESTATION_REOPEN + 1 EXCEPTIONAL_REOPEN

    // Both Category v1 and v2 preserved separately with exact historical names and versionNumbers
    expect(overview.feedback.byCategoryVersion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionId: catV1.currentVersion.id,
          name: 'Categoria Historica v1',
          versionNumber: 1,
          count: 1,
        }),
        expect.objectContaining({
          versionId: catV2.currentVersion.id,
          name: 'Categoria Historica v2 Renomeada',
          versionNumber: 2,
          count: 2,
        }),
      ]),
    );

    // Both ContestReason v1 and v2 preserved separately
    expect(overview.feedback.byContestReasonVersion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionId: reasonV1.currentVersion.id,
          name: 'Motivo Historico v1',
          versionNumber: 1,
          count: 1,
        }),
        expect.objectContaining({
          versionId: reasonV2.currentVersion.id,
          name: 'Motivo Historico v2 Renomeado',
          versionNumber: 2,
          count: 1,
        }),
      ]),
    );

    // All three cycle origins accounted for
    const originCounts = new Map(
      overview.feedback.cyclesByOrigin.map((bucket) => [bucket.key, bucket.count]),
    );
    expect(originCounts.get(CYCLE_ORIGINS.INITIAL)).toBe(3);
    expect(originCounts.get(CYCLE_ORIGINS.CONTESTATION_REOPEN)).toBe(1);
    expect(originCounts.get(CYCLE_ORIGINS.EXCEPTIONAL_REOPEN)).toBe(1);

    // SLA summary captures both ON_TRACK and BREACHED cycles
    expect(overview.feedback.slaSummary.breachedCount).toBeGreaterThanOrEqual(1);
    expect(overview.feedback.slaSummary.onTrackCount).toBeGreaterThanOrEqual(1);
    expect(overview.feedback.slaSummary.complianceRate.status).toBe(
      METRIC_AVAILABILITY_STATUSES.AVAILABLE,
    );

    // Strict exclusion of internal notes and internal attachments
    const serialized = JSON.stringify(overview);
    expect(serialized).not.toContain('SEGREDO_INTERNO_DO_ATENDIMENTO_QUE_NAO_PODE_VAZAR');
    expect(serialized).not.toContain('segredo_interno_anexo.txt');
    expect(serialized).not.toContain(secretNote.id);
    expect(serialized).not.toContain(INITIAL_FEEDBACK_CATEGORIES.OTHER);
    expect(serialized).not.toContain(INITIAL_CONTEST_REASONS.OTHER);
    expect(asFeedbackCategoryId(catV1.category.id)).toBe(catV1.category.id);
    expect(asFeedbackContestReasonId(reasonV1.reason.id)).toBe(reasonV1.reason.id);

    // Item-by-item FEEDBACK_VIEW filtering: member1 sees only their 2 feedbacks (not member2's fb2)
    const member1Overview = await container.services.analytics.getAnalyticsOverview(
      member1.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PERSONAL,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(member1Overview.feedback.totalInPeriod).toBe(2);
    expect(member1Overview.feedback.assigneePerformance).toEqual([]);
  });

  it('enforces ABAC/Privacy: Default Deny allowManagerViewIndividualProductivity, item-by-item TASK_VIEW filtering, isDemoIsolated and cross-org isolation', async () => {
    const { admin, managerA, managerB, member1, member2, organization, projectA, projectB } =
      await setupOrgFixture();

    // Seed tasks in Project A:
    // - taskA1 assigned to member1 (visible to member1 via TASK_VIEW)
    // - taskA2 assigned only to member2 (hidden from member1 via item-by-item TASK_VIEW)
    // - taskB1 in Project B (hidden from member1 and managerA via TASK_VIEW)
    const taskA1 = await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Visivel Membro 1 Projeto A',
        priority: PRIORITIES.CRITICAL,
        assigneeId: member1.user.id,
      },
    );
    await container.services.tasks.startTask(managerA.user.id, organization.id, taskA1.id);
    currentNow = asIsoDateTime('2026-09-02T12:00:00.000Z');
    await container.services.tasks.completeTask(managerA.user.id, organization.id, taskA1.id);

    const taskA2 = await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Exclusiva Membro 2 Projeto A',
        priority: PRIORITIES.MEDIUM,
        assigneeId: member2.user.id,
      },
    );

    const taskB1 = await container.services.tasks.createTask(
      managerB.user.id,
      organization.id,
      projectB.id,
      {
        title: 'Tarefa Privada Projeto B',
        priority: PRIORITIES.HIGH,
        assigneeId: managerB.user.id,
      },
    );
    await container.services.tasks.startTask(managerB.user.id, organization.id, taskB1.id);
    currentNow = asIsoDateTime('2026-09-03T12:00:00.000Z');
    await container.services.tasks.completeTask(managerB.user.id, organization.id, taskB1.id);

    // Seed third-party OVERLOAD alert in Project A targeting member2
    await container.repositories.bottlenecks.bottleneckAlerts.save({
      id: asBottleneckAlertId(crypto.randomUUID()),
      organizationId: organization.id,
      projectId: projectA.id,
      indicator: BOTTLENECK_INDICATORS.OVERLOAD,
      severity: BOTTLENECK_SEVERITIES.HIGH,
      status: BOTTLENECK_ALERT_STATUSES.OPEN,
      deduplicationKey: `${organization.id}:OVERLOAD:USER:${member2.user.id}`,
      targetEntityType: 'USER',
      targetEntityId: member2.user.id,
      summary: 'Sobrecarga individual Membro 2',
      detectedAt: currentNow,
      lastSeenAt: currentNow,
      occurrenceCount: 1,
    });

    // 1. MEMBER & MANAGER are denied ORGANIZATION scope
    await expect(
      container.services.analytics.getAnalyticsOverview(member1.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.analytics.getAnalyticsOverview(managerA.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
      }),
    ).rejects.toThrow(AuthorizationError);

    // 2. MEMBER in Project A: TASK_VIEW keeps taskA1, excludes taskA2 and taskB1; third-party workload & OVERLOAD alert are hidden
    const memberProjectA = await container.services.analytics.getAnalyticsOverview(
      member1.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(memberProjectA.includesThirdPartyIndividualMetrics).toBe(false);
    expect(memberProjectA.workload.memberWorkloads).toEqual([]);
    expect(memberProjectA.bottlenecks.alerts.some((a) => a.indicator === 'OVERLOAD')).toBe(false);
    expect(memberProjectA.flow.totalVisibleTasks).toBe(1);
    expect(JSON.stringify(memberProjectA)).not.toContain(taskA2.id);
    expect(JSON.stringify(memberProjectA)).not.toContain(taskB1.id);

    // 3. MANAGER in managed Project A with Default Deny (allowManagerViewIndividualProductivity === false)
    const managerDefaultDeny = await container.services.analytics.getAnalyticsOverview(
      managerA.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(managerDefaultDeny.includesThirdPartyIndividualMetrics).toBe(false);
    expect(managerDefaultDeny.workload.memberWorkloads).toEqual([]);
    expect(managerDefaultDeny.bottlenecks.alerts.some((a) => a.indicator === 'OVERLOAD')).toBe(
      false,
    );

    // 4. Enable allowManagerViewIndividualProductivity = true -> MANAGER sees third-party metrics ONLY in managed Project A
    await container.services.bottlenecks.updateIndividualProductivityVisibility(
      admin.user.id,
      organization.id,
      {
        allowManagerViewIndividualProductivity: true,
        justification: 'Aprovado para gestores de projeto',
      },
    );

    const managerAllowed = await container.services.analytics.getAnalyticsOverview(
      managerA.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(managerAllowed.includesThirdPartyIndividualMetrics).toBe(true);
    expect(managerAllowed.workload.memberWorkloads.length).toBeGreaterThan(0);
    expect(managerAllowed.bottlenecks.alerts.some((a) => a.indicator === 'OVERLOAD')).toBe(true);

    // MEMBER STILL denied third-party productivity even when allowManagerViewIndividualProductivity === true
    const memberStillDenied = await container.services.analytics.getAnalyticsOverview(
      member1.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(memberStillDenied.includesThirdPartyIndividualMetrics).toBe(false);
    expect(memberStillDenied.workload.memberWorkloads).toEqual([]);

    // MANAGER A cannot access Project B (not managed/participated)
    await expect(
      container.services.analytics.getAnalyticsOverview(managerA.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectB.id,
      }),
    ).rejects.toThrow(AuthorizationError);

    // 5. Cross-org isolation and Demo isolation (isDemoIsolated)
    await container.seedDemoOrganization(currentNow);
    const demoAdminOverview = await container.services.analytics.getAnalyticsOverview(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(demoAdminOverview.isDemoOrganization).toBe(true);
    expect(JSON.stringify(demoAdminOverview)).not.toContain(taskA1.id);

    const realAdminOverview = await container.services.analytics.getAnalyticsOverview(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      },
    );
    expect(realAdminOverview.isDemoOrganization).toBe(false);
    expect(JSON.stringify(realAdminOverview)).not.toContain(DEMO_PROJECT_ID);

    // Cross-org access attempt fails
    await expect(
      container.services.analytics.getAnalyticsOverview(admin.user.id, DEMO_ORG_ID, {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.analytics.getAnalyticsOverview(DEMO_MEMBER_USER_ID, organization.id, {
        scope: DASHBOARD_SCOPES.PERSONAL,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.analytics.getAnalyticsOverview(admin.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: DEMO_PROJECT_ID,
      }),
    ).rejects.toThrow(NotFoundError);
    expect(DEMO_MANAGER_USER_ID).toBeTruthy();
  });

  it('supports DashboardPreference CRUD across PERSONAL/PROJECT/ORGANIZATION preserving existing.id, user/org/demo isolation and resetDashboardPreference', async () => {
    const { admin, member1, member2, organization, projectA } = await setupOrgFixture();
    await container.seedDemoOrganization(currentNow);

    const domainEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      if (
        event.eventType === 'analytics.dashboard_preference.saved' ||
        event.eventType === 'analytics.dashboard_preference.reset'
      ) {
        domainEvents.push(event);
      }
    });

    // Initial default preference for PERSONAL
    const initialPersonal = await container.services.analytics.getDashboardPreference(
      member1.user.id,
      organization.id,
      { scope: DASHBOARD_SCOPES.PERSONAL },
    );
    expect(initialPersonal.isDefault).toBe(true);
    expect(initialPersonal.preference.isDemoIsolated).toBe(false);

    // Save PERSONAL preference first time
    const saved1 = await container.services.analytics.saveDashboardPreference(
      member1.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PERSONAL,
        widgets: [
          { widgetKey: 'my-workload', visible: true, order: 0 },
          { widgetKey: 'flow-kpis', visible: false, order: 1 },
        ],
      },
    );
    expect(saved1.isDemoIsolated).toBe(false);

    // Save PERSONAL preference second time -> Dexie logical uniqueness MUST preserve existing.id
    const saved2 = await container.services.analytics.saveDashboardPreference(
      member1.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PERSONAL,
        widgets: [{ widgetKey: 'flow-kpis', visible: true, order: 0 }],
      },
    );
    expect(saved2.id).toBe(saved1.id);

    // Save PROJECT and ORGANIZATION preferences
    const projectPref = await container.services.analytics.saveDashboardPreference(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.PROJECT,
        projectId: projectA.id,
        widgets: [{ widgetKey: 'team-workload', visible: true, order: 0 }],
      },
    );
    const orgPref = await container.services.analytics.saveDashboardPreference(
      admin.user.id,
      organization.id,
      {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
        widgets: [{ widgetKey: 'bottlenecks-alerts', visible: true, order: 0 }],
      },
    );
    expect(projectPref.id).not.toBe(orgPref.id);

    // User isolation: member2 still gets default PERSONAL preference
    const member2Initial = await container.services.analytics.getDashboardPreference(
      member2.user.id,
      organization.id,
      { scope: DASHBOARD_SCOPES.PERSONAL },
    );
    expect(member2Initial.isDefault).toBe(true);

    // Demo isolation: demo member preference has isDemoIsolated === true
    const demoSaved = await container.services.analytics.saveDashboardPreference(
      DEMO_MEMBER_USER_ID,
      DEMO_ORG_ID,
      {
        scope: DASHBOARD_SCOPES.PERSONAL,
        widgets: [{ widgetKey: 'my-workload', visible: true, order: 0 }],
      },
    );
    expect(demoSaved.isDemoIsolated).toBe(true);

    // Reset restores default widgets while preserving existing.id
    const resetPersonal = await container.services.analytics.resetDashboardPreference(
      member1.user.id,
      organization.id,
      { scope: DASHBOARD_SCOPES.PERSONAL },
    );
    expect(resetPersonal.id).toBe(saved1.id);
    expect(resetPersonal.widgets.length).toBeGreaterThan(1);

    const listInDexie = await container.repositories.analytics.dashboardPreferences.listByUser(
      organization.id,
      member1.user.id,
    );
    expect(listInDexie).toHaveLength(1);
    expect(listInDexie[0]?.id).toBe(saved1.id);

    // Validation guards
    await expect(
      container.services.analytics.saveDashboardPreference(member1.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.PERSONAL,
        widgets: [
          { widgetKey: 'flow-kpis', visible: true, order: 0 },
          { widgetKey: 'flow-kpis', visible: false, order: 1 },
        ],
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      container.services.analytics.getDashboardPreference(member1.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.PROJECT,
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      container.services.analytics.getDashboardPreference(member1.user.id, organization.id, {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
      }),
    ).rejects.toThrow(AuthorizationError);

    expect(domainEvents.some((e) => e.eventType === 'analytics.dashboard_preference.saved')).toBe(
      true,
    );
    expect(domainEvents.some((e) => e.eventType === 'analytics.dashboard_preference.reset')).toBe(
      true,
    );
  });

  it('enforces DN-06 ANALYTICS_RULES_MANAGE: ADMIN-only, workload & focus weight sums = 1.0, inactivityThresholdDays, AuditEvent and post-commit domain event', async () => {
    const { admin, managerA, member1, organization } = await setupOrgFixture();
    const calibrationEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      if (event.eventType === 'analytics.calibration.updated') {
        calibrationEvents.push(event);
      }
    });

    // MANAGER and MEMBER denied both read and update
    await expect(
      container.services.analytics.getCalibrationSettings(managerA.user.id, organization.id),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.analytics.getCalibrationSettings(member1.user.id, organization.id),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.analytics.updateCalibrationSettings(managerA.user.id, organization.id, {
        calibratableWeights: { workloadPausedFactor: 0.4 },
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.analytics.updateCalibrationSettings(member1.user.id, organization.id, {
        calibratableWeights: { workloadPausedFactor: 0.4 },
      }),
    ).rejects.toThrow(AuthorizationError);

    // Invalid workload sum (!= 1.0)
    await expect(
      container.services.analytics.updateCalibrationSettings(admin.user.id, organization.id, {
        calibratableWeights: {
          workloadPriorityWeight: 0.5,
          workloadDelayWeight: 0.5,
          workloadImpedimentsWeight: 0.2,
          workloadOperationalStateWeight: 0.1,
        },
      }),
    ).rejects.toThrow(ValidationError);

    // Invalid focus sum (!= 1.0)
    await expect(
      container.services.analytics.updateCalibrationSettings(admin.user.id, organization.id, {
        calibratableWeights: {
          focusPriorityWeight: 0.8,
          focusDeadlineWeight: 0.4,
        },
      }),
    ).rejects.toThrow(ValidationError);

    // Valid calibration update (both groups sum to 1.0)
    const updated = await container.services.analytics.updateCalibrationSettings(
      admin.user.id,
      organization.id,
      {
        calibratableWeights: {
          workloadPriorityWeight: 0.4,
          workloadDelayWeight: 0.25,
          workloadImpedimentsWeight: 0.2,
          workloadOperationalStateWeight: 0.15,
          workloadPausedFactor: 0.4,
          focusPriorityWeight: 0.35,
          focusDeadlineWeight: 0.25,
          focusDependenciesWeight: 0.2,
          focusInactivityWeight: 0.1,
          focusWorkloadCompatibilityWeight: 0.1,
          defaultProjectInactivityThresholdDays: 14,
        },
        justification: 'Calibracao trimestral de pesos',
      },
    );

    expect(updated.calibratableWeights.workloadPriorityWeight).toBe(0.4);
    expect(updated.calibratableWeights.focusPriorityWeight).toBe(0.35);
    expect(updated.calibratableWeights.defaultProjectInactivityThresholdDays).toBe(14);

    // Read back persisted calibration
    const reloaded = await container.services.analytics.getCalibrationSettings(
      admin.user.id,
      organization.id,
    );
    expect(reloaded.calibratableWeights).toEqual(updated.calibratableWeights);

    // AuditEvent persisted with before/after & justification
    const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
      organization.id,
      { page: 1, pageSize: 50 },
    );
    const calibrationAudit = auditPage.items.find(
      (event) => event.eventType === 'analytics.calibration.updated',
    );
    expect(calibrationAudit).toBeDefined();
    expect(calibrationAudit?.category).toBe(AUDIT_CATEGORIES.ORGANIZATION);
    expect(calibrationAudit?.justification).toBe('Calibracao trimestral de pesos');
    expect(calibrationEvents).toHaveLength(1);

    // Non-existent org check -> NotFoundError (DENIED_RESOURCE_NOT_FOUND)
    await expect(
      container.services.analytics.getCalibrationSettings(
        admin.user.id,
        asOrganizationId('00000000-0000-4000-8000-000000009999'),
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
