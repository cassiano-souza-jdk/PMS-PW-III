import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import type { Impediment } from '@/modules/impediments';
import { IMPEDIMENT_CATEGORIES, IMPEDIMENT_STATUSES } from '@/modules/impediments';
import type { TaskDependency, TaskDependencyListItem } from '@/modules/dependencies';
import {
  SUBTASK_STATUSES,
  type Subtask,
  type Tag,
  type Task,
  type TaskAttachment,
  type TaskComment,
  type TaskDeadlineHistoryEntry,
  type TaskDetail,
} from '@/modules/tasks';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InfrastructureError,
  ValidationError,
} from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  PRIORITIES,
  TASK_STATUSES,
  asCorrelationId,
  asEntityId,
  asIsoDateTime,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  DEMO_TASK_IDS,
  createAppContainer,
  createMswHandlers,
  type AppCompositionContainer,
} from './index';

const FIXED_NOW = asIsoDateTime('2026-08-01T10:00:00.000Z');

describe('Phase 07 MSW Endpoints Integration (Tasks, Subtasks, Comments, Attachments, Tags, Dependencies & Impediments)', () => {
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
    currentNow = FIXED_NOW;
    container = createAppContainer({
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_f07_msw_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
    await container.seedDemoOrganization(FIXED_NOW);

    server.use(
      ...createMswHandlers({
        repositories: container.repositories,
        transactionPort: container.transactionPort,
        eventBus: container.eventBus,
        simulationController: container.simulationController,
        attachmentBlobStore: container.attachmentBlobStore,
        services: container.services,
        now: () => currentNow,
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

  it('executa ciclo completo de Tarefa, Subtarefas, Comentários, Anexos Base64<->Uint8Array e Etiquetas via HttpClient -> MSW -> Dexie', async () => {
    const corrId = asCorrelationId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

    // Sem x-actor-user-id -> 401 AuthenticationError
    await expect(
      container.httpClient.get(
        `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      ),
    ).rejects.toThrowError(AuthenticationError);

    // Demo seed garante ciclo #1 para FOUNDATION_TASK, permitindo pausa e retomada imediata
    const pauseRes = await container.httpClient.post<{ readonly task: Task }>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/pause`,
      { reason: 'Pausa para alinhamento técnico' },
      { actorUserId: DEMO_MEMBER_USER_ID, correlationId: corrId },
    );
    expect(pauseRes.task.status).toBe(TASK_STATUSES.PAUSED);

    const resumedDemo = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/resume`,
      {},
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(resumedDemo.status).toBe(TASK_STATUSES.IN_PROGRESS);

    // Tags: ADMIN cria catálogo organizacional; MANAGER não cria (403); MEMBER lista e associa à sua tarefa
    await expect(
      container.httpClient.post<Tag>(
        `/organizations/${DEMO_ORG_ID}/tags`,
        { name: 'Performance' },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(AuthorizationError);

    const tag = await container.httpClient.post<Tag>(
      `/organizations/${DEMO_ORG_ID}/tags`,
      { name: 'Performance', colorToken: 'amber' },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(tag.name).toBe('Performance');

    const listedTags = await container.httpClient.get<readonly Tag[]>(
      `/organizations/${DEMO_ORG_ID}/tags`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(listedTags).toHaveLength(1);

    // Gestor cria tarefa com prazo inicial via POST /projects/:projectId/tasks
    const due1 = asIsoDateTime('2026-08-15T18:00:00.000Z');
    const createdTask = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Fluxo Completo Fase 07 MSW',
        description: 'Validação ponta a ponta',
        priority: PRIORITIES.HIGH,
        assigneeId: DEMO_MEMBER_USER_ID,
        dueDate: due1,
        tagIds: [tag.id],
      },
      { actorUserId: DEMO_MANAGER_USER_ID, correlationId: corrId },
    );
    expect(createdTask.status).toBe(TASK_STATUSES.TODO);
    expect(createdTask.tagIds).toEqual([tag.id]);

    // Start tarefa -> move para Em Execucao + IN_PROGRESS
    const startedTask = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/start`,
      {},
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(startedTask.status).toBe(TASK_STATUSES.IN_PROGRESS);

    // Subtarefas CRUD + reorder
    const sub1 = await container.httpClient.post<Subtask>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/subtasks`,
      { title: 'Subtarefa A', required: true },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    const sub2 = await container.httpClient.post<Subtask>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/subtasks`,
      { title: 'Subtarefa B', required: false },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    await container.httpClient.post<Subtask>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/subtasks/${sub1.id}/assign`,
      { assigneeId: DEMO_MEMBER_USER_ID },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    const reorderedSubs = await container.httpClient.post<readonly Subtask[]>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/subtasks/reorder`,
      { orderedSubtaskIds: [sub2.id, sub1.id] },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(reorderedSubs.map((s) => s.id)).toEqual([sub2.id, sub1.id]);

    const completedSub = await container.httpClient.post<Subtask>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/subtasks/${sub1.id}/complete`,
      {},
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(completedSub.status).toBe(SUBTASK_STATUSES.DONE);

    // Comentários + configuração de janela
    const defaults = createDefaultOrganizationSettings(DEMO_ORG_ID, currentNow);
    await container.repositories.settings.organizationSettings.save({
      ...defaults,
      pendingPermissionDefaults: {
        ...defaults.pendingPermissionDefaults,
        commentEditWindowMinutes: 30,
      },
    });

    const comment = await container.httpClient.post<TaskComment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/comments`,
      { body: 'Comentário via MSW' },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    const editedComment = await container.httpClient.patch<TaskComment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/comments/${comment.id}`,
      { body: 'Comentário editado via MSW' },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(editedComment.body).toBe('Comentário editado via MSW');

    // Anexos binários via contentBase64 <-> Uint8Array na borda MSW
    const rawPayloadText = 'Documento binário PMS v07';
    const contentBase64 = globalThis.btoa(
      String.fromCharCode(...new TextEncoder().encode(rawPayloadText)),
    );

    // Base64 inválido retorna 422 ValidationError
    await expect(
      container.httpClient.post<TaskAttachment>(
        `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/attachments`,
        {
          fileName: 'invalido.txt',
          mimeType: 'text/plain',
          contentBase64: '!!!not-base64!!!',
        },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrowError(ValidationError);

    const attachment = await container.httpClient.post<TaskAttachment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/attachments`,
      {
        fileName: 'relatorio.txt',
        mimeType: 'text/plain',
        contentBase64,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(attachment.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const downloaded = await container.httpClient.get<{
      readonly attachment: TaskAttachment;
      readonly mimeType: string;
      readonly contentBase64: string;
    }>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/attachments/${attachment.id}/content`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(downloaded.contentBase64).toBe(contentBase64);

    // Solicitação de cancelamento por MEMBER -> cria comentário sistema sem cancelar
    const cancelReq = await container.httpClient.post<TaskComment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/cancellation-requests`,
      { justification: 'Revisar escopo com gestor' },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(cancelReq.isSystem).toBe(true);

    // Concluir, Reabrir, Deletar e Restaurar tarefa via HTTP/MSW
    const completed = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/complete`,
      {},
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(completed.status).toBe(TASK_STATUSES.DONE);

    const reopened = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/reopen`,
      { reason: 'Nova bateria de QA' },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(reopened.status).toBe(TASK_STATUSES.IN_PROGRESS);

    // Consulta detalhe consolidado
    const detail = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detail.subtasks).toHaveLength(2);
    expect(detail.comments).toHaveLength(2);
    expect(detail.attachments).toHaveLength(1);
    expect(detail.executionCycles).toHaveLength(2);
    expect(detail.deadlineHistory).toHaveLength(1);
    expect(detail.tags).toHaveLength(1);

    // Soft-delete (TASK_CANCEL) + consulta ?includeDeleted=true + restore
    const deleted = await container.httpClient.delete<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID, query: { reason: 'Limpeza de teste' } },
    );
    expect(deleted.deletedAt).toBe(FIXED_NOW);

    const tasksWithDeleted = await container.httpClient.get<readonly Task[]>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      { actorUserId: DEMO_ADMIN_USER_ID, query: { includeDeleted: true } },
    );
    expect(tasksWithDeleted.some((t) => t.id === createdTask.id && t.deletedAt !== undefined)).toBe(
      true,
    );

    const restored = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${createdTask.id}/restore`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(restored.deletedAt).toBeUndefined();
  });

  it('executa endpoints de Dependências e Impedimentos via MSW validando ciclos, visibilidade e transição BLOCKED', async () => {
    const dependency = await container.httpClient.post<TaskDependency>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/dependencies`,
      {
        dependsOnTaskId: DEMO_TASK_IDS.KANBAN_FLOW_TASK,
        required: true,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(dependency.taskId).toBe(DEMO_TASK_IDS.FOUNDATION_TASK);

    // Ciclo reverso rejeitado com 409 ConflictError
    await expect(
      container.httpClient.post<TaskDependency>(
        `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.KANBAN_FLOW_TASK}/dependencies`,
        {
          dependsOnTaskId: DEMO_TASK_IDS.FOUNDATION_TASK,
          required: true,
        },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(ConflictError);

    // MEMBER tem acesso a FOUNDATION_TASK, mas NÃO a KANBAN_FLOW_TASK -> lista de dependências oculta KANBAN_FLOW_TASK!
    const memberDeps = await container.httpClient.get<readonly TaskDependencyListItem[]>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/dependencies`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(memberDeps).toHaveLength(0);

    const managerDeps = await container.httpClient.get<readonly TaskDependencyListItem[]>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/dependencies`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(managerDeps).toHaveLength(1);

    // Impedimentos: cria -> tarefa vai para BLOCKED; resolve -> restaura IN_PROGRESS sem concluir
    const impediment = await container.httpClient.post<Impediment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/impediments`,
      {
        category: IMPEDIMENT_CATEGORIES.RESOURCE_UNAVAILABILITY,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Ambiente de banco indisponível',
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(impediment.status).toBe(IMPEDIMENT_STATUSES.OPEN);

    const detailBlocked = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailBlocked.task.status).toBe(TASK_STATUSES.BLOCKED);

    const resolvedImp = await container.httpClient.post<Impediment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/impediments/${impediment.id}/transition`,
      {
        targetStatus: IMPEDIMENT_STATUSES.RESOLVED,
        resolutionNote: 'Ambiente restabelecido',
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(resolvedImp.status).toBe(IMPEDIMENT_STATUSES.RESOLVED);

    const detailRestored = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailRestored.task.status).toBe(TASK_STATUSES.IN_PROGRESS);

    // Remove dependência
    await container.httpClient.delete(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/dependencies/${dependency.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(
      await container.httpClient.get<readonly TaskDependencyListItem[]>(
        `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/dependencies`,
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).toHaveLength(0);
  });

  it('valida Decisão Normativa B (Tags CRUD ADMIN-only, unicidade normalizada, atomicidade e PATCH parcial de MEMBER)', async () => {
    const tag = await container.httpClient.post<Tag>(
      `/organizations/${DEMO_ORG_ID}/tags`,
      { name: 'Backend', colorToken: 'blue' },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    // Unicidade case-insensitive normalizada -> 409 ConflictError
    await expect(
      container.httpClient.post<Tag>(
        `/organizations/${DEMO_ORG_ID}/tags`,
        { name: '  backend  ', colorToken: 'red' },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrowError(ConflictError);

    // MANAGER não pode editar nem excluir etiqueta (ADMIN-only -> 403)
    await expect(
      container.httpClient.patch<Tag>(
        `/organizations/${DEMO_ORG_ID}/tags/${tag.id}`,
        { name: 'Backend API' },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      container.httpClient.delete(`/organizations/${DEMO_ORG_ID}/tags/${tag.id}`, {
        actorUserId: DEMO_MANAGER_USER_ID,
      }),
    ).rejects.toThrowError(AuthorizationError);

    // MEMBER pode atualizar somente tags da tarefa acessível, mas alteração concorrente de priority falha com 403
    const updatedByMember = await container.httpClient.patch<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      { tagIds: [tag.id] },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(updatedByMember.tagIds).toEqual([tag.id]);

    const originalPriority = updatedByMember.priority;
    await expect(
      container.httpClient.patch<Task>(
        `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
        {
          tagIds: [],
          priority: originalPriority === PRIORITIES.HIGH ? PRIORITIES.LOW : PRIORITIES.HIGH,
        },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrowError(AuthorizationError);

    const detailAfterDenied = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailAfterDenied.task.tagIds).toEqual([tag.id]);
    expect(detailAfterDenied.task.priority).toBe(originalPriority);

    // ADMIN atualiza e exclui etiqueta removendo tagId atomicamente das tarefas vinculadas
    const renamedTag = await container.httpClient.patch<Tag>(
      `/organizations/${DEMO_ORG_ID}/tags/${tag.id}`,
      { name: 'Backend Core', colorToken: 'teal' },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(renamedTag.name).toBe('Backend Core');

    await container.httpClient.delete(`/organizations/${DEMO_ORG_ID}/tags/${tag.id}`, {
      actorUserId: DEMO_ADMIN_USER_ID,
    });

    const detailAfterTagDelete = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailAfterTagDelete.task.tagIds).toEqual([]);
  });

  it('valida ciclo indireto de 3 tarefas (A→B→C→A) e exceção de conclusão com dependência pendente via MSW', async () => {
    const taskC = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa C Cadeia MSW',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    // A (FOUNDATION_TASK) -> B (KANBAN_FLOW_TASK) -> C (taskC)
    await container.httpClient.post<TaskDependency>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/dependencies`,
      { dependsOnTaskId: DEMO_TASK_IDS.KANBAN_FLOW_TASK, required: true },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    await container.httpClient.post<TaskDependency>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.KANBAN_FLOW_TASK}/dependencies`,
      { dependsOnTaskId: taskC.id, required: true },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    // Ciclo indireto C -> A rejeitado com 409 ConflictError
    await expect(
      container.httpClient.post<TaskDependency>(
        `/organizations/${DEMO_ORG_ID}/tasks/${taskC.id}/dependencies`,
        { dependsOnTaskId: DEMO_TASK_IDS.FOUNDATION_TASK, required: true },
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(ConflictError);

    // Conclusão sem justificativa falha (409); MEMBER com justificativa falha (403); MANAGER com justificativa conclui + audita
    await expect(
      container.httpClient.post<Task>(
        `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/complete`,
        {},
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(ConflictError);

    await expect(
      container.httpClient.post<Task>(
        `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/complete`,
        { dependencyOverrideJustification: 'Tentativa sem permissão DEPENDENCY_MANAGE' },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrowError(AuthorizationError);

    const completed = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/complete`,
      { dependencyOverrideJustification: 'Aprovação excepcional de release via MSW' },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(completed.status).toBe(TASK_STATUSES.DONE);

    const taskAudit = await container.repositories.audit.auditEvents.listByOrganization(
      DEMO_ORG_ID,
      { page: 1, pageSize: 100 },
      { category: AUDIT_CATEGORIES.TASK },
    );
    expect(
      taskAudit.items.some(
        (event) =>
          event.eventType === 'task.completed' &&
          event.resourceId === (DEMO_TASK_IDS.FOUNDATION_TASK as string) &&
          event.justification === 'Aprovação excepcional de release via MSW',
      ),
    ).toBe(true);
  });

  it('valida anexos via MSW: revalidação de TASK_VIEW após perda de acesso, payload vazio (422), QuotaExceededError não-destrutivo e exclusão', async () => {
    const restrictedTask = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa Restrita Anexo MSW',
        priority: PRIORITIES.HIGH,
        assigneeId: DEMO_MANAGER_USER_ID,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    await container.httpClient.post(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/participants`,
      { userId: DEMO_MEMBER_USER_ID },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    // Payload vazio -> 422 ValidationError
    await expect(
      container.httpClient.post<TaskAttachment>(
        `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/attachments`,
        {
          fileName: 'vazio.txt',
          mimeType: 'text/plain',
          contentBase64: '',
        },
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrowError(ValidationError);

    const rawBytes = new TextEncoder().encode('Evidência inicial intacta');
    const validBase64 = globalThis.btoa(String.fromCharCode(...rawBytes));
    const uploaded = await container.httpClient.post<TaskAttachment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/attachments`,
      {
        fileName: 'evidencia.txt',
        mimeType: 'text/plain',
        contentBase64: validBase64,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );

    const downloadedBeforeRevoke = await container.httpClient.get<{
      readonly attachment: TaskAttachment;
      readonly mimeType: string;
      readonly contentBase64: string;
    }>(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/attachments/${uploaded.id}/content`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(downloadedBeforeRevoke.contentBase64).toBe(validBase64);

    // QuotaExceededError na gravação do blob rejeita com InfrastructureError preservando o anexo existente
    vi.spyOn(container.attachmentBlobStore, 'putBlob').mockRejectedValueOnce(
      new DOMException('Quota exceeded', 'QuotaExceededError'),
    );

    let quotaError: unknown = null;
    try {
      await container.httpClient.post<TaskAttachment>(
        `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/attachments`,
        {
          fileName: 'falha-cota.txt',
          mimeType: 'text/plain',
          contentBase64: validBase64,
        },
        { actorUserId: DEMO_MEMBER_USER_ID },
      );
    } catch (error) {
      quotaError = error;
    }
    expect(quotaError).toBeInstanceOf(InfrastructureError);

    const detailAfterQuota = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(detailAfterQuota.attachments).toHaveLength(1);
    expect(detailAfterQuota.attachments[0]?.id).toBe(uploaded.id);

    // Remoção de participação revoga acesso e revalidação de download retorna 403 AuthorizationError
    await container.httpClient.delete(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/participants/${DEMO_MEMBER_USER_ID}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    await expect(
      container.httpClient.get(
        `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/attachments/${uploaded.id}/content`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      ),
    ).rejects.toThrowError(AuthorizationError);

    await container.httpClient.delete(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}/attachments/${uploaded.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    const detailAfterDelete = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${restrictedTask.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(detailAfterDelete.attachments).toHaveLength(0);
  });

  it('valida DELETE /tasks revogando grants RESOURCE em taskId e bloqueio 409 de DELETE e RESTORE em projeto arquivado', async () => {
    const taskA = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa Grant & Arquivo MSW',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    const taskB = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa Soft-Deleted Antes do Arquivo',
        priority: PRIORITIES.HIGH,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    await container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
      granteeUserId: DEMO_MEMBER_USER_ID,
      permission: PERMISSION_CODES.TASK_COMMENT,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(taskA.id),
      reason: 'Concessão temporária em tarefa específica para auditoria',
    });

    const deletedA = await container.httpClient.delete<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${taskA.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(deletedA.deletedAt).toBeDefined();

    const memberGrants = await container.repositories.authorization.permissionGrants.listByGrantee(
      DEMO_ORG_ID,
      DEMO_MEMBER_USER_ID,
    );
    const taskAGrant = memberGrants.find(
      (grant) =>
        grant.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE &&
        (grant.scopeId as string | undefined) === (taskA.id as string),
    );
    expect(taskAGrant?.revokedAt).toBeDefined();

    // Restaura A e exclui B antes do arquivamento do projeto
    const restoredA = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${taskA.id}/restore`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(restoredA.deletedAt).toBeUndefined();

    await container.httpClient.delete<Task>(`/organizations/${DEMO_ORG_ID}/tasks/${taskB.id}`, {
      actorUserId: DEMO_MANAGER_USER_ID,
    });

    // Arquiva projeto -> DELETE em taskA e RESTORE em taskB retornam 409 ConflictError
    await container.services.projects.archiveProject(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      DEMO_PROJECT_ID,
    );

    await expect(
      container.httpClient.delete(`/organizations/${DEMO_ORG_ID}/tasks/${taskA.id}`, {
        actorUserId: DEMO_MANAGER_USER_ID,
      }),
    ).rejects.toThrowError(ConflictError);

    await expect(
      container.httpClient.post(
        `/organizations/${DEMO_ORG_ID}/tasks/${taskB.id}/restore`,
        {},
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(ConflictError);
  });

  it('rejeita MIME executáveis/ativos web com HTTP 422 via POST .../attachments e preserva tipos seguros', async () => {
    const validBase64 = globalThis.btoa('safe-or-unsafe-payload');
    const disallowedMimes = [
      {
        fileName: 'app.exe',
        mimeType: 'application/x-msdownload',
        expectedBase: 'application/x-msdownload',
      },
      { fileName: 'script.sh', mimeType: 'application/x-sh', expectedBase: 'application/x-sh' },
      { fileName: 'evil.html', mimeType: 'text/html', expectedBase: 'text/html' },
      {
        fileName: 'evil-utf8.html',
        mimeType: 'text/html; charset=utf-8',
        expectedBase: 'text/html',
      },
      { fileName: 'xss.svg', mimeType: 'image/svg+xml', expectedBase: 'image/svg+xml' },
    ] as const;

    for (const entry of disallowedMimes) {
      let caught: unknown;
      try {
        await container.httpClient.post<TaskAttachment>(
          `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/attachments`,
          {
            fileName: entry.fileName,
            mimeType: entry.mimeType,
            contentBase64: validBase64,
          },
          { actorUserId: DEMO_MEMBER_USER_ID },
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as ValidationError).details).toMatchObject({
        httpStatus: 422,
        field: 'mimeType',
        mimeType: entry.expectedBase,
        reason: 'DISALLOWED_MIME_TYPE',
      });
    }

    const safeText = await container.httpClient.post<TaskAttachment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/attachments`,
      {
        fileName: 'nota-utf8.txt',
        mimeType: 'text/plain; charset=utf-8',
        contentBase64: validBase64,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(safeText.mimeType).toBe('text/plain; charset=utf-8');

    const safePdf = await container.httpClient.post<TaskAttachment>(
      `/organizations/${DEMO_ORG_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}/attachments`,
      {
        fileName: 'relatorio.pdf',
        mimeType: 'application/pdf',
        contentBase64: validBase64,
      },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(safePdf.mimeType).toBe('application/pdf');
  });

  it('impõe TASK_HISTORY_VIEW em GET .../deadline-history e paridade TRASH_VIEW em tarefa soft-deleted via MSW', async () => {
    // 1. ExplicitDenyRule apenas para TASK_HISTORY_VIEW mantém GET /tasks/:taskId (deadlineHistory: []) e bloqueia GET .../deadline-history com 403
    const memberTask = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa Deny TASK_HISTORY_VIEW MSW',
        assigneeId: DEMO_MEMBER_USER_ID,
        dueDate: asIsoDateTime('2026-08-20T18:00:00.000Z'),
        deadlineJustification: 'Prazo inicial para validação MSW',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    await container.services.authorization.createExplicitDenyRule(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
      targetUserId: DEMO_MEMBER_USER_ID,
      permission: PERMISSION_CODES.TASK_HISTORY_VIEW,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(memberTask.id),
      reason: 'Bloquear histórico de prazos via MSW mantendo TASK_VIEW',
    });

    const detailAfterDeny = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${memberTask.id}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailAfterDeny.task.id).toBe(memberTask.id);
    expect(detailAfterDeny.deadlineHistory).toEqual([]);

    let denyHistoryError: unknown;
    try {
      await container.httpClient.get<readonly TaskDeadlineHistoryEntry[]>(
        `/organizations/${DEMO_ORG_ID}/tasks/${memberTask.id}/deadline-history`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      );
    } catch (error) {
      denyHistoryError = error;
    }
    expect(denyHistoryError).toBeInstanceOf(AuthorizationError);
    expect((denyHistoryError as AuthorizationError).details?.httpStatus).toBe(403);

    // 2. Ator fora do escopo com PermissionGrant apenas de TASK_VIEW lê GET /tasks/:taskId (deadlineHistory: []), mas recebe 403 em GET .../deadline-history
    const outOfScopeTask = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa Grant Parcial TASK_VIEW MSW',
        assigneeId: DEMO_MANAGER_USER_ID,
        dueDate: asIsoDateTime('2026-08-22T18:00:00.000Z'),
        deadlineJustification: 'Prazo de tarefa fora do escopo do membro',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    await container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
      granteeUserId: DEMO_MEMBER_USER_ID,
      permission: PERMISSION_CODES.TASK_VIEW,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(outOfScopeTask.id),
      reason: 'Grant restrito apenas a TASK_VIEW sem TASK_HISTORY_VIEW',
    });

    const detailWithGrantOnly = await container.httpClient.get<TaskDetail>(
      `/organizations/${DEMO_ORG_ID}/tasks/${outOfScopeTask.id}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(detailWithGrantOnly.task.id).toBe(outOfScopeTask.id);
    expect(detailWithGrantOnly.deadlineHistory).toEqual([]);

    let grantHistoryError: unknown;
    try {
      await container.httpClient.get<readonly TaskDeadlineHistoryEntry[]>(
        `/organizations/${DEMO_ORG_ID}/tasks/${outOfScopeTask.id}/deadline-history`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      );
    } catch (error) {
      grantHistoryError = error;
    }
    expect(grantHistoryError).toBeInstanceOf(AuthorizationError);
    expect((grantHistoryError as AuthorizationError).details?.httpStatus).toBe(403);

    // 3. Paridade TRASH_VIEW: tarefa soft-deleted em projeto ativo retorna deadlineHistory populado para ADMIN/MANAGER e bloqueia MEMBER (403); projeto soft-deleted retorna 409
    const deletedTask = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      {
        title: 'Tarefa Soft-Deleted Paridade Histórico MSW',
        assigneeId: DEMO_MEMBER_USER_ID,
        dueDate: asIsoDateTime('2026-08-25T18:00:00.000Z'),
        deadlineJustification: 'Prazo preservado na lixeira via MSW',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );

    await container.httpClient.delete<Task>(
      `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}`,
      { actorUserId: DEMO_MANAGER_USER_ID, query: { reason: 'Enviada para lixeira MSW' } },
    );

    for (const authorizedActorId of [DEMO_ADMIN_USER_ID, DEMO_MANAGER_USER_ID]) {
      const trashDetail = await container.httpClient.get<TaskDetail>(
        `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}`,
        { actorUserId: authorizedActorId },
      );
      expect(trashDetail.task.deletedAt).toBeDefined();
      expect(trashDetail.deadlineHistory).toHaveLength(1);

      const trashHistory = await container.httpClient.get<readonly TaskDeadlineHistoryEntry[]>(
        `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}/deadline-history`,
        { actorUserId: authorizedActorId },
      );
      expect(trashHistory).toHaveLength(1);
    }

    let memberTrashDetailError: unknown;
    try {
      await container.httpClient.get<TaskDetail>(
        `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      );
    } catch (error) {
      memberTrashDetailError = error;
    }
    expect(memberTrashDetailError).toBeInstanceOf(AuthorizationError);
    expect((memberTrashDetailError as AuthorizationError).details?.httpStatus).toBe(403);

    let memberTrashHistoryError: unknown;
    try {
      await container.httpClient.get<readonly TaskDeadlineHistoryEntry[]>(
        `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}/deadline-history`,
        { actorUserId: DEMO_MEMBER_USER_ID },
      );
    } catch (error) {
      memberTrashHistoryError = error;
    }
    expect(memberTrashHistoryError).toBeInstanceOf(AuthorizationError);
    expect((memberTrashHistoryError as AuthorizationError).details?.httpStatus).toBe(403);

    await container.services.projects.deleteProject(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      DEMO_PROJECT_ID,
      { reason: 'Projeto também excluído logicamente' },
    );

    for (const actorId of [DEMO_ADMIN_USER_ID, DEMO_MANAGER_USER_ID]) {
      let deletedProjectDetailError: unknown;
      try {
        await container.httpClient.get<TaskDetail>(
          `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}`,
          { actorUserId: actorId },
        );
      } catch (error) {
        deletedProjectDetailError = error;
      }
      expect(deletedProjectDetailError).toBeInstanceOf(ConflictError);
      expect((deletedProjectDetailError as ConflictError).details?.httpStatus).toBe(409);

      let deletedProjectHistoryError: unknown;
      try {
        await container.httpClient.get<readonly TaskDeadlineHistoryEntry[]>(
          `/organizations/${DEMO_ORG_ID}/tasks/${deletedTask.id}/deadline-history`,
          { actorUserId: actorId },
        );
      } catch (error) {
        deletedProjectHistoryError = error;
      }
      expect(deletedProjectHistoryError).toBeInstanceOf(ConflictError);
      expect((deletedProjectHistoryError as ConflictError).details?.httpStatus).toBe(409);
    }
  });
});
