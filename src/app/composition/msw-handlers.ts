import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { AUDIT_CATEGORIES, AUDIT_RESULTS, type AuditEvent } from '@/modules/audit';
import {
  AuthService,
  asSessionId,
  type EnterDemoProfileInput,
  type LoginWithPasswordInput,
  type RegisterUserInput,
} from '@/modules/authentication';
import { WebCryptoSimulatedPasswordVerifier } from '@/modules/authentication/infrastructure/security/web-crypto-password-verifier';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import {
  AuthorizationManagementService,
  PERMISSION_CODES,
  asDenyRuleId,
  assertAuthorized,
  type AuthorizationActor,
  type AuthorizationResource,
  type CreateExplicitDenyRuleInput,
  type GrantPermissionInput,
  type PermissionCode,
} from '@/modules/authorization';
import { DEMO_SEED_VERSION } from '@/modules/demo';
import {
  InvitationService,
  asInvitationId,
  type CreateInvitationInput,
} from '@/modules/invitations';
import {
  OrganizationService,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from '@/modules/organizations';
import {
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  asProjectMemberId,
  type Project,
} from '@/modules/projects';
import { TeamService, type CreateTeamInput, type UpdateTeamInput } from '@/modules/teams';
import { UserService, type UpdateMyProfileInput } from '@/modules/users';
import {
  AuthenticationError,
  ValidationError,
  isAppError,
  normalizeError,
  type AppErrorCode,
} from '@/shared/errors';
import {
  HTTP_HEADERS,
  appErrorCodeToHttpStatus,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type SimulationScenarioController,
} from '@/shared/http';
import {
  MEMBERSHIP_STATUSES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asGrantId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTeamId,
  asUserId,
  createDomainEvent,
  isUuid,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationRole,
  type ProjectId,
  type TeamId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, PMS_SCHEMA_VERSION } from '@/shared/persistence';
import {
  createAuthorizationAuditWriterAdapter,
  createAuthorizationContextLookupAdapter,
} from './authorization-ports-adapter';
import type { AppServicesRegistry } from './container';
import {
  DEMO_ORG_ID,
  ensureDemoOrganizationSeeded,
  type DemoOrganizationSeedResult,
} from './demo-seed';
import type { AppRepositoriesRegistry } from './repositories-registry';

export interface MswCompositionDependencies {
  readonly repositories: AppRepositoriesRegistry;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly simulationController: SimulationScenarioController;
  readonly services?: AppServicesRegistry;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface HealthEndpointResponse {
  readonly status: 'ok';
  readonly databaseName: string;
  readonly schemaVersion: number;
  readonly demoSeedVersion: string;
  readonly demoOrganizationSeeded: boolean;
}

export interface CreateProjectRequestPayload {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly teamId?: string;
  readonly ownerUserId?: string;
  readonly inactivityThresholdDays?: number;
}

function defaultNowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

function defaultUuidGenerator(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

function resolveCorrelationId(request: Request, generateUuid: () => string): string {
  const headerValue = request.headers.get(HTTP_HEADERS.CORRELATION_ID)?.trim();
  if (headerValue && isUuid(headerValue)) {
    return headerValue;
  }

  return generateUuid();
}

function buildSuccessResponse<TData>(
  data: TData,
  correlationId: string,
  timestamp: IsoDateTime,
  status = 200,
): Response {
  const envelope: ApiSuccessEnvelope<TData> = {
    data,
    meta: {
      correlationId,
      timestamp,
    },
  };

  return HttpResponse.json(envelope, {
    status,
    headers: {
      [HTTP_HEADERS.CORRELATION_ID]: correlationId,
    },
  });
}

function buildErrorResponse(
  code: AppErrorCode,
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
  explicitStatus?: number,
): Response {
  const status = explicitStatus ?? appErrorCodeToHttpStatus(code);
  const envelope: ApiErrorEnvelope = {
    error: {
      code,
      message,
      correlationId,
      ...(details !== undefined ? { details } : {}),
    },
  };

  return HttpResponse.json(envelope, {
    status,
    headers: {
      [HTTP_HEADERS.CORRELATION_ID]: correlationId,
    },
  });
}

async function resolveAuthorizationActor(
  deps: MswCompositionDependencies,
  request: Request,
  targetOrganizationId: OrganizationId,
  now: IsoDateTime,
): Promise<{ readonly actor: AuthorizationActor; readonly userId: UserId }> {
  const rawActorId = request.headers.get(HTTP_HEADERS.ACTOR_USER_ID)?.trim();
  if (!rawActorId) {
    throw new AuthenticationError(
      'Missing required x-actor-user-id header for authenticated endpoint.',
    );
  }

  const userId = asUserId(rawActorId, 'x-actor-user-id');

  const [membership, projectMemberships, orgTeams, grants, explicitDenies] = await Promise.all([
    deps.repositories.organizations.organizationMembers.findByOrganizationAndUser(
      targetOrganizationId,
      userId,
    ),
    deps.repositories.projects.projectMembers.listByUser(targetOrganizationId, userId),
    deps.repositories.teams.teams.listByOrganization(targetOrganizationId, {
      includeArchived: true,
      includeDeleted: true,
    }),
    deps.repositories.authorization.permissionGrants.listActiveByGrantee(
      targetOrganizationId,
      userId,
      now,
    ),
    deps.repositories.authorization.explicitDenyRules.listActiveByTargetUser(
      targetOrganizationId,
      userId,
      now,
    ),
  ]);

  const activeProjectMemberships = projectMemberships.filter((pm) => pm.removedAt === undefined);
  const managedProjectIds: ProjectId[] = activeProjectMemberships
    .filter((pm) => pm.projectRole === PROJECT_MEMBER_ROLES.MANAGER)
    .map((pm) => pm.projectId);
  const participatedProjectIds: ProjectId[] = activeProjectMemberships.map((pm) => pm.projectId);

  const managedTeamIds: TeamId[] = orgTeams
    .filter((team) => team.managerUserIds.includes(userId))
    .map((team) => team.id);

  const actor: AuthorizationActor = {
    isAuthenticated: true,
    userId,
    ...(membership !== null
      ? {
          organizationMembership: {
            organizationId: membership.organizationId,
            role: membership.role,
            status: membership.status,
          },
        }
      : {}),
    managedProjectIds,
    participatedProjectIds,
    managedTeamIds,
    grants,
    explicitDenies,
  };

  return { actor, userId };
}

async function authorizeOrThrow(
  deps: MswCompositionDependencies,
  request: Request,
  organizationId: OrganizationId,
  action: PermissionCode,
  resource: AuthorizationResource,
  now: IsoDateTime,
): Promise<{ readonly actor: AuthorizationActor; readonly userId: UserId }> {
  const { actor, userId } = await resolveAuthorizationActor(deps, request, organizationId, now);

  assertAuthorized({
    actor,
    action,
    resource,
    context: { now },
  });

  return { actor, userId };
}

/**
 * Wraps an MSW endpoint handler with:
 * - `x-correlation-id` extraction/generation;
 * - `SimulationScenarioController` latency and deterministic fault injection;
 * - Canonical `AppError -> HTTP Status + ApiErrorEnvelope` translation.
 */
function withSimulatedEndpoint(
  deps: MswCompositionDependencies,
  handler: (context: {
    readonly request: Request;
    readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly correlationId: string;
    readonly now: IsoDateTime;
    readonly nextUuid: () => string;
  }) => Promise<Response>,
) {
  return async ({
    request,
    params,
  }: {
    readonly request: Request;
    readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
  }): Promise<Response> => {
    const nextUuid = deps.generateUuid ?? defaultUuidGenerator;
    const nowFn = deps.now ?? defaultNowIso;
    const correlationId = resolveCorrelationId(request, nextUuid);
    const now = nowFn();

    const scenario = deps.simulationController.matchRule(request.method, request.url);

    if (scenario.latencyMs > 0) {
      await delay(scenario.latencyMs);
    }

    if (scenario.networkError) {
      return HttpResponse.error();
    }

    if (scenario.forcedError !== undefined) {
      return buildErrorResponse(
        scenario.forcedError.code,
        scenario.forcedError.message,
        correlationId,
        { simulatedFault: true },
        scenario.forcedError.status,
      );
    }

    try {
      return await handler({
        request,
        params,
        correlationId,
        now,
        nextUuid,
      });
    } catch (error: unknown) {
      const normalized = isAppError(error) ? error : normalizeError(error, correlationId);

      return buildErrorResponse(
        normalized.code,
        normalized.message,
        normalized.correlationId ?? correlationId,
        normalized.details,
      );
    }
  };
}

function resolveMswServices(deps: MswCompositionDependencies): AppServicesRegistry {
  if (deps.services !== undefined) {
    return deps.services;
  }

  const passwordVerifier = new WebCryptoSimulatedPasswordVerifier();
  const ephemeralSessionPointer = new InMemoryEphemeralSessionPointer();
  const isActiveOrganizationMember = async (
    organizationId: OrganizationId,
    actorUserId: UserId,
  ): Promise<boolean> => {
    const member =
      await deps.repositories.organizations.organizationMembers.findByOrganizationAndUser(
        organizationId,
        actorUserId,
      );
    return member !== null && member.status === MEMBERSHIP_STATUSES.ACTIVE;
  };

  return Object.freeze({
    auth: new AuthService({
      users: deps.repositories.users.users,
      localCredentials: deps.repositories.authentication.localCredentials,
      userSessions: deps.repositories.authentication.userSessions,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      passwordVerifier,
      ephemeralSessionPointer,
      seedDemoOrganization: (now) =>
        ensureDemoOrganizationSeeded(
          {
            repositories: deps.repositories,
            transactionPort: deps.transactionPort,
            eventBus: deps.eventBus,
            passwordVerifier,
          },
          now,
        ),
      isActiveOrganizationMember,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    users: new UserService({
      users: deps.repositories.users.users,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      isActiveOrganizationMember,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    organizations: new OrganizationService({
      organizations: deps.repositories.organizations.organizations,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      users: deps.repositories.users.users,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    invitations: new InvitationService({
      invitations: deps.repositories.invitations.invitations,
      organizations: deps.repositories.organizations.organizations,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      users: deps.repositories.users.users,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    teams: new TeamService({
      teams: deps.repositories.teams.teams,
      teamMembers: deps.repositories.teams.teamMembers,
      projects: deps.repositories.projects.projects,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      users: deps.repositories.users.users,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    authorization: new AuthorizationManagementService({
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      contextLookup: createAuthorizationContextLookupAdapter(deps.repositories),
      auditWriter: createAuthorizationAuditWriterAdapter(deps.repositories, deps.generateUuid),
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
  });
}

function requireActorUserId(request: Request): UserId {
  const rawActorId = request.headers.get(HTTP_HEADERS.ACTOR_USER_ID)?.trim();
  if (!rawActorId) {
    throw new AuthenticationError(
      'Missing required x-actor-user-id header for authenticated endpoint.',
    );
  }

  return asUserId(rawActorId, 'x-actor-user-id');
}

function resolveOptionalOrganizationHeader(request: Request): OrganizationId | undefined {
  const rawOrgId = request.headers.get(HTTP_HEADERS.ORGANIZATION_ID)?.trim();
  if (!rawOrgId) {
    return undefined;
  }
  return asOrganizationId(rawOrgId, 'x-organization-id');
}

/**
 * Creates the canonical MSW v2 HTTP handlers backed by Dexie repositories and RBAC+ABAC policy engine
 * (API-SIMULATION.md, ADR-0003, ADR-0007 §5.2, ADR-0008).
 *
 * Invariant: write endpoints ALWAYS await Dexie transaction commit before returning an HTTP success response.
 */
export function createMswHandlers(deps: MswCompositionDependencies): readonly HttpHandler[] {
  const services = resolveMswServices(deps);

  return [
    http.get(
      '*/api/v1/health',
      withSimulatedEndpoint(deps, async ({ correlationId, now }) => {
        const demoOrg = await deps.repositories.organizations.organizations.findById(DEMO_ORG_ID);

        const payload: HealthEndpointResponse = {
          status: 'ok',
          databaseName: PMS_DATABASE_NAME,
          schemaVersion: PMS_SCHEMA_VERSION,
          demoSeedVersion: DEMO_SEED_VERSION,
          demoOrganizationSeeded: demoOrg !== null,
        };

        return buildSuccessResponse(payload, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/demo/seed',
      withSimulatedEndpoint(deps, async ({ correlationId, now }) => {
        const result: DemoOrganizationSeedResult = await ensureDemoOrganizationSeeded(
          {
            repositories: deps.repositories,
            transactionPort: deps.transactionPort,
            eventBus: deps.eventBus,
          },
          now,
        );

        return buildSuccessResponse(result, correlationId, now, result.seeded ? 201 : 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 04 — Authentication & Device Sessions (delegating strictly to AuthService)
    // -------------------------------------------------------------------------
    http.post(
      '*/api/v1/auth/register',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const rawBody = (await request.json().catch(() => null)) as RegisterUserInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for registration.');
        }

        const result = await services.auth.registerUser({
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(result, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/auth/login',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const rawBody = (await request.json().catch(() => null)) as LoginWithPasswordInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for login.');
        }

        const result = await services.auth.loginWithPassword({
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/auth/demo',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const rawBody = (await request.json().catch(() => null)) as EnterDemoProfileInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for demo profile entry.');
        }

        const result = await services.auth.enterDemoProfile({
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/auth/logout',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const activeOrganizationId = resolveOptionalOrganizationHeader(request);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly sessionId?: string;
        } | null;

        if (!rawBody || typeof rawBody.sessionId !== 'string') {
          throw new ValidationError('Field "sessionId" is required to logout.');
        }

        await services.auth.logoutCurrentSession({
          actorUserId,
          sessionId: asSessionId(rawBody.sessionId, 'sessionId'),
          ...(activeOrganizationId !== undefined ? { activeOrganizationId } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse({ loggedOut: true }, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/auth/sessions',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const sessions = await services.auth.listUserSessions(actorUserId);
        return buildSuccessResponse(sessions, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/auth/sessions/:sessionId/revoke',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const activeOrganizationId = resolveOptionalOrganizationHeader(request);
        const sessionId = asSessionId(String(params.sessionId ?? ''), 'sessionId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        await services.auth.revokeSession({
          actorUserId,
          sessionId,
          ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
          ...(activeOrganizationId !== undefined ? { activeOrganizationId } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse({ revoked: true, sessionId }, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 04 — Current User Profile (delegating strictly to UserService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/users/me',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const profile = await services.users.getMyProfile(actorUserId);
        return buildSuccessResponse(profile, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/users/me',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const activeOrganizationId = resolveOptionalOrganizationHeader(request);
        const rawBody = (await request.json().catch(() => null)) as UpdateMyProfileInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for profile update.');
        }

        const updated = await services.users.updateMyProfile(actorUserId, {
          ...rawBody,
          ...(activeOrganizationId !== undefined ? { activeOrganizationId } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 04 — Organizations & Memberships (delegating strictly to OrganizationService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const summaries = await services.organizations.listMyOrganizations(actorUserId);
        return buildSuccessResponse(summaries, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const rawBody = (await request.json().catch(() => null)) as CreateOrganizationInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for organization creation.');
        }

        const created = await services.organizations.createOrganization(actorUserId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const organization = await services.organizations.getOrganizationDetails(
          actorUserId,
          organizationId,
        );

        return buildSuccessResponse(organization, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as UpdateOrganizationInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for organization update.');
        }

        const updated = await services.organizations.updateOrganization(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/members',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const members = await services.organizations.listOrganizationMembers(
          actorUserId,
          organizationId,
        );

        return buildSuccessResponse(members, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/members/:userId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const targetUserId = asUserId(String(params.userId ?? ''), 'userId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly role?: OrganizationRole;
          readonly status?: 'ACTIVE' | 'SUSPENDED';
        } | null;

        if (!rawBody || (rawBody.role === undefined && rawBody.status === undefined)) {
          throw new ValidationError(
            'Member update requires at least "role" or "status" ("ACTIVE" | "SUSPENDED").',
          );
        }

        const correlationUuid = asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid());
        let updatedMember;

        if (rawBody.role !== undefined) {
          updatedMember = await services.organizations.changeMemberRole(
            actorUserId,
            organizationId,
            targetUserId,
            rawBody.role,
            { correlationId: correlationUuid },
          );
        }

        if (rawBody.status !== undefined) {
          updatedMember = await services.organizations.suspendOrReactivateMember(
            actorUserId,
            organizationId,
            targetUserId,
            rawBody.status,
            { correlationId: correlationUuid },
          );
        }

        return buildSuccessResponse(updatedMember, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/leave',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const removedMembership = await services.organizations.leaveOrganization(
          actorUserId,
          organizationId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(removedMembership, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 05 — Invitations (delegating strictly to InvitationService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/invitations',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const invitations = await services.invitations.listInvitations(actorUserId, organizationId);
        return buildSuccessResponse(invitations, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/invitations',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateInvitationInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for invitation creation.');
        }

        const result = await services.invitations.createInvitation(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(result, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/invitations/:invitationId/revoke',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const invitationId = asInvitationId(String(params.invitationId ?? ''), 'invitationId');

        const revoked = await services.invitations.revokeInvitation(
          actorUserId,
          organizationId,
          invitationId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(revoked, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/invitations/preview',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const url = new URL(request.url);
        const code = url.searchParams.get('code') ?? '';

        const preview = await services.invitations.previewInvitationByCode(actorUserId, code);
        return buildSuccessResponse(preview, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/invitations/accept',
      withSimulatedEndpoint(deps, async ({ request, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly code?: string;
        } | null;

        if (!rawBody || typeof rawBody.code !== 'string') {
          throw new ValidationError('Field "code" is required to accept an invitation.');
        }

        const accepted = await services.invitations.acceptInvitation(actorUserId, rawBody.code, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(accepted, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 05 — Teams & Team Members (delegating strictly to TeamService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/teams',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const includeArchived = url.searchParams.get('includeArchived') === 'true';

        const teams = await services.teams.listTeams(actorUserId, organizationId, {
          includeArchived,
        });
        return buildSuccessResponse(teams, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/teams',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateTeamInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for team creation.');
        }

        const created = await services.teams.createTeam(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/teams/:teamId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');

        const details = await services.teams.getTeamDetails(actorUserId, organizationId, teamId);
        return buildSuccessResponse(details, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/teams/:teamId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');
        const rawBody = (await request.json().catch(() => null)) as
          (UpdateTeamInput & { readonly managerUserIds?: readonly UserId[] }) | null;

        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for team update.');
        }

        const correlationUuid = asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid());
        let updatedTeam;

        if (rawBody.name !== undefined || rawBody.description !== undefined) {
          updatedTeam = await services.teams.updateTeam(actorUserId, organizationId, teamId, {
            ...(rawBody.name !== undefined ? { name: rawBody.name } : {}),
            ...(rawBody.description !== undefined ? { description: rawBody.description } : {}),
            correlationId: correlationUuid,
          });
        }

        if (rawBody.managerUserIds !== undefined) {
          updatedTeam = await services.teams.setTeamManagers(
            actorUserId,
            organizationId,
            teamId,
            rawBody.managerUserIds,
            { correlationId: correlationUuid },
          );
        }

        if (updatedTeam === undefined) {
          throw new ValidationError(
            'Team update requires at least "name", "description" or "managerUserIds".',
          );
        }

        return buildSuccessResponse(updatedTeam, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/teams/:teamId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        const deleted = await services.teams.deleteTeam(actorUserId, organizationId, teamId, {
          ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/teams/:teamId/archive',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');

        const archived = await services.teams.archiveTeam(actorUserId, organizationId, teamId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(archived, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/teams/:teamId/restore',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');

        const restored = await services.teams.restoreTeam(actorUserId, organizationId, teamId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(restored, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/teams/:teamId/members',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly userId?: string;
        } | null;

        if (!rawBody || typeof rawBody.userId !== 'string') {
          throw new ValidationError('Field "userId" is required to add a team member.');
        }

        const member = await services.teams.addTeamMember(
          actorUserId,
          organizationId,
          teamId,
          asUserId(rawBody.userId, 'userId'),
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(member, correlationId, now, 201);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/teams/:teamId/members/:userId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const teamId = asTeamId(String(params.teamId ?? ''), 'teamId');
        const targetUserId = asUserId(String(params.userId ?? ''), 'userId');

        const removed = await services.teams.removeTeamMember(
          actorUserId,
          organizationId,
          teamId,
          targetUserId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(removed, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 05 — Permissions Management (delegating strictly to AuthorizationManagementService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/permissions/me',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const rules = await services.authorization.listMyActiveAccessRules(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(rules, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/permissions/grants',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const grants = await services.authorization.listOrganizationGrants(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(grants, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/permissions/grants',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as GrantPermissionInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for permission grant creation.');
        }

        const grant = await services.authorization.grantPermission(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(grant, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/permissions/grants/:grantId/revoke',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const grantId = asGrantId(String(params.grantId ?? ''), 'grantId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        await services.authorization.revokePermissionGrant(actorUserId, organizationId, grantId, {
          ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse({ revoked: true, grantId }, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/permissions/denies',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const denies = await services.authorization.listOrganizationDenyRules(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(denies, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/permissions/denies',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as CreateExplicitDenyRuleInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for explicit deny rule creation.');
        }

        const rule = await services.authorization.createExplicitDenyRule(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(rule, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/permissions/denies/:denyRuleId/revoke',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const denyRuleId = asDenyRuleId(String(params.denyRuleId ?? ''), 'denyRuleId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        await services.authorization.revokeExplicitDenyRule(
          actorUserId,
          organizationId,
          denyRuleId,
          {
            ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse({ revoked: true, denyRuleId }, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const { actor } = await resolveAuthorizationActor(deps, request, organizationId, now);

        const allProjects =
          await deps.repositories.projects.projects.listByOrganization(organizationId);

        if (allProjects.length === 0) {
          // Verify basic membership/auth even when list is empty
          assertAuthorized({
            actor,
            action: PERMISSION_CODES.ORGANIZATION_VIEW,
            resource: {
              kind: 'ORGANIZATION',
              id: asEntityId(organizationId),
              exists: true,
              organizationId,
            },
            context: { now },
          });
          return buildSuccessResponse([], correlationId, now, 200);
        }

        const visibleProjects: Project[] = [];
        for (const project of allProjects) {
          try {
            assertAuthorized({
              actor,
              action: PERMISSION_CODES.PROJECT_VIEW,
              resource: {
                kind: 'PROJECT',
                id: asEntityId(project.id),
                exists: true,
                organizationId: project.organizationId,
                projectId: project.id,
                teamId: project.teamId,
                ownerUserId: project.ownerUserId,
                deletedAt: project.deletedAt,
                archivedAt: project.archivedAt,
              },
              context: { now },
            });
            visibleProjects.push(project);
          } catch {
            // Filter out projects outside the actor's authorized scope
          }
        }

        return buildSuccessResponse(visibleProjects, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const rawBody = (await request
          .json()
          .catch(() => null)) as CreateProjectRequestPayload | null;

        if (!rawBody || typeof rawBody.name !== 'string' || rawBody.name.trim().length === 0) {
          throw new ValidationError('Project "name" is required and must be a non-empty string.', {
            details: { field: 'name' },
          });
        }

        const teamId =
          rawBody.teamId !== undefined ? asTeamId(rawBody.teamId, 'teamId') : undefined;

        const { userId } = await authorizeOrThrow(
          deps,
          request,
          organizationId,
          PERMISSION_CODES.PROJECT_CREATE,
          {
            kind: 'PROJECT',
            exists: true,
            organizationId,
            ...(teamId !== undefined ? { teamId } : {}),
          },
          now,
        );

        const projectId = asProjectId(rawBody.id ?? nextUuid(), 'projectId');
        const ownerUserId =
          rawBody.ownerUserId !== undefined ? asUserId(rawBody.ownerUserId, 'ownerUserId') : userId;
        const inactivityThresholdDays =
          rawBody.inactivityThresholdDays !== undefined ? rawBody.inactivityThresholdDays : 7;

        if (!Number.isInteger(inactivityThresholdDays) || inactivityThresholdDays < 1) {
          throw new ValidationError('Project "inactivityThresholdDays" must be an integer >= 1.', {
            details: { field: 'inactivityThresholdDays' },
          });
        }

        const newProject: Project = {
          id: projectId,
          organizationId,
          ...(teamId !== undefined ? { teamId } : {}),
          name: rawBody.name.trim(),
          ...(rawBody.description !== undefined ? { description: rawBody.description } : {}),
          status: PROJECT_STATUSES.ACTIVE,
          ownerUserId,
          inactivityThresholdDays,
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
        };

        const correlationUuid = asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid());

        // Persist inside a Dexie transaction and emit post-commit event BEFORE returning HTTP 201
        await deps.transactionPort.run(
          [
            TRANSACTION_RESOURCES.PROJECTS,
            TRANSACTION_RESOURCES.PROJECT_MEMBERS,
            TRANSACTION_RESOURCES.AUDIT_EVENTS,
          ],
          async () => {
            await deps.repositories.projects.projects.save(newProject);
            await deps.repositories.projects.projectMembers.save({
              id: asProjectMemberId(nextUuid()),
              organizationId,
              projectId: newProject.id,
              userId: ownerUserId,
              projectRole: PROJECT_MEMBER_ROLES.MANAGER,
              joinedAt: now,
            });

            const auditEvent: AuditEvent = {
              id: asAuditEventId(nextUuid()),
              organizationId,
              actorId: userId,
              projectId: newProject.id,
              occurredAt: now,
              category: AUDIT_CATEGORIES.PROJECT,
              eventType: 'project.created',
              resourceType: 'Project',
              resourceId: newProject.id,
              after: {
                id: newProject.id,
                name: newProject.name,
                status: newProject.status,
              },
              result: AUDIT_RESULTS.SUCCESS,
              correlationId: correlationUuid,
            };
            await deps.repositories.audit.auditEvents.append(auditEvent);

            await deps.eventBus.publish(
              createDomainEvent({
                eventId: asEventId(nextUuid()),
                eventType: 'project.created',
                occurredAt: now,
                organizationId,
                actorId: userId,
                correlationId: correlationUuid,
                aggregateType: 'Project',
                aggregateId: newProject.id,
                payload: {
                  projectId: newProject.id,
                  name: newProject.name,
                },
              }),
            );
          },
        );

        return buildSuccessResponse(newProject, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId/tasks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');

        const project = await deps.repositories.projects.projects.findById(
          organizationId,
          projectId,
        );

        await authorizeOrThrow(
          deps,
          request,
          organizationId,
          PERMISSION_CODES.PROJECT_VIEW,
          {
            kind: 'PROJECT',
            id: asEntityId(projectId),
            exists: project !== null,
            organizationId,
            projectId,
            teamId: project?.teamId,
            ownerUserId: project?.ownerUserId,
            deletedAt: project?.deletedAt,
            archivedAt: project?.archivedAt,
          },
          now,
        );

        const tasks = await deps.repositories.tasks.tasks.listByProject(organizationId, projectId);

        return buildSuccessResponse(tasks, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/audit-events',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        await authorizeOrThrow(
          deps,
          request,
          organizationId,
          PERMISSION_CODES.AUDIT_ORGANIZATION_VIEW,
          {
            kind: 'AUDIT',
            exists: true,
            organizationId,
          },
          now,
        );

        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

        const result = await deps.repositories.audit.auditEvents.listByOrganization(
          organizationId,
          { page, pageSize },
        );

        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),
  ];
}
