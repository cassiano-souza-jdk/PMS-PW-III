import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent } from '@/modules/audit';
import { DEMO_SEED_VERSION, MAINTENANCE_ACTIONS } from '@/modules/demo';
import type { Project } from '@/modules/projects';
import { AuthenticationError, AuthorizationError, InfrastructureError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  asCorrelationId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asUserId,
  type DomainEventEnvelope,
  type PaginatedResult,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_BOARD_ID,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_ORG_SLUG,
  DEMO_PROJECT_ID,
  DEMO_TEAM_ID,
  createAppContainer,
  createMswHandlers,
  type AppCompositionContainer,
  type CreateProjectRequestPayload,
  type DemoOrganizationSeedResult,
  type HealthEndpointResponse,
} from './index';

const OTHER_ORG_ID = asOrganizationId('99999999-9999-4999-8999-999999999901');
const OTHER_USER_ID = asUserId('99999999-9999-4999-8999-999999999902');
const FIXED_NOW = asIsoDateTime('2026-04-01T10:00:00.000Z');

describe('MSW v2 Server + HttpClient + Demo Organization Seed + RBAC/ABAC Integration', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_msw_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);

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

  describe('Seed Determinística Idempotente da Organização Demonstrativa (ensureDemoOrganizationSeeded)', () => {
    it('popula atomicamente todas as 16 stores da organização demo na primeira execução, emite demo.organization.seeded pós-commit e mantém idempotência não-destrutiva na segunda execução', async () => {
      const receivedEvents: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        receivedEvents.push(event);
      });

      const firstSeed = await container.seedDemoOrganization(FIXED_NOW);
      expect(firstSeed).toEqual({
        seeded: true,
        organizationId: DEMO_ORG_ID,
        seedVersion: DEMO_SEED_VERSION,
      });

      // Evento emitido pós-commit
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]?.eventType).toBe('demo.organization.seeded');
      expect(receivedEvents[0]?.organizationId).toBe(DEMO_ORG_ID);

      // Verificação das entidades persistidas no IndexedDB
      const org = await container.repositories.organizations.organizations.findById(DEMO_ORG_ID);
      expect(org?.slug).toBe(DEMO_ORG_SLUG);
      expect(org?.isDemo).toBe(true);

      const settings =
        await container.repositories.settings.organizationSettings.findByOrganization(DEMO_ORG_ID);
      expect(settings).not.toBeNull();

      const members =
        await container.repositories.organizations.organizationMembers.listByOrganization(
          DEMO_ORG_ID,
        );
      expect(members).toHaveLength(3);
      expect(members.map((m) => m.role).sort()).toEqual([
        ORGANIZATION_ROLES.ADMIN,
        ORGANIZATION_ROLES.MANAGER,
        ORGANIZATION_ROLES.MEMBER,
      ]);

      const teams = await container.repositories.teams.teams.listByOrganization(DEMO_ORG_ID);
      expect(teams).toHaveLength(1);
      expect(teams[0]?.id).toBe(DEMO_TEAM_ID);

      const projects =
        await container.repositories.projects.projects.listByOrganization(DEMO_ORG_ID);
      expect(projects).toHaveLength(1);
      expect(projects[0]?.id).toBe(DEMO_PROJECT_ID);

      const board = await container.repositories.kanban.projectBoards.findPrimaryByProject(
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      expect(board?.id).toBe(DEMO_BOARD_ID);

      const columns = await container.repositories.kanban.boardColumns.listByBoard(
        DEMO_ORG_ID,
        DEMO_BOARD_ID,
      );
      expect(columns).toHaveLength(4);

      const tasks = await container.repositories.tasks.tasks.listByProject(
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      expect(tasks).toHaveLength(2);

      const categories =
        await container.repositories.feedback.feedbackCategories.listByOrganization(DEMO_ORG_ID);
      expect(categories).toHaveLength(8);
      for (const category of categories) {
        const versions = await container.repositories.feedback.feedbackCategories.listVersions(
          DEMO_ORG_ID,
          category.id,
        );
        expect(versions).toHaveLength(1);
        expect(versions[0]?.versionNumber).toBe(1);
      }

      const reasons =
        await container.repositories.feedback.feedbackContestReasons.listByOrganization(
          DEMO_ORG_ID,
        );
      expect(reasons).toHaveLength(8);
      for (const reason of reasons) {
        const versions = await container.repositories.feedback.feedbackContestReasons.listVersions(
          DEMO_ORG_ID,
          reason.id,
        );
        expect(versions).toHaveLength(1);
        expect(versions[0]?.versionNumber).toBe(1);
      }

      const maintenanceEvents =
        await container.repositories.demo.maintenanceEvents.listByOrganization(DEMO_ORG_ID);
      expect(maintenanceEvents).toHaveLength(1);
      expect(maintenanceEvents[0]?.action).toBe(MAINTENANCE_ACTIONS.SEED);

      // Altera o nome do projeto demo para testar que a 2ª seed não sobrescreve dados existentes
      const firstProject = projects[0]!;
      await container.repositories.projects.projects.save({
        ...firstProject,
        name: 'Projeto Demo Customizado Pelo Usuario',
      });

      const secondSeed = await container.seedDemoOrganization(FIXED_NOW);
      expect(secondSeed).toEqual({
        seeded: false,
        organizationId: DEMO_ORG_ID,
        seedVersion: DEMO_SEED_VERSION,
      });

      // Nenhum novo evento de seed emitido e nenhuma alteração sobrescrita
      expect(receivedEvents).toHaveLength(1);
      const afterSecondSeedProject = await container.repositories.projects.projects.findById(
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      expect(afterSecondSeedProject?.name).toBe('Projeto Demo Customizado Pelo Usuario');
      expect(
        await container.repositories.demo.maintenanceEvents.listByOrganization(DEMO_ORG_ID),
      ).toHaveLength(1);
    });
  });

  describe('Integração Ponta a Ponta HttpClient + MSW + Repositórios Dexie + RBAC/ABAC', () => {
    it('executa GET /api/v1/health e POST /api/v1/demo/seed propagando x-correlation-id no envelope HTTP', async () => {
      const customCorrelationId = asCorrelationId('77777777-7777-4777-8777-777777777701');

      const healthBefore = await container.httpClient.requestEnvelope<HealthEndpointResponse>(
        '/health',
        {
          correlationId: customCorrelationId,
        },
      );
      expect(healthBefore.meta.correlationId).toBe(customCorrelationId);
      expect(healthBefore.data.status).toBe('ok');
      expect(healthBefore.data.demoOrganizationSeeded).toBe(false);

      const seedEnvelope = await container.httpClient.requestEnvelope<DemoOrganizationSeedResult>(
        '/demo/seed',
        {
          method: 'POST',
          correlationId: customCorrelationId,
        },
      );
      expect(seedEnvelope.meta.correlationId).toBe(customCorrelationId);
      expect(seedEnvelope.data.seeded).toBe(true);
      expect(seedEnvelope.data.organizationId).toBe(DEMO_ORG_ID);

      const healthAfter = await container.httpClient.get<HealthEndpointResponse>('/health');
      expect(healthAfter.demoOrganizationSeeded).toBe(true);
    });

    it('controla autorização em GET /api/v1/organizations/:organizationId/projects para ADMIN, MANAGER, MEMBER, não autenticado (401) e cross-organization (403)', async () => {
      await container.seedDemoOrganization(FIXED_NOW);

      // ADMIN, MANAGER e MEMBER da organização demo listam o projeto com sucesso
      for (const actorId of [DEMO_ADMIN_USER_ID, DEMO_MANAGER_USER_ID, DEMO_MEMBER_USER_ID]) {
        const projects = await container.httpClient.get<readonly Project[]>(
          `/organizations/${DEMO_ORG_ID}/projects`,
          { actorUserId: actorId },
        );
        expect(projects).toHaveLength(1);
        expect(projects[0]?.id).toBe(DEMO_PROJECT_ID);
      }

      // Ator não autenticado (sem x-actor-user-id) recebe AuthenticationError (HTTP 401)
      await expect(
        container.httpClient.get<readonly Project[]>(`/organizations/${DEMO_ORG_ID}/projects`),
      ).rejects.toThrowError(AuthenticationError);

      // Ator de outra organização (sem vínculo na demo org) tentando listar projetos quando a lista está vazia ou populada
      await container.repositories.organizations.organizations.save({
        id: OTHER_ORG_ID,
        name: 'Outra Organizacao',
        slug: 'outra-org',
        isDemo: false,
        createdByUserId: OTHER_USER_ID,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      });

      await expect(
        container.httpClient.get<readonly Project[]>(`/organizations/${OTHER_ORG_ID}/projects`, {
          actorUserId: DEMO_MEMBER_USER_ID,
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.httpClient.get(`/organizations/${DEMO_ORG_ID}`, {
          actorUserId: OTHER_USER_ID,
        }),
      ).rejects.toThrowError(AuthorizationError);
    });

    it('persiste Project, ProjectMember e AuditEvent no Dexie antes do retorno HTTP 201 em POST /projects para ADMIN e bloqueia MEMBER com HTTP 403 sem gravar nada', async () => {
      await container.seedDemoOrganization(FIXED_NOW);

      const dispatchedEvents: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        dispatchedEvents.push(event);
      });

      const createdProjectId = asProjectId('88888888-8888-4888-8888-888888888801');
      const correlationId = asCorrelationId('88888888-8888-4888-8888-888888888802');

      const createdProject = await container.httpClient.post<Project, CreateProjectRequestPayload>(
        `/organizations/${DEMO_ORG_ID}/projects`,
        {
          id: createdProjectId,
          name: 'Novo Projeto Estrategico Q2',
          description: 'Criado via MSW + Dexie transaction',
          teamId: DEMO_TEAM_ID,
          ownerUserId: DEMO_MANAGER_USER_ID,
          inactivityThresholdDays: 5,
        },
        {
          actorUserId: DEMO_ADMIN_USER_ID,
          correlationId,
        },
      );

      expect(createdProject.id).toBe(createdProjectId);
      expect(createdProject.name).toBe('Novo Projeto Estrategico Q2');

      // Verifica persistência confirmada no Dexie
      const persistedProject = await container.repositories.projects.projects.findById(
        DEMO_ORG_ID,
        createdProjectId,
      );
      expect(persistedProject).not.toBeNull();
      expect(persistedProject?.name).toBe('Novo Projeto Estrategico Q2');

      const projectMember =
        await container.repositories.projects.projectMembers.findByProjectAndUser(
          DEMO_ORG_ID,
          createdProjectId,
          DEMO_MANAGER_USER_ID,
        );
      expect(projectMember).not.toBeNull();
      expect(projectMember?.projectRole).toBe('MANAGER');

      const auditTrail = await container.repositories.audit.auditEvents.listByProject(
        DEMO_ORG_ID,
        createdProjectId,
        { page: 1, pageSize: 10 },
      );
      expect(auditTrail.items).toHaveLength(1);
      expect(auditTrail.items[0]?.eventType).toBe('project.created');
      expect(auditTrail.items[0]?.correlationId).toBe(correlationId);

      expect(dispatchedEvents.some((e) => e.eventType === 'project.created')).toBe(true);

      // MEMBER tentando criar projeto recebe AuthorizationError (HTTP 403) e nenhum registro é gravado
      const forbiddenProjectId = asProjectId('88888888-8888-4888-8888-888888888899');
      await expect(
        container.httpClient.post<Project, CreateProjectRequestPayload>(
          `/organizations/${DEMO_ORG_ID}/projects`,
          {
            id: forbiddenProjectId,
            name: 'Projeto Nao Autorizado',
          },
          {
            actorUserId: DEMO_MEMBER_USER_ID,
          },
        ),
      ).rejects.toThrowError(AuthorizationError);

      expect(
        await container.repositories.projects.projects.findById(DEMO_ORG_ID, forbiddenProjectId),
      ).toBeNull();
    });

    it('permite ADMIN consultar GET /api/v1/organizations/:organizationId/audit-events e bloqueia MEMBER com AuthorizationError (HTTP 403 — Cenário 14 de permission-matrix.md §11)', async () => {
      await container.seedDemoOrganization(FIXED_NOW);

      // Cria um projeto como ADMIN para gerar um AuditEvent
      await container.httpClient.post<Project, CreateProjectRequestPayload>(
        `/organizations/${DEMO_ORG_ID}/projects`,
        {
          name: 'Projeto Auditado',
        },
        {
          actorUserId: DEMO_ADMIN_USER_ID,
        },
      );

      const adminAuditPage = await container.httpClient.get<PaginatedResult<AuditEvent>>(
        `/organizations/${DEMO_ORG_ID}/audit-events`,
        {
          actorUserId: DEMO_ADMIN_USER_ID,
          query: { page: 1, pageSize: 10 },
        },
      );
      expect(adminAuditPage.total).toBe(1);
      expect(adminAuditPage.items[0]?.eventType).toBe('project.created');

      // MEMBER bloqueado com AuthorizationError (HTTP 403)
      let memberError: unknown;
      try {
        await container.httpClient.get<PaginatedResult<AuditEvent>>(
          `/organizations/${DEMO_ORG_ID}/audit-events`,
          {
            actorUserId: DEMO_MEMBER_USER_ID,
          },
        );
      } catch (error: unknown) {
        memberError = error;
      }

      expect(memberError).toBeInstanceOf(AuthorizationError);
      expect((memberError as AuthorizationError).details?.httpStatus).toBe(403);

      // Usuário suspenso também é bloqueado
      await container.repositories.organizations.organizationMembers.save({
        id: (await container.repositories.organizations.organizationMembers.findByOrganizationAndUser(
          DEMO_ORG_ID,
          DEMO_MANAGER_USER_ID,
        ))!.id,
        organizationId: DEMO_ORG_ID,
        userId: DEMO_MANAGER_USER_ID,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.SUSPENDED,
        joinedAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      });

      await expect(
        container.httpClient.get<PaginatedResult<AuditEvent>>(
          `/organizations/${DEMO_ORG_ID}/audit-events`,
          {
            actorUserId: DEMO_MANAGER_USER_ID,
          },
        ),
      ).rejects.toThrowError(AuthorizationError);
    });

    it('SimulationScenarioController injeta erro determinístico (forceStatus: 503 e networkError: true com remainingApplications: 1) convertido em InfrastructureError com correlationId e volta a suceder após expirar a regra', async () => {
      const correlation503 = asCorrelationId('66666666-6666-4666-8666-666666666601');

      container.simulationController.setRule({
        method: 'GET',
        pathPattern: '/api/v1/health',
        forceStatus: 503,
        remainingApplications: 1,
      });

      let caught503: unknown;
      try {
        await container.httpClient.get<HealthEndpointResponse>('/health', {
          correlationId: correlation503,
        });
      } catch (error: unknown) {
        caught503 = error;
      }

      expect(caught503).toBeInstanceOf(InfrastructureError);
      expect((caught503 as InfrastructureError).correlationId).toBe(correlation503);
      expect((caught503 as InfrastructureError).details?.httpStatus).toBe(503);

      // Chamada seguinte sucede automaticamente pois remainingApplications: 1 expirou
      const healthRecoveredAfter503 =
        await container.httpClient.get<HealthEndpointResponse>('/health');
      expect(healthRecoveredAfter503.status).toBe('ok');

      // Injeção de falha de rede (networkError: true com remainingApplications: 1)
      const correlationNet = asCorrelationId('66666666-6666-4666-8666-666666666602');
      container.simulationController.setRule({
        method: 'GET',
        pathPattern: '/api/v1/health',
        networkError: true,
        remainingApplications: 1,
      });

      let caughtNetwork: unknown;
      try {
        await container.httpClient.get<HealthEndpointResponse>('/health', {
          correlationId: correlationNet,
        });
      } catch (error: unknown) {
        caughtNetwork = error;
      }

      expect(caughtNetwork).toBeInstanceOf(InfrastructureError);
      expect((caughtNetwork as InfrastructureError).correlationId).toBe(correlationNet);
      expect((caughtNetwork as InfrastructureError).details?.reason).toBe('NETWORK_ERROR');

      // Chamada seguinte volta a suceder normalmente
      const healthRecoveredAfterNet =
        await container.httpClient.get<HealthEndpointResponse>('/health');
      expect(healthRecoveredAfterNet.status).toBe('ok');
    });
  });
});
