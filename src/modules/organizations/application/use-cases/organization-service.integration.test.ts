import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import {
  GRANT_STATUSES,
  PERMISSION_CODES,
  PERMISSION_SCOPE_TYPES,
  type PermissionGrant,
} from '@/modules/authorization';
import { asOrganizationMemberId } from '@/modules/organizations';
import { AuthorizationError, ConflictError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  asGrantId,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('OrganizationService Integration (Multi-Org Isolation, RBAC & Last-Admin Guard)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-05-02T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_org_service_${crypto.randomUUID()}`,
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

  async function registerTestUser(email: string, displayName: string) {
    return container.services.auth.registerUser({
      email,
      password: 'PasswordForte!2026',
      displayName,
      acceptTerms: true,
      persistent: true,
    });
  }

  describe('createOrganization & listMyOrganizations', () => {
    it('cria atomicamente Organization + OrganizationMember (ADMIN) + OrganizationSettings padrão + AuditEvent, publica evento pós-commit e rejeita slug duplicado com ConflictError', async () => {
      const creator = await registerTestUser('admin.creator@pms.local', 'Admin Criador');
      const dispatchedEvents: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        dispatchedEvents.push(event);
      });

      const created = await container.services.organizations.createOrganization(creator.user.id, {
        name: 'Acme Engenharia',
        slug: 'acme-engenharia',
        description: 'Workspace principal de engenharia',
      });

      expect(created.organization.name).toBe('Acme Engenharia');
      expect(created.organization.slug).toBe('acme-engenharia');
      expect(created.organization.isDemo).toBe(false);
      expect(created.membership.role).toBe(ORGANIZATION_ROLES.ADMIN);
      expect(created.membership.status).toBe(MEMBERSHIP_STATUSES.ACTIVE);
      expect(created.settings.organizationId).toBe(created.organization.id);

      // Verifica persistência atômica no IndexedDB
      const persistedOrg = await container.repositories.organizations.organizations.findById(
        created.organization.id,
      );
      expect(persistedOrg?.slug).toBe('acme-engenharia');

      const persistedMember =
        await container.repositories.organizations.organizationMembers.findByOrganizationAndUser(
          created.organization.id,
          creator.user.id,
        );
      expect(persistedMember?.role).toBe(ORGANIZATION_ROLES.ADMIN);

      const persistedSettings =
        await container.repositories.settings.organizationSettings.findByOrganization(
          created.organization.id,
        );
      expect(persistedSettings).not.toBeNull();

      const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
        created.organization.id,
        { page: 1, pageSize: 10 },
      );
      expect(auditPage.items.some((event) => event.eventType === 'organization.created')).toBe(
        true,
      );

      expect(dispatchedEvents.some((event) => event.eventType === 'organization.created')).toBe(
        true,
      );

      // Rejeita slug duplicado (case-insensitive)
      await expect(
        container.services.organizations.createOrganization(creator.user.id, {
          name: 'Outra Acme',
          slug: 'ACME-ENGENHARIA',
        }),
      ).rejects.toThrowError(ConflictError);
    });

    it('retorna em listMyOrganizations apenas a projeção mínima das organizações com associação ACTIVE do próprio usuário', async () => {
      const userA = await registerTestUser('user.a@pms.local', 'Usuario A');
      const userB = await registerTestUser('user.b@pms.local', 'Usuario B');

      const org1 = await container.services.organizations.createOrganization(userA.user.id, {
        name: 'Beta Corp',
        slug: 'beta-corp',
      });
      const org2 = await container.services.organizations.createOrganization(userA.user.id, {
        name: 'Alpha Corp',
        slug: 'alpha-corp',
      });
      // Organização exclusiva de userB
      const orgB = await container.services.organizations.createOrganization(userB.user.id, {
        name: 'Gamma Privada',
        slug: 'gamma-privada',
      });

      // Adiciona userA como SUSPENDED em orgB — não pode aparecer em listMyOrganizations
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: orgB.organization.id,
        userId: userA.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.SUSPENDED,
        joinedAt: currentNow,
        suspendedAt: currentNow,
        updatedAt: currentNow,
      });

      const listA = await container.services.organizations.listMyOrganizations(userA.user.id);
      expect(listA).toHaveLength(2);
      expect(listA.map((item) => item.name)).toEqual(['Alpha Corp', 'Beta Corp']);
      expect(listA.map((item) => item.id)).toEqual([org2.organization.id, org1.organization.id]);

      // Garante projeção mínima (sem vazar descrição interna nem metadados administrativos)
      for (const summary of listA) {
        expect(Object.keys(summary).sort()).toEqual([
          'id',
          'isDemo',
          'name',
          'role',
          'slug',
          'status',
        ]);
      }

      const listB = await container.services.organizations.listMyOrganizations(userB.user.id);
      expect(listB).toHaveLength(1);
      expect(listB[0]?.id).toBe(orgB.organization.id);
    });
  });

  describe('getOrganizationDetails & updateOrganization', () => {
    it('permite ADMIN ler e atualizar gravando AuditEvent, enquanto bloqueia MEMBER e usuário de outra organização com AuthorizationError', async () => {
      const admin = await registerTestUser('admin.details@pms.local', 'Admin Details');
      const member = await registerTestUser('member.details@pms.local', 'Member Details');
      const outsider = await registerTestUser('outsider.details@pms.local', 'Outsider Details');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Delta Systems',
          slug: 'delta-systems',
          description: 'Descricao inicial',
        },
      );

      // Adiciona member como MEMBER ativo
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: member.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });

      // ADMIN lê e atualiza
      const details = await container.services.organizations.getOrganizationDetails(
        admin.user.id,
        organization.id,
      );
      expect(details.name).toBe('Delta Systems');

      const updated = await container.services.organizations.updateOrganization(
        admin.user.id,
        organization.id,
        {
          name: 'Delta Systems Atualizada',
          description: 'Nova descricao',
        },
      );
      expect(updated.name).toBe('Delta Systems Atualizada');
      expect(updated.description).toBe('Nova descricao');

      const auditEvents = await container.repositories.audit.auditEvents.listByOrganization(
        organization.id,
        { page: 1, pageSize: 20 },
      );
      expect(auditEvents.items.some((event) => event.eventType === 'organization.updated')).toBe(
        true,
      );

      // MEMBER bloqueado em getOrganizationDetails e updateOrganization
      await expect(
        container.services.organizations.getOrganizationDetails(member.user.id, organization.id),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.organizations.updateOrganization(member.user.id, organization.id, {
          name: 'Tentativa Member',
        }),
      ).rejects.toThrowError(AuthorizationError);

      // Usuário de outra organização bloqueado (isolamento multi-org)
      await expect(
        container.services.organizations.getOrganizationDetails(outsider.user.id, organization.id),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.organizations.updateOrganization(outsider.user.id, organization.id, {
          name: 'Tentativa Outsider',
        }),
      ).rejects.toThrowError(AuthorizationError);
    });
  });

  describe('listOrganizationMembers, changeMemberRole e suspendOrReactivateMember', () => {
    it('permite ADMIN listar, promover/rebaixar e suspender/reativar membros, bloqueia MEMBER com AuthorizationError e protege último ADMIN ativo com ConflictError', async () => {
      const admin = await registerTestUser('admin.members@pms.local', 'Admin Members');
      const member = await registerTestUser('member.members@pms.local', 'Member Target');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Epsilon Lab',
          slug: 'epsilon-lab',
        },
      );

      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: member.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });

      // ADMIN lista membros com detalhes de usuário
      const listed = await container.services.organizations.listOrganizationMembers(
        admin.user.id,
        organization.id,
      );
      expect(listed).toHaveLength(2);
      expect(listed.map((m) => m.email).sort()).toEqual([
        'admin.members@pms.local',
        'member.members@pms.local',
      ]);

      // MEMBER não tem permissão para listar, alterar papel nem suspender
      await expect(
        container.services.organizations.listOrganizationMembers(member.user.id, organization.id),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.organizations.changeMemberRole(
          member.user.id,
          organization.id,
          member.user.id,
          ORGANIZATION_ROLES.ADMIN,
        ),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.organizations.suspendOrReactivateMember(
          member.user.id,
          organization.id,
          admin.user.id,
          MEMBERSHIP_STATUSES.SUSPENDED,
        ),
      ).rejects.toThrowError(AuthorizationError);

      // Tentativa de rebaixar ou suspender o ÚLTIMO ADMIN ativo falha com ConflictError
      await expect(
        container.services.organizations.changeMemberRole(
          admin.user.id,
          organization.id,
          admin.user.id,
          ORGANIZATION_ROLES.MANAGER,
        ),
      ).rejects.toThrowError(ConflictError);

      await expect(
        container.services.organizations.suspendOrReactivateMember(
          admin.user.id,
          organization.id,
          admin.user.id,
          MEMBERSHIP_STATUSES.SUSPENDED,
        ),
      ).rejects.toThrowError(ConflictError);

      // ADMIN promove member para MANAGER e depois ADMIN
      const promotedManager = await container.services.organizations.changeMemberRole(
        admin.user.id,
        organization.id,
        member.user.id,
        ORGANIZATION_ROLES.MANAGER,
      );
      expect(promotedManager.role).toBe(ORGANIZATION_ROLES.MANAGER);

      const promotedAdmin = await container.services.organizations.changeMemberRole(
        admin.user.id,
        organization.id,
        member.user.id,
        ORGANIZATION_ROLES.ADMIN,
      );
      expect(promotedAdmin.role).toBe(ORGANIZATION_ROLES.ADMIN);

      // Agora com 2 ADMINs ativos, é permitido rebaixar member de volta para MEMBER
      const demoted = await container.services.organizations.changeMemberRole(
        admin.user.id,
        organization.id,
        member.user.id,
        ORGANIZATION_ROLES.MEMBER,
      );
      expect(demoted.role).toBe(ORGANIZATION_ROLES.MEMBER);

      // ADMIN suspende e reativa member
      const suspended = await container.services.organizations.suspendOrReactivateMember(
        admin.user.id,
        organization.id,
        member.user.id,
        MEMBERSHIP_STATUSES.SUSPENDED,
      );
      expect(suspended.status).toBe(MEMBERSHIP_STATUSES.SUSPENDED);
      expect(suspended.suspendedAt).toBe(currentNow);

      const reactivated = await container.services.organizations.suspendOrReactivateMember(
        admin.user.id,
        organization.id,
        member.user.id,
        MEMBERSHIP_STATUSES.ACTIVE,
      );
      expect(reactivated.status).toBe(MEMBERSHIP_STATUSES.ACTIVE);
      expect(reactivated.suspendedAt).toBeUndefined();
    });
  });

  describe('leaveOrganization', () => {
    it('permite MEMBER sair revogando grants naquela org sem encerrar a sessão global, e impede último ADMIN ativo de sair com ConflictError', async () => {
      const admin = await registerTestUser('admin.leave@pms.local', 'Admin Leave');
      const member = await registerTestUser('member.leave@pms.local', 'Member Leave');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Zeta Corp',
          slug: 'zeta-corp',
        },
      );

      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: member.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });

      // Concede um PermissionGrant ativo ao member na organização
      const grant: PermissionGrant = {
        id: asGrantId(crypto.randomUUID()),
        organizationId: organization.id,
        granteeUserId: member.user.id,
        permission: PERMISSION_CODES.PROJECT_CREATE,
        scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
        grantedByUserId: admin.user.id,
        grantedByRole: ORGANIZATION_ROLES.ADMIN,
        grantedAt: currentNow,
        reason: 'Concessao temporaria para teste de saida',
        status: GRANT_STATUSES.ACTIVE,
      };
      await container.repositories.authorization.permissionGrants.save(grant);

      // Último ADMIN ativo é impedido de sair com ConflictError
      await expect(
        container.services.organizations.leaveOrganization(admin.user.id, organization.id),
      ).rejects.toThrowError(ConflictError);

      // MEMBER sai com sucesso
      const leftMembership = await container.services.organizations.leaveOrganization(
        member.user.id,
        organization.id,
      );
      expect(leftMembership.status).toBe(MEMBERSHIP_STATUSES.REMOVED);
      expect(leftMembership.removedAt).toBe(currentNow);

      // Grants ativos naquela organização foram revogados
      const activeGrantsAfter =
        await container.repositories.authorization.permissionGrants.listActiveByGrantee(
          organization.id,
          member.user.id,
          currentNow,
        );
      expect(activeGrantsAfter).toHaveLength(0);

      // Organização não aparece mais em listMyOrganizations do member
      const memberOrgsAfter = await container.services.organizations.listMyOrganizations(
        member.user.id,
      );
      expect(memberOrgsAfter).toHaveLength(0);

      // Sessão global do member permanece 100% ATIVA (PRD.md §5)!
      const memberSessionAfter = await container.repositories.authentication.userSessions.findById(
        member.session.id,
      );
      expect(memberSessionAfter).not.toBeNull();
      expect(memberSessionAfter?.revokedAt).toBeUndefined();

      // Se houver um segundo ADMIN ativo, o primeiro ADMIN pode sair com sucesso
      const secondAdmin = await registerTestUser('second.admin@pms.local', 'Segundo Admin');
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: secondAdmin.user.id,
        role: ORGANIZATION_ROLES.ADMIN,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });

      const adminLeft = await container.services.organizations.leaveOrganization(
        admin.user.id,
        organization.id,
      );
      expect(adminLeft.status).toBe(MEMBERSHIP_STATUSES.REMOVED);
    });
  });
});
