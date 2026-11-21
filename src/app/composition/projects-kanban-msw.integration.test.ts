import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BoardColumn, ProjectBoardView } from '@/modules/kanban';
import { BOARD_COLUMN_ROLES } from '@/modules/kanban';
import {
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  type Project,
  type ProjectDetails,
  type ProjectExportData,
  type ProjectListItem,
  type ProjectMember,
} from '@/modules/projects';
import type { Task } from '@/modules/tasks';
import type { Team } from '@/modules/teams';
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import { TASK_STATUSES, asCorrelationId, asIsoDateTime, type IsoDateTime } from '@/shared/kernel';
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

const FIXED_NOW = asIsoDateTime('2026-06-20T10:00:00.000Z');

describe('Phase 06 MSW Endpoints Integration (Projects, Participants & Kanban)', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_f06_msw_${crypto.randomUUID()}`,
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

  it('executa ciclo completo de projetos, transferência, arquivamento, participantes e exportação via HttpClient -> MSW -> Dexie', async () => {
    const corrId = asCorrelationId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

    // Cria nova equipe para transferência
    const secondTeam = await container.httpClient.post<Team>(
      `/organizations/${DEMO_ORG_ID}/teams`,
      {
        name: 'Squad Expansão',
        managerUserIds: [DEMO_MANAGER_USER_ID],
      },
      { actorUserId: DEMO_ADMIN_USER_ID },
    );

    // Lista projetos enriquecidos
    const listed = await container.httpClient.get<readonly ProjectListItem[]>(
      `/organizations/${DEMO_ORG_ID}/projects`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.teamName).toBe('Equipe de Produto e Engenharia');

    // GET detalhes do projeto
    const details = await container.httpClient.get<ProjectDetails>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(details.activeParticipantCount).toBe(2);

    // PATCH rejeita alteração de teamId (422 ValidationError)
    await expect(
      container.httpClient.patch<Project>(
        `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}`,
        { name: 'Atualizado', teamId: secondTeam.id },
        { actorUserId: DEMO_ADMIN_USER_ID },
      ),
    ).rejects.toThrowError(ValidationError);

    // PATCH válido atualiza nome
    const updated = await container.httpClient.patch<Project>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}`,
      { name: 'PMS v1 Atualizado', inactivityThresholdDays: 10 },
      { actorUserId: DEMO_MANAGER_USER_ID, correlationId: corrId },
    );
    expect(updated.name).toBe('PMS v1 Atualizado');
    expect(updated.inactivityThresholdDays).toBe(10);

    // POST /transfer transfere equipe
    const transferred = await container.httpClient.post<Project>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/transfer`,
      { targetTeamId: secondTeam.id, reason: 'Alinhamento de squad' },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(transferred.teamId).toBe(secondTeam.id);

    // Exportação para MEMBER retorna apenas tarefas visíveis ao MEMBER (FOUNDATION_TASK, não KANBAN_FLOW_TASK)
    const memberExport = await container.httpClient.get<ProjectExportData>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/export`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(memberExport.tasks.map((t) => t.id)).toEqual([DEMO_TASK_IDS.FOUNDATION_TASK]);

    // GET /projects/:projectId/tasks também filtra por TASK_VIEW para MEMBER
    const memberTasks = await container.httpClient.get<readonly Task[]>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/tasks`,
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(memberTasks.map((t) => t.id)).toEqual([DEMO_TASK_IDS.FOUNDATION_TASK]);

    // Participantes: PATCH papel do membro para MANAGER e depois volta para PARTICIPANT
    const promoted = await container.httpClient.patch<ProjectMember>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/participants/${DEMO_MEMBER_USER_ID}`,
      { role: PROJECT_MEMBER_ROLES.MANAGER },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(promoted.projectRole).toBe(PROJECT_MEMBER_ROLES.MANAGER);

    // Arquivar bloqueia mutações operacionais e includeArchived=true exibe na listagem
    const archived = await container.httpClient.post<Project>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/archive`,
      { reason: 'Pausa programada' },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(archived.status).toBe(PROJECT_STATUSES.ARCHIVED);

    const activeOnly = await container.httpClient.get<readonly ProjectListItem[]>(
      `/organizations/${DEMO_ORG_ID}/projects`,
      { actorUserId: DEMO_ADMIN_USER_ID },
    );
    expect(activeOnly).toHaveLength(0);

    const withArchived = await container.httpClient.get<readonly ProjectListItem[]>(
      `/organizations/${DEMO_ORG_ID}/projects`,
      { actorUserId: DEMO_ADMIN_USER_ID, query: { includeArchived: true } },
    );
    expect(withArchived).toHaveLength(1);

    // Restaurar
    const restored = await container.httpClient.post<Project>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/restore`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(restored.status).toBe(PROJECT_STATUSES.ACTIVE);

    // Remover participante falha enquanto há tarefa pendente (FOUNDATION_TASK)
    await expect(
      container.httpClient.delete(
        `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/participants/${DEMO_MEMBER_USER_ID}`,
        { actorUserId: DEMO_MANAGER_USER_ID },
      ),
    ).rejects.toThrowError(ConflictError);

    // Soft-delete do projeto exclusivo de ADMIN
    await expect(
      container.httpClient.delete(`/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}`, {
        actorUserId: DEMO_MANAGER_USER_ID,
      }),
    ).rejects.toThrowError(AuthorizationError);

    const deleted = await container.httpClient.delete<Project>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}`,
      { actorUserId: DEMO_ADMIN_USER_ID, query: { reason: 'Fim do ciclo demo' } },
    );
    expect(deleted.deletedAt).toBe(FIXED_NOW);
  });

  it('executa fluxo completo de quadro Kanban, colunas, cartões rápidos e movimentação via MSW', async () => {
    const boardBefore = await container.httpClient.get<ProjectBoardView>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board`,
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(boardBefore.columns).toHaveLength(4);
    expect(boardBefore.cards).toHaveLength(2);

    // Cria nova coluna operacional via POST /board/columns
    const qaCol = await container.httpClient.post<BoardColumn>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board/columns`,
      {
        name: 'Homologação',
        columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
        wipLimit: 2,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(qaCol.name).toBe('Homologação');

    // Atualiza WIP via PATCH /board/columns/:columnId
    const qaUpdated = await container.httpClient.patch<BoardColumn>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board/columns/${qaCol.id}`,
      { wipLimit: 3 },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(qaUpdated.wipLimit).toBe(3);

    // Reordena colunas via POST /board/columns/reorder
    const reorderedIds = [
      boardBefore.columns[0]!.id,
      boardBefore.columns[1]!.id,
      qaCol.id,
      boardBefore.columns[2]!.id,
      boardBefore.columns[3]!.id,
    ];
    const reordered = await container.httpClient.post<readonly BoardColumn[]>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board/columns/reorder`,
      { orderedColumnIds: reorderedIds },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(reordered[2]?.id).toBe(qaCol.id);
    expect(reordered[2]?.order).toBe(3);

    // Cria cartão rápido na coluna Homologação via POST /cards
    const quickCard = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/cards`,
      {
        title: 'Validar homologação E2E',
        columnId: qaCol.id,
        assigneeId: DEMO_MEMBER_USER_ID,
        priority: 'HIGH',
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(quickCard.columnId).toBe(qaCol.id);
    expect(quickCard.status).toBe(TASK_STATUSES.IN_PROGRESS);

    // Move cartão para Concluído via POST /cards/:taskId/move -> status DONE
    const doneColumn = boardBefore.columns[3]!;
    const completedCard = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/cards/${quickCard.id}/move`,
      { targetColumnId: doneColumn.id },
      { actorUserId: DEMO_MEMBER_USER_ID },
    );
    expect(completedCard.status).toBe(TASK_STATUSES.DONE);
    expect(completedCard.completedAt).toBe(FIXED_NOW);

    // Exclui coluna Homologação migrando a tarefa movida ou outra criada nela
    const tempCard = await container.httpClient.post<Task>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/cards`,
      {
        title: 'Card a migrar na exclusão',
        columnId: qaCol.id,
      },
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    const deleteColRes = await container.httpClient.delete<{
      readonly deletedColumnId: string;
      readonly migratedTaskCount: number;
    }>(`/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board/columns/${qaCol.id}`, {
      actorUserId: DEMO_MANAGER_USER_ID,
      query: { migrationTargetColumnId: boardBefore.columns[0]!.id },
    });
    expect(deleteColRes.deletedColumnId).toBe(qaCol.id);
    expect(deleteColRes.migratedTaskCount).toBe(1);

    const migratedTask = await container.repositories.tasks.tasks.findById(
      DEMO_ORG_ID,
      tempCard.id,
    );
    expect(migratedTask?.columnId).toBe(boardBefore.columns[0]!.id);

    // Arquiva e restaura coluna vazia (Em Revisão)
    const reviewCol = boardBefore.columns[2]!;
    const archivedCol = await container.httpClient.post<BoardColumn>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board/columns/${reviewCol.id}/archive`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(archivedCol.archivedAt).toBe(FIXED_NOW);

    const restoredCol = await container.httpClient.post<BoardColumn>(
      `/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/board/columns/${reviewCol.id}/restore`,
      {},
      { actorUserId: DEMO_MANAGER_USER_ID },
    );
    expect(restoredCol.archivedAt).toBeUndefined();
  });
});
