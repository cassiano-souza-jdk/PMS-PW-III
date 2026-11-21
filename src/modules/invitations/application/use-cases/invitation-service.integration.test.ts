import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import {
  DEFAULT_INVITATION_EXPIRY_DAYS,
  INVITATION_ERROR_REASONS,
  INVITATION_STATUSES,
} from '@/modules/invitations';
import { asOrganizationMemberId } from '@/modules/organizations';
import { AuthorizationError, ConflictError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  asIsoDateTime,
  parseIsoDateTimeMs,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('InvitationService Integration (Nominal Invitations, RBAC & Membership State Guards)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-06-01T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_invitations_${crypto.randomUUID()}`,
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

  describe('createInvitation', () => {
    it('permite ADMIN criar convite com validade padrão 15 dias ou configurável, código + link simulado e AuditEvent, bloqueando MANAGER e MEMBER com AuthorizationError', async () => {
      const admin = await registerUser('admin.inv@pms.local', 'Admin Convites');
      const manager = await registerUser('manager.inv@pms.local', 'Manager Convites');
      const member = await registerUser('member.inv@pms.local', 'Member Convites');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Orquestra Tech',
          slug: 'orquestra-tech',
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

      const dispatchedEvents: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        dispatchedEvents.push(event);
      });

      // Validade padrão (15 dias) e papel padrão (MEMBER)
      const defaultInvite = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        {
          email: '  Convidado.Padrao@Empresa.com.br ',
        },
      );

      expect(defaultInvite.invitation.email).toBe('convidado.padrao@empresa.com.br');
      expect(defaultInvite.invitation.initialRole).toBe(ORGANIZATION_ROLES.MEMBER);
      expect(defaultInvite.invitation.status).toBe(INVITATION_STATUSES.PENDING);
      expect(defaultInvite.invitation.code).toMatch(/^PMS-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
      expect(defaultInvite.inviteLink).toBe(
        `/invitations/accept?code=${encodeURIComponent(defaultInvite.invitation.code)}`,
      );
      expect(
        parseIsoDateTimeMs(defaultInvite.invitation.expiresAt) -
          parseIsoDateTimeMs(defaultInvite.invitation.createdAt),
      ).toBe(DEFAULT_INVITATION_EXPIRY_DAYS * MS_PER_DAY);

      // Validade configurável (7 dias) e papel MANAGER
      const customInvite = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        {
          email: 'gestor.novo@empresa.com.br',
          expiresInDays: 7,
          initialRole: ORGANIZATION_ROLES.MANAGER,
        },
      );
      expect(customInvite.invitation.initialRole).toBe(ORGANIZATION_ROLES.MANAGER);
      expect(
        parseIsoDateTimeMs(customInvite.invitation.expiresAt) -
          parseIsoDateTimeMs(customInvite.invitation.createdAt),
      ).toBe(7 * MS_PER_DAY);

      // AuditEvent gravado e evento pós-commit publicado
      const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
        organization.id,
        { page: 1, pageSize: 20 },
      );
      expect(
        auditPage.items.filter((event) => event.eventType === 'invitation.created'),
      ).toHaveLength(2);
      expect(
        dispatchedEvents.filter((event) => event.eventType === 'invitation.created'),
      ).toHaveLength(2);

      // MANAGER e MEMBER recebem AuthorizationError
      await expect(
        container.services.invitations.createInvitation(manager.user.id, organization.id, {
          email: 'tentativa.manager@pms.local',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        container.services.invitations.createInvitation(member.user.id, organization.id, {
          email: 'tentativa.member@pms.local',
        }),
      ).rejects.toThrowError(AuthorizationError);
    });
  });

  describe('previewInvitationByCode', () => {
    it('retorna projeção mínima segura com emailMatchesActor true/false sem vazar lista de membros nem e-mail do convite', async () => {
      const admin = await registerUser('admin.preview@pms.local', 'Admin Preview');
      const invitedUser = await registerUser('alvo.preview@pms.local', 'Alvo Preview');
      const otherUser = await registerUser('outro.preview@pms.local', 'Outro Preview');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Preview Corp',
          slug: 'preview-corp',
        },
      );

      const { invitation } = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        {
          email: invitedUser.user.email,
        },
      );

      const matchingPreview = await container.services.invitations.previewInvitationByCode(
        invitedUser.user.id,
        invitation.code,
      );
      expect(matchingPreview).toEqual({
        code: invitation.code,
        organizationName: 'Preview Corp',
        organizationSlug: 'preview-corp',
        status: INVITATION_STATUSES.PENDING,
        initialRole: ORGANIZATION_ROLES.MEMBER,
        expiresAt: invitation.expiresAt,
        emailMatchesActor: true,
      });

      const nonMatchingPreview = await container.services.invitations.previewInvitationByCode(
        otherUser.user.id,
        invitation.code,
      );
      expect(nonMatchingPreview.emailMatchesActor).toBe(false);
      expect(nonMatchingPreview.organizationName).toBe('Preview Corp');
      expect(Object.keys(nonMatchingPreview).sort()).toEqual([
        'code',
        'emailMatchesActor',
        'expiresAt',
        'initialRole',
        'organizationName',
        'organizationSlug',
        'status',
      ]);
    });
  });

  describe('acceptInvitation (nominal e proteção de vínculos pré-existentes)', () => {
    it('bloqueia e-mail divergente (AuthorizationError), membro ACTIVE (ConflictError), membro SUSPENDED (AuthorizationError), aceita usuário válido criando MEMBER + AuditEvent e impede reuso (ConflictError)', async () => {
      const admin = await registerUser('admin.accept@pms.local', 'Admin Accept');
      const target = await registerUser('convidado.real@pms.local', 'Convidado Real');
      const wrongUser = await registerUser('intruso@pms.local', 'Intruso');
      const activeMember = await registerUser('ja.ativo@pms.local', 'Ja Ativo');
      const suspendedMember = await registerUser('suspenso@pms.local', 'Suspenso');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Seguranca Org',
          slug: 'seguranca-org',
        },
      );

      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: activeMember.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });

      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: suspendedMember.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.SUSPENDED,
        joinedAt: currentNow,
        suspendedAt: currentNow,
        updatedAt: currentNow,
      });

      const targetInvite = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: target.user.email },
      );

      // 1. Usuário com e-mail divergente recebe AuthorizationError com reason EMAIL_MISMATCH
      const emailMismatchError = await container.services.invitations
        .acceptInvitation(wrongUser.user.id, targetInvite.invitation.code)
        .catch((error: unknown) => error);
      expect(emailMismatchError).toBeInstanceOf(AuthorizationError);
      expect((emailMismatchError as AuthorizationError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.EMAIL_MISMATCH,
      );

      // 2. Membro já ACTIVE recebe ConflictError com reason MEMBER_ALREADY_ACTIVE
      const activeInvite = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: activeMember.user.email },
      );
      const alreadyActiveError = await container.services.invitations
        .acceptInvitation(activeMember.user.id, activeInvite.invitation.code)
        .catch((error: unknown) => error);
      expect(alreadyActiveError).toBeInstanceOf(ConflictError);
      expect((alreadyActiveError as ConflictError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.MEMBER_ALREADY_ACTIVE,
      );

      // 3. Membro SUSPENDED recebe AuthorizationError com reason MEMBER_SUSPENDED (jamais contorna suspensão!)
      const suspendedInvite = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: suspendedMember.user.email },
      );
      const suspendedError = await container.services.invitations
        .acceptInvitation(suspendedMember.user.id, suspendedInvite.invitation.code)
        .catch((error: unknown) => error);
      expect(suspendedError).toBeInstanceOf(AuthorizationError);
      expect((suspendedError as AuthorizationError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.MEMBER_SUSPENDED,
      );

      const suspendedStillSuspended =
        await container.repositories.organizations.organizationMembers.findByOrganizationAndUser(
          organization.id,
          suspendedMember.user.id,
        );
      expect(suspendedStillSuspended?.status).toBe(MEMBERSHIP_STATUSES.SUSPENDED);

      // 4. Usuário válido aceita criando OrganizationMember 'MEMBER' + AuditEvent
      const accepted = await container.services.invitations.acceptInvitation(
        target.user.id,
        targetInvite.invitation.code,
      );
      expect(accepted.invitation.status).toBe(INVITATION_STATUSES.ACCEPTED);
      expect(accepted.invitation.acceptedByUserId).toBe(target.user.id);
      expect(accepted.membership.role).toBe(ORGANIZATION_ROLES.MEMBER);
      expect(accepted.membership.status).toBe(MEMBERSHIP_STATUSES.ACTIVE);
      expect(accepted.organization.id).toBe(organization.id);

      const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
        organization.id,
        { page: 1, pageSize: 20 },
      );
      expect(auditPage.items.some((event) => event.eventType === 'invitation.accepted')).toBe(true);

      // 5. Tentativa de reuso do mesmo convite falha com ConflictError:
      // enquanto o usuário permanece ACTIVE, retorna MEMBER_ALREADY_ACTIVE; após sair da org (REMOVED), retorna INVITATION_NOT_PENDING
      const reuseWhileActiveError = await container.services.invitations
        .acceptInvitation(target.user.id, targetInvite.invitation.code)
        .catch((error: unknown) => error);
      expect(reuseWhileActiveError).toBeInstanceOf(ConflictError);
      expect((reuseWhileActiveError as ConflictError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.MEMBER_ALREADY_ACTIVE,
      );

      await container.services.organizations.leaveOrganization(target.user.id, organization.id);

      const reuseAfterLeaveError = await container.services.invitations
        .acceptInvitation(target.user.id, targetInvite.invitation.code)
        .catch((error: unknown) => error);
      expect(reuseAfterLeaveError).toBeInstanceOf(ConflictError);
      expect((reuseAfterLeaveError as ConflictError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.INVITATION_NOT_PENDING,
      );
    });
  });

  describe('revokeInvitation e expiração', () => {
    it('permite ADMIN revogar convite pendente e impede aceite de convite revogado ou expirado com ConflictError', async () => {
      const admin = await registerUser('admin.revoke@pms.local', 'Admin Revoke');
      const userRevoked = await registerUser('revogado@pms.local', 'Usuario Revogado');
      const userExpired = await registerUser('expirado@pms.local', 'Usuario Expirado');

      const { organization } = await container.services.organizations.createOrganization(
        admin.user.id,
        {
          name: 'Revoke Org',
          slug: 'revoke-org',
        },
      );

      const inviteToRevoke = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: userRevoked.user.email },
      );

      const revoked = await container.services.invitations.revokeInvitation(
        admin.user.id,
        organization.id,
        inviteToRevoke.invitation.id,
      );
      expect(revoked.status).toBe(INVITATION_STATUSES.REVOKED);
      expect(revoked.revokedByUserId).toBe(admin.user.id);

      const revokedAcceptError = await container.services.invitations
        .acceptInvitation(userRevoked.user.id, inviteToRevoke.invitation.code)
        .catch((error: unknown) => error);
      expect(revokedAcceptError).toBeInstanceOf(ConflictError);
      expect((revokedAcceptError as ConflictError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.INVITATION_NOT_PENDING,
      );

      // Convite com validade de 1 dia que expira após avançar o relógio
      const shortInvite = await container.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        {
          email: userExpired.user.email,
          expiresInDays: 1,
        },
      );

      currentNow = asIsoDateTime('2026-06-03T10:00:00.000Z');

      const expiredPreview = await container.services.invitations.previewInvitationByCode(
        userExpired.user.id,
        shortInvite.invitation.code,
      );
      expect(expiredPreview.status).toBe(INVITATION_STATUSES.EXPIRED);

      const expiredAcceptError = await container.services.invitations
        .acceptInvitation(userExpired.user.id, shortInvite.invitation.code)
        .catch((error: unknown) => error);
      expect(expiredAcceptError).toBeInstanceOf(ConflictError);
      expect((expiredAcceptError as ConflictError).details?.['reason']).toBe(
        INVITATION_ERROR_REASONS.INVITATION_NOT_PENDING,
      );
    });
  });
});
