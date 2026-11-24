import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import {
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  asBottleneckAlertId,
  type BottleneckAlert,
  type EvaluateProjectBottlenecksResult,
  type IndividualProductivityVisibilityResult,
  type MyWorkloadSummary,
  type OrganizationBottleneckAlertsResult,
  type ProjectBottleneckRulesResult,
  type ProjectBottlenecksOverview,
} from '@/modules/bottlenecks';
import { FOCUS_MODES, type FocusPreference, type MyFocusView } from '@/modules/focus';
import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES, type Project } from '@/modules/projects';
import type { Task } from '@/modules/tasks';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  IMPEDIMENT_SEVERITIES,
  PRIORITIES,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTaskId,
  asUserId,
  type DomainEventEnvelope,
  type ProjectId,
  type UserId,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_COLUMN_IDS,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  createAppContainer,
  createMswHandlers,
  type AppCompositionContainer,
} from './index';

const FIXED_NOW = asIsoDateTime('2026-04-20T12:00:00.000Z');
const STALE_MOVE_DATE = asIsoDateTime('2026-04-01T12:00:00.000Z');
const OVERDUE_DATE = asIsoDateTime('2026-04-10T12:00:00.000Z');
const OTHER_ORG_ID = asOrganizationId('99999999-9999-4999-8999-999999999901');
const SECOND_MEMBER_ID = asUserId('11111111-1111-4111-8111-111111111299');

describe('Phase 08 — FocusService, BottleneckService, Repository Complements & MSW Integration', () => {
  let server: SetupServer;
  let container: AppCompositionContainer;

  beforeAll(() => {
    server = setupServer();
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    container = createAppContainer({
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_f08_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
      now: () => FIXED_NOW,
    });
    await ensureDatabaseOpen(container.db);
    await container.seedDemoOrganization(FIXED_NOW);

    server.use(
      ...createMswHandlers({
        repositories: container.repositories,
        transactionPort: container.transactionPort,
        eventBus: container.eventBus,
        simulationController: container.simulationController,
        now: () => FIXED_NOW,
      }),
    );
  });

  afterEach(async () => {
    server.resetHandlers();
    container.simulationController.clearRules();
    if (container.db.isOpen()) {
      container.db.close();
    }
    await container.db.delete();
  });

  async function seedSecondMemberInDemoProject(): Promise<UserId> {
    await container.repositories.users.users.save({
      id: SECOND_MEMBER_ID,
      email: 'member2@pms.demo',
      displayName: 'Segundo Membro Demo',
      acceptedTermsAt: FIXED_NOW,
      emailVerifiedSimulated: true,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await container.services.organizations
      .createOrganization(SECOND_MEMBER_ID, {
        name: 'Organizacao Externa Isolada',
        slug: 'org-externa-isolada',
      })
      .catch(() => undefined);

    await container.repositories.organizations.organizationMembers.save({
      id: asOrganizationMemberId('11111111-1111-4111-8111-111111111399'),
      organizationId: DEMO_ORG_ID,
      userId: SECOND_MEMBER_ID,
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });

    await container.services.projects.addProjectParticipant(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      DEMO_PROJECT_ID,
      SECOND_MEMBER_ID,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    return SECOND_MEMBER_ID;
  }

  async function createTaskViaApi(
    actorUserId: UserId,
    projectId: ProjectId,
    payload: {
      readonly title: string;
      readonly priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      readonly assigneeId?: UserId;
      readonly dueDate?: string;
      readonly columnId?: string;
    },
  ): Promise<Task> {
    return container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${projectId}/tasks`,
      payload,
      { actorUserId },
    );
  }

  it('validates Schema v2 repository complements with strict organizationId isolation', async () => {
    const t1 = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa com participante e subtarefa',
      assigneeId: DEMO_MEMBER_USER_ID,
    });

    await container.services.tasks.addTaskParticipant(DEMO_MANAGER_USER_ID, DEMO_ORG_ID, t1.id, {
      userId: DEMO_MANAGER_USER_ID,
    });

    await container.services.tasks.createSubtask(DEMO_MANAGER_USER_ID, DEMO_ORG_ID, t1.id, {
      title: 'Subtarefa 1',
      required: true,
      assigneeId: DEMO_MEMBER_USER_ID,
    });

    const orgSubtasks = await container.repositories.tasks.subtasks.listByOrganization(DEMO_ORG_ID);
    expect(orgSubtasks).toHaveLength(1);
    expect(orgSubtasks[0]?.taskId).toBe(t1.id);

    const otherOrgSubtasks =
      await container.repositories.tasks.subtasks.listByOrganization(OTHER_ORG_ID);
    expect(otherOrgSubtasks).toHaveLength(0);

    const orgParticipants =
      await container.repositories.tasks.taskParticipants.listByOrganization(DEMO_ORG_ID);
    expect(orgParticipants).toHaveLength(1);
    expect(orgParticipants[0]?.userId).toBe(DEMO_MANAGER_USER_ID);

    const otherOrgParticipants =
      await container.repositories.tasks.taskParticipants.listByOrganization(OTHER_ORG_ID);
    expect(otherOrgParticipants).toHaveLength(0);

    const alert1: BottleneckAlert = {
      id: asBottleneckAlertId('61000000-0000-4000-8000-000000000001'),
      organizationId: DEMO_ORG_ID,
      projectId: DEMO_PROJECT_ID,
      indicator: BOTTLENECK_INDICATORS.OVERDUE,
      severity: BOTTLENECK_SEVERITIES.HIGH,
      status: BOTTLENECK_ALERT_STATUSES.OPEN,
      deduplicationKey: `${DEMO_ORG_ID}:OVERDUE:PROJECT:${DEMO_PROJECT_ID}`,
      targetEntityType: 'PROJECT',
      targetEntityId: DEMO_PROJECT_ID,
      summary: 'Atraso ativo',
      detectedAt: FIXED_NOW,
      lastSeenAt: FIXED_NOW,
      occurrenceCount: 1,
    };
    const alert2Resolved: BottleneckAlert = {
      ...alert1,
      id: asBottleneckAlertId('61000000-0000-4000-8000-000000000002'),
      status: BOTTLENECK_ALERT_STATUSES.RESOLVED,
      deduplicationKey: `${DEMO_ORG_ID}:WIP:PROJECT:${DEMO_PROJECT_ID}`,
      indicator: BOTTLENECK_INDICATORS.WIP,
      resolvedAt: FIXED_NOW,
      resolvedByUserId: DEMO_ADMIN_USER_ID,
    };

    await container.repositories.bottlenecks.bottleneckAlerts.saveMany(DEMO_ORG_ID, [
      alert1,
      alert2Resolved,
    ]);

    const activeAlerts =
      await container.repositories.bottlenecks.bottleneckAlerts.listActiveByOrganization(
        DEMO_ORG_ID,
        { projectId: DEMO_PROJECT_ID },
      );
    expect(activeAlerts).toHaveLength(1);
    expect(activeAlerts[0]?.id).toBe(alert1.id);

    expect(
      await container.repositories.bottlenecks.bottleneckAlerts.listActiveByOrganization(
        OTHER_ORG_ID,
      ),
    ).toHaveLength(0);
  });

  it('FocusService + MSW: filters candidates by TASK_VIEW, separates blockedTasks with reasons, persists/resets preferences without mutating Kanban', async () => {
    const member2 = await seedSecondMemberInDemoProject();
    const events: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      events.push(event);
    });

    const memberTask = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa do membro 1',
      priority: PRIORITIES.LOW,
      assigneeId: DEMO_MEMBER_USER_ID,
    });
    const otherMemberTask = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa sigilosa do membro 2',
      priority: PRIORITIES.CRITICAL,
      assigneeId: member2,
    });
    const impededTask = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa com impedimento do membro 1',
      priority: PRIORITIES.HIGH,
      assigneeId: DEMO_MEMBER_USER_ID,
    });
    await container.services.impediments.createImpediment(
      DEMO_MEMBER_USER_ID,
      DEMO_ORG_ID,
      impededTask.id,
      {
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Erro no ambiente de build',
      },
    );

    // Dependency on otherMemberTask (inaccessible to DEMO_MEMBER_USER_ID) must NOT leak its title
    const depBlockedTask = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa aguardando dependencia sigilosa',
      priority: PRIORITIES.MEDIUM,
      assigneeId: DEMO_MEMBER_USER_ID,
    });
    await container.services.dependencies.addDependency(
      DEMO_MANAGER_USER_ID,
      DEMO_ORG_ID,
      depBlockedTask.id,
      {
        dependsOnTaskId: otherMemberTask.id,
        required: true,
      },
    );

    const memberFocus = await container.httpClient.get<MyFocusView>(
      `/organizations/${DEMO_ORG_ID}/focus`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );

    expect(memberFocus.workload.representsHours).toBe(false);
    expect(memberFocus.workload.score).toBeGreaterThanOrEqual(0);
    expect(memberFocus.workload.score).toBeLessThanOrEqual(100);

    const visibleTaskIds = [
      ...memberFocus.ranking.actionableTasks.map((t) => t.candidate.taskId),
      ...memberFocus.ranking.blockedTasks.map((t) => t.candidate.taskId),
    ];
    expect(visibleTaskIds).toContain(memberTask.id);
    expect(visibleTaskIds).toContain(impededTask.id);
    expect(visibleTaskIds).toContain(depBlockedTask.id);
    expect(visibleTaskIds).not.toContain(otherMemberTask.id);

    const blockedImp = memberFocus.ranking.blockedTasks.find(
      (b) => b.candidate.taskId === impededTask.id,
    );
    expect(blockedImp?.reasons[0]?.code).toBe('OPEN_IMPEDIMENT');

    const blockedDep = memberFocus.ranking.blockedTasks.find(
      (b) => b.candidate.taskId === depBlockedTask.id,
    );
    expect(blockedDep?.reasons[0]?.code).toBe('PENDING_DEPENDENCY');
    expect(blockedDep?.reasons[0]?.description).not.toContain('Tarefa sigilosa do membro 2');

    // Pin memberTask in Focus Mode -> must NOT mutate Task.priority or Kanban column/order
    const updatedPref = await container.httpClient.put<FocusPreference>(
      `/organizations/${DEMO_ORG_ID}/focus/preferences`,
      {
        mode: FOCUS_MODES.MANUAL,
        pinnedTaskIds: [memberTask.id],
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(updatedPref.mode).toBe(FOCUS_MODES.MANUAL);
    expect(updatedPref.pinnedTaskIds).toEqual([memberTask.id]);

    const taskAfterFocusPin = await container.repositories.tasks.tasks.findById(
      DEMO_ORG_ID,
      memberTask.id,
    );
    expect(taskAfterFocusPin?.priority).toBe(PRIORITIES.LOW);
    expect(taskAfterFocusPin?.columnId).toBe(memberTask.columnId);
    expect(taskAfterFocusPin?.order).toBe(memberTask.order);

    // Reset reuses existing.id and publishes focus.preferences.updated
    const resetPref = await container.httpClient.post<FocusPreference>(
      `/organizations/${DEMO_ORG_ID}/focus/preferences/reset`,
      {},
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(resetPref.id).toBe(updatedPref.id);
    expect(resetPref.mode).toBe(FOCUS_MODES.AUTO);
    expect(resetPref.pinnedTaskIds).toEqual([]);

    const focusEvents = events.filter((e) => e.eventType === 'focus.preferences.updated');
    expect(focusEvents).toHaveLength(2);
  });

  it('BottleneckService + MSW: evaluates 5 indicators, preserves DN-04, enforces DN-02 privacy, alert lifecycle, 409 on archived project, and ADMIN-only visibility toggle', async () => {
    await seedSecondMemberInDemoProject();
    const events: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      events.push(event);
    });

    // Create tasks that trigger WIP (REVIEW wipLimit=2, put 3 tasks), OVERDUE, INACTIVITY (lastMovedAt), IMPEDIMENTS, and OVERLOAD for member2
    const overloadedTasks: Task[] = [];
    for (let i = 0; i < 4; i += 1) {
      const created = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
        title: `Carga critica ${i + 1}`,
        priority: PRIORITIES.CRITICAL,
        assigneeId: SECOND_MEMBER_ID,
        dueDate: OVERDUE_DATE,
      });
      overloadedTasks.push(created);
    }

    // Move 3 tasks to REVIEW (wipLimit: 2) and backdate lastMovedAt on 2 tasks while keeping recent lastActivityAt
    for (let i = 0; i < 3; i += 1) {
      await container.services.kanban.moveCard(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        overloadedTasks[i]!.id,
        {
          targetColumnId: DEMO_COLUMN_IDS.REVIEW,
          ...(i === 2 ? { wipOverrideJustification: 'Necessidade critica de revisao' } : {}),
        },
      );
    }

    for (let i = 0; i < 2; i += 1) {
      const stored = await container.repositories.tasks.tasks.findById(
        DEMO_ORG_ID,
        overloadedTasks[i]!.id,
      );
      if (stored) {
        await container.repositories.tasks.tasks.save({
          ...stored,
          lastMovedAt: STALE_MOVE_DATE,
          lastActivityAt: FIXED_NOW,
        });
      }
    }

    // Open impediment on 4th task
    await container.services.impediments.createImpediment(
      DEMO_MANAGER_USER_ID,
      DEMO_ORG_ID,
      overloadedTasks[3]!.id,
      {
        category: IMPEDIMENT_CATEGORIES.AWAITING_APPROVAL,
        severity: IMPEDIMENT_SEVERITIES.CRITICAL,
        description: 'Bloqueio critico',
      },
    );

    // DN-04: Before explicit evaluate, zero persisted bottleneckAlerts exist
    expect(
      await container.repositories.bottlenecks.bottleneckAlerts.listActiveByOrganization(
        DEMO_ORG_ID,
      ),
    ).toHaveLength(0);

    // Personal workload endpoint
    const myWorkload = await container.httpClient.get<MyWorkloadSummary>(
      `/organizations/${DEMO_ORG_ID}/workload/me`,
      { actorUserId: SECOND_MEMBER_ID },
    );
    expect(myWorkload.workload.representsHours).toBe(false);
    expect(myWorkload.workload.score).toBeGreaterThanOrEqual(50);

    // DN-04: Overview reads live indicators without persisting alerts
    const managerOverviewBefore = await container.httpClient.get<ProjectBottlenecksOverview>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(managerOverviewBefore.indicators.wipExceededColumnsCount).toBe(1);
    expect(managerOverviewBefore.indicators.inactiveTaskCount).toBe(2);
    expect(managerOverviewBefore.indicators.overdueTaskCount).toBe(4);
    expect(managerOverviewBefore.indicators.blockedTaskCount).toBe(1);
    expect(managerOverviewBefore.indicators.overloadedMemberCount).toBeGreaterThanOrEqual(1);
    // DN-02: Default Deny for MANAGER -> no third-party memberWorkloads
    expect(managerOverviewBefore.canViewThirdPartyIndividualMetrics).toBe(false);
    expect(managerOverviewBefore.memberWorkloads.some((m) => m.userId === SECOND_MEMBER_ID)).toBe(
      false,
    );
    expect(
      await container.repositories.bottlenecks.bottleneckAlerts.listActiveByOrganization(
        DEMO_ORG_ID,
      ),
    ).toHaveLength(0);

    // MEMBER cannot evaluate bottlenecks (403)
    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/evaluate`,
        {},
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    // ADMIN evaluates bottlenecks explicitly -> persists 5 indicators
    const eval1 = await container.httpClient.post<EvaluateProjectBottlenecksResult>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/evaluate`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(eval1.detectedCandidateCount).toBeGreaterThanOrEqual(5);
    const indicators1 = new Set(eval1.alerts.map((a) => a.indicator));
    expect(indicators1.has(BOTTLENECK_INDICATORS.WIP)).toBe(true);
    expect(indicators1.has(BOTTLENECK_INDICATORS.INACTIVITY)).toBe(true);
    expect(indicators1.has(BOTTLENECK_INDICATORS.OVERDUE)).toBe(true);
    expect(indicators1.has(BOTTLENECK_INDICATORS.IMPEDIMENTS)).toBe(true);
    expect(indicators1.has(BOTTLENECK_INDICATORS.OVERLOAD)).toBe(true);

    // Acknowledge a non-overload alert and verify deduplication preserves ACKNOWLEDGED and increments occurrenceCount
    const wipAlert = eval1.alerts.find((a) => a.indicator === BOTTLENECK_INDICATORS.WIP)!;
    const acked = await container.httpClient.post<BottleneckAlert>(
      `/organizations/${DEMO_ORG_ID}/bottlenecks/${wipAlert.id}/acknowledge`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(acked.status).toBe(BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED);

    // Re-evaluating deduplicates in place without creating duplicates
    const eval2 = await container.httpClient.post<EvaluateProjectBottlenecksResult>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/evaluate`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const wipAlertAfterEval2 = eval2.alerts.find((a) => a.id === wipAlert.id)!;
    expect(wipAlertAfterEval2.status).toBe(BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED);
    expect(wipAlertAfterEval2.occurrenceCount).toBe(2);

    // Cannot acknowledge already acknowledged alert
    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/bottlenecks/${wipAlert.id}/acknowledge`,
        {},
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    // DN-02: MANAGER and MEMBER listing org alerts do NOT see SECOND_MEMBER_ID OVERLOAD alert,
    // and unauthorized project / org-level alerts are filtered before counts
    const orgWideAlert: BottleneckAlert = {
      id: asBottleneckAlertId('61000000-0000-4000-8000-000000000099'),
      organizationId: DEMO_ORG_ID,
      indicator: BOTTLENECK_INDICATORS.OVERLOAD,
      severity: BOTTLENECK_SEVERITIES.HIGH,
      status: BOTTLENECK_ALERT_STATUSES.OPEN,
      deduplicationKey: `${DEMO_ORG_ID}:OVERLOAD:PROJECT:org-wide`,
      targetEntityType: 'PROJECT',
      targetEntityId: 'org-wide',
      summary: 'Alerta organizacional sem projectId',
      detectedAt: FIXED_NOW,
      lastSeenAt: FIXED_NOW,
      occurrenceCount: 1,
    };
    await container.repositories.bottlenecks.bottleneckAlerts.save(orgWideAlert);

    const managerAlertsDefault = await container.httpClient.get<OrganizationBottleneckAlertsResult>(
      `/organizations/${DEMO_ORG_ID}/bottlenecks`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(
      managerAlertsDefault.alerts.some((a) => a.indicator === BOTTLENECK_INDICATORS.OVERLOAD),
    ).toBe(false);
    expect(managerAlertsDefault.alerts.some((a) => a.id === orgWideAlert.id)).toBe(false);
    expect(managerAlertsDefault.overloadedMemberCount).toBe(1);

    // DN-06: MANAGER cannot toggle productivity visibility (403); ADMIN can
    await expect(
      container.httpClient.patch(
        `/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`,
        { allowManagerViewIndividualProductivity: true },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    const visibilityUpdated =
      await container.httpClient.patch<IndividualProductivityVisibilityResult>(
        `/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`,
        { allowManagerViewIndividualProductivity: true, justification: 'Habilitar gestores' },
        { actorUserId: DEMO_ADMIN_USER_ID },
      );
    expect(visibilityUpdated.allowManagerViewIndividualProductivity).toBe(true);

    // Now MANAGER managing the project CAN see third-party OVERLOAD alerts & memberWorkloads
    const managerAlertsAfter = await container.httpClient.get<OrganizationBottleneckAlertsResult>(
      `/organizations/${DEMO_ORG_ID}/bottlenecks`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(
      managerAlertsAfter.alerts.some(
        (a) =>
          a.indicator === BOTTLENECK_INDICATORS.OVERLOAD && a.targetEntityId === SECOND_MEMBER_ID,
      ),
    ).toBe(true);

    const managerOverviewAfter = await container.httpClient.get<ProjectBottlenecksOverview>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(managerOverviewAfter.canViewThirdPartyIndividualMetrics).toBe(true);
    expect(managerOverviewAfter.memberWorkloads.some((m) => m.userId === SECOND_MEMBER_ID)).toBe(
      true,
    );

    // Thresholds update validation (422) & valid update
    await expect(
      container.httpClient.patch(
        `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/thresholds`,
        { thresholds: { overdueWarningCount: 10, overdueCriticalCount: 5 } },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    const updatedRules = await container.httpClient.patch<ProjectBottleneckRulesResult>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/thresholds`,
      { inactivityThresholdDays: 14, thresholds: { wipUtilizationPercent: 90 } },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(updatedRules.inactivityThresholdDays).toBe(14);
    expect(updatedRules.thresholds.wipUtilizationPercent).toBe(90);

    // Resolve alert
    const resolved = await container.httpClient.post<BottleneckAlert>(
      `/organizations/${DEMO_ORG_ID}/bottlenecks/${wipAlert.id}/resolve`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(resolved.status).toBe(BOTTLENECK_ALERT_STATUSES.RESOLVED);

    // Archived project blocks BOTTLENECK_RULES_MANAGE mutations with 409 Conflict
    await container.services.projects.archiveProject(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      DEMO_PROJECT_ID,
    );
    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/evaluate`,
        {},
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    // Cross-organization access returns 403
    const otherOrg = await container.services.organizations.createOrganization(DEMO_ADMIN_USER_ID, {
      name: 'Org B',
      slug: 'org-b-isolation',
    });
    await expect(
      container.httpClient.get<MyWorkloadSummary>(
        `/organizations/${otherOrg.organization.id}/workload/me`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);

    // Verify AuditEvents recorded under PROJECT and ORGANIZATION categories
    const audits = await container.repositories.audit.auditEvents.listByOrganization(DEMO_ORG_ID, {
      page: 1,
      pageSize: 50,
    });
    expect(
      audits.items.some(
        (a) =>
          a.category === AUDIT_CATEGORIES.PROJECT && a.eventType === 'bottleneck.project.evaluated',
      ),
    ).toBe(true);
    expect(
      audits.items.some(
        (a) =>
          a.category === AUDIT_CATEGORIES.ORGANIZATION &&
          a.eventType === 'organization.productivity_visibility.updated',
      ),
    ).toBe(true);

    // Verify post-commit events were emitted
    expect(events.some((e) => e.eventType === 'bottleneck.project.evaluated')).toBe(true);
    expect(events.some((e) => e.eventType === 'bottleneck.alert.acknowledged')).toBe(true);
    expect(events.some((e) => e.eventType === 'bottleneck.alert.resolved')).toBe(true);
    expect(events.some((e) => e.eventType === 'bottleneck.rules.updated')).toBe(true);
    expect(events.some((e) => e.eventType === 'organization.productivity_visibility.updated')).toBe(
      true,
    );

    // Overview on archived project still allowed for BOTTLENECK_VIEW
    const archivedOverview = await container.httpClient.get<ProjectBottlenecksOverview>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(archivedOverview.project.status).toBe('ARCHIVED');
    expect((archivedOverview.project as Project | { id: ProjectId }).id).toBe(DEMO_PROJECT_ID);
  });

  it('cobre todas as rotas §11 restantes, query params, códigos HTTP 200/403/404/409/422 e isolamento cross-org completo', async () => {
    const member2 = await seedSecondMemberInDemoProject();
    const secondProject = await container.services.projects.createProject(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      { name: 'Projeto Secundario MSW', ownerUserId: DEMO_MANAGER_USER_ID },
    );

    const taskMember1 = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa Foco Membro 1',
      assigneeId: DEMO_MEMBER_USER_ID,
      dueDate: OVERDUE_DATE,
    });
    const taskMember2 = await createTaskViaApi(DEMO_MANAGER_USER_ID, DEMO_PROJECT_ID, {
      title: 'Tarefa Foco Membro 2',
      assigneeId: member2,
      dueDate: OVERDUE_DATE,
    });
    await createTaskViaApi(DEMO_MANAGER_USER_ID, secondProject.id, {
      title: 'Tarefa Projeto Secundario',
      assigneeId: DEMO_MANAGER_USER_ID,
    });

    // 1. Query params on GET .../focus (?projectId=...&onlyMyTasks=true)
    const filteredFocus = await container.httpClient.get<MyFocusView>(
      `/organizations/${DEMO_ORG_ID}/focus?projectId=${DEMO_PROJECT_ID}&onlyMyTasks=true`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(
      filteredFocus.ranking.actionableTasks.every(
        (item) => item.candidate.projectId === DEMO_PROJECT_ID,
      ),
    ).toBe(true);
    expect(
      filteredFocus.ranking.actionableTasks.some((t) => t.candidate.taskId === taskMember1.id),
    ).toBe(true);
    expect(
      filteredFocus.ranking.actionableTasks.some((t) => t.candidate.taskId === taskMember2.id),
    ).toBe(false);

    // 2. GET .../settings/productivity-visibility (200 ADMIN, 403 MANAGER/MEMBER)
    const initialVisibility =
      await container.httpClient.get<IndividualProductivityVisibilityResult>(
        `/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`,
        { actorUserId: DEMO_ADMIN_USER_ID },
      );
    expect(initialVisibility.allowManagerViewIndividualProductivity).toBe(false);

    await expect(
      container.httpClient.get(`/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`, {
        actorUserId: DEMO_MANAGER_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.get(`/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`, {
        actorUserId: DEMO_MEMBER_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);

    // 3. Evaluate & query params on GET .../bottlenecks (?projectId&indicator&status&includeResolved)
    const evalResult = await container.httpClient.post<EvaluateProjectBottlenecksResult>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/evaluate`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const overdueAlert = evalResult.alerts.find(
      (a) => a.indicator === BOTTLENECK_INDICATORS.OVERDUE,
    )!;
    await container.httpClient.post<BottleneckAlert>(
      `/organizations/${DEMO_ORG_ID}/bottlenecks/${overdueAlert.id}/resolve`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    const resolvedFiltered = await container.httpClient.get<OrganizationBottleneckAlertsResult>(
      `/organizations/${DEMO_ORG_ID}/bottlenecks?projectId=${DEMO_PROJECT_ID}&indicator=OVERDUE&status=RESOLVED&includeResolved=true`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(resolvedFiltered.alerts).toHaveLength(1);
    expect(resolvedFiltered.alerts[0]?.id).toBe(overdueAlert.id);
    expect(resolvedFiltered.alerts[0]?.status).toBe(BOTTLENECK_ALERT_STATUSES.RESOLVED);

    // 4. HTTP status codes 200 / 403 / 404 / 409 / 422 verified directly over MSW HTTP transport
    const missingProjectId = asProjectId('99999999-9999-4999-8999-999999999988');
    const missingTaskId = asTaskId('99999999-9999-4999-8999-999999999977');
    const missingAlertId = asBottleneckAlertId('99999999-9999-4999-8999-999999999966');

    const res200 = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`,
      {
        method: 'GET',
        headers: { 'x-actor-user-id': DEMO_ADMIN_USER_ID },
      },
    );
    expect(res200.status).toBe(200);

    const res403FocusPin = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/focus/preferences`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-actor-user-id': DEMO_MEMBER_USER_ID,
        },
        body: JSON.stringify({ pinnedTaskIds: [taskMember2.id] }),
      },
    );
    expect(res403FocusPin.status).toBe(403);

    const res404FocusTask = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/focus/preferences`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-actor-user-id': DEMO_MEMBER_USER_ID,
        },
        body: JSON.stringify({ pinnedTaskIds: [missingTaskId] }),
      },
    );
    expect(res404FocusTask.status).toBe(404);

    const res422FocusEmpty = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/focus/preferences`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-actor-user-id': DEMO_MEMBER_USER_ID,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res422FocusEmpty.status).toBe(422);

    const res404Overview = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/projects/${missingProjectId}/bottlenecks`,
      {
        method: 'GET',
        headers: { 'x-actor-user-id': DEMO_ADMIN_USER_ID },
      },
    );
    expect(res404Overview.status).toBe(404);

    const res404Ack = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/bottlenecks/${missingAlertId}/acknowledge`,
      {
        method: 'POST',
        headers: { 'x-actor-user-id': DEMO_ADMIN_USER_ID },
      },
    );
    expect(res404Ack.status).toBe(404);

    const res409AlreadyResolved = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/bottlenecks/${overdueAlert.id}/resolve`,
      {
        method: 'POST',
        headers: { 'x-actor-user-id': DEMO_ADMIN_USER_ID },
      },
    );
    expect(res409AlreadyResolved.status).toBe(409);

    const res422Visibility = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/productivity-visibility`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-actor-user-id': DEMO_ADMIN_USER_ID,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res422Visibility.status).toBe(422);

    // 5. Archived project returns 409 Conflict for thresholds, acknowledge and resolve too
    const evalSecond = await container.httpClient.post<EvaluateProjectBottlenecksResult>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/evaluate`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const activeAlertId = evalSecond.alerts[0]!.id;
    await container.services.projects.archiveProject(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      DEMO_PROJECT_ID,
    );

    await expect(
      container.httpClient.patch<ProjectBottleneckRulesResult>(
        `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/bottlenecks/thresholds`,
        { inactivityThresholdDays: 10 },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    await expect(
      container.httpClient.post<BottleneckAlert>(
        `/organizations/${DEMO_ORG_ID}/bottlenecks/${activeAlertId}/acknowledge`,
        {},
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    await expect(
      container.httpClient.post<BottleneckAlert>(
        `/organizations/${DEMO_ORG_ID}/bottlenecks/${activeAlertId}/resolve`,
        {},
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(ConflictError);

    // Also verify typed NotFoundError & ValidationError via httpClient
    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/bottlenecks/${missingAlertId}/resolve`,
        {},
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrow(NotFoundError);
    await expect(
      container.httpClient.put<FocusPreference>(
        `/organizations/${DEMO_ORG_ID}/focus/preferences`,
        {},
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(ValidationError);

    // 6. Complete cross-org isolation across ALL §11 endpoints
    const { organization: orgB } = await container.services.organizations.createOrganization(
      DEMO_ADMIN_USER_ID,
      { name: 'Org B Isolamento Total', slug: 'org-b-isolamento-total' },
    );
    const orgBProject = await container.services.projects.createProject(
      DEMO_ADMIN_USER_ID,
      orgB.id,
      { name: 'Projeto Org B', ownerUserId: DEMO_ADMIN_USER_ID },
    );
    await container.httpClient.post(
      `/organizations/${orgB.id}/projects/${orgBProject.id}/tasks`,
      { title: 'Tarefa Atrasada Org B', dueDate: OVERDUE_DATE },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const orgBEval = await container.httpClient.post<EvaluateProjectBottlenecksResult>(
      `/organizations/${orgB.id}/projects/${orgBProject.id}/bottlenecks/evaluate`,
      {},
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    const orgBAlertId = orgBEval.alerts[0]!.id;

    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/focus`, {
        actorUserId: DEMO_MEMBER_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.put(
        `/organizations/${orgB.id}/focus/preferences`,
        { mode: FOCUS_MODES.MANUAL },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.post(
        `/organizations/${orgB.id}/focus/preferences/reset`,
        {},
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/bottlenecks`, {
        actorUserId: DEMO_MEMBER_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/projects/${orgBProject.id}/bottlenecks`, {
        actorUserId: DEMO_MEMBER_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.post(
        `/organizations/${orgB.id}/projects/${orgBProject.id}/bottlenecks/evaluate`,
        {},
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.patch(
        `/organizations/${orgB.id}/projects/${orgBProject.id}/bottlenecks/thresholds`,
        { inactivityThresholdDays: 5 },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.post(
        `/organizations/${orgB.id}/bottlenecks/${orgBAlertId}/acknowledge`,
        {},
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.post(
        `/organizations/${orgB.id}/bottlenecks/${orgBAlertId}/resolve`,
        {},
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.get(`/organizations/${orgB.id}/settings/productivity-visibility`, {
        actorUserId: DEMO_MEMBER_USER_ID,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.httpClient.patch(
        `/organizations/${orgB.id}/settings/productivity-visibility`,
        { allowManagerViewIndividualProductivity: true },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(AuthorizationError);
    // Non-disclosure when referencing Org A projectId inside Org B URL
    await expect(
      container.httpClient.get(
        `/organizations/${orgB.id}/projects/${DEMO_PROJECT_ID}/bottlenecks`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
