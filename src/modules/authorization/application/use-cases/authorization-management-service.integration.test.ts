import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  DEMO_TEAM_ID,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import {
  GRANT_STATUSES,
  PERMISSION_CODES,
  PERMISSION_SCOPE_TYPES,
  evaluateAuthorization,
} from '@/modules/authorization';
import { AuthorizationError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  asEntityId,
  asIsoDateTime,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('AuthorizationManagementService Integration (Grants, Manager Scope Delegation, Deny Overrides & Active Rules)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    window.sessionStorage.clear();
    currentNow = asIsoDateTime('2026-06-10T10:00:00.000Z');
    container = createAppContainer({
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_authz_mgmt_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
    await container.seedDemoOrganization(currentNow);
  });

  afterEach(async () => {
    if (container.db.isOpen()) {
      container.db.close();
    }
    await container.db.delete();
    window.sessionStorage.clear();
  });

  describe('grantPermission & revokePermissionGrant', () => {
    it('permite ADMIN conceder e revogar com reason obrigatória e AuditEvent, rejeita reason curta com ValidationError e bloqueia MEMBER com AuthorizationError', async () => {
      // Reason curta falha com ValidationError
      await expect(
        container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
          granteeUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TEAM_UPDATE,
          scopeType: PERMISSION_SCOPE_TYPES.TEAM,
          scopeId: asEntityId(DEMO_TEAM_ID),
          reason: 'ok',
        }),
      ).rejects.toThrowError(ValidationError);

      // MEMBER não pode conceder permissões
      await expect(
        container.services.authorization.grantPermission(DEMO_MEMBER_USER_ID, DEMO_ORG_ID, {
          granteeUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Tentativa indevida de auto-concessao',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // ADMIN concede permissão com sucesso e grava AuditEvent
      const grant = await container.services.authorization.grantPermission(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          granteeUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Apoio operacional temporario no projeto demo',
        },
      );

      expect(grant.status).toBe(GRANT_STATUSES.ACTIVE);
      expect(grant.granteeUserId).toBe(DEMO_MEMBER_USER_ID);
      expect(grant.permission).toBe(PERMISSION_CODES.TASK_CREATE);

      // ADMIN revoga a concessão e grava AuditEvent
      await container.services.authorization.revokePermissionGrant(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        grant.id,
        { reason: 'Fim do periodo temporario' },
      );

      const listed = await container.services.authorization.listOrganizationGrants(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
      );
      const revokedEntry = listed.find((item) => item.id === grant.id);
      expect(revokedEntry?.derivedStatus).toBe(GRANT_STATUSES.REVOKED);

      const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
        DEMO_ORG_ID,
        { page: 1, pageSize: 20 },
      );
      expect(auditPage.items.some((e) => e.eventType === 'authorization.grant.created')).toBe(true);
      expect(auditPage.items.some((e) => e.eventType === 'authorization.grant.revoked')).toBe(true);
    });

    it('restringe MANAGER a delegar apenas MANAGER_DELEGABLE_PERMISSIONS dentro de equipes/projetos que administra (Cenário 9 §11) e bloqueia ADMIN comum em demo.maintenance.* (Cenário 17 §11)', async () => {
      // Cria uma segunda equipe NÃO gerida pelo DEMO_MANAGER_USER_ID
      const unmanagedTeam = await container.services.teams.createTeam(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          name: 'Equipe Nao Gerida Pelo Manager',
        },
      );

      // 1. MANAGER delega permissão delegável (TASK_CREATE) dentro do projeto que administra -> SUCESSO
      const delegatedGrant = await container.services.authorization.grantPermission(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        {
          granteeUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Delegacao valida dentro do projeto gerido pelo manager',
        },
      );
      expect(delegatedGrant.grantedByRole).toBe(ORGANIZATION_ROLES.MANAGER);

      // 2. MANAGER tentando delegar FORA do escopo administrado (unmanagedTeam) -> AuthorizationError (Cenário 9)
      await expect(
        container.services.authorization.grantPermission(DEMO_MANAGER_USER_ID, DEMO_ORG_ID, {
          granteeUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TEAM_VIEW,
          scopeType: PERMISSION_SCOPE_TYPES.TEAM,
          scopeId: asEntityId(unmanagedTeam.id),
          reason: 'Tentativa fora do escopo administrado',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // 3. MANAGER tentando delegar permissão ACIMA da autoridade (ORGANIZATION_ROLES_MANAGE ou TEAM_DELETE) -> AuthorizationError
      await expect(
        container.services.authorization.grantPermission(DEMO_MANAGER_USER_ID, DEMO_ORG_ID, {
          granteeUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TEAM_DELETE,
          scopeType: PERMISSION_SCOPE_TYPES.TEAM,
          scopeId: asEntityId(DEMO_TEAM_ID),
          reason: 'Tentativa de delegar permissao exclusiva de ADMIN',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // 4. ADMIN comum não pode conceder demo.maintenance.* sem hasDemoMaintenanceDelegationAuthority (Cenário 17 §11)
      await expect(
        container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
          granteeUserId: DEMO_MANAGER_USER_ID,
          permission: PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE,
          scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
          reason: 'Tentativa de delegar manutencao demo sem autoridade especial',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
          granteeUserId: DEMO_MANAGER_USER_ID,
          permission: PERMISSION_CODES.DEMO_MAINTENANCE_VIEW,
          scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
          reason: 'Tentativa de delegar visualizacao de manutencao demo',
        }),
      ).rejects.toThrowError(AuthorizationError);
    });
  });

  describe('createExplicitDenyRule & revokeExplicitDenyRule (Deny Overrides — Cenário 10 §11)', () => {
    it('restringe criação/revogação ao ADMIN e comprova que ExplicitDenyRule prevalece sobre papel base e PermissionGrant ativo', async () => {
      // MANAGER e MEMBER não podem criar ExplicitDenyRule
      await expect(
        container.services.authorization.createExplicitDenyRule(DEMO_MANAGER_USER_ID, DEMO_ORG_ID, {
          targetUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Manager nao pode criar deny rule',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // ADMIN concede TASK_CREATE ao MEMBER no projeto demo
      await container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
        granteeUserId: DEMO_MEMBER_USER_ID,
        permission: PERMISSION_CODES.TASK_CREATE,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: asEntityId(DEMO_PROJECT_ID),
        reason: 'Concessao ativa antes do deny override',
      });

      // ADMIN cria ExplicitDenyRule para o mesmo MEMBER na mesma permissão/escopo
      const denyRule = await container.services.authorization.createExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          targetUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.TASK_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Bloqueio explicito preventivo por auditoria',
        },
      );

      // Avalia a autorização com os grants e denies ativos retornados por listMyActiveAccessRules
      const memberRules = await container.services.authorization.listMyActiveAccessRules(
        DEMO_MEMBER_USER_ID,
        DEMO_ORG_ID,
      );

      const decisionWithDeny = evaluateAuthorization({
        actor: {
          isAuthenticated: true,
          userId: DEMO_MEMBER_USER_ID,
          organizationMembership: {
            organizationId: DEMO_ORG_ID,
            role: ORGANIZATION_ROLES.MEMBER,
            status: MEMBERSHIP_STATUSES.ACTIVE,
          },
          managedTeamIds: memberRules.managedTeamIds,
          memberTeamIds: memberRules.memberTeamIds,
          managedProjectIds: memberRules.managedProjectIds,
          participatedProjectIds: memberRules.participatedProjectIds,
          grants: memberRules.grants,
          explicitDenies: memberRules.explicitDenies,
        },
        action: PERMISSION_CODES.TASK_CREATE,
        resource: {
          kind: 'TASK',
          exists: true,
          organizationId: DEMO_ORG_ID,
          projectId: DEMO_PROJECT_ID,
        },
        context: { now: currentNow },
      });

      expect(decisionWithDeny.allowed).toBe(false);
      expect(decisionWithDeny.reasonCode).toBe('DENIED_EXPLICIT_DENY');

      // Após ADMIN revogar o ExplicitDenyRule, o grant ativo volta a permitir a ação
      await container.services.authorization.revokeExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        denyRule.id,
        { reason: 'Auditoria concluida sem pendencias' },
      );

      const memberRulesAfterRevoke = await container.services.authorization.listMyActiveAccessRules(
        DEMO_MEMBER_USER_ID,
        DEMO_ORG_ID,
      );
      expect(memberRulesAfterRevoke.explicitDenies).toHaveLength(0);

      const decisionAfterRevoke = evaluateAuthorization({
        actor: {
          isAuthenticated: true,
          userId: DEMO_MEMBER_USER_ID,
          organizationMembership: {
            organizationId: DEMO_ORG_ID,
            role: ORGANIZATION_ROLES.MEMBER,
            status: MEMBERSHIP_STATUSES.ACTIVE,
          },
          managedTeamIds: memberRulesAfterRevoke.managedTeamIds,
          memberTeamIds: memberRulesAfterRevoke.memberTeamIds,
          managedProjectIds: memberRulesAfterRevoke.managedProjectIds,
          participatedProjectIds: memberRulesAfterRevoke.participatedProjectIds,
          grants: memberRulesAfterRevoke.grants,
          explicitDenies: memberRulesAfterRevoke.explicitDenies,
        },
        action: PERMISSION_CODES.TASK_CREATE,
        resource: {
          kind: 'TASK',
          exists: true,
          organizationId: DEMO_ORG_ID,
          projectId: DEMO_PROJECT_ID,
        },
        context: { now: currentNow },
      });

      expect(decisionAfterRevoke.allowed).toBe(true);
    });
  });

  describe('listMyActiveAccessRules', () => {
    it('retorna apenas grants e explicitDenies ativos (excluindo expirados e revogados) junto com os escopos geridos e participados', async () => {
      // 1. Grant ativo
      const activeGrant = await container.services.authorization.grantPermission(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          granteeUserId: DEMO_MANAGER_USER_ID,
          permission: PERMISSION_CODES.TEAM_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
          reason: 'Grant ativo valido',
        },
      );

      // 2. Grant revogado
      const revokedGrant = await container.services.authorization.grantPermission(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          granteeUserId: DEMO_MANAGER_USER_ID,
          permission: PERMISSION_CODES.REPORT_EXPORT,
          scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
          reason: 'Grant que sera revogado',
        },
      );
      await container.services.authorization.revokePermissionGrant(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        revokedGrant.id,
      );

      // 3. Grant expirado (expira em 1 hora)
      await container.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
        granteeUserId: DEMO_MANAGER_USER_ID,
        permission: PERMISSION_CODES.DATA_EXPORT,
        scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
        expiresAt: asIsoDateTime('2026-06-10T11:00:00.000Z'),
        reason: 'Grant temporario de 1 hora',
      });

      // 4. ExplicitDenyRule ativa e outra expirada
      const activeDeny = await container.services.authorization.createExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          targetUserId: DEMO_MANAGER_USER_ID,
          permission: PERMISSION_CODES.PROJECT_DELETE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Negacao permanente de exclusao',
        },
      );

      await container.services.authorization.createExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          targetUserId: DEMO_MANAGER_USER_ID,
          permission: PERMISSION_CODES.BOARD_WIP_MANAGE,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          expiresAt: asIsoDateTime('2026-06-10T11:00:00.000Z'),
          reason: 'Negacao temporaria de 1 hora',
        },
      );

      // Avança o relógio para após a expiração dos itens de 1 hora
      currentNow = asIsoDateTime('2026-06-10T12:00:00.000Z');

      const managerRules = await container.services.authorization.listMyActiveAccessRules(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
      );

      expect(managerRules.grants.map((g) => g.id)).toEqual([activeGrant.id]);
      expect(managerRules.explicitDenies.map((d) => d.id)).toEqual([activeDeny.id]);
      expect(managerRules.managedTeamIds).toContain(DEMO_TEAM_ID);
      expect(managerRules.memberTeamIds).toContain(DEMO_TEAM_ID);
      expect(managerRules.managedProjectIds).toContain(DEMO_PROJECT_ID);
      expect(managerRules.participatedProjectIds).toContain(DEMO_PROJECT_ID);
    });
  });
});
