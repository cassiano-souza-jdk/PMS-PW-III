import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { BOARD_COLUMN_ROLES } from '@/modules/kanban';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES, PROJECT_STATUSES, asProjectMemberId } from '@/modules/projects';
import { asTaskParticipantId, type Task } from '@/modules/tasks';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  asBoardColumnId,
  asBoardId,
  asEntityId,
  asIsoDateTime,
  asProjectId,
  asTaskId,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('ProjectService & TeamService.activeProjectCount Integration (Phase 06)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-06-10T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_projects_${crypto.randomUUID()}`,
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

  async function setupOrgWithRoles() {
    const admin = await registerUser('admin.proj@pms.local', 'Admin Projetos');
    const manager = await registerUser('manager.proj@pms.local', 'Gestor Projetos');
    const secondManager = await registerUser('manager2.proj@pms.local', 'Gestor 2');
    const member = await registerUser('member.proj@pms.local', 'Membro Projetos');
    const outsider = await registerUser('outsider.proj@pms.local', 'Fora da Org');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Projetos Corp',
        slug: 'projetos-corp',
      },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
      [secondManager.user.id, ORGANIZATION_ROLES.MANAGER],
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

    return { admin, manager, secondManager, member, outsider, organization };
  }

  describe('createProject, listProjects, getProjectDetails e TeamDetails.activeProjectCount', () => {
    it('cria projeto com quadro primário e 4 colunas padrão, registra 1 AuditEvent, enriquece list/details e atualiza TeamDetails.activeProjectCount', async () => {
      const { admin, manager, member, outsider, organization } = await setupOrgWithRoles();

      const team = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Squad Core',
        managerUserIds: [manager.user.id],
      });

      const events: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        events.push(event);
      });

      const created = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Plataforma Alpha',
          description: 'Entrega inicial',
          teamId: team.id,
          ownerUserId: manager.user.id,
          inactivityThresholdDays: 5,
        },
      );

      expect(created.status).toBe(PROJECT_STATUSES.ACTIVE);
      expect(created.teamId).toBe(team.id);
      expect(created.ownerUserId).toBe(manager.user.id);
      expect(created.inactivityThresholdDays).toBe(5);

      const board = await container.repositories.kanban.projectBoards.findPrimaryByProject(
        organization.id,
        created.id,
      );
      expect(board).not.toBeNull();
      expect(board?.name).toBe('Quadro Principal');
      expect(board?.isPrimary).toBe(true);

      const columns = await container.repositories.kanban.boardColumns.listByBoard(
        organization.id,
        board!.id,
      );
      expect(columns.map((c) => [c.name, c.columnRole, c.order, c.wipLimit])).toEqual([
        ['A Fazer', BOARD_COLUMN_ROLES.INITIAL, 1, null],
        ['Em Execução', BOARD_COLUMN_ROLES.OPERATIONAL, 2, 3],
        ['Em Revisão', BOARD_COLUMN_ROLES.OPERATIONAL, 3, 2],
        ['Concluído', BOARD_COLUMN_ROLES.FINAL, 4, null],
      ]);

      const auditTrail = await container.repositories.audit.auditEvents.listByProject(
        organization.id,
        created.id,
        { page: 1, pageSize: 10 },
      );
      expect(auditTrail.items).toHaveLength(1);
      expect(auditTrail.items[0]?.eventType).toBe('project.created');
      expect(events.some((e) => e.eventType === 'project.created')).toBe(true);

      // TeamDetails inclui activeProjectCount
      const teamDetails = await container.services.teams.getTeamDetails(
        admin.user.id,
        organization.id,
        team.id,
      );
      expect(teamDetails.activeProjectCount).toBe(1);

      // listProjects enriquece metadados e segmenta escopo por papel
      const adminList = await container.services.projects.listProjects(
        admin.user.id,
        organization.id,
      );
      expect(adminList).toHaveLength(1);
      expect(adminList[0]?.teamName).toBe('Squad Core');
      expect(adminList[0]?.ownerName).toBe('Gestor Projetos');
      expect(adminList[0]?.participantCount).toBe(1);

      const memberListBefore = await container.services.projects.listProjects(
        member.user.id,
        organization.id,
      );
      expect(memberListBefore).toEqual([]);

      await expect(
        container.services.projects.listProjects(outsider.user.id, organization.id),
      ).rejects.toThrowError(AuthorizationError);

      // getProjectDetails
      const details = await container.services.projects.getProjectDetails(
        manager.user.id,
        organization.id,
        created.id,
      );
      expect(details.teamName).toBe('Squad Core');
      expect(details.owner).toEqual({
        userId: manager.user.id,
        displayName: 'Gestor Projetos',
        email: 'manager.proj@pms.local',
      });
      expect(details.activeParticipantCount).toBe(1);
    });

    it('impõe escopo de MANAGER e rejeita equipe arquivada ou excluída em createProject', async () => {
      const { admin, manager, secondManager, member, organization } = await setupOrgWithRoles();

      const managedTeam = await container.services.teams.createTeam(
        admin.user.id,
        organization.id,
        {
          name: 'Equipe Gerida',
          managerUserIds: [manager.user.id],
        },
      );
      const unmanagedTeam = await container.services.teams.createTeam(
        admin.user.id,
        organization.id,
        {
          name: 'Equipe Alheia',
          managerUserIds: [secondManager.user.id],
        },
      );
      const archivedTeam = await container.services.teams.createTeam(
        admin.user.id,
        organization.id,
        {
          name: 'Equipe Arquivada',
          managerUserIds: [manager.user.id],
        },
      );
      await container.services.teams.archiveTeam(admin.user.id, organization.id, archivedTeam.id);

      // Sem grant project.create, MANAGER é bloqueado
      await expect(
        container.services.projects.createProject(manager.user.id, organization.id, {
          name: 'Sem Grant',
          teamId: managedTeam.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      await container.services.authorization.grantPermission(admin.user.id, organization.id, {
        granteeUserId: manager.user.id,
        permission: PERMISSION_CODES.PROJECT_CREATE,
        scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
        reason: 'Permitir criação de projetos no escopo gerido',
      });

      // MANAGER tentando associar equipe não gerida -> AuthorizationError
      await expect(
        container.services.projects.createProject(manager.user.id, organization.id, {
          name: 'Equipe Não Gerida',
          teamId: unmanagedTeam.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Equipe arquivada -> ConflictError
      await expect(
        container.services.projects.createProject(manager.user.id, organization.id, {
          name: 'Equipe Arquivada',
          teamId: archivedTeam.id,
        }),
      ).rejects.toThrowError(ConflictError);

      // MANAGER tentando atribuir ADMIN como owner -> AuthorizationError
      await expect(
        container.services.projects.createProject(manager.user.id, organization.id, {
          name: 'Elevação Bloqueada',
          teamId: managedTeam.id,
          ownerUserId: admin.user.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // MANAGER criando projeto com outro owner (MEMBER) mantém criador também como MANAGER
      const createdByManager = await container.services.projects.createProject(
        manager.user.id,
        organization.id,
        {
          name: 'Projeto Delegado',
          teamId: managedTeam.id,
          ownerUserId: member.user.id,
        },
      );

      const creatorMembership =
        await container.repositories.projects.projectMembers.findByProjectAndUser(
          organization.id,
          createdByManager.id,
          manager.user.id,
        );
      expect(creatorMembership?.projectRole).toBe(PROJECT_MEMBER_ROLES.MANAGER);
    });
  });

  describe('updateProject, transferProjectTeam, archiveProject, restoreProject e deleteProject', () => {
    it('proíbe alterar teamId em updateProject, controla escopo de transferProjectTeam e preserva integridade no deleteProject', async () => {
      const { admin, manager, secondManager, member, organization } = await setupOrgWithRoles();

      const teamA = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Team A',
        managerUserIds: [manager.user.id],
      });
      const teamB = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Team B',
        managerUserIds: [manager.user.id],
      });
      const teamC = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Team C',
        managerUserIds: [secondManager.user.id],
      });

      const project = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto Ciclo Completo',
          teamId: teamA.id,
          ownerUserId: manager.user.id,
        },
      );

      // updateProject rejeita teamId com ValidationError
      await expect(
        container.services.projects.updateProject(admin.user.id, organization.id, project.id, {
          name: 'Novo Nome',
          teamId: teamB.id,
        } as unknown as Parameters<typeof container.services.projects.updateProject>[3]),
      ).rejects.toThrowError(ValidationError);

      // MANAGER não pode transferir ownership para ADMIN
      await expect(
        container.services.projects.updateProject(manager.user.id, organization.id, project.id, {
          ownerUserId: admin.user.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // MANAGER transfere entre teamA e teamB (ambas geridas)
      const transferredByManager = await container.services.projects.transferProjectTeam(
        manager.user.id,
        organization.id,
        project.id,
        { targetTeamId: teamB.id, reason: 'Reorganização de squad' },
      );
      expect(transferredByManager.teamId).toBe(teamB.id);

      // MANAGER NÃO pode transferir para teamC (não gerida) nem desvincular (null)
      await expect(
        container.services.projects.transferProjectTeam(
          manager.user.id,
          organization.id,
          project.id,
          { targetTeamId: teamC.id },
        ),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.projects.transferProjectTeam(
          manager.user.id,
          organization.id,
          project.id,
          { targetTeamId: null },
        ),
      ).rejects.toThrowError(AuthorizationError);

      // ADMIN pode desvincular (null)
      const unlinked = await container.services.projects.transferProjectTeam(
        admin.user.id,
        organization.id,
        project.id,
        { targetTeamId: null },
      );
      expect(unlinked.teamId).toBeUndefined();

      // Arquivar e restaurar
      const archived = await container.services.projects.archiveProject(
        manager.user.id,
        organization.id,
        project.id,
      );
      expect(archived.status).toBe(PROJECT_STATUSES.ARCHIVED);
      expect(archived.archivedAt).toBe(currentNow);

      await expect(
        container.services.projects.archiveProject(manager.user.id, organization.id, project.id),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.projects.updateProject(admin.user.id, organization.id, project.id, {
          name: 'Bloqueado Arquivado',
        }),
      ).rejects.toThrowError(ConflictError);

      const restored = await container.services.projects.restoreProject(
        manager.user.id,
        organization.id,
        project.id,
      );
      expect(restored.status).toBe(PROJECT_STATUSES.ACTIVE);
      expect(restored.archivedAt).toBeUndefined();

      await expect(
        container.services.projects.restoreProject(manager.user.id, organization.id, project.id),
      ).rejects.toThrowError(ConflictError);

      // Adiciona participante e grant de projeto antes de deleteProject
      await container.services.projects.addProjectParticipant(
        admin.user.id,
        organization.id,
        project.id,
        member.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );

      const projectGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(project.id),
          reason: 'Delegação temporária',
        },
      );

      // MANAGER não pode excluir projeto
      await expect(
        container.services.projects.deleteProject(manager.user.id, organization.id, project.id),
      ).rejects.toThrowError(AuthorizationError);

      const deleted = await container.services.projects.deleteProject(
        admin.user.id,
        organization.id,
        project.id,
        { reason: 'Encerramento definitivo' },
      );
      expect(deleted.deletedAt).toBe(currentNow);
      expect(deleted.deletionReason).toBe('Encerramento definitivo');

      const membersAfterDelete = await container.repositories.projects.projectMembers.listByProject(
        organization.id,
        project.id,
      );
      expect(membersAfterDelete.every((m) => m.removedAt === currentNow)).toBe(true);

      const grantAfterDelete = await container.repositories.authorization.permissionGrants.findById(
        organization.id,
        projectGrant.id,
      );
      expect(grantAfterDelete?.revokedAt).toBe(currentNow);
    });
  });

  describe('Participantes, reativação, pendências de tarefas, revogação de grants e exportProjectData', () => {
    it('reutiliza existing.id ao reativar participante, bloqueia remoção com tarefa pendente, revoga grants via revokeByScope e filtra exportação por TASK_VIEW', async () => {
      const { admin, manager, member, organization } = await setupOrgWithRoles();

      const project = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto Participantes',
          ownerUserId: manager.user.id,
        },
      );

      const firstMembership = await container.services.projects.addProjectParticipant(
        manager.user.id,
        organization.id,
        project.id,
        member.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );

      // Não pode rebaixar ou remover o ownerUserId
      await expect(
        container.services.projects.updateProjectParticipantRole(
          admin.user.id,
          organization.id,
          project.id,
          manager.user.id,
          PROJECT_MEMBER_ROLES.PARTICIPANT,
        ),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.projects.removeProjectParticipant(
          admin.user.id,
          organization.id,
          project.id,
          manager.user.id,
        ),
      ).rejects.toThrowError(ConflictError);

      const board = await container.repositories.kanban.projectBoards.findPrimaryByProject(
        organization.id,
        project.id,
      );
      const columns = await container.repositories.kanban.boardColumns.listByBoard(
        organization.id,
        board!.id,
      );
      const todoColumn = columns[0]!;

      // Tarefa 1 atribuída ao manager (invisível ao member)
      const managerTask: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        boardId: board!.id,
        columnId: todoColumn.id,
        title: 'Tarefa Confidencial do Gestor',
        status: TASK_STATUSES.TODO,
        priority: PRIORITIES.HIGH,
        assigneeId: manager.user.id,
        order: 1,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      };

      // Tarefa 2 onde member é TaskParticipant ativo
      const memberParticipatedTask: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: project.id,
        boardId: board!.id,
        columnId: todoColumn.id,
        title: 'Tarefa Compartilhada com Membro',
        status: TASK_STATUSES.IN_PROGRESS,
        priority: PRIORITIES.MEDIUM,
        assigneeId: manager.user.id,
        order: 2,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      };

      await container.repositories.tasks.tasks.saveMany(organization.id, [
        managerTask,
        memberParticipatedTask,
      ]);
      await container.repositories.tasks.taskParticipants.save({
        id: asTaskParticipantId(crypto.randomUUID()),
        organizationId: organization.id,
        taskId: memberParticipatedTask.id,
        userId: member.user.id,
        addedByUserId: manager.user.id,
        joinedAt: currentNow,
      });

      // Exportação para MEMBER retorna SOMENTE tarefas acessíveis (TASK_VIEW), sem segredos
      const memberExport = await container.services.projects.exportProjectData(
        member.user.id,
        organization.id,
        project.id,
      );
      expect(memberExport.tasks.map((t) => t.id)).toEqual([memberParticipatedTask.id]);
      expect(memberExport.board?.id).toBe(board!.id);
      expect(memberExport.columns).toHaveLength(4);
      expect(JSON.stringify(memberExport)).not.toContain('passwordVerifier');

      const exportAudit = await container.repositories.audit.auditEvents.listByProject(
        organization.id,
        project.id,
        { page: 1, pageSize: 20 },
        { category: AUDIT_CATEGORIES.EXPORT },
      );
      expect(exportAudit.items.some((e) => e.eventType === 'project.exported')).toBe(true);

      // Remoção de member bloqueada enquanto houver tarefa pendente sob responsabilidade
      await expect(
        container.services.projects.removeProjectParticipant(
          manager.user.id,
          organization.id,
          project.id,
          member.user.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Conclui a tarefa pendente -> remoção liberada
      await container.repositories.tasks.tasks.save({
        ...memberParticipatedTask,
        status: TASK_STATUSES.DONE,
        completedAt: currentNow,
      });

      const projectGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_COMMENT,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(project.id),
          reason: 'Concessão no projeto',
        },
      );

      const removed = await container.services.projects.removeProjectParticipant(
        manager.user.id,
        organization.id,
        project.id,
        member.user.id,
      );
      expect(removed.removedAt).toBe(currentNow);

      // Grant de escopo PROJECT revogado, OrganizationMember permanece ACTIVE
      const revokedGrant = await container.repositories.authorization.permissionGrants.findById(
        organization.id,
        projectGrant.id,
      );
      expect(revokedGrant?.revokedAt).toBe(currentNow);

      const orgMembershipAfter =
        await container.repositories.organizations.organizationMembers.findByOrganizationAndUser(
          organization.id,
          member.user.id,
        );
      expect(orgMembershipAfter?.status).toBe(MEMBERSHIP_STATUSES.ACTIVE);

      // Reativação reutiliza existing.id sem ConstraintError
      const reactivated = await container.services.projects.addProjectParticipant(
        manager.user.id,
        organization.id,
        project.id,
        member.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );
      expect(reactivated.id).toBe(firstMembership.id);
      expect(reactivated.removedAt).toBeUndefined();
    });
  });

  describe('DexieTaskRepository.saveMany e listByColumn({ includeDeleted })', () => {
    it('persiste em lote com isolamento organizacional e filtra soft-deleted conforme includeDeleted', async () => {
      const { organization } = await setupOrgWithRoles();
      const boardId = asBoardId(crypto.randomUUID());
      const colId = asBoardColumnId(crypto.randomUUID());
      const projectId = asProjectId(crypto.randomUUID());
      const actorId = asEntityId(crypto.randomUUID()) as unknown as Task['createdByUserId'];

      const activeTask: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId,
        boardId,
        columnId: colId,
        title: 'Ativa',
        status: TASK_STATUSES.TODO,
        priority: PRIORITIES.LOW,
        order: 1,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        createdByUserId: actorId,
        createdAt: currentNow,
        updatedAt: currentNow,
      };

      const deletedTask: Task = {
        ...activeTask,
        id: asTaskId(crypto.randomUUID()),
        title: 'Excluída',
        order: 2,
        deletedAt: currentNow,
        deletedBy: actorId,
      };

      await container.repositories.tasks.tasks.saveMany(organization.id, [activeTask, deletedTask]);

      const onlyActive = await container.repositories.tasks.tasks.listByColumn(
        organization.id,
        colId,
      );
      expect(onlyActive.map((t) => t.id)).toEqual([activeTask.id]);

      const withDeleted = await container.repositories.tasks.tasks.listByColumn(
        organization.id,
        colId,
        { includeDeleted: true },
      );
      expect(withDeleted.map((t) => t.id)).toEqual([activeTask.id, deletedTask.id]);

      const nonExistentProject = await container.repositories.projects.projects.findById(
        organization.id,
        asProjectId(crypto.randomUUID()),
      );
      expect(nonExistentProject).toBeNull();
      await expect(
        container.services.projects.getProjectDetails(
          actorId,
          organization.id,
          asProjectId(crypto.randomUUID()),
        ),
      ).rejects.toThrowError(NotFoundError);
    });
  });

  describe('Proteção do último MANAGER ativo, isolamento multi-organização, escopo cruzado, concessões expiradas e ExplicitDenyRule', () => {
    it('protege último ProjectMember MANAGER ativo, impede auto-rebaixamento de MANAGER e isola revogação de grants por escopo PROJECT', async () => {
      const { admin, manager, secondManager, member, organization } = await setupOrgWithRoles();

      const team = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Squad Proteção',
        managerUserIds: [manager.user.id, secondManager.user.id],
      });

      const projectA = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto A Escopo',
          teamId: team.id,
          ownerUserId: manager.user.id,
        },
      );
      const projectB = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto B Escopo',
          teamId: team.id,
          ownerUserId: manager.user.id,
        },
      );

      // Promove secondManager a MANAGER em projectA; MANAGER não altera papel de ADMIN nem auto-rebaixa; ADMIN consegue rebaixar quando há outro MANAGER
      await container.services.projects.addProjectParticipant(
        admin.user.id,
        organization.id,
        projectA.id,
        secondManager.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );
      await container.services.projects.updateProjectParticipantRole(
        admin.user.id,
        organization.id,
        projectA.id,
        secondManager.user.id,
        PROJECT_MEMBER_ROLES.MANAGER,
      );

      await container.services.projects.addProjectParticipant(
        admin.user.id,
        organization.id,
        projectA.id,
        admin.user.id,
        PROJECT_MEMBER_ROLES.MANAGER,
      );
      await expect(
        container.services.projects.updateProjectParticipantRole(
          manager.user.id,
          organization.id,
          projectA.id,
          admin.user.id,
          PROJECT_MEMBER_ROLES.PARTICIPANT,
        ),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.projects.updateProjectParticipantRole(
          secondManager.user.id,
          organization.id,
          projectA.id,
          secondManager.user.id,
          PROJECT_MEMBER_ROLES.PARTICIPANT,
        ),
      ).rejects.toThrowError(AuthorizationError);

      const demotedSecond = await container.services.projects.updateProjectParticipantRole(
        admin.user.id,
        organization.id,
        projectA.id,
        secondManager.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );
      expect(demotedSecond.projectRole).toBe(PROJECT_MEMBER_ROLES.PARTICIPANT);

      // Cenário em que ownerUserId não possui ProjectMember ativo e secondManager é o último ProjectMember MANAGER ativo
      const guardedProject = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto Último Gestor',
          ownerUserId: admin.user.id,
        },
      );
      const adminMember = await container.repositories.projects.projectMembers.findByProjectAndUser(
        organization.id,
        guardedProject.id,
        admin.user.id,
      );
      expect(adminMember).not.toBeNull();
      await container.repositories.projects.projectMembers.save({
        ...adminMember!,
        removedAt: currentNow,
      });
      await container.repositories.projects.projectMembers.save({
        id: asProjectMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: guardedProject.id,
        userId: secondManager.user.id,
        projectRole: PROJECT_MEMBER_ROLES.MANAGER,
        joinedAt: currentNow,
      });

      await expect(
        container.services.projects.updateProjectParticipantRole(
          admin.user.id,
          organization.id,
          guardedProject.id,
          secondManager.user.id,
          PROJECT_MEMBER_ROLES.PARTICIPANT,
        ),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.projects.removeProjectParticipant(
          admin.user.id,
          organization.id,
          guardedProject.id,
          secondManager.user.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Tarefa atribuída diretamente via assigneeId bloqueia remoção; tarefa CANCELLED libera e revoga SOMENTE grant do projeto alvo
      await container.services.projects.addProjectParticipant(
        admin.user.id,
        organization.id,
        projectA.id,
        member.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );
      const orgGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_COMMENT,
          scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
          reason: 'Grant organizacional preservado',
        },
      );
      const projectAGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_UPDATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(projectA.id),
          reason: 'Grant específico projeto A',
        },
      );
      const projectBGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(projectB.id),
          reason: 'Grant específico projeto B',
        },
      );

      const boardA = await container.repositories.kanban.projectBoards.findPrimaryByProject(
        organization.id,
        projectA.id,
      );
      const colsA = await container.repositories.kanban.boardColumns.listByBoard(
        organization.id,
        boardA!.id,
      );
      const assignedTask: Task = {
        id: asTaskId(crypto.randomUUID()),
        organizationId: organization.id,
        projectId: projectA.id,
        boardId: boardA!.id,
        columnId: colsA[0]!.id,
        title: 'Tarefa atribuída ao membro',
        status: TASK_STATUSES.TODO,
        priority: PRIORITIES.HIGH,
        assigneeId: member.user.id,
        order: 1,
        tagIds: [],
        lastMovedAt: currentNow,
        lastActivityAt: currentNow,
        createdByUserId: manager.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      };
      await container.repositories.tasks.tasks.save(assignedTask);

      await expect(
        container.services.projects.removeProjectParticipant(
          admin.user.id,
          organization.id,
          projectA.id,
          member.user.id,
        ),
      ).rejects.toThrowError(ConflictError);

      await container.repositories.tasks.tasks.save({
        ...assignedTask,
        status: TASK_STATUSES.CANCELLED,
        cancelledAt: currentNow,
        cancellationReason: 'Escopo cancelado',
      });

      await container.services.projects.removeProjectParticipant(
        admin.user.id,
        organization.id,
        projectA.id,
        member.user.id,
      );

      expect(
        (
          await container.repositories.authorization.permissionGrants.findById(
            organization.id,
            projectAGrant.id,
          )
        )?.revokedAt,
      ).toBe(currentNow);
      expect(
        (
          await container.repositories.authorization.permissionGrants.findById(
            organization.id,
            projectBGrant.id,
          )
        )?.revokedAt,
      ).toBeUndefined();
      expect(
        (
          await container.repositories.authorization.permissionGrants.findById(
            organization.id,
            orgGrant.id,
          )
        )?.revokedAt,
      ).toBeUndefined();

      // deleteProject decrementa TeamDetails.activeProjectCount e preserva grant organizacional
      await container.services.projects.deleteProject(admin.user.id, organization.id, projectA.id);
      await container.services.projects.deleteProject(admin.user.id, organization.id, projectB.id);

      const teamDetailsAfterDeletes = await container.services.teams.getTeamDetails(
        admin.user.id,
        organization.id,
        team.id,
      );
      expect(teamDetailsAfterDeletes.activeProjectCount).toBe(0);
      expect(
        (
          await container.repositories.authorization.permissionGrants.findById(
            organization.id,
            projectBGrant.id,
          )
        )?.revokedAt,
      ).toBe(currentNow);
      expect(
        (
          await container.repositories.authorization.permissionGrants.findById(
            organization.id,
            orgGrant.id,
          )
        )?.revokedAt,
      ).toBeUndefined();
    });

    it('bloqueia acesso cross-organization (ADMIN da Org B), escopo cruzado de MANAGER, concessão expirada, ExplicitDenyRule e projeto arquivado', async () => {
      const { admin, manager, secondManager, member, outsider, organization } =
        await setupOrgWithRoles();

      const { organization: orgB } = await container.services.organizations.createOrganization(
        outsider.user.id,
        {
          name: 'Org B Externa',
          slug: 'org-b-externa',
        },
      );
      const teamBOrg = await container.services.teams.createTeam(outsider.user.id, orgB.id, {
        name: 'Equipe Org B',
        managerUserIds: [outsider.user.id],
      });

      const teamX = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Squad X',
        managerUserIds: [manager.user.id],
      });
      const teamY = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Squad Y',
        managerUserIds: [secondManager.user.id],
      });

      const projectX = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto X',
          teamId: teamX.id,
          ownerUserId: manager.user.id,
        },
      );
      const projectY = await container.services.projects.createProject(
        admin.user.id,
        organization.id,
        {
          name: 'Projeto Y',
          teamId: teamY.id,
          ownerUserId: secondManager.user.id,
        },
      );

      // Cenário 1: ADMIN da Organização B não lê nem altera projetos da Organização A
      await expect(
        container.services.projects.listProjects(outsider.user.id, organization.id),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.getProjectDetails(
          outsider.user.id,
          organization.id,
          projectX.id,
        ),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.updateProject(outsider.user.id, organization.id, projectX.id, {
          name: 'Invasão Org B',
        }),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.transferProjectTeam(
          outsider.user.id,
          organization.id,
          projectX.id,
          { targetTeamId: null },
        ),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.deleteProject(outsider.user.id, organization.id, projectX.id),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.exportProjectData(
          outsider.user.id,
          organization.id,
          projectX.id,
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Tentativa de vincular equipe de Org B em projeto de Org A -> NotFoundError
      await expect(
        container.services.projects.createProject(admin.user.id, organization.id, {
          name: 'Vínculo Cross-Org',
          teamId: teamBOrg.id,
        }),
      ).rejects.toThrowError(NotFoundError);

      // Cenário 3: MANAGER atribuído a Projeto X não consulta nem administra Projeto Y
      await expect(
        container.services.projects.getProjectDetails(
          manager.user.id,
          organization.id,
          projectY.id,
        ),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.updateProject(manager.user.id, organization.id, projectY.id, {
          name: 'Alteração Indevida',
        }),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.archiveProject(manager.user.id, organization.id, projectY.id),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.addProjectParticipant(
          manager.user.id,
          organization.id,
          projectY.id,
          member.user.id,
        ),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.exportProjectData(
          manager.user.id,
          organization.id,
          projectY.id,
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Cenário 8: Concessão temporária expirada não autoriza criação de projeto após expiração
      const expiresAt = asIsoDateTime('2026-06-11T10:00:00.000Z');
      await container.services.authorization.grantPermission(admin.user.id, organization.id, {
        granteeUserId: manager.user.id,
        permission: PERMISSION_CODES.PROJECT_CREATE,
        scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
        reason: 'Janela temporária de criação',
        expiresAt,
      });

      currentNow = asIsoDateTime('2026-06-12T10:00:00.000Z');
      await expect(
        container.services.projects.createProject(manager.user.id, organization.id, {
          name: 'Após Expiração',
          teamId: teamX.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Cenário 10: ExplicitDenyRule prevalece sobre concessão ativa de PROJECT_VIEW
      await container.services.authorization.grantPermission(admin.user.id, organization.id, {
        granteeUserId: member.user.id,
        permission: PERMISSION_CODES.PROJECT_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: asEntityId(projectY.id),
        reason: 'Leitura pontual do projeto Y',
      });
      await container.services.authorization.createExplicitDenyRule(
        admin.user.id,
        organization.id,
        {
          targetUserId: member.user.id,
          permission: PERMISSION_CODES.PROJECT_VIEW,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(projectY.id),
          reason: 'Restrição explícita sobre projeto Y',
        },
      );

      await expect(
        container.services.projects.getProjectDetails(member.user.id, organization.id, projectY.id),
      ).rejects.toThrowError(AuthorizationError);
      await expect(
        container.services.projects.exportProjectData(member.user.id, organization.id, projectY.id),
      ).rejects.toThrowError(AuthorizationError);

      // Cenário 18: Operações operacionais bloqueadas em projeto arquivado mesmo para ADMIN
      await container.services.projects.archiveProject(admin.user.id, organization.id, projectX.id);
      await expect(
        container.services.projects.transferProjectTeam(
          admin.user.id,
          organization.id,
          projectX.id,
          { targetTeamId: teamY.id },
        ),
      ).rejects.toThrowError(ConflictError);
      await expect(
        container.services.projects.addProjectParticipant(
          admin.user.id,
          organization.id,
          projectX.id,
          member.user.id,
        ),
      ).rejects.toThrowError(ConflictError);
    });
  });
});
