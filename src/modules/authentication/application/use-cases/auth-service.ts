import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import { normalizeEmail, type User, type UserRepositoryPort } from '@/modules/users';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors';
import {
  ORGANIZATION_ROLES,
  SYSTEM_ACTOR_ID,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEventId,
  asIsoDateTime,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  parseIsoDateTimeMs,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationRole,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import { DEMO_CREDENTIALS_BY_ROLE, type LocalCredential } from '../../domain/local-credential';
import {
  asSessionId,
  assertSessionValid,
  isSessionActiveAt,
  type SessionId,
  type UserSession,
} from '../../domain/user-session';
import type { EphemeralSessionPointerPort } from '../ports/ephemeral-session-pointer.port';
import type { LocalCredentialRepositoryPort } from '../ports/local-credential-repository.port';
import type { PasswordVerifierPort } from '../ports/password-verifier.port';
import type { UserSessionRepositoryPort } from '../ports/user-session-repository.port';

const PERSISTENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EPHEMERAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_DEVICE_LABEL = 'Navegador Local (PMS)';

const registerUserInputSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
  displayName: z.string().trim().min(2).max(120),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Terms of use must be accepted to create an account.' }),
  }),
  persistent: z.boolean().optional().default(true),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
  correlationId: z.string().uuid().optional(),
});

const loginWithPasswordInputSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
  persistent: z.boolean().optional().default(true),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
  correlationId: z.string().uuid().optional(),
});

const enterDemoProfileInputSchema = z.object({
  role: z.enum([ORGANIZATION_ROLES.ADMIN, ORGANIZATION_ROLES.MANAGER, ORGANIZATION_ROLES.MEMBER]),
  persistent: z.boolean().optional().default(true),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
  correlationId: z.string().uuid().optional(),
});

const simulatePasswordRecoveryInputSchema = z.object({
  email: z.string().trim().min(3).max(254),
  correlationId: z.string().uuid().optional(),
});

export interface DemoSeedHookResult {
  readonly seeded: boolean;
  readonly organizationId: OrganizationId;
  readonly seedVersion: string;
}

export interface AuthServiceDependencies {
  readonly users: UserRepositoryPort;
  readonly localCredentials: LocalCredentialRepositoryPort;
  readonly userSessions: UserSessionRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly passwordVerifier: PasswordVerifierPort;
  readonly ephemeralSessionPointer: EphemeralSessionPointerPort;
  readonly seedDemoOrganization: (now?: IsoDateTime) => Promise<DemoSeedHookResult>;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface RegisterUserInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly acceptTerms: true;
  readonly persistent?: boolean;
  readonly deviceLabel?: string;
  readonly correlationId?: CorrelationId;
}

export interface LoginWithPasswordInput {
  readonly email: string;
  readonly password: string;
  readonly persistent?: boolean;
  readonly deviceLabel?: string;
  readonly correlationId?: CorrelationId;
}

export interface EnterDemoProfileInput {
  readonly role: OrganizationRole;
  readonly persistent?: boolean;
  readonly deviceLabel?: string;
  readonly correlationId?: CorrelationId;
}

export interface LogoutCurrentSessionInput {
  readonly actorUserId: UserId;
  readonly sessionId: SessionId;
  readonly activeOrganizationId?: OrganizationId;
  readonly correlationId?: CorrelationId;
}

export interface RevokeSessionInput {
  readonly actorUserId: UserId;
  readonly sessionId: SessionId;
  readonly reason?: string;
  readonly activeOrganizationId?: OrganizationId;
  readonly correlationId?: CorrelationId;
}

export interface RevokeAllSessionsInput {
  readonly actorUserId: UserId;
  readonly reason?: string;
  readonly activeOrganizationId?: OrganizationId;
  readonly correlationId?: CorrelationId;
}

export interface SimulatePasswordRecoveryInput {
  readonly email: string;
  readonly correlationId?: CorrelationId;
}

export interface SimulateEmailVerificationInput {
  readonly actorUserId: UserId;
  readonly correlationId?: CorrelationId;
}

export interface AuthSessionResult {
  readonly user: User;
  readonly session: UserSession;
  readonly accessToken: string;
}

export interface EnterDemoProfileResult extends AuthSessionResult {
  readonly organizationId: OrganizationId;
  readonly seeded: boolean;
}

export interface SimulatePasswordRecoveryResult {
  readonly accepted: true;
  readonly simulatedNotice: string;
}

function defaultNowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

function defaultUuidGenerator(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

function parseWithZod<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  input: unknown,
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid authentication input payload.', {
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

function addMilliseconds(iso: IsoDateTime, deltaMs: number): IsoDateTime {
  return asIsoDateTime(new Date(parseIsoDateTimeMs(iso) + deltaMs).toISOString());
}

function createSimulatedAccessToken(nextUuid: () => string): string {
  return `pms_sim_${nextUuid()}`;
}

export class AuthService {
  private readonly deps: AuthServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: AuthServiceDependencies) {
    this.deps = deps;
    this.now = deps.now ?? defaultNowIso;
    this.nextUuid = deps.generateUuid ?? defaultUuidGenerator;
  }

  private resolveCorrelationId(candidate?: string): CorrelationId {
    if (candidate && isUuid(candidate)) {
      return asCorrelationId(candidate);
    }
    return asCorrelationId(this.nextUuid());
  }

  private buildSession(
    userId: UserId,
    persistent: boolean,
    now: IsoDateTime,
    deviceLabel?: string,
  ): UserSession {
    const ttlMs = persistent ? PERSISTENT_SESSION_TTL_MS : EPHEMERAL_SESSION_TTL_MS;
    return {
      id: asSessionId(this.nextUuid()),
      userId,
      deviceLabel: deviceLabel?.trim() || DEFAULT_DEVICE_LABEL,
      persistent,
      createdAt: now,
      expiresAt: addMilliseconds(now, ttlMs),
      lastActivityAt: now,
    };
  }

  private syncEphemeralPointer(session: UserSession): void {
    if (!session.persistent) {
      this.deps.ephemeralSessionPointer.setSessionId(session.id);
    } else {
      this.deps.ephemeralSessionPointer.clear();
    }
  }

  async registerUser(input: RegisterUserInput): Promise<AuthSessionResult> {
    const parsed = parseWithZod(registerUserInputSchema, input);
    const normalizedEmail = normalizeEmail(parsed.email, 'email');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const existingBeforeTx = await this.deps.users.findByEmail(normalizedEmail);
    if (existingBeforeTx !== null) {
      throw new ConflictError('An account with this email address already exists.', {
        details: { field: 'email' },
      });
    }

    // CRITICAL (ADR-0008 §2.4): Password hashing MUST execute OUTSIDE TransactionPort.run
    const hashed = await this.deps.passwordVerifier.hashPassword(parsed.password);

    const userId = asUserId(this.nextUuid());
    const user: User = {
      id: userId,
      email: normalizedEmail,
      displayName: parsed.displayName,
      acceptedTermsAt: now,
      emailVerifiedSimulated: false,
      createdAt: now,
      updatedAt: now,
    };

    const credential: LocalCredential = {
      userId,
      email: normalizedEmail,
      passwordVerifier: hashed.passwordVerifier,
      salt: hashed.salt,
      algorithm: hashed.algorithm,
      updatedAt: now,
    };

    const session = this.buildSession(userId, parsed.persistent, now, parsed.deviceLabel);

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.USERS,
        TRANSACTION_RESOURCES.LOCAL_CREDENTIALS,
        TRANSACTION_RESOURCES.USER_SESSIONS,
      ],
      async () => {
        const existingInsideTx = await this.deps.users.findByEmail(normalizedEmail);
        if (existingInsideTx !== null) {
          throw new ConflictError('An account with this email address already exists.', {
            details: { field: 'email' },
          });
        }

        await this.deps.users.save(user);
        await this.deps.localCredentials.save(credential);
        await this.deps.userSessions.save(session);

        await this.deps.eventBus.publishMany([
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'auth.user.registered',
            occurredAt: now,
            actorId: userId,
            correlationId,
            aggregateType: 'User',
            aggregateId: userId,
            payload: {
              userId,
              emailVerifiedSimulated: false,
            },
          }),
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'auth.session.created',
            occurredAt: now,
            actorId: userId,
            correlationId,
            aggregateType: 'UserSession',
            aggregateId: session.id,
            payload: {
              sessionId: session.id,
              persistent: session.persistent,
              deviceLabel: session.deviceLabel,
            },
          }),
        ]);
      },
    );

    this.syncEphemeralPointer(session);
    this.deps.logger?.info('User registered locally.', {
      userId,
      sessionId: session.id,
      correlationId,
    });

    return Object.freeze({
      user,
      session,
      accessToken: createSimulatedAccessToken(this.nextUuid),
    });
  }

  async loginWithPassword(input: LoginWithPasswordInput): Promise<AuthSessionResult> {
    const parsed = parseWithZod(loginWithPasswordInputSchema, input);
    const normalizedEmail = normalizeEmail(parsed.email, 'email');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [user, credential] = await Promise.all([
      this.deps.users.findByEmail(normalizedEmail),
      this.deps.localCredentials.findByEmail(normalizedEmail),
    ]);

    if (!user || isSoftDeleted(user) || !credential || credential.userId !== user.id) {
      throw new AuthenticationError('Invalid email or password.');
    }

    // CRITICAL (ADR-0008 §2.4): Password verification MUST execute OUTSIDE TransactionPort.run
    const isPasswordValid = await this.deps.passwordVerifier.verifyPassword(
      parsed.password,
      credential,
    );
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid email or password.');
    }

    const session = this.buildSession(user.id, parsed.persistent, now, parsed.deviceLabel);

    await this.deps.transactionPort.run([TRANSACTION_RESOURCES.USER_SESSIONS], async () => {
      await this.deps.userSessions.save(session);
      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'auth.session.created',
          occurredAt: now,
          actorId: user.id,
          correlationId,
          aggregateType: 'UserSession',
          aggregateId: session.id,
          payload: {
            sessionId: session.id,
            persistent: session.persistent,
            deviceLabel: session.deviceLabel,
          },
        }),
      );
    });

    this.syncEphemeralPointer(session);
    this.deps.logger?.info('User authenticated locally.', {
      userId: user.id,
      sessionId: session.id,
      persistent: session.persistent,
      correlationId,
    });

    return Object.freeze({
      user,
      session,
      accessToken: createSimulatedAccessToken(this.nextUuid),
    });
  }

  async enterDemoProfile(input: EnterDemoProfileInput): Promise<EnterDemoProfileResult> {
    const parsed = parseWithZod(enterDemoProfileInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const seedResult = await this.deps.seedDemoOrganization(now);
    const descriptor = DEMO_CREDENTIALS_BY_ROLE[parsed.role];
    const demoUser = await this.deps.users.findByEmail(descriptor.email);

    if (!demoUser || isSoftDeleted(demoUser)) {
      throw new NotFoundError(`Demo user profile for role "${parsed.role}" was not found.`, {
        details: { role: parsed.role },
      });
    }

    const session = this.buildSession(
      demoUser.id,
      parsed.persistent,
      now,
      parsed.deviceLabel ?? `Ambiente Demonstrativo (${parsed.role})`,
    );

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.USER_SESSIONS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.userSessions.save(session);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: seedResult.organizationId,
          actorId: demoUser.id,
          occurredAt: now,
          category: AUDIT_CATEGORIES.AUTH,
          eventType: 'auth.demo.entered',
          resourceType: 'UserSession',
          resourceId: session.id,
          after: {
            role: parsed.role,
            persistent: session.persistent,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'auth.demo.entered',
            occurredAt: now,
            organizationId: seedResult.organizationId,
            actorId: demoUser.id,
            correlationId,
            aggregateType: 'UserSession',
            aggregateId: session.id,
            payload: {
              sessionId: session.id,
              role: parsed.role,
              isDemo: true,
            },
          }),
        );
      },
    );

    this.syncEphemeralPointer(session);
    this.deps.logger?.info('Demo profile session started.', {
      userId: demoUser.id,
      role: parsed.role,
      sessionId: session.id,
      correlationId,
    });

    return Object.freeze({
      user: demoUser,
      session,
      accessToken: createSimulatedAccessToken(this.nextUuid),
      organizationId: seedResult.organizationId,
      seeded: seedResult.seeded,
    });
  }

  async restoreActiveSession(): Promise<AuthSessionResult | null> {
    const now = this.now();
    let candidateSession: UserSession | null = null;

    const ephemeralSessionId = this.deps.ephemeralSessionPointer.getSessionId();
    if (ephemeralSessionId !== null) {
      const ephemeralSession = await this.deps.userSessions.findById(ephemeralSessionId);
      if (ephemeralSession && isSessionActiveAt(ephemeralSession, now)) {
        candidateSession = ephemeralSession;
      } else {
        this.deps.ephemeralSessionPointer.clear();
      }
    }

    if (candidateSession === null) {
      candidateSession = await this.deps.userSessions.findLatestActivePersistent(now);
    }

    if (candidateSession === null) {
      return null;
    }

    try {
      assertSessionValid(candidateSession, now);
    } catch {
      if (!candidateSession.persistent) {
        this.deps.ephemeralSessionPointer.clear();
      }
      return null;
    }

    const user = await this.deps.users.findById(candidateSession.userId);
    if (!user || isSoftDeleted(user)) {
      if (!candidateSession.persistent) {
        this.deps.ephemeralSessionPointer.clear();
      }
      return null;
    }

    const refreshedSession: UserSession = {
      ...candidateSession,
      lastActivityAt: now,
    };

    await this.deps.transactionPort.run([TRANSACTION_RESOURCES.USER_SESSIONS], async () => {
      await this.deps.userSessions.save(refreshedSession);
    });

    return Object.freeze({
      user,
      session: refreshedSession,
      accessToken: createSimulatedAccessToken(this.nextUuid),
    });
  }

  async logoutCurrentSession(input: LogoutCurrentSessionInput): Promise<void> {
    await this.revokeSession({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      reason: 'USER_LOGOUT',
      ...(input.activeOrganizationId !== undefined
        ? { activeOrganizationId: input.activeOrganizationId }
        : {}),
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    });
  }

  async listUserSessions(actorUserId: UserId): Promise<readonly UserSession[]> {
    const validatedUserId = asUserId(actorUserId, 'actorUserId');
    return this.deps.userSessions.listByUserId(validatedUserId);
  }

  async revokeSession(input: RevokeSessionInput): Promise<void> {
    const actorUserId = asUserId(input.actorUserId, 'actorUserId');
    const sessionId = asSessionId(input.sessionId, 'sessionId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(input.correlationId);
    const reason = input.reason?.trim() || 'USER_REVOKED';

    const existing = await this.deps.userSessions.findById(sessionId);
    if (!existing) {
      throw new NotFoundError(`UserSession "${sessionId}" was not found.`, {
        details: { sessionId },
      });
    }

    if (existing.userId !== actorUserId) {
      throw new AuthorizationError('Actors can only revoke their own sessions.', {
        details: { sessionId },
      });
    }

    const resources =
      input.activeOrganizationId !== undefined
        ? ([TRANSACTION_RESOURCES.USER_SESSIONS, TRANSACTION_RESOURCES.AUDIT_EVENTS] as const)
        : ([TRANSACTION_RESOURCES.USER_SESSIONS] as const);

    await this.deps.transactionPort.run(resources, async () => {
      await this.deps.userSessions.revokeById(sessionId, now, reason);

      if (input.activeOrganizationId !== undefined) {
        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: input.activeOrganizationId,
          actorId: actorUserId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.AUTH,
          eventType: 'auth.session.revoked',
          resourceType: 'UserSession',
          resourceId: sessionId,
          after: {
            revokedAt: now,
            reason,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);
      }

      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'auth.session.revoked',
          occurredAt: now,
          ...(input.activeOrganizationId !== undefined
            ? { organizationId: input.activeOrganizationId }
            : {}),
          actorId: actorUserId,
          correlationId,
          aggregateType: 'UserSession',
          aggregateId: sessionId,
          payload: {
            sessionId,
            reason,
          },
        }),
      );
    });

    if (this.deps.ephemeralSessionPointer.getSessionId() === sessionId) {
      this.deps.ephemeralSessionPointer.clear();
    }
  }

  async revokeAllSessions(input: RevokeAllSessionsInput): Promise<void> {
    const actorUserId = asUserId(input.actorUserId, 'actorUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(input.correlationId);
    const reason = input.reason?.trim() || 'REVOKE_ALL_SESSIONS';

    const resources =
      input.activeOrganizationId !== undefined
        ? ([TRANSACTION_RESOURCES.USER_SESSIONS, TRANSACTION_RESOURCES.AUDIT_EVENTS] as const)
        : ([TRANSACTION_RESOURCES.USER_SESSIONS] as const);

    await this.deps.transactionPort.run(resources, async () => {
      await this.deps.userSessions.revokeAllByUserId(actorUserId, now, reason);

      if (input.activeOrganizationId !== undefined) {
        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: input.activeOrganizationId,
          actorId: actorUserId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.AUTH,
          eventType: 'auth.sessions.revoked_all',
          resourceType: 'User',
          resourceId: actorUserId,
          after: {
            revokedAt: now,
            reason,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);
      }

      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'auth.sessions.revoked_all',
          occurredAt: now,
          ...(input.activeOrganizationId !== undefined
            ? { organizationId: input.activeOrganizationId }
            : {}),
          actorId: actorUserId,
          correlationId,
          aggregateType: 'User',
          aggregateId: actorUserId,
          payload: {
            reason,
          },
        }),
      );
    });

    this.deps.ephemeralSessionPointer.clear();
  }

  async simulatePasswordRecovery(
    input: SimulatePasswordRecoveryInput,
  ): Promise<SimulatePasswordRecoveryResult> {
    const parsed = parseWithZod(simulatePasswordRecoveryInputSchema, input);
    const normalizedEmail = normalizeEmail(parsed.email, 'email');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const existingUser = await this.deps.users.findByEmail(normalizedEmail);

    if (existingUser && !isSoftDeleted(existingUser)) {
      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'auth.password_recovery.simulated',
          occurredAt: now,
          actorId: SYSTEM_ACTOR_ID,
          correlationId,
          aggregateType: 'User',
          aggregateId: existingUser.id,
          payload: {
            simulated: true,
          },
        }),
      );
    }

    // Non-enumerating response: never disclose whether the email exists
    return Object.freeze({
      accepted: true,
      simulatedNotice:
        'If an account matches this email, simulated local password recovery instructions have been recorded.',
    });
  }

  async simulateEmailVerification(input: SimulateEmailVerificationInput): Promise<User> {
    const actorUserId = asUserId(input.actorUserId, 'actorUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(input.correlationId);

    const existingUser = await this.deps.users.findById(actorUserId);
    if (!existingUser || isSoftDeleted(existingUser)) {
      throw new NotFoundError(`User "${actorUserId}" was not found.`, {
        details: { userId: actorUserId },
      });
    }

    if (existingUser.emailVerifiedSimulated) {
      return existingUser;
    }

    const verifiedUser: User = {
      ...existingUser,
      emailVerifiedSimulated: true,
      updatedAt: now,
    };

    await this.deps.transactionPort.run([TRANSACTION_RESOURCES.USERS], async () => {
      await this.deps.users.save(verifiedUser);
      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'auth.email.verified_simulated',
          occurredAt: now,
          actorId: actorUserId,
          correlationId,
          aggregateType: 'User',
          aggregateId: actorUserId,
          payload: {
            emailVerifiedSimulated: true,
          },
        }),
      );
    });

    return verifiedUser;
  }
}
