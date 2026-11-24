import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import {
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  asBottleneckAlertId,
  buildBottleneckDeduplicationKey,
  type BottleneckAlert,
} from '@/modules/bottlenecks';
import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';
import { BOARD_COLUMN_ROLES } from '@/modules/kanban';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  asCorrelationId,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('BottleneckService Integration (Dexie, Workload 0-100, 5 Indicators, Deduplication, DN-02 Privacy, 409 Archived/Deleted & Audit/Events)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-08-20T12:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_bottlenecks_service_${crypto.randomUUID()}`,
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

  async function setupBottleneckFixture() {
    const admin = await registerUser('admin.bn@pms.local', 'Admin Gargalos');
    const manager = await registerUser('manager.bn@pms.local', 'Gestor Gargalos');
    const otherManager = await registerUser('manager2.bn@pms.local', 'Gestor Projeto B');
    const member1 = await registerUser('member1.bn@pms.local', 'Membro 1 Gargalos');
    const member2 = await registerUser('member2.bn@pms.local', 'Membro 2 Gargalos');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Bottlenecks Org',
        slug: 'bottlenecks-org',
      },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
      [otherManager.user.id, ORGANIZATION_ROLES.MANAGER],
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
        name: 'Projeto Gargalos A',
        ownerUserId: manager.user.id,
      },
    );
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      projectA.id,
      member1.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      projectA.id,
      member2.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    const projectB = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      {
        name: 'Projeto Gargalos B Restrito',
        ownerUserId: otherManager.user.id,
      },
    );

    return {
      admin,
      manager,
      otherManager,
      member1,
      member2,
      organization,
      projectA,
      projectB,
    };
  }

  it('calcula Carga de Trabalho 0-100 (representsHours: false), aplica redução de 50% em PAUSED, exclui DONE/CANCELLED, faz rateio 1/N e soma Subtask OPEN independente', async () => {
    const { manager, member1, member2, organization, projectA } = await setupBottleneckFixture();

    const boardView = await container.services.kanban.getProjectBoard(
      manager.user.id,
      organization.id,
      projectA.id,
    );
    const execCol = boardView.columns.filter(
      (c) => c.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL,
    )[0]!;
    await container.services.kanban.updateColumn(
      manager.user.id,
      organization.id,
      projectA.id,
      execCol.id,
      { wipLimit: 10 },
    );

    // 1. DONE and CANCELLED tasks must contribute 0
    const doneTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Concluída Zero Carga',
        priority: PRIORITIES.CRITICAL,
        assigneeId: member1.user.id,
      },
    );
    await container.services.tasks.completeTask(manager.user.id, organization.id, doneTask.id);

    const cancelledTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Cancelada Zero Carga',
        priority: PRIORITIES.CRITICAL,
        assigneeId: member1.user.id,
      },
    );
    await container.services.tasks.cancelTask(manager.user.id, organization.id, cancelledTask.id, {
      justification: 'Cancelada para validar peso zero',
    });

    const zeroSummary = await container.services.bottlenecks.getMyWorkloadSummary(
      member1.user.id,
      organization.id,
    );
    expect(zeroSummary.workload).toEqual({
      score: 0,
      level: BOTTLENECK_SEVERITIES.LOW,
      activeTaskCount: 0,
      activeSubtaskCount: 0,
      representsHours: false,
    });

    // 2. Active task -> paused task reduces score by 50%
    const activeTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Ativa vs Pausada',
        priority: PRIORITIES.CRITICAL,
        assigneeId: member1.user.id,
        dueDate: asIsoDateTime('2026-08-10T12:00:00.000Z'), // overdue > 7 days
      },
    );
    await container.services.tasks.startTask(member1.user.id, organization.id, activeTask.id);
    const activeSummary = await container.services.bottlenecks.getMyWorkloadSummary(
      member1.user.id,
      organization.id,
    );
    expect(activeSummary.workload.representsHours).toBe(false);
    expect(activeSummary.workload.activeTaskCount).toBe(1);
    expect(activeSummary.breakdown.inProgressCount).toBe(1);
    expect(activeSummary.breakdown.overdueCount).toBe(1);

    await container.services.tasks.pauseTask(member1.user.id, organization.id, activeTask.id, {
      reason: 'Pausada para validar redução 50%',
    });
    const pausedSummary = await container.services.bottlenecks.getMyWorkloadSummary(
      member1.user.id,
      organization.id,
    );
    expect(pausedSummary.breakdown.pausedCount).toBe(1);
    expect(pausedSummary.workload.score).toBeLessThan(activeSummary.workload.score);
    expect(pausedSummary.workload.score).toBe(Math.round(activeSummary.workload.score * 0.47)); // 50% pausedFactor with PAUSED operational state (60 vs 100)

    // Resume and add participant -> equal split 1 / 2
    await container.services.tasks.resumeTask(member1.user.id, organization.id, activeTask.id);
    await container.services.tasks.addTaskParticipant(
      manager.user.id,
      organization.id,
      activeTask.id,
      { userId: member2.user.id },
    );
    const sharedSummary = await container.services.bottlenecks.getMyWorkloadSummary(
      member1.user.id,
      organization.id,
    );
    expect(sharedSummary.breakdown.sharedTaskCount).toBe(1);
    expect(sharedSummary.workload.score).toBe(Math.round(activeSummary.workload.score / 2));

    // 3. Independent OPEN Subtask assigned to member2 on a task owned by manager
    const managerParentTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa do Gestor com Subtarefa para Membro 2',
        priority: PRIORITIES.CRITICAL,
        assigneeId: manager.user.id,
        dueDate: asIsoDateTime('2026-08-10T12:00:00.000Z'),
      },
    );
    const member2BeforeSub = await container.services.bottlenecks.getMyWorkloadSummary(
      member2.user.id,
      organization.id,
    );
    await container.services.tasks.createSubtask(
      manager.user.id,
      organization.id,
      managerParentTask.id,
      {
        title: 'Subtarefa Independente M2',
        assigneeId: member2.user.id,
      },
    );
    const member2WithSub = await container.services.bottlenecks.getMyWorkloadSummary(
      member2.user.id,
      organization.id,
    );
    expect(member2WithSub.workload.activeSubtaskCount).toBe(
      member2BeforeSub.workload.activeSubtaskCount + 1,
    );
    expect(member2WithSub.breakdown.openSubtaskCount).toBe(
      member2BeforeSub.breakdown.openSubtaskCount + 1,
    );
    expect(member2WithSub.workload.score).toBeGreaterThan(member2BeforeSub.workload.score);
  });

  it('avalia todos os 5 indicadores (WIP, INACTIVITY via lastMovedAt diferenciando BLOCKED, OVERDUE, IMPEDIMENTS, OVERLOAD), deduplica alertas e impõe OPEN -> ACKNOWLEDGED -> RESOLVED', async () => {
    const { admin, manager, member1, member2, organization, projectA } =
      await setupBottleneckFixture();

    const boardView = await container.services.kanban.getProjectBoard(
      manager.user.id,
      organization.id,
      projectA.id,
    );
    const reviewCol = boardView.columns.filter(
      (c) => c.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL,
    )[1]!; // wipLimit = 2
    const execCol = boardView.columns.filter(
      (c) => c.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL,
    )[0]!; // wipLimit = 3

    // Create 5 overdue critical tasks for member2 -> triggers OVERLOAD & OVERDUE & WIP (3 in REVIEW)
    const createdTasks = [];
    for (let i = 0; i < 5; i += 1) {
      const created = await container.services.tasks.createTask(
        manager.user.id,
        organization.id,
        projectA.id,
        {
          title: `Gargalo Task ${i + 1}`,
          priority: PRIORITIES.CRITICAL,
          assigneeId: member2.user.id,
          dueDate: asIsoDateTime('2026-08-05T12:00:00.000Z'),
        },
      );
      createdTasks.push(created);
    }

    // Move tasks 0, 1, 2 to REVIEW (2/2 + 1 override = 3/2 WIP exceeded)
    // Also pause task 0 to prove PAUSED still occupies WIP
    for (let i = 0; i < 3; i += 1) {
      await container.services.kanban.moveCard(
        manager.user.id,
        organization.id,
        projectA.id,
        createdTasks[i]!.id,
        {
          targetColumnId: reviewCol.id,
          ...(i === 2 ? { wipOverrideJustification: 'Revisão paralela crítica' } : {}),
        },
      );
    }
    await container.services.tasks.pauseTask(
      manager.user.id,
      organization.id,
      createdTasks[0]!.id,
      {
        reason: 'Pausada mantendo ocupação WIP',
      },
    );

    // Move task 3 to execCol (1/3) and open blocking impediment on task 4 (BLOCKED)
    await container.services.kanban.moveCard(
      manager.user.id,
      organization.id,
      projectA.id,
      createdTasks[3]!.id,
      { targetColumnId: execCol.id },
    );
    await container.services.impediments.createImpediment(
      manager.user.id,
      organization.id,
      createdTasks[4]!.id,
      {
        category: IMPEDIMENT_CATEGORIES.AWAITING_APPROVAL,
        severity: IMPEDIMENT_SEVERITIES.CRITICAL,
        description: 'Aprovação pendente crítica',
      },
    );

    // Backdate lastMovedAt on tasks 1, 2 AND blocked task 4, while updating comment (lastActivityAt = currentNow)
    await container.services.tasks.addTaskComment(
      manager.user.id,
      organization.id,
      createdTasks[1]!.id,
      { body: 'Comentário recente que NÃO deve zerar inatividade de movimentação' },
    );
    for (const idx of [1, 2, 4]) {
      const stored = await container.repositories.tasks.tasks.findById(
        organization.id,
        createdTasks[idx]!.id,
      );
      if (stored) {
        await container.repositories.tasks.tasks.save({
          ...stored,
          lastMovedAt: asIsoDateTime('2026-08-01T12:00:00.000Z'), // 19 days >= 7
          lastActivityAt: currentNow,
        });
      }
    }

    // Also add 1 task in execCol for member1 to test preventive WIP warning (2/3 = 67% if threshold 65%)
    const member1Task = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa do Membro 1',
        priority: PRIORITIES.LOW,
        assigneeId: member1.user.id,
        columnId: execCol.id,
      },
    );
    expect(member1Task.columnId).toBe(execCol.id);

    // DN-04: getProjectBottlenecksOverview computes live without persisting alerts
    const overviewBefore = await container.services.bottlenecks.getProjectBottlenecksOverview(
      admin.user.id,
      organization.id,
      projectA.id,
    );
    expect(overviewBefore.activeAlerts).toHaveLength(0);
    expect(overviewBefore.indicators.wipExceededColumnsCount).toBe(1);
    expect(overviewBefore.indicators.inactiveTaskCount).toBe(2);
    expect(overviewBefore.indicators.inactiveTasks.map((t) => t.taskId)).not.toContain(
      createdTasks[4]!.id,
    );
    expect(overviewBefore.indicators.blockedTaskCount).toBe(1);
    expect(overviewBefore.indicators.blockedTasks.map((t) => t.taskId)).toEqual([
      createdTasks[4]!.id,
    ]);
    expect(overviewBefore.indicators.overdueTaskCount).toBe(5);
    expect(overviewBefore.indicators.overloadedMemberCount).toBe(1);

    // Item-by-item TASK_VIEW filtering for member1 in overview: member1 does NOT see member2's task titles
    const member1Overview = await container.services.bottlenecks.getProjectBottlenecksOverview(
      member1.user.id,
      organization.id,
      projectA.id,
    );
    expect(member1Overview.indicators.inactiveTaskCount).toBe(2);
    expect(member1Overview.indicators.inactiveTasks).toHaveLength(0);
    expect(member1Overview.indicators.overdueTasks).toHaveLength(0);
    expect(member1Overview.indicators.blockedTasks).toHaveLength(0);

    // Evaluate persists all 5 indicators with canonical deduplication keys
    const eval1 = await container.services.bottlenecks.evaluateProjectBottlenecks(
      admin.user.id,
      organization.id,
      projectA.id,
    );
    expect(eval1.detectedCandidateCount).toBe(5);
    const byIndicator = new Map(eval1.alerts.map((a) => [a.indicator, a]));
    expect(byIndicator.get(BOTTLENECK_INDICATORS.WIP)?.deduplicationKey).toBe(
      buildBottleneckDeduplicationKey(
        organization.id,
        BOTTLENECK_INDICATORS.WIP,
        'BOARD_COLUMN',
        reviewCol.id,
      ),
    );
    expect(byIndicator.get(BOTTLENECK_INDICATORS.INACTIVITY)?.deduplicationKey).toBe(
      buildBottleneckDeduplicationKey(
        organization.id,
        BOTTLENECK_INDICATORS.INACTIVITY,
        'PROJECT',
        projectA.id,
      ),
    );
    expect(byIndicator.get(BOTTLENECK_INDICATORS.OVERDUE)?.deduplicationKey).toBe(
      buildBottleneckDeduplicationKey(
        organization.id,
        BOTTLENECK_INDICATORS.OVERDUE,
        'PROJECT',
        projectA.id,
      ),
    );
    expect(byIndicator.get(BOTTLENECK_INDICATORS.IMPEDIMENTS)?.deduplicationKey).toBe(
      buildBottleneckDeduplicationKey(
        organization.id,
        BOTTLENECK_INDICATORS.IMPEDIMENTS,
        'PROJECT',
        projectA.id,
      ),
    );
    expect(byIndicator.get(BOTTLENECK_INDICATORS.OVERLOAD)?.deduplicationKey).toBe(
      buildBottleneckDeduplicationKey(
        organization.id,
        BOTTLENECK_INDICATORS.OVERLOAD,
        'USER',
        member2.user.id,
      ),
    );

    // Acknowledge WIP alert (OPEN -> ACKNOWLEDGED)
    const wipAlert = byIndicator.get(BOTTLENECK_INDICATORS.WIP)!;
    const acked = await container.services.bottlenecks.acknowledgeAlert(
      manager.user.id,
      organization.id,
      wipAlert.id,
    );
    expect(acked.status).toBe(BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED);
    expect(acked.acknowledgedByUserId).toBe(manager.user.id);

    // Cannot acknowledge twice
    await expect(
      container.services.bottlenecks.acknowledgeAlert(
        manager.user.id,
        organization.id,
        wipAlert.id,
      ),
    ).rejects.toThrowError(ConflictError);

    // Re-evaluate increments occurrenceCount and keeps ACKNOWLEDGED status (ACKNOWLEDGED !== RESOLVED)
    const eval2 = await container.services.bottlenecks.evaluateProjectBottlenecks(
      manager.user.id,
      organization.id,
      projectA.id,
    );
    const wipAfterEval2 = eval2.alerts.find((a) => a.id === wipAlert.id)!;
    expect(wipAfterEval2.status).toBe(BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED);
    expect(wipAfterEval2.occurrenceCount).toBe(2);

    // Resolve WIP alert (ACKNOWLEDGED -> RESOLVED)
    const resolved = await container.services.bottlenecks.resolveAlert(
      manager.user.id,
      organization.id,
      wipAlert.id,
    );
    expect(resolved.status).toBe(BOTTLENECK_ALERT_STATUSES.RESOLVED);
    expect(resolved.resolvedByUserId).toBe(manager.user.id);

    // Cannot acknowledge or resolve an already RESOLVED alert
    await expect(
      container.services.bottlenecks.acknowledgeAlert(
        manager.user.id,
        organization.id,
        wipAlert.id,
      ),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.resolveAlert(manager.user.id, organization.id, wipAlert.id),
    ).rejects.toThrowError(ConflictError);

    // Re-evaluating after RESOLVED creates a brand new OPEN alert instead of reopening the resolved one
    const eval3 = await container.services.bottlenecks.evaluateProjectBottlenecks(
      admin.user.id,
      organization.id,
      projectA.id,
    );
    const newWipAlert = eval3.alerts.find((a) => a.indicator === BOTTLENECK_INDICATORS.WIP)!;
    expect(newWipAlert.id).not.toBe(wipAlert.id);
    expect(newWipAlert.status).toBe(BOTTLENECK_ALERT_STATUSES.OPEN);
    expect(newWipAlert.occurrenceCount).toBe(1);
  });

  it('impõe privacidade DN-02, filtragem projeto-a-projeto e remoção de alertas sem projectId em listOrganizationAlerts antes de contagens', async () => {
    const { admin, manager, otherManager, member1, member2, organization, projectA, projectB } =
      await setupBottleneckFixture();

    // Create overload for member2 in Project A
    for (let i = 0; i < 4; i += 1) {
      await container.services.tasks.createTask(manager.user.id, organization.id, projectA.id, {
        title: `Overload M2 ${i + 1}`,
        priority: PRIORITIES.CRITICAL,
        assigneeId: member2.user.id,
        dueDate: asIsoDateTime('2026-08-05T12:00:00.000Z'),
      });
    }
    // Create overload/overdue in Project B (restricted from manager & member1 & member2)
    for (let i = 0; i < 4; i += 1) {
      await container.services.tasks.createTask(
        otherManager.user.id,
        organization.id,
        projectB.id,
        {
          title: `Overload B ${i + 1}`,
          priority: PRIORITIES.CRITICAL,
          assigneeId: otherManager.user.id,
          dueDate: asIsoDateTime('2026-08-05T12:00:00.000Z'),
        },
      );
    }

    const evalA = await container.services.bottlenecks.evaluateProjectBottlenecks(
      admin.user.id,
      organization.id,
      projectA.id,
    );
    await container.services.bottlenecks.evaluateProjectBottlenecks(
      admin.user.id,
      organization.id,
      projectB.id,
    );

    // Seed an organization-wide alert without projectId
    const orgWideAlert: BottleneckAlert = {
      id: asBottleneckAlertId('81000000-0000-4000-8000-000000000099'),
      organizationId: organization.id,
      indicator: BOTTLENECK_INDICATORS.OVERDUE,
      severity: BOTTLENECK_SEVERITIES.HIGH,
      status: BOTTLENECK_ALERT_STATUSES.OPEN,
      deduplicationKey: `${organization.id}:OVERDUE:PROJECT:org-wide`,
      targetEntityType: 'PROJECT',
      targetEntityId: 'org-wide',
      summary: 'Alerta global sem projectId',
      detectedAt: currentNow,
      lastSeenAt: currentNow,
      occurrenceCount: 1,
    };
    await container.repositories.bottlenecks.bottleneckAlerts.save(orgWideAlert);

    const member2OverloadAlert = evalA.alerts.find(
      (a) => a.indicator === BOTTLENECK_INDICATORS.OVERLOAD && a.targetEntityId === member2.user.id,
    )!;

    // 1. Default Deny: MANAGER and MEMBER1 do NOT see member2's OVERLOAD, Project B alerts, or orgWideAlert
    const managerDefaultAlerts = await container.services.bottlenecks.listOrganizationAlerts(
      manager.user.id,
      organization.id,
    );
    expect(managerDefaultAlerts.alerts.every((a) => a.projectId === projectA.id)).toBe(true);
    expect(managerDefaultAlerts.alerts.some((a) => a.id === orgWideAlert.id)).toBe(false);
    expect(
      managerDefaultAlerts.alerts.some((a) => a.indicator === BOTTLENECK_INDICATORS.OVERLOAD),
    ).toBe(false);
    expect(managerDefaultAlerts.totalCount).toBe(managerDefaultAlerts.alerts.length);
    expect(managerDefaultAlerts.summaryByIndicator.OVERLOAD).toBe(0);
    expect(managerDefaultAlerts.overloadedMemberCount).toBe(1);

    // MEMBER1 sees same anonymized count and zero third-party OVERLOAD alerts
    const member1Alerts = await container.services.bottlenecks.listOrganizationAlerts(
      member1.user.id,
      organization.id,
    );
    expect(member1Alerts.alerts.some((a) => a.indicator === BOTTLENECK_INDICATORS.OVERLOAD)).toBe(
      false,
    );
    expect(member1Alerts.overloadedMemberCount).toBe(1);

    // MEMBER2 sees their OWN OVERLOAD alert (targetEntityId === actorUserId)
    const member2Alerts = await container.services.bottlenecks.listOrganizationAlerts(
      member2.user.id,
      organization.id,
    );
    expect(member2Alerts.alerts.some((a) => a.id === member2OverloadAlert.id)).toBe(true);

    // Default Deny blocks MANAGER from acknowledging/resolving third-party OVERLOAD alert
    await expect(
      container.services.bottlenecks.acknowledgeAlert(
        manager.user.id,
        organization.id,
        member2OverloadAlert.id,
      ),
    ).rejects.toThrowError(AuthorizationError);

    // Non-ADMIN filtering by unauthorized projectB throws AuthorizationError
    await expect(
      container.services.bottlenecks.listOrganizationAlerts(manager.user.id, organization.id, {
        projectId: projectB.id,
      }),
    ).rejects.toThrowError(AuthorizationError);

    // ADMIN sees all projects AND orgWideAlert AND all OVERLOAD alerts
    const adminAlerts = await container.services.bottlenecks.listOrganizationAlerts(
      admin.user.id,
      organization.id,
    );
    expect(adminAlerts.alerts.some((a) => a.id === orgWideAlert.id)).toBe(true);
    expect(adminAlerts.alerts.some((a) => a.projectId === projectB.id)).toBe(true);
    expect(adminAlerts.alerts.some((a) => a.id === member2OverloadAlert.id)).toBe(true);
    expect(adminAlerts.overloadedMemberCount).toBe(2);

    // 2. Only ADMIN can manage productivity-visibility (DN-06)
    await expect(
      container.services.bottlenecks.getIndividualProductivityVisibility(
        manager.user.id,
        organization.id,
      ),
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      container.services.bottlenecks.updateIndividualProductivityVisibility(
        manager.user.id,
        organization.id,
        { allowManagerViewIndividualProductivity: true },
      ),
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      container.services.bottlenecks.updateIndividualProductivityVisibility(
        member1.user.id,
        organization.id,
        { allowManagerViewIndividualProductivity: true },
      ),
    ).rejects.toThrowError(AuthorizationError);

    const visibilityEnabled =
      await container.services.bottlenecks.updateIndividualProductivityVisibility(
        admin.user.id,
        organization.id,
        {
          allowManagerViewIndividualProductivity: true,
          justification: 'Liberado para gestão de carga do projeto',
        },
      );
    expect(visibilityEnabled.allowManagerViewIndividualProductivity).toBe(true);

    // Now MANAGER sees member2's OVERLOAD alert in Project A and third-party memberWorkloads,
    // while STILL NOT seeing Project B or orgWideAlert!
    const managerEnabledAlerts = await container.services.bottlenecks.listOrganizationAlerts(
      manager.user.id,
      organization.id,
    );
    expect(managerEnabledAlerts.alerts.some((a) => a.id === member2OverloadAlert.id)).toBe(true);
    expect(managerEnabledAlerts.alerts.some((a) => a.projectId === projectB.id)).toBe(false);
    expect(managerEnabledAlerts.alerts.some((a) => a.id === orgWideAlert.id)).toBe(false);

    const managerOverviewAfter = await container.services.bottlenecks.getProjectBottlenecksOverview(
      manager.user.id,
      organization.id,
      projectA.id,
    );
    expect(managerOverviewAfter.canViewThirdPartyIndividualMetrics).toBe(true);
    expect(managerOverviewAfter.memberWorkloads.some((m) => m.userId === member2.user.id)).toBe(
      true,
    );
    expect(managerOverviewAfter.activeAlerts.some((a) => a.id === member2OverloadAlert.id)).toBe(
      true,
    );

    // MEMBER1 STILL does NOT see member2's OVERLOAD alert even when manager visibility is enabled
    const member1AfterAdminToggle =
      await container.services.bottlenecks.getProjectBottlenecksOverview(
        member1.user.id,
        organization.id,
        projectA.id,
      );
    expect(member1AfterAdminToggle.canViewThirdPartyIndividualMetrics).toBe(false);
    expect(member1AfterAdminToggle.memberWorkloads.some((m) => m.userId === member2.user.id)).toBe(
      false,
    );
    expect(member1AfterAdminToggle.activeAlerts.some((a) => a.id === member2OverloadAlert.id)).toBe(
      false,
    );
  });

  it('bloqueia mutações com ConflictError (409) em projeto arquivado ou excluído, valida regras, grava AuditEvent, emite eventos pós-commit e isola cross-org', async () => {
    const { admin, manager, organization, projectA, projectB } = await setupBottleneckFixture();

    const publishedEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      publishedEvents.push(event);
    });

    await container.services.tasks.createTask(manager.user.id, organization.id, projectA.id, {
      title: 'Tarefa Atrasada para Auditoria',
      priority: PRIORITIES.HIGH,
      assigneeId: manager.user.id,
      dueDate: asIsoDateTime('2026-08-05T12:00:00.000Z'),
    });

    const correlation1 = asCorrelationId('82000000-0000-4000-8000-000000000001');
    const evalRes = await container.services.bottlenecks.evaluateProjectBottlenecks(
      manager.user.id,
      organization.id,
      projectA.id,
      { correlationId: correlation1 },
    );
    const alertId = evalRes.alerts[0]!.id;

    // Invalid thresholds throw ValidationError
    await expect(
      container.services.bottlenecks.updateProjectBottleneckRules(
        manager.user.id,
        organization.id,
        projectA.id,
        { thresholds: { blockedWarningCount: 4, blockedCriticalCount: 2 } },
      ),
    ).rejects.toThrowError(ValidationError);

    await container.services.bottlenecks.updateProjectBottleneckRules(
      manager.user.id,
      organization.id,
      projectA.id,
      { inactivityThresholdDays: 10, thresholds: { wipUtilizationPercent: 75 } },
    );
    await container.services.bottlenecks.updateIndividualProductivityVisibility(
      admin.user.id,
      organization.id,
      { allowManagerViewIndividualProductivity: true },
    );

    // Archive Project A -> all 4 BOTTLENECK_RULES_MANAGE mutations fail with ConflictError (even for ADMIN)
    await container.services.projects.archiveProject(admin.user.id, organization.id, projectA.id);

    await expect(
      container.services.bottlenecks.evaluateProjectBottlenecks(
        admin.user.id,
        organization.id,
        projectA.id,
      ),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.updateProjectBottleneckRules(
        admin.user.id,
        organization.id,
        projectA.id,
        { inactivityThresholdDays: 12 },
      ),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.acknowledgeAlert(admin.user.id, organization.id, alertId),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.resolveAlert(admin.user.id, organization.id, alertId),
    ).rejects.toThrowError(ConflictError);

    // Read overview still allowed on archived project
    const archivedOverview = await container.services.bottlenecks.getProjectBottlenecksOverview(
      admin.user.id,
      organization.id,
      projectA.id,
    );
    expect(archivedOverview.project.status).toBe('ARCHIVED');

    // Soft-deleted project B -> also blocks BOTTLENECK_RULES_MANAGE with ConflictError
    await container.services.tasks.createTask(admin.user.id, organization.id, projectB.id, {
      title: 'Tarefa Projeto B antes da exclusão',
      dueDate: asIsoDateTime('2026-08-05T12:00:00.000Z'),
    });
    const evalB = await container.services.bottlenecks.evaluateProjectBottlenecks(
      admin.user.id,
      organization.id,
      projectB.id,
    );
    const alertBId = evalB.alerts[0]!.id;
    await container.services.projects.deleteProject(admin.user.id, organization.id, projectB.id, {
      reason: 'Projeto encerrado',
    });

    await expect(
      container.services.bottlenecks.evaluateProjectBottlenecks(
        admin.user.id,
        organization.id,
        projectB.id,
      ),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.updateProjectBottleneckRules(
        admin.user.id,
        organization.id,
        projectB.id,
        { inactivityThresholdDays: 5 },
      ),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.acknowledgeAlert(admin.user.id, organization.id, alertBId),
    ).rejects.toThrowError(ConflictError);
    await expect(
      container.services.bottlenecks.resolveAlert(admin.user.id, organization.id, alertBId),
    ).rejects.toThrowError(ConflictError);

    // AuditEvents check (PROJECT & ORGANIZATION categories)
    const orgAudits = await container.repositories.audit.auditEvents.listByOrganization(
      organization.id,
      { page: 1, pageSize: 50 },
    );
    expect(
      orgAudits.items.some(
        (a) =>
          a.category === AUDIT_CATEGORIES.PROJECT &&
          a.eventType === 'bottleneck.project.evaluated' &&
          a.correlationId === correlation1,
      ),
    ).toBe(true);
    expect(
      orgAudits.items.some(
        (a) =>
          a.category === AUDIT_CATEGORIES.PROJECT && a.eventType === 'bottleneck.rules.updated',
      ),
    ).toBe(true);
    expect(
      orgAudits.items.some(
        (a) =>
          a.category === AUDIT_CATEGORIES.ORGANIZATION &&
          a.eventType === 'organization.productivity_visibility.updated',
      ),
    ).toBe(true);

    // Post-commit events check
    expect(publishedEvents.some((e) => e.eventType === 'bottleneck.project.evaluated')).toBe(true);
    expect(publishedEvents.some((e) => e.eventType === 'bottleneck.rules.updated')).toBe(true);
    expect(
      publishedEvents.some((e) => e.eventType === 'organization.productivity_visibility.updated'),
    ).toBe(true);

    // Cross-organization isolation
    const { organization: org2 } = await container.services.organizations.createOrganization(
      admin.user.id,
      { name: 'Org Secundária', slug: 'org-secundaria-bn' },
    );
    await expect(
      container.services.bottlenecks.getMyWorkloadSummary(manager.user.id, org2.id),
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      container.services.bottlenecks.listOrganizationAlerts(manager.user.id, org2.id),
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      container.services.bottlenecks.getIndividualProductivityVisibility(manager.user.id, org2.id),
    ).rejects.toThrowError(AuthorizationError);
  });
});
