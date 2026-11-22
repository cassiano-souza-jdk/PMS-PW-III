import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { IMPEDIMENT_CATEGORIES, IMPEDIMENT_STATUSES } from '@/modules/impediments';
import { BOARD_COLUMN_ROLES } from '@/modules/kanban';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import { SUBTASK_STATUSES } from '@/modules/tasks';
import {
  AuthorizationError,
  ConflictError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  asEntityId,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('TaskService Integration (Lifecycle, Participants, Subtasks, Comments, Attachments, Tags & §12.1)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-07-01T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_tasks_${crypto.randomUUID()}`,
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

  async function setupProjectFixture() {
    const admin = await registerUser('admin.tasks@pms.local', 'Admin Tasks');
    const manager = await registerUser('manager.tasks@pms.local', 'Gestor Tasks');
    const member = await registerUser('member.tasks@pms.local', 'Membro Tasks');
    const secondMember = await registerUser('member2.tasks@pms.local', 'Segundo Membro');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Tasks Corp',
        slug: 'tasks-corp',
      },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
      [member.user.id, ORGANIZATION_ROLES.MEMBER],
      [secondMember.user.id, ORGANIZATION_ROLES.MEMBER],
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
        name: 'Projeto Fase 07',
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
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      project.id,
      secondMember.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    const boardView = await container.services.kanban.getProjectBoard(
      manager.user.id,
      organization.id,
      project.id,
    );

    return { admin, manager, member, secondMember, organization, project, boardView };
  }

  describe('Ciclo de vida da tarefa, participantes, histórico de prazos, exclusão e restauração', () => {
    it('cria tarefa com ciclo #1 e prazo inicial, atualiza com requestedFields preservando lastMovedAt, inicia, pausa/retoma, conclui e reabre com ciclo #2', async () => {
      const { admin, manager, member, secondMember, organization, project, boardView } =
        await setupProjectFixture();

      const todoCol = boardView.columns.find((c) => c.columnRole === BOARD_COLUMN_ROLES.INITIAL)!;
      const execCol = boardView.columns.find((c) => c.name === 'Em Execução')!;
      const doneCol = boardView.columns.find((c) => c.columnRole === BOARD_COLUMN_ROLES.FINAL)!;

      // MEMBER sem permissão não cria tarefa (Default Deny)
      await expect(
        container.services.tasks.createTask(member.user.id, organization.id, project.id, {
          title: 'Negada para Membro',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Habilita allowMemberCreateTaskWithoutGrant -> MEMBER cria para si, mas sem TASK_ASSIGN não cria para terceiro
      const defaults = createDefaultOrganizationSettings(organization.id, currentNow);
      await container.repositories.settings.organizationSettings.save({
        ...defaults,
        pendingPermissionDefaults: {
          ...defaults.pendingPermissionDefaults,
          allowMemberCreateTaskWithoutGrant: true,
        },
      });

      await expect(
        container.services.tasks.createTask(member.user.id, organization.id, project.id, {
          title: 'Atribuída a terceiro sem permissão',
          assigneeId: secondMember.user.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Gestor cria tarefa com prazo inicial na coluna INITIAL
      const dueDate1 = asIsoDateTime('2026-07-10T18:00:00.000Z');
      const task = await container.services.tasks.createTask(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Implementar TaskService',
          description: 'Escopo completo da tarefa',
          priority: PRIORITIES.HIGH,
          assigneeId: member.user.id,
          dueDate: dueDate1,
          deadlineJustification: 'Meta inicial da sprint',
        },
      );
      expect(task.status).toBe(TASK_STATUSES.TODO);
      expect(task.columnId).toBe(todoCol.id);
      expect(task.lastMovedAt).toBe(currentNow);

      // Verifica ciclo #1 e histórico de prazo inicial
      const detailAfterCreate = await container.services.tasks.getTaskDetail(
        member.user.id,
        organization.id,
        task.id,
      );
      expect(detailAfterCreate.executionCycles).toHaveLength(1);
      expect(detailAfterCreate.executionCycles[0]?.cycleNumber).toBe(1);
      expect(detailAfterCreate.deadlineHistory).toHaveLength(1);
      expect(detailAfterCreate.deadlineHistory[0]?.newDueDate).toBe(dueDate1);

      // Readmissão de participante reutilizando existing.id (&[organizationId+taskId+userId])
      const addedPart = await container.services.tasks.addTaskParticipant(
        manager.user.id,
        organization.id,
        task.id,
        { userId: secondMember.user.id },
      );
      await container.services.tasks.removeTaskParticipant(
        manager.user.id,
        organization.id,
        task.id,
        secondMember.user.id,
      );
      const readmittedPart = await container.services.tasks.addTaskParticipant(
        manager.user.id,
        organization.id,
        task.id,
        { userId: secondMember.user.id },
      );
      expect(readmittedPart.id).toBe(addedPart.id);
      expect(readmittedPart.removedAt).toBeUndefined();

      // MEMBER pode atualizar title/description, mas Default Deny bloqueia priority e dueDate
      const t2 = asIsoDateTime('2026-07-02T10:00:00.000Z');
      currentNow = t2;

      await expect(
        container.services.tasks.updateTask(member.user.id, organization.id, task.id, {
          priority: PRIORITIES.CRITICAL,
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.tasks.updateTask(member.user.id, organization.id, task.id, {
          dueDate: asIsoDateTime('2026-07-12T18:00:00.000Z'),
        }),
      ).rejects.toThrowError(AuthorizationError);

      const updatedByMember = await container.services.tasks.updateTask(
        member.user.id,
        organization.id,
        task.id,
        { title: 'Implementar TaskService v2' },
      );
      expect(updatedByMember.title).toBe('Implementar TaskService v2');
      // §12.1: atualização de campo preserva lastMovedAt original
      expect(updatedByMember.lastMovedAt).toBe(task.lastMovedAt);
      expect(updatedByMember.lastActivityAt).toBe(t2);

      // Gestor altera dueDate -> grava histórico append-only sem alterar lastMovedAt
      const dueDate2 = asIsoDateTime('2026-07-15T18:00:00.000Z');
      const updatedByManager = await container.services.tasks.updateTask(
        manager.user.id,
        organization.id,
        task.id,
        { dueDate: dueDate2, deadlineJustification: 'Alinhamento com revisão' },
      );
      expect(updatedByManager.lastMovedAt).toBe(task.lastMovedAt);
      const historyAfterDueChange = await container.services.tasks.listTaskDeadlineHistory(
        member.user.id,
        organization.id,
        task.id,
      );
      expect(historyAfterDueChange).toHaveLength(2);
      expect(historyAfterDueChange[1]?.previousDueDate).toBe(dueDate1);
      expect(historyAfterDueChange[1]?.newDueDate).toBe(dueDate2);

      // startTask move de INITIAL para primeira OPERATIONAL ativa, atualiza lastMovedAt e define effectiveStartedAt
      const t3 = asIsoDateTime('2026-07-03T09:00:00.000Z');
      currentNow = t3;
      const started = await container.services.tasks.startTask(
        member.user.id,
        organization.id,
        task.id,
      );
      expect(started.status).toBe(TASK_STATUSES.IN_PROGRESS);
      expect(started.columnId).toBe(execCol.id);
      expect(started.startedAt).toBe(t3);
      expect(started.lastMovedAt).toBe(t3);

      // pauseTask exige justificativa e preserva lastMovedAt; resumeTask restaura IN_PROGRESS (ou BLOCKED se impedimento aberto)
      const t4 = asIsoDateTime('2026-07-03T12:00:00.000Z');
      currentNow = t4;
      await expect(
        container.services.tasks.pauseTask(member.user.id, organization.id, task.id, {
          reason: '   ',
        }),
      ).rejects.toThrowError(ValidationError);

      const pausedResult = await container.services.tasks.pauseTask(
        member.user.id,
        organization.id,
        task.id,
        { reason: 'Aguardando janela de deploy' },
      );
      expect(pausedResult.task.status).toBe(TASK_STATUSES.PAUSED);
      expect(pausedResult.task.lastMovedAt).toBe(t3);
      expect(pausedResult.pause.reason).toBe('Aguardando janela de deploy');

      const t5 = asIsoDateTime('2026-07-03T14:00:00.000Z');
      currentNow = t5;
      const resumed = await container.services.tasks.resumeTask(
        member.user.id,
        organization.id,
        task.id,
      );
      expect(resumed.status).toBe(TASK_STATUSES.IN_PROGRESS);
      expect(resumed.lastMovedAt).toBe(t3);

      // Se houver impedimento bloqueante, resumeTask restaura para BLOCKED
      await container.services.tasks.pauseTask(member.user.id, organization.id, task.id, {
        reason: 'Pausa antes de bloqueio',
      });
      await container.repositories.impediments.impediments.save({
        id: (await import('@/shared/kernel')).asImpedimentId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        taskId: task.id,
        category: IMPEDIMENT_CATEGORIES.EXTERNAL_DEPENDENCY,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Aguardando API externa',
        status: IMPEDIMENT_STATUSES.OPEN,
        openedByUserId: member.user.id,
        openedAt: t5,
        updatedAt: t5,
      });
      const resumedAsBlocked = await container.services.tasks.resumeTask(
        member.user.id,
        organization.id,
        task.id,
      );
      expect(resumedAsBlocked.status).toBe(TASK_STATUSES.BLOCKED);

      // Remove bloqueio para testar completeTask
      const imps = await container.repositories.impediments.impediments.listByTask(
        organization.id,
        task.id,
      );
      await container.repositories.impediments.impediments.save({
        ...imps[0]!,
        status: IMPEDIMENT_STATUSES.RESOLVED,
        resolvedAt: t5,
        resolvedByUserId: manager.user.id,
        updatedAt: t5,
      });

      const t6 = asIsoDateTime('2026-07-04T16:00:00.000Z');
      currentNow = t6;
      const completed = await container.services.tasks.completeTask(
        member.user.id,
        organization.id,
        task.id,
      );
      expect(completed.status).toBe(TASK_STATUSES.DONE);
      expect(completed.columnId).toBe(doneCol.id);
      expect(completed.completedAt).toBe(t6);
      expect(completed.lastMovedAt).toBe(t6);

      // Reopen cria ciclo #2 preservando ciclo #1
      const t7 = asIsoDateTime('2026-07-05T10:00:00.000Z');
      currentNow = t7;
      await expect(
        container.services.tasks.reopenTask(member.user.id, organization.id, task.id, {
          reason: 'Sem permissão',
        }),
      ).rejects.toThrowError(AuthorizationError);

      const reopened = await container.services.tasks.reopenTask(
        manager.user.id,
        organization.id,
        task.id,
        { reason: 'Ajuste pós-homologação' },
      );
      expect(reopened.status).toBe(TASK_STATUSES.IN_PROGRESS);
      expect(reopened.columnId).toBe(execCol.id);
      expect(reopened.completedAt).toBeUndefined();
      expect(reopened.lastMovedAt).toBe(t7);

      const cyclesAfterReopen = await container.repositories.tasks.taskExecutionCycles.listByTask(
        organization.id,
        task.id,
      );
      expect(cyclesAfterReopen).toHaveLength(2);
      expect(cyclesAfterReopen[0]?.completedAt).toBe(t6);
      expect(cyclesAfterReopen[1]?.cycleNumber).toBe(2);
      expect(cyclesAfterReopen[1]?.reopenedFromCycleId).toBe(cyclesAfterReopen[0]!.id);

      // Assign + ListProjectTasks filtragem
      const reassigned = await container.services.tasks.assignTask(
        admin.user.id,
        organization.id,
        task.id,
        { assigneeId: secondMember.user.id },
      );
      expect(reassigned.assigneeId).toBe(secondMember.user.id);
    });

    it('impõe Decisão Normativa A (deleteTask com TASK_CANCEL + revokeAllByScope), cancelTask vs requestTaskCancellation, e restoreTask com realocação de coluna arquivada e WIP', async () => {
      const { admin, manager, member, organization, project, boardView } =
        await setupProjectFixture();

      const todoCol = boardView.columns[0]!;
      const reviewCol = boardView.columns[2]!; // wipLimit: 2

      const task = await container.services.tasks.createTask(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Tarefa para Solicitação e Exclusão',
          columnId: reviewCol.id,
          assigneeId: member.user.id,
        },
      );

      // MEMBER não pode cancelar nem excluir diretamente (TASK_CANCEL), mas pode solicitar cancelamento
      await expect(
        container.services.tasks.cancelTask(member.user.id, organization.id, task.id, {
          justification: 'Quero cancelar',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.tasks.deleteTask(member.user.id, organization.id, task.id, {
          reason: 'Tentativa membro',
        }),
      ).rejects.toThrowError(AuthorizationError);

      const cancelRequestComment = await container.services.tasks.requestTaskCancellation(
        member.user.id,
        organization.id,
        task.id,
        { justification: 'Escopo substituído pela nova entrega' },
      );
      expect(cancelRequestComment.isSystem).toBe(true);
      const afterRequest = await container.repositories.tasks.tasks.findById(
        organization.id,
        task.id,
      );
      expect(afterRequest?.status).toBe(TASK_STATUSES.IN_PROGRESS);

      // Concede um grant RESOURCE na tarefa antes do deleteTask para validar revogação automática
      const resourceGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_REOPEN,
          scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
          scopeId: asEntityId(task.id),
          reason: 'Grant temporário na tarefa',
        },
      );

      const dispatchedEvents: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        dispatchedEvents.push(event);
      });

      // Exclusão lógica por MANAGER via TASK_CANCEL revoga grants RESOURCE atomicamente
      const deleted = await container.services.tasks.deleteTask(
        manager.user.id,
        organization.id,
        task.id,
        { reason: 'Tarefa duplicada' },
      );
      expect(deleted.deletedAt).toBe(currentNow);
      expect(deleted.deletionReason).toBe('Tarefa duplicada');

      const grantAfterDelete = await container.repositories.authorization.permissionGrants.findById(
        organization.id,
        resourceGrant.id,
      );
      expect(grantAfterDelete?.revokedAt).toBe(currentNow);
      expect(dispatchedEvents.some((e) => e.eventType === 'task.deleted')).toBe(true);

      // Arquiva coluna original reviewCol; restoreTask deve realocar para coluna ativa elegível (todoCol) e respeitar WIP
      await container.services.kanban.archiveColumn(
        manager.user.id,
        organization.id,
        project.id,
        reviewCol.id,
      );

      const restored = await container.services.tasks.restoreTask(
        manager.user.id,
        organization.id,
        task.id,
      );
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.columnId).toBe(todoCol.id);

      // cancelTask por ADMIN funciona e libera WIP
      const cancelled = await container.services.tasks.cancelTask(
        admin.user.id,
        organization.id,
        task.id,
        { justification: 'Cancelamento definitivo aprovado' },
      );
      expect(cancelled.status).toBe(TASK_STATUSES.CANCELLED);
      expect(cancelled.cancellationReason).toBe('Cancelamento definitivo aprovado');
    });
  });

  describe('Subtarefas, Cenário 6, Comentários (autoria/janela/isSystem), Anexos (SHA-256, TASK_VIEW, QuotaExceededError) e Etiquetas', () => {
    it('impõe Cenário 6 em subtarefas, reordena atomicamente via saveMany e protege autoria/janela de comentários', async () => {
      const { admin, manager, member, secondMember, organization, project } =
        await setupProjectFixture();

      const task = await container.services.tasks.createTask(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Tarefa Pai com Subtarefas',
          assigneeId: member.user.id,
        },
      );

      // Default Deny bloqueia MEMBER de gerenciar subtarefas; habilitando setting permite para taskActor
      await expect(
        container.services.tasks.createSubtask(member.user.id, organization.id, task.id, {
          title: 'Subtarefa 1',
          required: true,
        }),
      ).rejects.toThrowError(AuthorizationError);

      const sub1 = await container.services.tasks.createSubtask(
        manager.user.id,
        organization.id,
        task.id,
        {
          title: 'Subtarefa do Segundo Membro',
          required: true,
          assigneeId: secondMember.user.id,
        },
      );
      const sub2 = await container.services.tasks.createSubtask(
        manager.user.id,
        organization.id,
        task.id,
        {
          title: 'Subtarefa Opcional',
          required: false,
        },
      );

      // Cenário 6: secondMember é apenas responsável pela subtarefa sub1 (não é ator da tarefa-pai)
      // Pode concluir sub1 via completeSubtask, mas NÃO pode editar/mover/concluir a tarefa-pai nem gerenciar subtarefas!
      await expect(
        container.services.tasks.updateTask(secondMember.user.id, organization.id, task.id, {
          title: 'Tentativa Cenário 6',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.tasks.completeTask(secondMember.user.id, organization.id, task.id),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.tasks.createSubtask(secondMember.user.id, organization.id, task.id, {
          title: 'Subtarefa não autorizada',
        }),
      ).rejects.toThrowError(AuthorizationError);

      const completedSub1 = await container.services.tasks.completeSubtask(
        secondMember.user.id,
        organization.id,
        task.id,
        sub1.id,
      );
      expect(completedSub1.status).toBe(SUBTASK_STATUSES.DONE);

      // Reordenação atômica de subtarefas exige permutação exata e preserva lastMovedAt
      await expect(
        container.services.tasks.reorderSubtasks(manager.user.id, organization.id, task.id, [
          sub1.id,
        ]),
      ).rejects.toThrowError(ValidationError);

      const reordered = await container.services.tasks.reorderSubtasks(
        manager.user.id,
        organization.id,
        task.id,
        [sub2.id, sub1.id],
      );
      expect(reordered[0]?.id).toBe(sub2.id);
      expect(reordered[0]?.order).toBe(1);
      expect(reordered[1]?.id).toBe(sub1.id);
      expect(reordered[1]?.order).toBe(2);

      // Comentários: criação por MEMBER ator, Default Deny na edição (commentEditWindowMinutes === 0)
      const comment = await container.services.tasks.addTaskComment(
        member.user.id,
        organization.id,
        task.id,
        { body: 'Comentário inicial do responsável' },
      );

      await expect(
        container.services.tasks.updateTaskComment(
          member.user.id,
          organization.id,
          task.id,
          comment.id,
          { body: 'Edição negada por Default Deny' },
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Configura janela de 15 minutos -> autor edita dentro da janela, mas outro usuário (até ADMIN) não edita
      const defaults = createDefaultOrganizationSettings(organization.id, currentNow);
      await container.repositories.settings.organizationSettings.save({
        ...defaults,
        pendingPermissionDefaults: {
          ...defaults.pendingPermissionDefaults,
          commentEditWindowMinutes: 15,
        },
      });

      await expect(
        container.services.tasks.updateTaskComment(
          admin.user.id,
          organization.id,
          task.id,
          comment.id,
          { body: 'Admin tentando editar comentário alheio' },
        ),
      ).rejects.toThrowError(AuthorizationError);

      currentNow = asIsoDateTime('2026-07-01T10:10:00.000Z');
      const editedComment = await container.services.tasks.updateTaskComment(
        member.user.id,
        organization.id,
        task.id,
        comment.id,
        { body: 'Comentário editado dentro da janela' },
      );
      expect(editedComment.body).toBe('Comentário editado dentro da janela');
      expect(editedComment.editedAt).toBe(currentNow);

      // Após 20 minutos (> 15 min), janela expira
      currentNow = asIsoDateTime('2026-07-01T10:20:00.000Z');
      await expect(
        container.services.tasks.updateTaskComment(
          member.user.id,
          organization.id,
          task.id,
          comment.id,
          { body: 'Fora da janela' },
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Exclusão lógica por MANAGER que administra o projeto funciona; comentário de sistema é imutável
      const deletedComment = await container.services.tasks.deleteTaskComment(
        manager.user.id,
        organization.id,
        task.id,
        comment.id,
        { reason: 'Moderação' },
      );
      expect(deletedComment.deletedAt).toBe(currentNow);

      const sysComment = await container.services.tasks.requestTaskCancellation(
        member.user.id,
        organization.id,
        task.id,
        { justification: 'Teste imutabilidade' },
      );
      await expect(
        container.services.tasks.deleteTaskComment(
          admin.user.id,
          organization.id,
          task.id,
          sysComment.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // lastMovedAt permaneceu intocado desde criação da tarefa
      const taskAfterAll = await container.repositories.tasks.tasks.findById(
        organization.id,
        task.id,
      );
      expect(taskAfterAll?.lastMovedAt).toBe(task.lastMovedAt);
    });

    it('gerencia anexos binários com SHA-256 fora da transação, revalida TASK_VIEW no download, impõe limites e trata QuotaExceededError sem apagar dados', async () => {
      const { admin, manager, member, secondMember, organization, project } =
        await setupProjectFixture();

      const task = await container.services.tasks.createTask(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Tarefa com Anexos',
          assigneeId: member.user.id,
        },
      );

      const bytes = new TextEncoder().encode('PMS binary attachment content v1');
      const uploaded = await container.services.tasks.uploadTaskAttachment(
        member.user.id,
        organization.id,
        task.id,
        {
          fileName: 'especificacao.txt',
          mimeType: 'TEXT/PLAIN',
          bytes,
        },
      );

      expect(uploaded.mimeType).toBe('text/plain');
      expect(uploaded.sizeBytes).toBe(bytes.byteLength);
      expect(uploaded.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

      // Revalidação estrita TASK_VIEW no download: secondMember (não ator da tarefa) é bloqueado
      await expect(
        container.services.tasks.getTaskAttachmentContent(
          secondMember.user.id,
          organization.id,
          task.id,
          uploaded.id,
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Autorizado lê bytes idênticos
      const downloaded = await container.services.tasks.getTaskAttachmentContent(
        member.user.id,
        organization.id,
        task.id,
        uploaded.id,
      );
      expect(Array.from(downloaded.bytes)).toEqual(Array.from(bytes));

      // Limite > 15MB rejeitado antes da transação
      await expect(
        container.services.tasks.uploadTaskAttachment(member.user.id, organization.id, task.id, {
          fileName: 'grande.bin',
          mimeType: 'application/octet-stream',
          bytes: new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1),
        }),
      ).rejects.toThrowError(ValidationError);

      // Simula QuotaExceededError durante putBlob -> lança InfrastructureError(STORAGE_QUOTA_EXCEEDED) sem apagar anexo anterior
      const quotaErr = new Error('Quota has been exceeded.');
      quotaErr.name = 'QuotaExceededError';
      vi.spyOn(container.attachmentBlobStore, 'putBlob').mockRejectedValueOnce(quotaErr);

      await expect(
        container.services.tasks.uploadTaskAttachment(member.user.id, organization.id, task.id, {
          fileName: 'segundo.txt',
          mimeType: 'text/plain',
          bytes: new TextEncoder().encode('second file'),
        }),
      ).rejects.toThrowError(InfrastructureError);

      // Verifica que o anexo anterior e seu blob continuam intactos (zero perda de dados!)
      const attachmentsAfterQuota = await container.services.tasks.listTaskAttachments(
        admin.user.id,
        organization.id,
        task.id,
      );
      expect(attachmentsAfterQuota).toHaveLength(1);
      expect(attachmentsAfterQuota[0]?.id).toBe(uploaded.id);
      const intactDownload = await container.services.tasks.getTaskAttachmentContent(
        member.user.id,
        organization.id,
        task.id,
        uploaded.id,
      );
      expect(Array.from(intactDownload.bytes)).toEqual(Array.from(bytes));

      // Exclusão remove metadados + blob atomicamente
      await container.services.tasks.deleteTaskAttachment(
        member.user.id,
        organization.id,
        task.id,
        uploaded.id,
      );
      expect(
        await container.services.tasks.listTaskAttachments(
          member.user.id,
          organization.id,
          task.id,
        ),
      ).toHaveLength(0);
      expect(await container.attachmentBlobStore.getBlob(organization.id, uploaded.id)).toBeNull();
    });

    it('impõe Decisão Normativa B para Etiquetas (ADMIN-only no catálogo com unicidade normalizada vs TASK_UPDATE ["tags"] para membro) e limpa tagIds em deleteTag', async () => {
      const { admin, manager, member, organization, project } = await setupProjectFixture();

      // MANAGER e MEMBER não gerenciam catálogo global de tags
      await expect(
        container.services.tasks.createTag(manager.user.id, organization.id, { name: 'Urgente' }),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.tasks.createTag(member.user.id, organization.id, { name: 'Urgente' }),
      ).rejects.toThrowError(AuthorizationError);

      const urgentTag = await container.services.tasks.createTag(admin.user.id, organization.id, {
        name: 'Urgente',
        colorToken: 'red',
      });
      const backendTag = await container.services.tasks.createTag(admin.user.id, organization.id, {
        name: 'Backend',
        colorToken: 'blue',
      });

      // Unicidade normalizada case-insensitive + trim lança ConflictError
      await expect(
        container.services.tasks.createTag(admin.user.id, organization.id, {
          name: '  urgente ',
        }),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.tasks.updateTag(admin.user.id, organization.id, backendTag.id, {
          name: 'URGENTE',
        }),
      ).rejects.toThrowError(ConflictError);

      // Qualquer membro ACTIVE lista tags da organização
      const memberTagList = await container.services.tasks.listTags(
        member.user.id,
        organization.id,
      );
      expect(memberTagList).toHaveLength(2);

      // MEMBER responsável pela tarefa pode associar/remover tags via TASK_UPDATE(['tags'])
      const task = await container.services.tasks.createTask(
        manager.user.id,
        organization.id,
        project.id,
        {
          title: 'Tarefa Etiquetada',
          assigneeId: member.user.id,
        },
      );

      const taggedTask = await container.services.tasks.updateTask(
        member.user.id,
        organization.id,
        task.id,
        { tagIds: [urgentTag.id, backendTag.id] },
      );
      expect(taggedTask.tagIds).toEqual([urgentTag.id, backendTag.id]);

      // deleteTag remove urgentTag da tarefa atomicamente e grava AuditEvent
      const deleteResult = await container.services.tasks.deleteTag(
        admin.user.id,
        organization.id,
        urgentTag.id,
      );
      expect(deleteResult.updatedTaskCount).toBe(1);

      const taskAfterTagDelete = await container.repositories.tasks.tasks.findById(
        organization.id,
        task.id,
      );
      expect(taskAfterTagDelete?.tagIds).toEqual([backendTag.id]);

      const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
        organization.id,
        { page: 1, pageSize: 20 },
        { category: AUDIT_CATEGORIES.ORGANIZATION },
      );
      expect(auditPage.items.some((e) => e.eventType === 'tag.deleted')).toBe(true);

      // Tag inexistente na associação lança NotFoundError
      await expect(
        container.services.tasks.updateTask(member.user.id, organization.id, task.id, {
          tagIds: [urgentTag.id],
        }),
      ).rejects.toThrowError(NotFoundError);
    });
  });
});
