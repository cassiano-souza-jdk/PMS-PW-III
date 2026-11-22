import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  type TaskDetail,
} from '@/modules/tasks';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  PRIORITIES,
  TASK_STATUSES,
  asCorrelationId,
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
});
