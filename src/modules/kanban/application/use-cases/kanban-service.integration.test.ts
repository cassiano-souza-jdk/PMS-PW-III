import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { IMPEDIMENT_CATEGORIES, IMPEDIMENT_STATUSES } from '@/modules/impediments';
import { asTaskDependencyId } from '@/modules/dependencies';
import { BOARD_COLUMN_ROLES } from '@/modules/kanban';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import { SUBTASK_STATUSES, asTaskPauseId, type Task } from '@/modules/tasks';
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  asBoardColumnId,
  asEntityId,
  asImpedimentId,
  asIsoDateTime,
  asSubtaskId,
  asTaskId,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('KanbanService Integration (Board, Columns, WIP, Lifecycle, Pauses, Dependencies & §12.1)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-06-15T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_kanban_${crypto.randomUUID()}`,
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

  async function setupProjectFixture() {
    const admin = await registerUser('admin.kanban@pms.local', 'Admin Kanban');
    const manager = await registerUser('manager.kanban@pms.local', 'Gestor Kanban');
    const member = await registerUser('member.kanban@pms.local', 'Membro Kanban');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Kanban Corp',
        slug: 'kanban-corp',
      },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
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
      {
        name: 'Projeto Kanban',
        ownerUserId: manager.user.id,
      },
    );

    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      project.id,
      member.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    const boardView = await container.services.kanban.getProjectBoard(
      manager.user.id,
      organization.id,
      project.id,
    );

    return { admin, manager, member, organization, project, boardView };
  }

  describe('getProjectBoard, occupyingTaskCount com BLOCKED/PAUSED e filtragem TASK_VIEW', () => {
    it('computa WIP real incluindo BLOCKED/PAUSED, oculta cartões fora de TASK_VIEW para MEMBER e bloqueia mutações quando projeto arquivado', async () => {
      const { admin, manager, member, organization, project, boardView } =
        await setupProjectFixture();

      const todoCol = boardView.columns.find((c) => c.columnRole === BOARD_COLUMN_ROLES.INITIAL)!;
      const execCol = boardView.columns.find((c) => c.name === 'Em Execução')!;

      const memberTask = await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Card do Membro',
          columnId: execCol.id,
          assigneeId: member.user.id,
        },
      );

      const blockedManagerTask: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        boardId: boardView.board.id,
        columnId: execCol.id,
        title: 'Card Bloqueado do Gestor',
        status: TASK_STATUSES.BLOCKED,
        priority: PRIORITIES.HIGH,
        assigneeId: manager.user.id,
        order: 2,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      };
      const pausedManagerTask: Task = {
        ...blockedManagerTask,
        id: asTaskId(crypto.randomUUID()),
        title: 'Card Pausado do Gestor',
        status: TASK_STATUSES.PAUSED,
        order: 3,
      };
      await container.repositories.tasks.tasks.saveMany(organization.id, [
        blockedManagerTask,
        pausedManagerTask,
      ]);

      // MEMBER consulta quadro: vê apenas o próprio cartão, mas occupyingTaskCount de Em Execução = 3 (1 + BLOCKED + PAUSED)
      const memberView = await container.services.kanban.getProjectBoard(
        member.user.id,
        organization.id,
        project.id,
      );
      expect(memberView.cards.map((c) => c.task.id)).toEqual([memberTask.id]);
      expect(memberView.columns.find((c) => c.id === execCol.id)?.occupyingTaskCount).toBe(3);
      expect(memberView.permissions.canManageColumns).toBe(false);
      expect(memberView.permissions.canManageWip).toBe(false);
      expect(memberView.permissions.canCreateQuickCard).toBe(false);

      // Arquiva projeto -> leitura do quadro funciona, mas todas permissões mutáveis ficam false e mutações lançam ConflictError
      await container.services.projects.archiveProject(admin.user.id, organization.id, project.id);

      const archivedView = await container.services.kanban.getProjectBoard(
        manager.user.id,
        organization.id,
        project.id,
      );
      expect(archivedView.permissions.canManageColumns).toBe(false);
      expect(archivedView.permissions.canCreateQuickCard).toBe(false);
      expect(archivedView.cards.every((c) => c.canMove === false)).toBe(true);

      await expect(
        container.services.kanban.moveCard(
          manager.user.id,
          organization.id,
          project.id,
          memberTask.id,
          { targetColumnId: todoCol.id },
        ),
      ).rejects.toThrowError(ConflictError);
    });
  });

  describe('Colunas: createColumn, updateColumn, reorderColumns, archiveColumn, deleteColumn', () => {
    it('valida permissões WIP, permutação exata no reorder e migração de tarefas ativas + soft-deleted em deleteColumn', async () => {
      const { admin, manager, member, organization, project, boardView } =
        await setupProjectFixture();

      const todoCol = boardView.columns[0]!;
      const customCol = await container.services.kanban.createColumn(
        manager.user.id,
        organization.id,
        project.id,
        {
          name: 'Triagem',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          wipLimit: 2,
        },
      );

      // MEMBER sem permissão -> AuthorizationError
      await expect(
        container.services.kanban.updateColumn(
          member.user.id,
          organization.id,
          project.id,
          customCol.id,
          { wipLimit: 4 },
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Explicit deny em BOARD_WIP_MANAGE bloqueia alteração de wipLimit
      await container.services.authorization.createExplicitDenyRule(
        admin.user.id,
        organization.id,
        {
          targetUserId: manager.user.id,
          permission: PERMISSION_CODES.BOARD_WIP_MANAGE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(project.id),
          reason: 'Congelar limites de WIP temporariamente',
        },
      );
      await expect(
        container.services.kanban.updateColumn(
          manager.user.id,
          organization.id,
          project.id,
          customCol.id,
          { wipLimit: 5 },
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Reorder exige permutação exata
      await expect(
        container.services.kanban.reorderColumns(manager.user.id, organization.id, project.id, [
          todoCol.id,
          customCol.id,
        ]),
      ).rejects.toThrowError(ValidationError);

      await expect(
        container.services.kanban.reorderColumns(manager.user.id, organization.id, project.id, [
          todoCol.id,
          todoCol.id,
          customCol.id,
          boardView.columns[2]!.id,
          boardView.columns[3]!.id,
        ]),
      ).rejects.toThrowError(ValidationError);

      const reordered = await container.services.kanban.reorderColumns(
        manager.user.id,
        organization.id,
        project.id,
        [
          todoCol.id,
          customCol.id,
          boardView.columns[1]!.id,
          boardView.columns[2]!.id,
          boardView.columns[3]!.id,
        ],
      );
      expect(reordered[1]?.id).toBe(customCol.id);
      expect(reordered[1]?.order).toBe(2);

      // Cria tarefa ativa e tarefa soft-deleted na coluna customCol
      const activeCard = await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Card em Triagem', columnId: customCol.id },
      );
      const deletedCard: Task = {
        ...activeCard,
        id: asTaskId(crypto.randomUUID()),
        title: 'Card Excluído em Triagem',
        order: 2,
        deletedAt: currentNow,
        deletedBy: manager.user.id,
      };
      await container.repositories.tasks.tasks.save(deletedCard);

      // Arquivar coluna com tarefa ativa -> ConflictError
      await expect(
        container.services.kanban.archiveColumn(
          manager.user.id,
          organization.id,
          project.id,
          customCol.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Excluir coluna sem migrationTargetColumnId quando há tarefas -> ConflictError
      await expect(
        container.services.kanban.deleteColumn(
          manager.user.id,
          organization.id,
          project.id,
          customCol.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Excluir migrando para todoCol -> migra ativa E soft-deleted atomicamente
      const deleteResult = await container.services.kanban.deleteColumn(
        manager.user.id,
        organization.id,
        project.id,
        customCol.id,
        { migrationTargetColumnId: todoCol.id },
      );
      expect(deleteResult.migratedTaskCount).toBe(2);

      const migratedAll = await container.repositories.tasks.tasks.listByColumn(
        organization.id,
        todoCol.id,
        { includeDeleted: true },
      );
      expect(migratedAll.map((t) => t.id).sort()).toEqual([activeCard.id, deletedCard.id].sort());
      expect(
        await container.repositories.kanban.boardColumns.findById(organization.id, customCol.id),
      ).toBeNull();
    });
  });

  describe('createQuickCard e moveCard (WIP, pausas, FINAL, reabertura e §12.1)', () => {
    it('respeita OrganizationSettings.allowMemberCreateTaskWithoutGrant em createQuickCard', async () => {
      const { member, organization, project } = await setupProjectFixture();

      // Default Deny para MEMBER
      await expect(
        container.services.kanban.createQuickCard(member.user.id, organization.id, project.id, {
          title: 'Card Bloqueado para Membro',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Habilita nas configurações da organização
      const defaults = createDefaultOrganizationSettings(organization.id, currentNow);
      await container.repositories.settings.organizationSettings.save({
        ...defaults,
        pendingPermissionDefaults: {
          ...defaults.pendingPermissionDefaults,
          allowMemberCreateTaskWithoutGrant: true,
        },
      });

      const created = await container.services.kanban.createQuickCard(
        member.user.id,
        organization.id,
        project.id,
        { title: 'Card Permitido por Settings' },
      );
      expect(created.title).toBe('Card Permitido por Settings');
      expect(created.createdByUserId).toBe(member.user.id);

      const cycles = await container.repositories.tasks.taskExecutionCycles.listByTask(
        organization.id,
        created.id,
      );
      expect(cycles).toHaveLength(1);
      expect(cycles[0]?.cycleNumber).toBe(1);
    });

    it('controla WIP override, tarefas pausadas, bloqueios de conclusão/FINAL, reabertura com novo ciclo e separação §12.1 de lastMovedAt', async () => {
      const { manager, member, organization, project, boardView } = await setupProjectFixture();

      const todoCol = boardView.columns[0]!;
      const execCol = boardView.columns[1]!; // wipLimit: 3
      const reviewCol = boardView.columns[2]!; // wipLimit: 2
      const doneCol = boardView.columns[3]!; // FINAL

      // Preenche reviewCol até atingir WIP = 2
      const r1 = await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Revisão 1', columnId: reviewCol.id, assigneeId: member.user.id },
      );
      await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Revisão 2', columnId: reviewCol.id, assigneeId: manager.user.id },
      );

      // Cria card do membro em todoCol
      const card = await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Card Principal', columnId: todoCol.id, assigneeId: member.user.id },
      );
      const siblingInTodo = await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Irmão em A Fazer', columnId: todoCol.id, assigneeId: member.user.id },
      );

      // Reordenação dentro da mesma coluna em t2 preserva lastMovedAt original de t1 e atualiza lastActivityAt
      const t2 = asIsoDateTime('2026-06-16T12:00:00.000Z');
      currentNow = t2;

      const reorderedSameCol = await container.services.kanban.moveCard(
        member.user.id,
        organization.id,
        project.id,
        siblingInTodo.id,
        { targetColumnId: todoCol.id, targetOrder: 1 },
      );
      expect(reorderedSameCol.order).toBe(1);
      expect(reorderedSameCol.lastMovedAt).toBe(siblingInTodo.lastMovedAt);
      expect(reorderedSameCol.lastActivityAt).toBe(t2);

      // Irmão deslocado atualizou apenas order, mantendo lastMovedAt e lastActivityAt originais
      const untouchedCard = await container.repositories.tasks.tasks.findById(
        organization.id,
        card.id,
      );
      expect(untouchedCard?.order).toBe(2);
      expect(untouchedCard?.lastMovedAt).toBe(card.lastMovedAt);
      expect(untouchedCard?.lastActivityAt).toBe(card.lastActivityAt);

      // Movimento entre colunas em t3 atualiza lastMovedAt e lastActivityAt
      const t3 = asIsoDateTime('2026-06-17T14:00:00.000Z');
      currentNow = t3;
      const movedToExec = await container.services.kanban.moveCard(
        member.user.id,
        organization.id,
        project.id,
        card.id,
        { targetColumnId: execCol.id },
      );
      expect(movedToExec.columnId).toBe(execCol.id);
      expect(movedToExec.lastMovedAt).toBe(t3);
      expect(movedToExec.lastActivityAt).toBe(t3);

      // WIP excedido em reviewCol: sem justificativa -> ConflictError; MEMBER com override -> AuthorizationError; MANAGER sem justificativa -> ValidationError; MANAGER com justificativa -> sucesso auditado
      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: reviewCol.id,
        }),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: reviewCol.id,
          wipOverrideJustification: 'Urgência do cliente',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.kanban.moveCard(manager.user.id, organization.id, project.id, card.id, {
          targetColumnId: reviewCol.id,
          wipOverrideJustification: '   ',
        }),
      ).rejects.toThrowError(ValidationError);

      const movedWithWipOverride = await container.services.kanban.moveCard(
        manager.user.id,
        organization.id,
        project.id,
        card.id,
        { targetColumnId: reviewCol.id, wipOverrideJustification: 'Prioridade crítica aprovada' },
      );
      expect(movedWithWipOverride.columnId).toBe(reviewCol.id);

      const wipAuditEvents = await container.repositories.audit.auditEvents.listByProject(
        organization.id,
        project.id,
        { page: 1, pageSize: 50 },
        { category: AUDIT_CATEGORIES.KANBAN },
      );
      const wipOverrideAudit = wipAuditEvents.items.find(
        (event) =>
          event.eventType === 'kanban.card.moved' &&
          event.resourceId === card.id &&
          event.after?.usedWipOverride === true,
      );
      expect(wipOverrideAudit).toBeDefined();
      expect(wipOverrideAudit?.category).toBe(AUDIT_CATEGORIES.KANBAN);
      expect(wipOverrideAudit?.after?.exceededWip).toBe(true);
      expect(wipOverrideAudit?.justification).toBe('Prioridade crítica aprovada');

      // Pausa aberta impede movimentação sem exceção
      const cycles = await container.repositories.tasks.taskExecutionCycles.listByTask(
        organization.id,
        card.id,
      );
      const pauseId = asTaskPauseId(crypto.randomUUID());
      await container.repositories.tasks.taskPauses.save({
        id: pauseId,
        organizationId: organization.id,
        taskId: card.id,
        cycleId: cycles[0]!.id,
        startedAt: currentNow,
        startedByUserId: member.user.id,
        reason: 'Aguardando definição',
      });

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: execCol.id,
        }),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: execCol.id,
          pausedOverrideJustification: 'Tentativa membro',
        }),
      ).rejects.toThrowError(AuthorizationError);

      const movedPausedWithOverride = await container.services.kanban.moveCard(
        manager.user.id,
        organization.id,
        project.id,
        card.id,
        { targetColumnId: execCol.id, pausedOverrideJustification: 'Reajuste de fila autorizado' },
      );
      expect(movedPausedWithOverride.columnId).toBe(execCol.id);

      // Encerra pausa
      await container.repositories.tasks.taskPauses.save({
        id: pauseId,
        organizationId: organization.id,
        taskId: card.id,
        cycleId: cycles[0]!.id,
        startedAt: currentNow,
        startedByUserId: member.user.id,
        reason: 'Aguardando definição',
        endedAt: currentNow,
        endedByUserId: member.user.id,
      });

      // Subtarefa obrigatória aberta + impedimento bloqueante + dependência obrigatória pendente impedem entrada em FINAL
      const subtaskId = asSubtaskId(crypto.randomUUID());
      await container.repositories.tasks.subtasks.save({
        id: subtaskId,
        organizationId: organization.id,
        taskId: card.id,
        title: 'Checklist obrigatório',
        required: true,
        status: SUBTASK_STATUSES.OPEN,
        order: 1,
        createdAt: currentNow,
        updatedAt: currentNow,
      });

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: doneCol.id,
        }),
      ).rejects.toThrowError(ConflictError);

      // Conclui subtarefa, mas adiciona impedimento bloqueante
      await container.repositories.tasks.subtasks.save({
        id: subtaskId,
        organizationId: organization.id,
        taskId: card.id,
        title: 'Checklist obrigatório',
        required: true,
        status: SUBTASK_STATUSES.DONE,
        order: 1,
        completedAt: currentNow,
        createdAt: currentNow,
        updatedAt: currentNow,
      });

      const impId = asImpedimentId(crypto.randomUUID());
      await container.repositories.impediments.impediments.save({
        id: impId,
        organizationId: organization.id,
        projectId: project.id,
        taskId: card.id,
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Ambiente instável',
        status: IMPEDIMENT_STATUSES.OPEN,
        openedByUserId: member.user.id,
        openedAt: currentNow,
        updatedAt: currentNow,
      });

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: doneCol.id,
        }),
      ).rejects.toThrowError(ConflictError);

      // Resolve impedimento, mas adiciona dependência obrigatória pendente de r1
      await container.repositories.impediments.impediments.save({
        id: impId,
        organizationId: organization.id,
        projectId: project.id,
        taskId: card.id,
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Ambiente instável',
        status: IMPEDIMENT_STATUSES.RESOLVED,
        openedByUserId: member.user.id,
        openedAt: currentNow,
        resolvedAt: currentNow,
        resolvedByUserId: manager.user.id,
        updatedAt: currentNow,
      });

      await container.repositories.dependencies.taskDependencies.save({
        id: asTaskDependencyId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        taskId: card.id,
        dependsOnTaskId: r1.id,
        required: true,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
      });

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: doneCol.id,
        }),
      ).rejects.toThrowError(ConflictError);

      // MANAGER conclui com dependencyOverrideJustification
      const completed = await container.services.kanban.moveCard(
        manager.user.id,
        organization.id,
        project.id,
        card.id,
        {
          targetColumnId: doneCol.id,
          dependencyOverrideJustification: 'Dependência validada em paralelo',
        },
      );
      expect(completed.status).toBe(TASK_STATUSES.DONE);
      expect(completed.completedAt).toBe(t3);

      const cyclesAfterDone = await container.repositories.tasks.taskExecutionCycles.listByTask(
        organization.id,
        card.id,
      );
      expect(cyclesAfterDone).toHaveLength(1);
      expect(cyclesAfterDone[0]?.completedAt).toBe(t3);

      // Reabertura por movimentação para fora de FINAL: MEMBER sem grant -> AuthorizationError; MANAGER -> novo ciclo imutável #2
      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: execCol.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      const t4 = asIsoDateTime('2026-06-18T09:00:00.000Z');
      currentNow = t4;
      const reopened = await container.services.kanban.moveCard(
        manager.user.id,
        organization.id,
        project.id,
        card.id,
        {
          targetColumnId: execCol.id,
          reopenReason: 'Ajuste pós-revisão',
        },
      );
      expect(reopened.status).toBe(TASK_STATUSES.IN_PROGRESS);
      expect(reopened.completedAt).toBeUndefined();

      const cyclesAfterReopen = await container.repositories.tasks.taskExecutionCycles.listByTask(
        organization.id,
        card.id,
      );
      expect(cyclesAfterReopen).toHaveLength(2);
      expect(cyclesAfterReopen[1]?.cycleNumber).toBe(2);
      expect(cyclesAfterReopen[1]?.reopenedFromCycleId).toBe(cyclesAfterDone[0]!.id);
      expect(cyclesAfterReopen[1]?.reopenReason).toBe('Ajuste pós-revisão');
    });

    it('rejeita movimentação de tarefa CANCELLED com ConflictError', async () => {
      const { manager, organization, project, boardView } = await setupProjectFixture();
      const todoCol = boardView.columns[0]!;
      const execCol = boardView.columns[1]!;

      const cancelledTask: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        boardId: boardView.board.id,
        columnId: todoCol.id,
        title: 'Tarefa Cancelada',
        status: TASK_STATUSES.CANCELLED,
        priority: PRIORITIES.LOW,
        order: 1,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        cancelledAt: currentNow,
        cancellationReason: 'Descontinuada',
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      };
      await container.repositories.tasks.tasks.save(cancelledTask);

      await expect(
        container.services.kanban.moveCard(
          manager.user.id,
          organization.id,
          project.id,
          cancelledTask.id,
          { targetColumnId: execCol.id },
        ),
      ).rejects.toThrowError(ConflictError);
    });
  });

  describe('Invariantes estruturais (assertValidBoardColumns), Deny Overrides, isolamento multi-org e bloqueio por arquivamento', () => {
    it('respeita assertValidBoardColumns em archiveColumn/deleteColumn e exclui CANCELLED/soft-deleted de occupyingTaskCount', async () => {
      const { manager, organization, project, boardView } = await setupProjectFixture();

      const todoCol = boardView.columns[0]!;
      const execCol = boardView.columns[1]!;
      const reviewCol = boardView.columns[2]!;
      const doneCol = boardView.columns[3]!;

      // Não pode arquivar nem excluir a única coluna FINAL do quadro
      await expect(
        container.services.kanban.archiveColumn(
          manager.user.id,
          organization.id,
          project.id,
          doneCol.id,
        ),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.kanban.deleteColumn(
          manager.user.id,
          organization.id,
          project.id,
          doneCol.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Arquiva colunas operacionais vazias até restar apenas todoCol (última operacional) -> bloqueado por assertValidBoardColumns
      const archivedExec = await container.services.kanban.archiveColumn(
        manager.user.id,
        organization.id,
        project.id,
        execCol.id,
      );
      expect(archivedExec.archivedAt).toBe(currentNow);

      await container.services.kanban.archiveColumn(
        manager.user.id,
        organization.id,
        project.id,
        reviewCol.id,
      );

      await expect(
        container.services.kanban.archiveColumn(
          manager.user.id,
          organization.id,
          project.id,
          todoCol.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Não pode migrar tarefas para uma coluna arquivada na exclusão
      await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Card em A Fazer', columnId: todoCol.id },
      );
      await expect(
        container.services.kanban.deleteColumn(
          manager.user.id,
          organization.id,
          project.id,
          todoCol.id,
          { migrationTargetColumnId: execCol.id },
        ),
      ).rejects.toThrowError(ConflictError);

      // Restaura coluna arquivada e valida reorderColumns rejeitando ID inexistente
      const restoredExec = await container.services.kanban.restoreColumn(
        manager.user.id,
        organization.id,
        project.id,
        execCol.id,
      );
      expect(restoredExec.archivedAt).toBeUndefined();

      await expect(
        container.services.kanban.reorderColumns(manager.user.id, organization.id, project.id, [
          todoCol.id,
          execCol.id,
          doneCol.id,
          asBoardColumnId(crypto.randomUUID()),
        ]),
      ).rejects.toThrowError(ValidationError);

      // CANCELLED e soft-deleted NÃO incrementam occupyingTaskCount
      const cancelledInExec: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        boardId: boardView.board.id,
        columnId: execCol.id,
        title: 'Cancelada em Execução',
        status: TASK_STATUSES.CANCELLED,
        priority: PRIORITIES.LOW,
        order: 1,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        cancelledAt: currentNow,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      };
      const softDeletedInExec: Task = {
        ...cancelledInExec,
        id: asTaskId(crypto.randomUUID()),
        title: 'Soft-Deleted em Execução',
        status: TASK_STATUSES.IN_PROGRESS,
        order: 2,
        deletedAt: currentNow,
        deletedBy: manager.user.id,
      };
      await container.repositories.tasks.tasks.saveMany(organization.id, [
        cancelledInExec,
        softDeletedInExec,
      ]);

      const updatedBoard = await container.services.kanban.getProjectBoard(
        manager.user.id,
        organization.id,
        project.id,
      );
      expect(updatedBoard.columns.find((c) => c.id === execCol.id)?.occupyingTaskCount).toBe(0);
    });

    it('impõe precedência de ExplicitDenyRule sobre PermissionGrant em moveCard (Cenário 10), isola organizações (Cenário 1) e bloqueia ADMIN em projeto arquivado (Cenário 18)', async () => {
      const { admin, manager, member, organization, project, boardView } =
        await setupProjectFixture();

      const todoCol = boardView.columns[0]!;
      const execCol = boardView.columns[1]!;
      const reviewCol = boardView.columns[2]!; // wipLimit: 2
      const doneCol = boardView.columns[3]!;

      // Preenche reviewCol até WIP = 2
      await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Revisão Ocupante 1', columnId: reviewCol.id },
      );
      await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        { title: 'Revisão Ocupante 2', columnId: reviewCol.id },
      );

      // Card atribuído ao manager (MEMBER só move com grant explícito)
      const card = await container.services.kanban.createQuickCard(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Card Controlado por Grant vs Deny',
          columnId: todoCol.id,
          assigneeId: manager.user.id,
        },
      );

      // Concede TASK_VIEW, BOARD_CARD_MOVE, TASK_MOVE e BOARD_WIP_MANAGE ao MEMBER no projeto
      for (const permission of [
        PERMISSION_CODES.TASK_VIEW,
        PERMISSION_CODES.BOARD_CARD_MOVE,
        PERMISSION_CODES.TASK_MOVE,
        PERMISSION_CODES.BOARD_WIP_MANAGE,
      ]) {
        await container.services.authorization.grantPermission(admin.user.id, organization.id, {
          granteeUserId: member.user.id,
          permission,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(project.id),
          reason: 'Delegação explícita temporária no projeto',
        });
      }

      // Com os grants ativos, MEMBER consegue mover para Em Execução
      const movedWithGrant = await container.services.kanban.moveCard(
        member.user.id,
        organization.id,
        project.id,
        card.id,
        { targetColumnId: execCol.id },
      );
      expect(movedWithGrant.columnId).toBe(execCol.id);

      // ExplicitDenyRule sobre BOARD_WIP_MANAGE bloqueia WIP override mesmo com grant ativo
      const wipDenyRule = await container.services.authorization.createExplicitDenyRule(
        admin.user.id,
        organization.id,
        {
          targetUserId: member.user.id,
          permission: PERMISSION_CODES.BOARD_WIP_MANAGE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(project.id),
          reason: 'Bloqueio explícito de exceção WIP',
        },
      );

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: reviewCol.id,
          wipOverrideJustification: 'Tentativa apesar do deny WIP',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Revoga deny de WIP, aplica ExplicitDenyRule em TASK_MOVE -> bloqueia até movimentação simples mesmo com grants ativos
      await container.services.authorization.revokeExplicitDenyRule(
        admin.user.id,
        organization.id,
        wipDenyRule.id,
      );
      await container.services.authorization.createExplicitDenyRule(
        admin.user.id,
        organization.id,
        {
          targetUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_MOVE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(project.id),
          reason: 'Deny Overrides prevalece sobre grant TASK_MOVE',
        },
      );

      await expect(
        container.services.kanban.moveCard(member.user.id, organization.id, project.id, card.id, {
          targetColumnId: todoCol.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Estado persistido no Dexie permanece inalterado
      const persistedCard = await container.repositories.tasks.tasks.findById(
        organization.id,
        card.id,
      );
      expect(persistedCard?.columnId).toBe(execCol.id);

      const memberBoardUnderDeny = await container.services.kanban.getProjectBoard(
        member.user.id,
        organization.id,
        project.id,
      );
      expect(
        memberBoardUnderDeny.cards.find((projection) => projection.task.id === card.id)?.canMove,
      ).toBe(false);

      // Cenário 1: ADMIN de outra organização não lê nem altera o quadro da organização A
      const outsider = await registerUser('outsider.kanban@pms.local', 'Admin Org B');
      await container.services.organizations.createOrganization(outsider.user.id, {
        name: 'Org B Kanban',
        slug: 'org-b-kanban',
      });

      await expect(
        container.services.kanban.getProjectBoard(outsider.user.id, organization.id, project.id),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.kanban.createColumn(outsider.user.id, organization.id, project.id, {
          name: 'Invasão',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          wipLimit: null,
        }),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.kanban.createQuickCard(outsider.user.id, organization.id, project.id, {
          title: 'Card Invasor',
        }),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.kanban.moveCard(outsider.user.id, organization.id, project.id, card.id, {
          targetColumnId: todoCol.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Cenário 18: Projeto arquivado bloqueia mutações estruturais e operacionais mesmo para ADMIN
      await container.services.projects.archiveProject(admin.user.id, organization.id, project.id);

      await expect(
        container.services.kanban.createColumn(admin.user.id, organization.id, project.id, {
          name: 'Nova em Arquivado',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          wipLimit: null,
        }),
      ).rejects.toThrowError(ConflictError);
      await expect(
        container.services.kanban.updateColumn(
          admin.user.id,
          organization.id,
          project.id,
          reviewCol.id,
          { wipLimit: 5 },
        ),
      ).rejects.toThrowError(ConflictError);
      await expect(
        container.services.kanban.reorderColumns(admin.user.id, organization.id, project.id, [
          todoCol.id,
          execCol.id,
          reviewCol.id,
          doneCol.id,
        ]),
      ).rejects.toThrowError(ConflictError);
      await expect(
        container.services.kanban.createQuickCard(admin.user.id, organization.id, project.id, {
          title: 'Bloqueado Arquivado',
        }),
      ).rejects.toThrowError(ConflictError);
      await expect(
        container.services.kanban.moveCard(admin.user.id, organization.id, project.id, card.id, {
          targetColumnId: todoCol.id,
        }),
      ).rejects.toThrowError(ConflictError);
    });
  });

  describe('Endurecimentos da Fase 06 incorporados na Fase 07 (ADR-0011 §10)', () => {
    it('Endurecimento 1: createQuickCard exige TASK_ASSIGN quando assigneeId for informado para terceiro (diferente do ator)', async () => {
      const { admin, manager, member, organization, project } = await setupProjectFixture();

      const defaults = createDefaultOrganizationSettings(organization.id, currentNow);
      await container.repositories.settings.organizationSettings.save({
        ...defaults,
        pendingPermissionDefaults: {
          ...defaults.pendingPermissionDefaults,
          allowMemberCreateTaskWithoutGrant: true,
        },
      });

      // MEMBER pode criar cartão sem assigneeId ou atribuído a si mesmo
      const selfCard = await container.services.kanban.createQuickCard(
        member.user.id,
        organization.id,
        project.id,
        {
          title: 'Card Próprio do Membro',
          assigneeId: member.user.id,
        },
      );
      expect(selfCard.assigneeId).toBe(member.user.id);

      // MEMBER NÃO pode criar cartão atribuído a terceiro (manager) sem TASK_ASSIGN
      await expect(
        container.services.kanban.createQuickCard(member.user.id, organization.id, project.id, {
          title: 'Card Atribuído a Terceiro sem TASK_ASSIGN',
          assigneeId: manager.user.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Concede TASK_ASSIGN ao MEMBER no projeto -> agora sucede
      await container.services.authorization.grantPermission(admin.user.id, organization.id, {
        granteeUserId: member.user.id,
        permission: PERMISSION_CODES.TASK_ASSIGN,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: asEntityId(project.id),
        reason: 'Permitir atribuição de quick card na sprint',
      });

      const delegatedCard = await container.services.kanban.createQuickCard(
        member.user.id,
        organization.id,
        project.id,
        {
          title: 'Card Atribuído com TASK_ASSIGN',
          assigneeId: manager.user.id,
        },
      );
      expect(delegatedCard.assigneeId).toBe(manager.user.id);
    });

    it('Endurecimento 2: deleteColumn rejeita migrationTargetColumnId arquivada mesmo quando activeTaskCount === 0 (ex.: apenas tarefas soft-deleted)', async () => {
      const { manager, organization, project, boardView } = await setupProjectFixture();
      const reviewCol = boardView.columns[2]!;

      const tempCol = await container.services.kanban.createColumn(
        manager.user.id,
        organization.id,
        project.id,
        {
          name: 'Coluna Com Soft-Deleted',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          wipLimit: null,
        },
      );

      // Arquiva coluna vazia reviewCol
      await container.services.kanban.archiveColumn(
        manager.user.id,
        organization.id,
        project.id,
        reviewCol.id,
      );

      // Grava apenas uma tarefa soft-deleted dentro de tempCol (activeTaskCount === 0)
      const softDeletedCard: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        boardId: boardView.board.id,
        columnId: tempCol.id,
        title: 'Tarefa Excluída na Coluna',
        status: TASK_STATUSES.TODO,
        priority: PRIORITIES.LOW,
        order: 1,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
        deletedAt: currentNow,
        deletedBy: manager.user.id,
      };
      await container.repositories.tasks.tasks.save(softDeletedCard);

      // Tentar excluir tempCol migrando para a coluna arquivada reviewCol deve falhar com ConflictError
      await expect(
        container.services.kanban.deleteColumn(
          manager.user.id,
          organization.id,
          project.id,
          tempCol.id,
          { migrationTargetColumnId: reviewCol.id },
        ),
      ).rejects.toThrowError(ConflictError);

      // Coluna e tarefa permanecem intactas
      expect(
        await container.repositories.kanban.boardColumns.findById(organization.id, tempCol.id),
      ).not.toBeNull();
    });
  });
});
