import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_STATUSES } from '@/modules/projects';
import { AuthorizationError, ConflictError, NotFoundError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  asEntityId,
  asIsoDateTime,
  asProjectId,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('TeamService Integration (Scope Visibility, Lifecycle, Member Removal & Soft Delete)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-06-05T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_teams_${crypto.randomUUID()}`,
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
    const admin = await registerUser('admin.team@pms.local', 'Admin Equipes');
    const manager = await registerUser('manager.team@pms.local', 'Gestor Equipes');
    const member = await registerUser('member.team@pms.local', 'Membro Equipes');
    const outsider = await registerUser('outsider.team@pms.local', 'Fora da Org');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Equipes Corp',
        slug: 'equipes-corp',
      },
    );

    await container.repositories.organizations.organizationMembers.save({
      id: asOrganizationMemberId(crypto.randomUUID()),
      organizationId: organization.id,
      userId: manager.user.id,
      role: ORGANIZATION_ROLES.MANAGER,
      status: MEMBERSHIP_STATUSES.ACTIVE,
      joinedAt: currentNow,
      updatedAt: currentNow,
    });

    await container.repositories.organizations.organizationMembers.save({
      id: asOrganizationMemberId(crypto.randomUUID()),
      organizationId: organization.id,
      userId: member.user.id,
      role: ORGANIZATION_ROLES.MEMBER,
      status: MEMBERSHIP_STATUSES.ACTIVE,
      joinedAt: currentNow,
      updatedAt: currentNow,
    });

    return { admin, manager, member, outsider, organization };
  }

  describe('Escopo de listTeams por papel', () => {
    it('retorna todas as equipes para ADMIN, apenas as administradas para MANAGER e apenas as participadas para MEMBER', async () => {
      const { admin, manager, member, organization } = await setupOrgWithRoles();

      const teamA = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Equipe A (Gerida pelo Manager)',
        managerUserIds: [manager.user.id],
      });
      const teamB = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Equipe B (Participada pelo Member)',
      });
      const teamC = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Equipe C (Restrita ao Admin)',
      });

      await container.services.teams.addTeamMember(
        admin.user.id,
        organization.id,
        teamB.id,
        member.user.id,
      );

      const adminTeams = await container.services.teams.listTeams(admin.user.id, organization.id);
      expect(adminTeams.map((t) => t.id).sort()).toEqual([teamA.id, teamB.id, teamC.id].sort());

      const managerTeams = await container.services.teams.listTeams(
        manager.user.id,
        organization.id,
      );
      expect(managerTeams.map((t) => t.id)).toEqual([teamA.id]);

      const memberTeams = await container.services.teams.listTeams(member.user.id, organization.id);
      expect(memberTeams.map((t) => t.id)).toEqual([teamB.id]);
    });
  });

  describe('createTeam, updateTeam, archiveTeam, restoreTeam & addTeamMember', () => {
    it('permite ADMIN operar livremente, permite MANAGER criar apenas com concessão team.create (ficando em managerUserIds), bloqueia addTeamMember em equipe arquivada e rejeita usuário cross-org', async () => {
      const { admin, manager, member, outsider, organization } = await setupOrgWithRoles();

      // MANAGER sem concessão team.create recebe AuthorizationError
      await expect(
        container.services.teams.createTeam(manager.user.id, organization.id, {
          name: 'Equipe Bloqueada',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // ADMIN concede team.create no escopo ORGANIZATION para MANAGER
      await container.services.authorization.grantPermission(admin.user.id, organization.id, {
        granteeUserId: manager.user.id,
        permission: PERMISSION_CODES.TEAM_CREATE,
        scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
        reason: 'Autorizacao operacional para criacao de squads',
      });

      const managerCreatedTeam = await container.services.teams.createTeam(
        manager.user.id,
        organization.id,
        {
          name: 'Squad Produto',
          description: 'Criada pelo gestor com concessao',
        },
      );
      expect(managerCreatedTeam.managerUserIds).toContain(manager.user.id);

      // ADMIN atualiza equipe
      const updated = await container.services.teams.updateTeam(
        admin.user.id,
        organization.id,
        managerCreatedTeam.id,
        {
          name: 'Squad Produto Core',
          description: 'Atualizada pelo admin',
        },
      );
      expect(updated.name).toBe('Squad Produto Core');

      // Rejeita adicionar usuário fora da organização (zero cross-org!)
      await expect(
        container.services.teams.addTeamMember(
          admin.user.id,
          organization.id,
          managerCreatedTeam.id,
          outsider.user.id,
        ),
      ).rejects.toThrowError(NotFoundError);

      // Arquiva equipe e comprova que addTeamMember é bloqueado com ConflictError
      const archived = await container.services.teams.archiveTeam(
        admin.user.id,
        organization.id,
        managerCreatedTeam.id,
      );
      expect(archived.archivedAt).toBe(currentNow);

      await expect(
        container.services.teams.addTeamMember(
          admin.user.id,
          organization.id,
          managerCreatedTeam.id,
          member.user.id,
        ),
      ).rejects.toThrowError(ConflictError);

      // Restaura equipe e adiciona membro com sucesso
      const restored = await container.services.teams.restoreTeam(
        admin.user.id,
        organization.id,
        managerCreatedTeam.id,
      );
      expect(restored.archivedAt).toBeUndefined();

      const added = await container.services.teams.addTeamMember(
        admin.user.id,
        organization.id,
        managerCreatedTeam.id,
        member.user.id,
      );
      expect(added.userId).toBe(member.user.id);
    });
  });

  describe('removeTeamMember (Cenário 7 — permission-matrix.md §11)', () => {
    it('remove usuário da equipe e de managerUserIds, revoga automaticamente grants de escopo TEAM na mesma transação e preserva OrganizationMember ativo', async () => {
      const { admin, manager, organization } = await setupOrgWithRoles();

      const team = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Equipe Engenharia',
        managerUserIds: [manager.user.id],
      });

      // Concede uma permissão de escopo TEAM e outra de escopo ORGANIZATION para o manager
      const teamGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: manager.user.id,
          permission: PERMISSION_CODES.TEAM_ARCHIVE,
          scopeType: PERMISSION_SCOPE_TYPES.TEAM,
          scopeId: asEntityId(team.id),
          reason: 'Delegacao de arquivamento na equipe',
        },
      );

      const orgGrant = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: manager.user.id,
          permission: PERMISSION_CODES.TEAM_CREATE,
          scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
          reason: 'Grant organizacional que deve permanecer ativo',
        },
      );

      const removed = await container.services.teams.removeTeamMember(
        admin.user.id,
        organization.id,
        team.id,
        manager.user.id,
      );
      expect(removed.removedAt).toBe(currentNow);

      // Retirado de managerUserIds
      const teamAfter = await container.repositories.teams.teams.findById(organization.id, team.id);
      expect(teamAfter?.managerUserIds).not.toContain(manager.user.id);

      // Grant de escopo TEAM revogado automaticamente, grant de escopo ORGANIZATION preservado
      const activeGrantsAfter =
        await container.repositories.authorization.permissionGrants.listActiveByGrantee(
          organization.id,
          manager.user.id,
          currentNow,
        );
      expect(activeGrantsAfter.map((g) => g.id)).toEqual([orgGrant.id]);

      const revokedTeamGrant = await container.repositories.authorization.permissionGrants.findById(
        organization.id,
        teamGrant.id,
      );
      expect(revokedTeamGrant?.revokedAt).toBe(currentNow);

      // OrganizationMember preservado 100% ATIVO (PRD.md §7.3)
      const orgMemberAfter =
        await container.repositories.organizations.organizationMembers.findByOrganizationAndUser(
          organization.id,
          manager.user.id,
        );
      expect(orgMemberAfter?.status).toBe(MEMBERSHIP_STATUSES.ACTIVE);
      expect(orgMemberAfter?.role).toBe(ORGANIZATION_ROLES.MANAGER);
    });
  });

  describe('deleteTeam', () => {
    it('é exclusivo de ADMIN, bloqueia com ConflictError quando há projeto não-excluído vinculado e aplica soft-delete revogando todos os grants de escopo TEAM quando desimpedida', async () => {
      const { admin, manager, member, organization } = await setupOrgWithRoles();

      const team = await container.services.teams.createTeam(admin.user.id, organization.id, {
        name: 'Equipe Temporaria',
        managerUserIds: [manager.user.id],
      });
      await container.services.teams.addTeamMember(
        admin.user.id,
        organization.id,
        team.id,
        member.user.id,
      );

      const teamGrantForMember = await container.services.authorization.grantPermission(
        admin.user.id,
        organization.id,
        {
          granteeUserId: member.user.id,
          permission: PERMISSION_CODES.TEAM_UPDATE,
          scopeType: PERMISSION_SCOPE_TYPES.TEAM,
          scopeId: asEntityId(team.id),
          reason: 'Grant de escopo TEAM a ser revogado no deleteTeam',
        },
      );

      // MANAGER não pode excluir equipe
      await expect(
        container.services.teams.deleteTeam(manager.user.id, organization.id, team.id),
      ).rejects.toThrowError(AuthorizationError);

      // Vincula projeto ativo à equipe -> deleteTeam bloqueado com ConflictError
      const linkedProjectId = asProjectId(crypto.randomUUID());
      await container.repositories.projects.projects.save({
        id: linkedProjectId,
        organizationId: organization.id,
        teamId: team.id,
        name: 'Projeto Vinculado',
        status: PROJECT_STATUSES.ACTIVE,
        ownerUserId: manager.user.id,
        inactivityThresholdDays: 7,
        createdByUserId: admin.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
      });

      await expect(
        container.services.teams.deleteTeam(admin.user.id, organization.id, team.id),
      ).rejects.toThrowError(ConflictError);

      // Aplica soft-delete no projeto -> equipe fica desimpedida
      await container.repositories.projects.projects.save({
        id: linkedProjectId,
        organizationId: organization.id,
        teamId: team.id,
        name: 'Projeto Vinculado',
        status: PROJECT_STATUSES.ACTIVE,
        ownerUserId: manager.user.id,
        inactivityThresholdDays: 7,
        createdByUserId: admin.user.id,
        createdAt: currentNow,
        updatedAt: currentNow,
        deletedAt: currentNow,
        deletedBy: admin.user.id,
      });

      const deletedTeam = await container.services.teams.deleteTeam(
        admin.user.id,
        organization.id,
        team.id,
        { reason: 'Encerramento do squad' },
      );

      expect(deletedTeam.deletedAt).toBe(currentNow);
      expect(deletedTeam.deletedBy).toBe(admin.user.id);
      expect(deletedTeam.deletionReason).toBe('Encerramento do squad');

      // Todos os grants de escopo TEAM foram revogados via revokeAllByScope
      const grantAfter = await container.repositories.authorization.permissionGrants.findById(
        organization.id,
        teamGrantForMember.id,
      );
      expect(grantAfter?.revokedAt).toBe(currentNow);

      // Todos os TeamMember ativos da equipe recebem removedAt === currentNow
      const managerTeamMemberAfter =
        await container.repositories.teams.teamMembers.findByTeamAndUser(
          organization.id,
          team.id,
          manager.user.id,
        );
      expect(managerTeamMemberAfter?.removedAt).toBe(currentNow);

      const memberTeamMemberAfter =
        await container.repositories.teams.teamMembers.findByTeamAndUser(
          organization.id,
          team.id,
          member.user.id,
        );
      expect(memberTeamMemberAfter?.removedAt).toBe(currentNow);

      // listMyActiveAccessRules do gestor e do membro não retornam mais a equipe removida
      const [managerRulesAfter, memberRulesAfter] = await Promise.all([
        container.services.authorization.listMyActiveAccessRules(manager.user.id, organization.id),
        container.services.authorization.listMyActiveAccessRules(member.user.id, organization.id),
      ]);
      expect(managerRulesAfter.managedTeamIds).not.toContain(team.id);
      expect(managerRulesAfter.memberTeamIds).not.toContain(team.id);
      expect(memberRulesAfter.managedTeamIds).not.toContain(team.id);
      expect(memberRulesAfter.memberTeamIds).not.toContain(team.id);
    });
  });
});
