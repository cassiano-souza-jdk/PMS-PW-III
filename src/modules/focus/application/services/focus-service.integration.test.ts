import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { FOCUS_MODES } from '@/modules/focus';
import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import { AuthorizationError, NotFoundError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  asCorrelationId,
  asEntityId,
  asIsoDateTime,
  asTaskId,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('FocusService Integration (Dexie, Ranking 30/30/20/10/10, Modes, TASK_VIEW, Blocking & Isolation)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-08-10T12:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_focus_service_${crypto.randomUUID()}`,
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

  async function setupFocusFixture() {
    const admin = await registerUser('admin.focus@pms.local', 'Admin Focus');
    const manager = await registerUser('manager.focus@pms.local', 'Gestor Focus');
    const member1 = await registerUser('member1.focus@pms.local', 'Membro 1 Focus');
    const member2 = await registerUser('member2.focus@pms.local', 'Membro 2 Focus');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Focus Org A',
        slug: 'focus-org-a',
      },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
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
        name: 'Projeto Focus A',
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
        name: 'Projeto Focus B Restrito',
        ownerUserId: manager.user.id,
      },
    );
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      projectB.id,
      member2.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    return { admin, manager, member1, member2, organization, projectA, projectB };
  }

  it('aplica ranqueamento 30/30/20/10/10 parametrizado por calibratableWeights, alterna AUTO/MANUAL, fixa/oculta/reordena e reseta reutilizando existing.id sem alterar Kanban nem Task.priority', async () => {
    const { manager, member1, organization, projectA, projectB } = await setupFocusFixture();
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      projectB.id,
      member1.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    const taskCriticalLate = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Entrega Crítica Atrasada',
        priority: PRIORITIES.CRITICAL,
        assigneeId: member1.user.id,
        dueDate: asIsoDateTime('2026-08-05T12:00:00.000Z'),
      },
    );
    // Backdate lastMovedAt so inactivity score is 100
    await container.repositories.tasks.tasks.save({
      ...taskCriticalLate,
      lastMovedAt: asIsoDateTime('2026-08-01T12:00:00.000Z'),
    });

    const taskHighSoon = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Revisão Alta Prazo Próximo',
        priority: PRIORITIES.HIGH,
        assigneeId: member1.user.id,
        dueDate: asIsoDateTime('2026-08-11T10:00:00.000Z'),
      },
    );

    const taskLowFuture = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectB.id,
      {
        title: 'Refinamento Baixa Prioridade',
        priority: PRIORITIES.LOW,
        assigneeId: member1.user.id,
        dueDate: asIsoDateTime('2026-09-15T12:00:00.000Z'),
      },
    );

    // 1. Default 30/30/20/10/10 ranking
    const autoView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
    );
    expect(autoView.mode).toBe(FOCUS_MODES.AUTO);
    expect(autoView.workload.representsHours).toBe(false);
    expect(autoView.ranking.weightsUsed).toEqual({
      priority: 0.3,
      deadline: 0.3,
      dependencies: 0.2,
      inactivity: 0.1,
      workloadCompatibility: 0.1,
    });
    expect(autoView.ranking.actionableTasks.map((t) => t.candidate.taskId)).toEqual([
      taskCriticalLate.id,
      taskHighSoon.id,
      taskLowFuture.id,
    ]);

    // 2. Parametrization via OrganizationSettings.calibratableWeights
    const existingSettings =
      (await container.repositories.settings.organizationSettings.findByOrganization(
        organization.id,
      )) ?? createDefaultOrganizationSettings(organization.id, currentNow);
    await container.repositories.settings.organizationSettings.save({
      ...existingSettings,
      calibratableWeights: {
        ...existingSettings.calibratableWeights,
        focusPriorityWeight: 0.1,
        focusDeadlineWeight: 0.1,
        focusDependenciesWeight: 0.1,
        focusInactivityWeight: 0.6,
        focusWorkloadCompatibilityWeight: 0.1,
      },
      updatedAt: currentNow,
    });

    const calibratedView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
    );
    expect(calibratedView.ranking.weightsUsed).toEqual({
      priority: 0.1,
      deadline: 0.1,
      dependencies: 0.1,
      inactivity: 0.6,
      workloadCompatibility: 0.1,
    });
    const staleEntry = calibratedView.ranking.actionableTasks.find(
      (t) => t.candidate.taskId === taskCriticalLate.id,
    )!;
    const recentEntry = calibratedView.ranking.actionableTasks.find(
      (t) => t.candidate.taskId === taskHighSoon.id,
    )!;
    expect(staleEntry.score).toBeGreaterThan(recentEntry.score);

    // Project filter & onlyMyTasks filter
    const filteredProjectView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
      { projectId: projectB.id, onlyMyTasks: true },
    );
    expect(filteredProjectView.ranking.actionableTasks.map((t) => t.candidate.taskId)).toEqual([
      taskLowFuture.id,
    ]);

    // 3. Pin + Manual order + Hide without mutating Kanban column/order or Task.priority
    const pref1 = await container.services.focus.updateFocusPreferences(
      member1.user.id,
      organization.id,
      {
        mode: FOCUS_MODES.MANUAL,
        pinnedTaskIds: [taskLowFuture.id],
        manualOrderTaskIds: [taskHighSoon.id, taskCriticalLate.id],
      },
    );
    expect(pref1.mode).toBe(FOCUS_MODES.MANUAL);

    const manualView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
    );
    expect(manualView.ranking.actionableTasks.map((t) => t.candidate.taskId)).toEqual([
      taskLowFuture.id,
      taskHighSoon.id,
      taskCriticalLate.id,
    ]);
    expect(manualView.ranking.actionableTasks[0]?.isPinned).toBe(true);
    expect(manualView.counters.pinnedCount).toBe(1);

    // Hide taskCriticalLate
    const pref2 = await container.services.focus.updateFocusPreferences(
      member1.user.id,
      organization.id,
      {
        hiddenTaskIds: [taskCriticalLate.id],
      },
    );
    // Reuses existing.id on &[organizationId+userId]
    expect(pref2.id).toBe(pref1.id);

    const hiddenView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
    );
    expect(hiddenView.ranking.actionableTasks.map((t) => t.candidate.taskId)).toEqual([
      taskLowFuture.id,
      taskHighSoon.id,
    ]);
    expect(hiddenView.hiddenTasks.map((t) => t.taskId)).toEqual([taskCriticalLate.id]);
    expect(hiddenView.counters.hiddenCount).toBe(1);
    expect(hiddenView.counters.actionableCount).toBe(2);

    // Verify Kanban column, order, and official Task.priority are completely untouched
    const storedLow = await container.repositories.tasks.tasks.findById(
      organization.id,
      taskLowFuture.id,
    );
    const storedHigh = await container.repositories.tasks.tasks.findById(
      organization.id,
      taskHighSoon.id,
    );
    const storedCrit = await container.repositories.tasks.tasks.findById(
      organization.id,
      taskCriticalLate.id,
    );
    expect(storedLow?.priority).toBe(PRIORITIES.LOW);
    expect(storedLow?.columnId).toBe(taskLowFuture.columnId);
    expect(storedLow?.order).toBe(taskLowFuture.order);
    expect(storedHigh?.columnId).toBe(taskHighSoon.columnId);
    expect(storedHigh?.order).toBe(taskHighSoon.order);
    expect(storedCrit?.deletedAt).toBeUndefined();
    expect(storedCrit?.status).toBe(TASK_STATUSES.TODO);

    // 4. Reset preferences reuses existing.id and restores AUTO
    const resetPref = await container.services.focus.resetFocusPreferences(
      member1.user.id,
      organization.id,
    );
    expect(resetPref.id).toBe(pref1.id);
    expect(resetPref.mode).toBe(FOCUS_MODES.AUTO);
    expect(resetPref.pinnedTaskIds).toEqual([]);
    expect(resetPref.hiddenTaskIds).toEqual([]);
    expect(resetPref.manualOrderTaskIds).toEqual([]);
  });

  it('filtra tarefas item-a-item por TASK_VIEW (inclui ExplicitDenyRule e projeto inacessível) e rejeita preferências para tarefa inacessível', async () => {
    const { admin, manager, member1, member2, organization, projectA, projectB } =
      await setupFocusFixture();

    const visibleTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Visível Membro 1',
        assigneeId: member1.user.id,
      },
    );
    const deniedTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Bloqueada por Deny',
        assigneeId: member1.user.id,
      },
    );
    const otherMemberTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Exclusiva Membro 2',
        assigneeId: member2.user.id,
      },
    );
    const otherProjectTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectB.id,
      {
        title: 'Tarefa de Projeto Sem Acesso',
        assigneeId: member2.user.id,
      },
    );

    await container.services.authorization.createExplicitDenyRule(admin.user.id, organization.id, {
      targetUserId: member1.user.id,
      permission: PERMISSION_CODES.TASK_VIEW,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(deniedTask.id),
      reason: 'Restrição explícita de visualização da tarefa',
    });

    const focusView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
    );
    const allReturnedIds = [
      ...focusView.ranking.actionableTasks.map((t) => t.candidate.taskId),
      ...focusView.ranking.blockedTasks.map((t) => t.candidate.taskId),
    ];
    expect(allReturnedIds).toEqual([visibleTask.id]);
    expect(allReturnedIds).not.toContain(deniedTask.id);
    expect(allReturnedIds).not.toContain(otherMemberTask.id);
    expect(allReturnedIds).not.toContain(otherProjectTask.id);

    await expect(
      container.services.focus.updateFocusPreferences(member1.user.id, organization.id, {
        pinnedTaskIds: [otherMemberTask.id],
      }),
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      container.services.focus.updateFocusPreferences(member1.user.id, organization.id, {
        hiddenTaskIds: [otherProjectTask.id],
      }),
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      container.services.focus.updateFocusPreferences(member1.user.id, organization.id, {
        manualOrderTaskIds: [deniedTask.id],
      }),
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      container.services.focus.updateFocusPreferences(member1.user.id, organization.id, {
        pinnedTaskIds: [asTaskId('99999999-9999-4999-8999-999999999999')],
      }),
    ).rejects.toThrowError(NotFoundError);
  });

  it('separa tarefas bloqueadas (OPEN_IMPEDIMENT, PENDING_DEPENDENCY e PAUSED) com condição de desbloqueio e sem vazar título de predecessora fora de escopo', async () => {
    const { manager, member1, member2, organization, projectA, projectB } =
      await setupFocusFixture();

    const pausedTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Pausada no Foco',
        assigneeId: member1.user.id,
      },
    );
    await container.services.tasks.startTask(member1.user.id, organization.id, pausedTask.id);
    await container.services.tasks.pauseTask(member1.user.id, organization.id, pausedTask.id, {
      reason: 'Aguardando janela de manutenção',
    });

    const impededTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Impedida no Foco',
        assigneeId: member1.user.id,
      },
    );
    await container.services.impediments.createImpediment(
      member1.user.id,
      organization.id,
      impededTask.id,
      {
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.CRITICAL,
        description: 'Cluster de staging indisponível',
      },
    );

    const visiblePredecessor = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Predecessora Visível Liberadora',
        assigneeId: member1.user.id,
      },
    );
    const depVisibleTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Dependente de Predecessora Visível',
        assigneeId: member1.user.id,
      },
    );
    await container.services.dependencies.addDependency(
      manager.user.id,
      organization.id,
      depVisibleTask.id,
      { dependsOnTaskId: visiblePredecessor.id, required: true },
    );

    const secretPredecessor = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Predecessora Confidencial Membro 2',
        assigneeId: member2.user.id,
      },
    );
    const depSecretTask = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Dependente de Predecessora Sigilosa',
        assigneeId: member1.user.id,
      },
    );
    await container.services.dependencies.addDependency(
      manager.user.id,
      organization.id,
      depSecretTask.id,
      { dependsOnTaskId: secretPredecessor.id, required: true },
    );

    // Ensure task from projectB doesn't leak either
    await container.services.tasks.createTask(manager.user.id, organization.id, projectB.id, {
      title: 'Tarefa Secreta Projeto B',
      assigneeId: member2.user.id,
    });

    const focusView = await container.services.focus.getMyFocusView(
      member1.user.id,
      organization.id,
    );

    expect(focusView.ranking.actionableTasks.map((t) => t.candidate.taskId)).toEqual([
      visiblePredecessor.id,
    ]);
    expect(focusView.ranking.blockedTasks).toHaveLength(4);

    const pausedEntry = focusView.ranking.blockedTasks.find(
      (b) => b.candidate.taskId === pausedTask.id,
    )!;
    expect(pausedEntry.reasons[0]?.code).toBe('PAUSED');
    expect(pausedEntry.reasons[0]?.description).toContain('Aguardando janela de manutenção');
    expect(pausedEntry.reasons[0]?.unblockCondition.length).toBeGreaterThan(0);

    const impededEntry = focusView.ranking.blockedTasks.find(
      (b) => b.candidate.taskId === impededTask.id,
    )!;
    expect(impededEntry.reasons[0]?.code).toBe('OPEN_IMPEDIMENT');
    expect(impededEntry.reasons[0]?.description).toContain('Cluster de staging indisponível');
    expect(impededEntry.reasons[0]?.unblockCondition.length).toBeGreaterThan(0);

    const depVisibleEntry = focusView.ranking.blockedTasks.find(
      (b) => b.candidate.taskId === depVisibleTask.id,
    )!;
    expect(depVisibleEntry.reasons[0]?.code).toBe('PENDING_DEPENDENCY');
    expect(depVisibleEntry.reasons[0]?.description).toContain('Predecessora Visível Liberadora');
    expect(depVisibleEntry.reasons[0]?.unblockCondition.length).toBeGreaterThan(0);

    const depSecretEntry = focusView.ranking.blockedTasks.find(
      (b) => b.candidate.taskId === depSecretTask.id,
    )!;
    expect(depSecretEntry.reasons[0]?.code).toBe('PENDING_DEPENDENCY');
    expect(depSecretEntry.reasons[0]?.description).not.toContain(
      'Predecessora Confidencial Membro 2',
    );
    expect(depSecretEntry.reasons[0]?.unblockCondition.length).toBeGreaterThan(0);
  });

  it('garante isolamento estrito por ownerUserId, cross-organization e evento pós-commit focus.preferences.updated', async () => {
    const { admin, manager, member1, member2, organization, projectA } = await setupFocusFixture();

    const taskM1 = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Exclusiva M1',
        assigneeId: member1.user.id,
      },
    );
    const taskM2 = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Exclusiva M2',
        assigneeId: member2.user.id,
      },
    );

    const publishedEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      publishedEvents.push(event);
    });

    const correlation1 = asCorrelationId('71000000-0000-4000-8000-000000000001');
    const prefM1 = await container.services.focus.updateFocusPreferences(
      member1.user.id,
      organization.id,
      {
        mode: FOCUS_MODES.MANUAL,
        pinnedTaskIds: [taskM1.id],
        correlationId: correlation1,
      },
    );

    // member2 has completely isolated preferences and view
    const viewM2 = await container.services.focus.getMyFocusView(member2.user.id, organization.id);
    expect(viewM2.preference).toBeNull();
    expect(viewM2.mode).toBe(FOCUS_MODES.AUTO);
    expect(viewM2.ranking.actionableTasks.map((t) => t.candidate.taskId)).toEqual([taskM2.id]);
    expect(
      await container.repositories.focus.focusPreferences.findByUser(
        organization.id,
        member2.user.id,
      ),
    ).toBeNull();

    // Post-commit event check
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.eventType).toBe('focus.preferences.updated');
    expect(publishedEvents[0]?.correlationId).toBe(correlation1);
    expect(publishedEvents[0]?.aggregateId).toBe(prefM1.id);
    expect(publishedEvents[0]?.payload).toMatchObject({
      userId: member1.user.id,
      mode: FOCUS_MODES.MANUAL,
      pinnedCount: 1,
      reset: false,
    });

    // Reset publishes post-commit event with reset: true
    const correlation2 = asCorrelationId('71000000-0000-4000-8000-000000000002');
    await container.services.focus.resetFocusPreferences(member1.user.id, organization.id, {
      correlationId: correlation2,
    });
    expect(publishedEvents).toHaveLength(2);
    expect(publishedEvents[1]?.correlationId).toBe(correlation2);
    expect(publishedEvents[1]?.payload).toMatchObject({
      userId: member1.user.id,
      mode: FOCUS_MODES.AUTO,
      reset: true,
    });

    // Cross-organization isolation: Org B vs Org A
    const { organization: orgB } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Focus Org B Isolada',
        slug: 'focus-org-b',
      },
    );
    await expect(
      container.services.focus.getMyFocusView(member1.user.id, orgB.id),
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      container.services.focus.updateFocusPreferences(member1.user.id, orgB.id, {
        mode: FOCUS_MODES.MANUAL,
      }),
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      container.services.focus.resetFocusPreferences(member1.user.id, orgB.id),
    ).rejects.toThrowError(AuthorizationError);

    // Failed transaction does NOT emit post-commit event
    const countBeforeError = publishedEvents.length;
    vi.spyOn(container.repositories.focus.focusPreferences, 'save').mockRejectedValueOnce(
      new Error('Simulated Dexie write failure'),
    );
    await expect(
      container.services.focus.updateFocusPreferences(member1.user.id, organization.id, {
        mode: FOCUS_MODES.MANUAL,
      }),
    ).rejects.toThrow('Simulated Dexie write failure');
    expect(publishedEvents).toHaveLength(countBeforeError);
  });
});
