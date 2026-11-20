import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import {
  DEMO_CREDENTIALS_BY_ROLE,
  PASSWORD_VERIFIER_ALGORITHM,
  type RegisterUserInput,
} from '@/modules/authentication';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} from '@/shared/errors';
import {
  ORGANIZATION_ROLES,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { createLogger, createMemoryLogSink, type MemoryLogSink } from '@/shared/logging';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('AuthService & UserService Integration (IndexedDB + InMemoryEphemeralSessionPointer)', () => {
  let container: AppCompositionContainer;
  let logSink: MemoryLogSink;
  let ephemeralPointer: InMemoryEphemeralSessionPointer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-05-01T10:00:00.000Z');
    logSink = createMemoryLogSink();
    ephemeralPointer = new InMemoryEphemeralSessionPointer();

    container = createAppContainer({
      logger: createLogger({ minLevel: 'debug', sink: logSink }),
      ephemeralSessionPointer: ephemeralPointer,
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_auth_users_${crypto.randomUUID()}`,
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

  describe('registerUser', () => {
    it('cria User (sem senha na entidade), LocalCredential e UserSession retornando accessToken em memória e publica eventos pós-commit', async () => {
      const dispatchedEvents: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        dispatchedEvents.push(event);
      });

      const result = await container.services.auth.registerUser({
        email: '  Ana.Clara@Empresa.com.br  ',
        password: 'SenhaForte!2026',
        displayName: 'Ana Clara Souza',
        acceptTerms: true,
        persistent: true,
        deviceLabel: 'Notebook Trabalho',
      });

      expect(result.user.email).toBe('ana.clara@empresa.com.br');
      expect(result.user.displayName).toBe('Ana Clara Souza');
      expect(result.user.emailVerifiedSimulated).toBe(false);
      expect(result.user.acceptedTermsAt).toBe(currentNow);
      expect(result.accessToken).toMatch(/^pms_sim_/);
      expect(result.session.userId).toBe(result.user.id);
      expect(result.session.persistent).toBe(true);
      expect(result.session.deviceLabel).toBe('Notebook Trabalho');

      // Garante que a entidade User persistida jamais contém senha ou verificador de senha
      const storedUser = await container.repositories.users.users.findById(result.user.id);
      expect(storedUser).not.toBeNull();
      const rawUserRecord = await container.db.users.get(result.user.id);
      expect(rawUserRecord).toBeDefined();
      expect(Object.keys(rawUserRecord ?? {})).not.toContain('password');
      expect(Object.keys(rawUserRecord ?? {})).not.toContain('passwordHash');
      expect(Object.keys(rawUserRecord ?? {})).not.toContain('passwordVerifier');
      expect(JSON.stringify(rawUserRecord)).not.toContain('SenhaForte!2026');

      // Verifica LocalCredential desacoplada
      const storedCredential =
        await container.repositories.authentication.localCredentials.findByUserId(result.user.id);
      expect(storedCredential).not.toBeNull();
      expect(storedCredential?.email).toBe('ana.clara@empresa.com.br');
      expect(storedCredential?.algorithm).toBe(PASSWORD_VERIFIER_ALGORITHM);
      expect(storedCredential?.passwordVerifier).not.toBe('SenhaForte!2026');

      // Verifica UserSession persistida
      const storedSession = await container.repositories.authentication.userSessions.findById(
        result.session.id,
      );
      expect(storedSession).not.toBeNull();
      expect(storedSession?.userId).toBe(result.user.id);

      // Eventos pós-commit
      expect(dispatchedEvents.map((e) => e.eventType)).toEqual([
        'auth.user.registered',
        'auth.session.created',
      ]);
    });

    it('bloqueia cadastro duplicado com ConflictError e rejeita acceptTerms: false com ValidationError', async () => {
      await container.services.auth.registerUser({
        email: 'duplicado@pms.local',
        password: 'SenhaValida!2026',
        displayName: 'Primeiro Cadastro',
        acceptTerms: true,
      });

      await expect(
        container.services.auth.registerUser({
          email: 'DUPLICADO@pms.local',
          password: 'OutraSenha!2026',
          displayName: 'Segundo Cadastro',
          acceptTerms: true,
        }),
      ).rejects.toThrowError(ConflictError);

      const invalidTermsPayload = {
        email: 'semtermos@pms.local',
        password: 'SenhaValida!2026',
        displayName: 'Sem Termos',
        acceptTerms: false,
      } as unknown as RegisterUserInput;

      await expect(container.services.auth.registerUser(invalidTermsPayload)).rejects.toThrowError(
        ValidationError,
      );

      expect(
        await container.repositories.users.users.findByEmail('semtermos@pms.local'),
      ).toBeNull();
    });
  });

  describe('loginWithPassword', () => {
    it('valida credencial correta e rejeita senha incorreta com AuthenticationError sem vazar dados sensíveis em logs', async () => {
      const secretPassword = 'SuperSecretPassword!9876';
      const wrongPassword = 'WrongPasswordAttempt!0000';

      const registered = await container.services.auth.registerUser({
        email: 'login.teste@pms.local',
        password: secretPassword,
        displayName: 'Usuario Login',
        acceptTerms: true,
      });

      const loggedIn = await container.services.auth.loginWithPassword({
        email: 'LOGIN.TESTE@pms.local',
        password: secretPassword,
        persistent: true,
        deviceLabel: 'Chrome Desktop',
      });

      expect(loggedIn.user.id).toBe(registered.user.id);
      expect(loggedIn.session.id).not.toBe(registered.session.id);
      expect(loggedIn.accessToken).toMatch(/^pms_sim_/);

      await expect(
        container.services.auth.loginWithPassword({
          email: 'login.teste@pms.local',
          password: wrongPassword,
        }),
      ).rejects.toThrowError(AuthenticationError);

      await expect(
        container.services.auth.loginWithPassword({
          email: 'inexistente@pms.local',
          password: secretPassword,
        }),
      ).rejects.toThrowError(AuthenticationError);

      const serializedLogs = JSON.stringify(logSink.entries);
      expect(serializedLogs).not.toContain(secretPassword);
      expect(serializedLogs).not.toContain(wrongPassword);
      expect(serializedLogs).not.toContain(loggedIn.accessToken);
    });
  });

  describe('Sessões persistentes vs temporárias, restauração e revogação', () => {
    it('restaura sessão temporária via EphemeralSessionPointerPort e faz fallback para sessão persistente quando o ponteiro é limpo', async () => {
      const registered = await container.services.auth.registerUser({
        email: 'sessoes@pms.local',
        password: 'SenhaSessoes!2026',
        displayName: 'Usuario Sessoes',
        acceptTerms: true,
        persistent: true,
        deviceLabel: 'Dispositivo Persistente',
      });

      const persistentSessionId = registered.session.id;
      expect(ephemeralPointer.getSessionId()).toBeNull();

      // Cria uma sessão temporária (persistent: false) no mesmo usuário
      currentNow = asIsoDateTime('2026-05-01T10:05:00.000Z');
      const ephemeralLogin = await container.services.auth.loginWithPassword({
        email: 'sessoes@pms.local',
        password: 'SenhaSessoes!2026',
        persistent: false,
        deviceLabel: 'Aba Temporaria',
      });

      expect(ephemeralLogin.session.persistent).toBe(false);
      expect(ephemeralPointer.getSessionId()).toBe(ephemeralLogin.session.id);

      // Enquanto o ponteiro temporário está presente, restoreActiveSession prioriza a sessão temporária
      currentNow = asIsoDateTime('2026-05-01T10:10:00.000Z');
      const restoredEphemeral = await container.services.auth.restoreActiveSession();
      expect(restoredEphemeral).not.toBeNull();
      expect(restoredEphemeral?.session.id).toBe(ephemeralLogin.session.id);
      expect(restoredEphemeral?.session.persistent).toBe(false);
      expect(restoredEphemeral?.session.lastActivityAt).toBe(currentNow);

      // Simula fechamento de aba (limpeza do ponteiro efêmero): fallback para sessão persistente no IndexedDB
      ephemeralPointer.clear();
      currentNow = asIsoDateTime('2026-05-01T10:15:00.000Z');
      const restoredPersistent = await container.services.auth.restoreActiveSession();
      expect(restoredPersistent).not.toBeNull();
      expect(restoredPersistent?.session.id).toBe(persistentSessionId);
      expect(restoredPersistent?.session.persistent).toBe(true);
    });

    it('retorna null em restoreActiveSession após logoutCurrentSession, revokeSession (individual) e revokeAllSessions (global)', async () => {
      // 1. logoutCurrentSession
      const userA = await container.services.auth.registerUser({
        email: 'logout@pms.local',
        password: 'SenhaLogout!2026',
        displayName: 'Usuario Logout',
        acceptTerms: true,
        persistent: true,
      });

      await container.services.auth.logoutCurrentSession({
        actorUserId: userA.user.id,
        sessionId: userA.session.id,
      });
      expect(await container.services.auth.restoreActiveSession()).toBeNull();

      // 2. revokeSession (individual) e proteção contra revogação por terceiro
      const userB = await container.services.auth.registerUser({
        email: 'revoke.one@pms.local',
        password: 'SenhaRevoke!2026',
        displayName: 'Usuario Revoke One',
        acceptTerms: true,
        persistent: false,
      });

      await expect(
        container.services.auth.revokeSession({
          actorUserId: userA.user.id,
          sessionId: userB.session.id,
        }),
      ).rejects.toThrowError(AuthorizationError);

      await container.services.auth.revokeSession({
        actorUserId: userB.user.id,
        sessionId: userB.session.id,
        reason: 'SUSPECTED_DEVICE',
      });
      expect(ephemeralPointer.getSessionId()).toBeNull();
      expect(await container.services.auth.restoreActiveSession()).toBeNull();

      // 3. revokeAllSessions (global em múltiplas sessões)
      const firstSession = await container.services.auth.loginWithPassword({
        email: 'revoke.one@pms.local',
        password: 'SenhaRevoke!2026',
        persistent: true,
        deviceLabel: 'Desktop 1',
      });
      currentNow = asIsoDateTime('2026-05-01T11:00:00.000Z');
      await container.services.auth.loginWithPassword({
        email: 'revoke.one@pms.local',
        password: 'SenhaRevoke!2026',
        persistent: false,
        deviceLabel: 'Desktop 2',
      });

      const listedBefore = await container.services.auth.listUserSessions(firstSession.user.id);
      expect(listedBefore.length).toBeGreaterThanOrEqual(3);

      await container.services.auth.revokeAllSessions({
        actorUserId: firstSession.user.id,
        reason: 'GLOBAL_SIGN_OUT',
      });

      expect(ephemeralPointer.getSessionId()).toBeNull();
      expect(await container.services.auth.restoreActiveSession()).toBeNull();

      const listedAfter = await container.services.auth.listUserSessions(firstSession.user.id);
      expect(listedAfter.every((session) => session.revokedAt !== undefined)).toBe(true);
    });
  });

  describe('enterDemoProfile (ADMIN, MANAGER, MEMBER)', () => {
    it('dispara seed idempotente da organização demo, cria sessões para os 3 papéis e permite login manual posterior com DEMO_CREDENTIALS_BY_ROLE', async () => {
      const adminEntry = await container.services.auth.enterDemoProfile({
        role: ORGANIZATION_ROLES.ADMIN,
      });
      expect(adminEntry.seeded).toBe(true);
      expect(adminEntry.user.email).toBe(DEMO_CREDENTIALS_BY_ROLE.ADMIN.email);
      expect(adminEntry.session.userId).toBe(adminEntry.user.id);
      expect(adminEntry.accessToken).toMatch(/^pms_sim_/);

      const managerEntry = await container.services.auth.enterDemoProfile({
        role: ORGANIZATION_ROLES.MANAGER,
      });
      expect(managerEntry.seeded).toBe(false);
      expect(managerEntry.organizationId).toBe(adminEntry.organizationId);
      expect(managerEntry.user.email).toBe(DEMO_CREDENTIALS_BY_ROLE.MANAGER.email);

      const memberEntry = await container.services.auth.enterDemoProfile({
        role: ORGANIZATION_ROLES.MEMBER,
      });
      expect(memberEntry.seeded).toBe(false);
      expect(memberEntry.organizationId).toBe(adminEntry.organizationId);
      expect(memberEntry.user.email).toBe(DEMO_CREDENTIALS_BY_ROLE.MEMBER.email);

      // Login manual com todas as credenciais canônicas DEMO_CREDENTIALS_BY_ROLE
      for (const role of [
        ORGANIZATION_ROLES.ADMIN,
        ORGANIZATION_ROLES.MANAGER,
        ORGANIZATION_ROLES.MEMBER,
      ]) {
        const descriptor = DEMO_CREDENTIALS_BY_ROLE[role];
        const manualLogin = await container.services.auth.loginWithPassword({
          email: descriptor.email,
          password: descriptor.password,
        });
        expect(manualLogin.user.email).toBe(descriptor.email);
        expect(manualLogin.user.displayName).toBe(descriptor.displayName);
      }
    });
  });

  describe('simulatePasswordRecovery e simulateEmailVerification', () => {
    it('responde de forma não-enumerativa em simulatePasswordRecovery para e-mail existente e inexistente', async () => {
      const registered = await container.services.auth.registerUser({
        email: 'recovery@pms.local',
        password: 'SenhaRecovery!2026',
        displayName: 'Usuario Recovery',
        acceptTerms: true,
      });

      const events: DomainEventEnvelope[] = [];
      container.eventBus.subscribe((event) => {
        events.push(event);
      });

      const existingResponse = await container.services.auth.simulatePasswordRecovery({
        email: registered.user.email,
      });
      const unknownResponse = await container.services.auth.simulatePasswordRecovery({
        email: 'nao.existe@pms.local',
      });

      expect(existingResponse).toEqual(unknownResponse);
      expect(existingResponse.accepted).toBe(true);
      expect(existingResponse.simulatedNotice.length).toBeGreaterThan(0);

      // Apenas o usuário existente gera evento interno
      const recoveryEvents = events.filter(
        (event) => event.eventType === 'auth.password_recovery.simulated',
      );
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0]?.aggregateId).toBe(registered.user.id);
    });

    it('marca emailVerifiedSimulated como true de forma idempotente em simulateEmailVerification', async () => {
      const registered = await container.services.auth.registerUser({
        email: 'verify@pms.local',
        password: 'SenhaVerify!2026',
        displayName: 'Usuario Verify',
        acceptTerms: true,
      });
      expect(registered.user.emailVerifiedSimulated).toBe(false);

      const verified = await container.services.auth.simulateEmailVerification({
        actorUserId: registered.user.id,
      });
      expect(verified.emailVerifiedSimulated).toBe(true);

      const verifiedAgain = await container.services.auth.simulateEmailVerification({
        actorUserId: registered.user.id,
      });
      expect(verifiedAgain.emailVerifiedSimulated).toBe(true);
    });
  });

  describe('UserService (getMyProfile e updateMyProfile)', () => {
    it('lê e atualiza displayName e avatarUrl sem alterar papéis nem associações organizacionais', async () => {
      const registered = await container.services.auth.registerUser({
        email: 'perfil@pms.local',
        password: 'SenhaPerfil!2026',
        displayName: 'Nome Original',
        acceptTerms: true,
      });

      const createdOrg = await container.services.organizations.createOrganization(
        registered.user.id,
        {
          name: 'Org Perfil Teste',
          slug: 'org-perfil-teste',
        },
      );

      const profileBefore = await container.services.users.getMyProfile(registered.user.id);
      expect(profileBefore.displayName).toBe('Nome Original');
      expect(profileBefore.avatarUrl).toBeUndefined();

      currentNow = asIsoDateTime('2026-05-01T12:00:00.000Z');
      const updated = await container.services.users.updateMyProfile(registered.user.id, {
        displayName: 'Nome Atualizado',
        avatarUrl: 'https://cdn.pms.local/avatars/ana.png',
        activeOrganizationId: createdOrg.organization.id,
      });

      expect(updated.displayName).toBe('Nome Atualizado');
      expect(updated.avatarUrl).toBe('https://cdn.pms.local/avatars/ana.png');
      expect(updated.email).toBe('perfil@pms.local');

      // Remove avatarUrl com string vazia
      const clearedAvatar = await container.services.users.updateMyProfile(registered.user.id, {
        displayName: 'Nome Atualizado 2',
        avatarUrl: '',
      });
      expect(clearedAvatar.displayName).toBe('Nome Atualizado 2');
      expect(clearedAvatar.avatarUrl).toBeUndefined();

      // Papéis e associações permanecem intactos
      const memberships = await container.services.organizations.listMyOrganizations(
        registered.user.id,
      );
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.id).toBe(createdOrg.organization.id);
      expect(memberships[0]?.role).toBe(ORGANIZATION_ROLES.ADMIN);
      expect(memberships[0]?.status).toBe('ACTIVE');

      // Rejeita URL de avatar inválida (ex.: javascript:)
      await expect(
        container.services.users.updateMyProfile(registered.user.id, {
          displayName: 'Nome Atualizado 2',
          avatarUrl: 'javascript:alert(1)',
        }),
      ).rejects.toThrowError(ValidationError);
    });

    it('não grava AuditEvent em organização alheia quando activeOrganizationId não possui vínculo ACTIVE do ator', async () => {
      const owner = await container.services.auth.registerUser({
        email: 'owner.audit@pms.local',
        password: 'SenhaOwner!2026',
        displayName: 'Owner Org Alheia',
        acceptTerms: true,
      });
      const foreignOrg = await container.services.organizations.createOrganization(owner.user.id, {
        name: 'Org Alheia Isolada',
        slug: 'org-alheia-isolada',
      });

      const outsider = await container.services.auth.registerUser({
        email: 'outsider.audit@pms.local',
        password: 'SenhaOutsider!2026',
        displayName: 'Usuario Externo',
        acceptTerms: true,
      });

      const outsiderSecondSession = await container.services.auth.loginWithPassword({
        email: 'outsider.audit@pms.local',
        password: 'SenhaOutsider!2026',
        persistent: true,
        deviceLabel: 'Outro Dispositivo',
      });

      const auditBefore = await container.repositories.audit.auditEvents.listByOrganization(
        foreignOrg.organization.id,
        { page: 1, pageSize: 50 },
      );

      // 1. updateMyProfile passando activeOrganizationId alheia
      const updated = await container.services.users.updateMyProfile(outsider.user.id, {
        displayName: 'Usuario Externo Atualizado',
        activeOrganizationId: foreignOrg.organization.id,
      });
      expect(updated.displayName).toBe('Usuario Externo Atualizado');

      // 2. revokeSession passando activeOrganizationId alheia
      await container.services.auth.revokeSession({
        actorUserId: outsider.user.id,
        sessionId: outsiderSecondSession.session.id,
        activeOrganizationId: foreignOrg.organization.id,
      });

      // 3. revokeAllSessions passando activeOrganizationId alheia
      await container.services.auth.revokeAllSessions({
        actorUserId: outsider.user.id,
        activeOrganizationId: foreignOrg.organization.id,
      });

      const auditAfter = await container.repositories.audit.auditEvents.listByOrganization(
        foreignOrg.organization.id,
        { page: 1, pageSize: 50 },
      );

      expect(auditAfter.total).toBe(auditBefore.total);
      expect(auditAfter.items.some((event) => event.actorId === outsider.user.id)).toBe(false);
    });
  });
});
