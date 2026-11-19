import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { AUDIT_CATEGORIES, AUDIT_RESULTS, type AuditEvent } from '@/modules/audit';
import {
  PERMISSION_CODES,
  assertAuthorized,
  type AuthorizationActor,
  type AuthorizationResource,
  type PermissionCode,
} from '@/modules/authorization';
import { DEMO_SEED_VERSION } from '@/modules/demo';
import {
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  asProjectMemberId,
  type Project,
} from '@/modules/projects';
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
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
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
  type ProjectId,
  type TeamId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, PMS_SCHEMA_VERSION } from '@/shared/persistence';
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

/**
 * Creates the canonical MSW v2 HTTP handlers backed by Dexie repositories and RBAC+ABAC policy engine
 * (API-SIMULATION.md, ADR-0003, ADR-0007 §5.2).
 *
 * Invariant: write endpoints ALWAYS await Dexie transaction commit before returning an HTTP success response.
 */
export function createMswHandlers(deps: MswCompositionDependencies): readonly HttpHandler[] {
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

    http.get(
      '*/api/v1/organizations/:organizationId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const organization =
          await deps.repositories.organizations.organizations.findById(organizationId);

        await authorizeOrThrow(
          deps,
          request,
          organizationId,
          PERMISSION_CODES.ORGANIZATION_VIEW,
          {
            kind: 'ORGANIZATION',
            id: asEntityId(organizationId),
            exists: organization !== null,
            organizationId,
            deletedAt: organization?.deletedAt,
            archivedAt: organization?.archivedAt,
          },
          now,
        );

        return buildSuccessResponse(organization, correlationId, now, 200);
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
