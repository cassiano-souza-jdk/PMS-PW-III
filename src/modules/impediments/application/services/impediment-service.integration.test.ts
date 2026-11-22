import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { IMPEDIMENT_CATEGORIES, IMPEDIMENT_STATUSES } from '@/modules/impediments';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import { AuthorizationError, ConflictError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TASK_STATUSES,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('ImpedimentService Integration (Categories, Transitions, Task BLOCKED/Restore Sync & MANAGER Symmetry)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-07-20T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_impediments_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
  });

  afterEach(async () => {
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

  async function setupFixture() {
    const admin = await registerUser('admin.imp@pms.local', 'Admin Imp');
    const manager = await registerUser('manager.imp@pms.local', 'Gestor Imp');
    const participatingManager = await registerUser(
      'pmanager.imp@pms.local',
      'Gestor Participante Imp',
    );
    const member = await registerUser('member.imp@pms.local', 'Membro Imp');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      { name: 'Impediments Corp', slug: 'impediments-corp' },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
      [participatingManager.user.id, ORGANIZATION_ROLES.MANAGER],
      [member.user.id, ORGANIZATION_ROLES.MEMBER],
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

    const project = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      { name: 'Projeto Impedimentos', ownerUserId: manager.user.id },
    );

    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      project.id,
      participatingManager.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      project.id,
      member.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    return { admin, manager, participatingManager, member, organization, project };
  }

  it('transiciona tarefa para BLOCKED, restaura PAUSED/IN_PROGRESS/TODO ao encerrar último bloqueante sem auto-concluir e preserva lastMovedAt', async () => {
    const { manager, member, organization, project } = await setupFixture();

    const task = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      project.id,
      { title: 'Tarefa com Bloqueios', assigneeId: member.user.id },
    );

    // Inicia tarefa -> IN_PROGRESS
    const startedTask = await container.services.tasks.startTask(
      member.user.id,
      organization.id,
      task.id,
    );
    expect(startedTask.status).toBe(TASK_STATUSES.IN_PROGRESS);
    const movedAtAfterStart = startedTask.lastMovedAt;

    const events: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      events.push(event);
    });

    // Cria dois impedimentos bloqueantes de categorias distintas
    const t2 = asIsoDateTime('2026-07-21T09:00:00.000Z');
    currentNow = t2;

    const imp1 = await container.services.impediments.createImpediment(
      member.user.id,
      organization.id,
      task.id,
      {
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.CRITICAL,
        description: 'Falha de infraestrutura',
      },
    );
    const imp2 = await container.services.impediments.createImpediment(
      manager.user.id,
      organization.id,
      task.id,
      {
        category: IMPEDIMENT_CATEGORIES.AWAITING_APPROVAL,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Aguardando aprovação de segurança',
        ownerUserId: manager.user.id,
      },
    );

    const blockedTask = await container.repositories.tasks.tasks.findById(organization.id, task.id);
    expect(blockedTask?.status).toBe(TASK_STATUSES.BLOCKED);
    expect(blockedTask?.lastMovedAt).toBe(movedAtAfterStart);

    // Atualiza descrição do imp1
    const updatedImp1 = await container.services.impediments.updateImpediment(
      member.user.id,
      organization.id,
      task.id,
      imp1.id,
      { description: 'Falha de infraestrutura no cluster staging' },
    );
    expect(updatedImp1.description).toBe('Falha de infraestrutura no cluster staging');

    // Move imp1 para IN_RESOLUTION e depois RESOLVED -> imp2 ainda aberto mantém tarefa BLOCKED
    await container.services.impediments.transitionImpediment(
      member.user.id,
      organization.id,
      task.id,
      imp1.id,
      { targetStatus: IMPEDIMENT_STATUSES.IN_RESOLUTION },
    );
    await container.services.impediments.transitionImpediment(
      member.user.id,
      organization.id,
      task.id,
      imp1.id,
      { targetStatus: IMPEDIMENT_STATUSES.RESOLVED, resolutionNote: 'Cluster restaurado' },
    );

    const stillBlocked = await container.repositories.tasks.tasks.findById(
      organization.id,
      task.id,
    );
    expect(stillBlocked?.status).toBe(TASK_STATUSES.BLOCKED);

    // Não pode reabrir impedimento já RESOLVED
    await expect(
      container.services.impediments.transitionImpediment(
        manager.user.id,
        organization.id,
        task.id,
        imp1.id,
        { targetStatus: IMPEDIMENT_STATUSES.OPEN },
      ),
    ).rejects.toThrowError(ConflictError);

    // Cancela o último impedimento bloqueante imp2 -> restaura IN_PROGRESS (jamais DONE!), preservando lastMovedAt
    const t3 = asIsoDateTime('2026-07-22T11:00:00.000Z');
    currentNow = t3;
    const cancelledImp2 = await container.services.impediments.transitionImpediment(
      manager.user.id,
      organization.id,
      task.id,
      imp2.id,
      { targetStatus: IMPEDIMENT_STATUSES.CANCELLED, resolutionNote: 'Aprovação dispensada' },
    );
    expect(cancelledImp2.status).toBe(IMPEDIMENT_STATUSES.CANCELLED);

    const restoredTask = await container.repositories.tasks.tasks.findById(
      organization.id,
      task.id,
    );
    expect(restoredTask?.status).toBe(TASK_STATUSES.IN_PROGRESS);
    expect(restoredTask?.completedAt).toBeUndefined();
    expect(restoredTask?.lastMovedAt).toBe(movedAtAfterStart);
    expect(restoredTask?.lastActivityAt).toBe(t3);

    const transitionEvent = events.find(
      (e) => e.eventType === 'task.impediment.transitioned' && e.aggregateId === imp2.id,
    );
    expect(transitionEvent?.payload).toMatchObject({ autoCompletesTask: false });

    // Se houver pausa aberta na tarefa quando o último impedimento é resolvido, restaura para PAUSED
    await container.services.tasks.pauseTask(member.user.id, organization.id, task.id, {
      reason: 'Pausa antes de novo impedimento',
    });
    const imp3 = await container.services.impediments.createImpediment(
      member.user.id,
      organization.id,
      task.id,
      {
        category: IMPEDIMENT_CATEGORIES.COMMUNICATION,
        severity: IMPEDIMENT_SEVERITIES.LOW,
        description: 'Alinhamento pendente',
      },
    );
    expect(
      (await container.repositories.tasks.tasks.findById(organization.id, task.id))?.status,
    ).toBe(TASK_STATUSES.BLOCKED);
    await container.services.impediments.transitionImpediment(
      member.user.id,
      organization.id,
      task.id,
      imp3.id,
      { targetStatus: IMPEDIMENT_STATUSES.RESOLVED },
    );
    expect(
      (await container.repositories.tasks.tasks.findById(organization.id, task.id))?.status,
    ).toBe(TASK_STATUSES.PAUSED);
  });

  it('aplica simetria para MANAGER participante de projeto em IMPEDIMENT_RESOLVE via OrganizationSettings.allowMemberResolveOthersImpediment', async () => {
    const { manager, participatingManager, member, organization, project } = await setupFixture();

    const task = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      project.id,
      { title: 'Tarefa de Equipe', assigneeId: member.user.id },
    );
    await container.services.tasks.addTaskParticipant(manager.user.id, organization.id, task.id, {
      userId: participatingManager.user.id,
    });

    const memberImp = await container.services.impediments.createImpediment(
      member.user.id,
      organization.id,
      task.id,
      {
        category: IMPEDIMENT_CATEGORIES.MISSING_INFORMATION,
        severity: IMPEDIMENT_SEVERITIES.MEDIUM,
        description: 'Especificação incompleta',
      },
    );

    // Default Deny: MANAGER participante (não gestor do projeto) não resolve impedimento aberto por terceiro
    await expect(
      container.services.impediments.transitionImpediment(
        participatingManager.user.id,
        organization.id,
        task.id,
        memberImp.id,
        { targetStatus: IMPEDIMENT_STATUSES.RESOLVED },
      ),
    ).rejects.toThrowError(AuthorizationError);

    // Habilita allowMemberResolveOthersImpediment -> MANAGER participante passa a resolver
    const defaults = createDefaultOrganizationSettings(organization.id, currentNow);
    await container.repositories.settings.organizationSettings.save({
      ...defaults,
      pendingPermissionDefaults: {
        ...defaults.pendingPermissionDefaults,
        allowMemberResolveOthersImpediment: true,
      },
    });

    const resolved = await container.services.impediments.transitionImpediment(
      participatingManager.user.id,
      organization.id,
      task.id,
      memberImp.id,
      { targetStatus: IMPEDIMENT_STATUSES.RESOLVED, resolutionNote: 'Informação obtida' },
    );
    expect(resolved.status).toBe(IMPEDIMENT_STATUSES.RESOLVED);
    expect(resolved.resolvedByUserId).toBe(participatingManager.user.id);
  });
});
