import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { AnalyticsService } from '@/modules/analytics';
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
  type CreateExplicitDenyRuleInput,
  type GrantPermissionInput,
} from '@/modules/authorization';
import {
  BottleneckService,
  asBottleneckAlertId,
  type BottleneckAlertStatus,
  type BottleneckIndicator,
  type UpdateIndividualProductivityVisibilityInput,
  type UpdateProjectBottleneckRulesInput,
} from '@/modules/bottlenecks';
import { DEMO_SEED_VERSION } from '@/modules/demo';
import {
  DependencyService,
  asTaskDependencyId,
  type AddTaskDependencyInput,
} from '@/modules/dependencies';
import {
  FeedbackService,
  asFeedbackCategoryId,
  asFeedbackContestReasonId,
  asFeedbackInternalNoteId,
  asFeedbackMessageId,
  asFeedbackReopenRequestId,
  type AddFeedbackInternalNoteInput,
  type AddFeedbackMessageInput,
  type AssignFeedbackInput,
  type CreateCatalogItemInput,
  type CreateFeedbackInput,
  type DecideContestInput,
  type DecideExceptionalReopenInput,
  type DelegateContestAnalysisInput,
  type FeedbackExportFormat,
  type FeedbackStatus,
  type OpenFeedbackContestInput,
  type ReorderFeedbackCategoriesInput,
  type ReorderFeedbackContestReasonsInput,
  type RequestExceptionalReopenInput,
  type SubmitContestAnalysisInput,
  type TransitionFeedbackStatusInput,
  type UpdateCatalogItemInput,
  type UpdateFeedbackSlaSettingsInput,
  type UpdateFeedbackTriageInput,
} from '@/modules/feedback';
import { FocusService, type UpdateFocusPreferencesInput } from '@/modules/focus';
import {
  ImpedimentService,
  type CreateImpedimentInput,
  type TransitionImpedimentInput,
  type UpdateImpedimentInput,
} from '@/modules/impediments';
import {
  InvitationService,
  asInvitationId,
  type CreateInvitationInput,
} from '@/modules/invitations';
import {
  KanbanService,
  type CreateColumnInput,
  type CreateQuickCardInput,
  type MoveCardInput,
  type UpdateColumnInput,
} from '@/modules/kanban';
import {
  OrganizationService,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from '@/modules/organizations';
import {
  ProjectService,
  type CreateProjectInput,
  type ProjectMemberRole,
  type TransferProjectTeamInput,
  type UpdateProjectInput,
} from '@/modules/projects';
import { ReportService } from '@/modules/reports';
import {
  TaskService,
  asTagId,
  asTaskCommentId,
  type AssignSubtaskInput,
  type AssignTaskInput,
  type CancelTaskInput,
  type CompleteTaskInput,
  type CreateSubtaskInput,
  type CreateTagInput,
  type CreateTaskInput,
  type PauseTaskInput,
  type ReopenTaskInput,
  type TaskCommentInput,
  type UpdateSubtaskInput,
  type UpdateTagInput,
  type UpdateTaskInput,
} from '@/modules/tasks';
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
  MAX_ATTACHMENT_SIZE_BYTES,
  MEMBERSHIP_STATUSES,
  asAttachmentId,
  asBoardColumnId,
  asCorrelationId,
  asFeedbackContestId,
  asFeedbackId,
  asGrantId,
  asImpedimentId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asSubtaskId,
  asTaskId,
  asTeamId,
  asUserId,
  assertSameOrganization,
  isSoftDeleted,
  isUuid,
  type AttachmentBlobPayload,
  type AttachmentBlobStorePort,
  type AttachmentId,
  type BoardColumnId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationRole,
  type Priority,
  type SubtaskId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, PMS_SCHEMA_VERSION } from '@/shared/persistence';
import { createAnalyticsPortsAdapter } from './analytics-ports-adapter';
import { createAnalyticsAndReportsMswHandlers } from './analytics-reports-msw-handlers';
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
import { createFeedbackContextAdapter } from './feedback-ports-adapter';
import {
  createProjectBoardInitializerAdapter,
  createProjectTeamLookupAdapter,
} from './project-ports-adapter';
import type { AppRepositoriesRegistry } from './repositories-registry';
import {
  createDependencyWorkContextAdapter,
  createImpedimentWorkContextAdapter,
  createTaskProjectContextAdapter,
} from './task-ports-adapter';
import {
  createBottleneckWorkContextAdapter,
  createFocusWorkContextAdapter,
} from './work-intelligence-ports-adapter';

export interface MswCompositionDependencies {
  readonly repositories: AppRepositoriesRegistry;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly simulationController: SimulationScenarioController;
  readonly attachmentBlobStore?: AttachmentBlobStorePort;
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

function createInMemoryAttachmentBlobStore(): AttachmentBlobStorePort {
  const blobs = new Map<AttachmentId, AttachmentBlobPayload>();

  return {
    async putBlob(payload): Promise<void> {
      const normalizedMimeType = payload.mimeType.trim().toLowerCase();
      if (normalizedMimeType.length === 0) {
        throw new ValidationError('Attachment blob "mimeType" must be a non-empty string.');
      }
      if (payload.bytes.byteLength <= 0 || payload.bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new ValidationError('Attachment blob size is outside allowed bounds.');
      }
      const existing = blobs.get(payload.attachmentId);
      if (existing !== undefined) {
        assertSameOrganization(existing.organizationId, payload.organizationId, 'AttachmentBlob');
      }
      blobs.set(payload.attachmentId, {
        attachmentId: payload.attachmentId,
        organizationId: payload.organizationId,
        mimeType: normalizedMimeType,
        bytes: new Uint8Array(payload.bytes),
      });
    },

    async getBlob(organizationId, attachmentId): Promise<AttachmentBlobPayload | null> {
      const existing = blobs.get(attachmentId);
      if (!existing) {
        return null;
      }
      assertSameOrganization(organizationId, existing.organizationId, 'AttachmentBlob');
      return {
        ...existing,
        bytes: new Uint8Array(existing.bytes),
      };
    },

    async deleteBlob(organizationId, attachmentId): Promise<void> {
      const existing = blobs.get(attachmentId);
      if (!existing) {
        return;
      }
      assertSameOrganization(organizationId, existing.organizationId, 'AttachmentBlob');
      blobs.delete(attachmentId);
    },
  };
}

/**
 * Transport-layer Base64 decoding restricted strictly to MSW HTTP boundary (ADR-0011 §2.5).
 */
function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.trim();
  if (normalized.length === 0) {
    throw new ValidationError('Field "contentBase64" must be a non-empty base64 string.', {
      details: { field: 'contentBase64' },
    });
  }

  try {
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new ValidationError('Field "contentBase64" is not valid base64.', {
      details: { field: 'contentBase64' },
    });
  }
}

/**
 * Transport-layer Base64 encoding restricted strictly to MSW HTTP boundary (ADR-0011 §2.5).
 */
function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
}

function resolveMswServices(deps: MswCompositionDependencies): AppServicesRegistry {
  if (deps.services !== undefined) {
    return deps.services;
  }

  const attachmentBlobStore = deps.attachmentBlobStore ?? createInMemoryAttachmentBlobStore();

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

  const analyticsPortsAdapter = createAnalyticsPortsAdapter({
    repositories: deps.repositories,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
  });

  const analyticsService = new AnalyticsService({
    dashboardPreferences: deps.repositories.analytics.dashboardPreferences,
    workContext: analyticsPortsAdapter,
    governance: analyticsPortsAdapter,
    permissionGrants: deps.repositories.authorization.permissionGrants,
    explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
    transactionPort: deps.transactionPort,
    eventBus: deps.eventBus,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
  });

  const reportService = new ReportService({
    reportsContext: analyticsPortsAdapter,
    analyticsService,
    analyticsWorkContext: analyticsPortsAdapter,
    analyticsGovernance: analyticsPortsAdapter,
    permissionGrants: deps.repositories.authorization.permissionGrants,
    explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
    transactionPort: deps.transactionPort,
    eventBus: deps.eventBus,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
  });

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
    projects: new ProjectService({
      projects: deps.repositories.projects.projects,
      projectMembers: deps.repositories.projects.projectMembers,
      tasks: deps.repositories.tasks.tasks,
      taskParticipants: deps.repositories.tasks.taskParticipants,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      users: deps.repositories.users.users,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      teamLookup: createProjectTeamLookupAdapter(deps.repositories),
      boardInitializer: createProjectBoardInitializerAdapter(deps.repositories),
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    kanban: new KanbanService({
      projects: deps.repositories.projects.projects,
      projectMembers: deps.repositories.projects.projectMembers,
      projectBoards: deps.repositories.kanban.projectBoards,
      boardColumns: deps.repositories.kanban.boardColumns,
      tasks: deps.repositories.tasks.tasks,
      taskParticipants: deps.repositories.tasks.taskParticipants,
      subtasks: deps.repositories.tasks.subtasks,
      taskDependencies: deps.repositories.dependencies.taskDependencies,
      impediments: deps.repositories.impediments.impediments,
      taskPauses: deps.repositories.tasks.taskPauses,
      taskExecutionCycles: deps.repositories.tasks.taskExecutionCycles,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    tasks: new TaskService({
      tasks: deps.repositories.tasks.tasks,
      taskParticipants: deps.repositories.tasks.taskParticipants,
      subtasks: deps.repositories.tasks.subtasks,
      taskPauses: deps.repositories.tasks.taskPauses,
      taskExecutionCycles: deps.repositories.tasks.taskExecutionCycles,
      taskComments: deps.repositories.tasks.taskComments,
      taskAttachments: deps.repositories.tasks.taskAttachments,
      tags: deps.repositories.tasks.tags,
      taskDeadlineHistory: deps.repositories.tasks.taskDeadlineHistory,
      taskDependencies: deps.repositories.dependencies.taskDependencies,
      impediments: deps.repositories.impediments.impediments,
      attachmentBlobStore,
      projectContext: createTaskProjectContextAdapter(deps.repositories),
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    dependencies: new DependencyService({
      taskDependencies: deps.repositories.dependencies.taskDependencies,
      workContext: createDependencyWorkContextAdapter(deps.repositories),
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    impediments: new ImpedimentService({
      impediments: deps.repositories.impediments.impediments,
      workContext: createImpedimentWorkContextAdapter(deps.repositories),
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    focus: new FocusService({
      focusPreferences: deps.repositories.focus.focusPreferences,
      workContext: createFocusWorkContextAdapter(deps.repositories),
      organizations: deps.repositories.organizations.organizations,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    bottlenecks: new BottleneckService({
      bottleneckAlerts: deps.repositories.bottlenecks.bottleneckAlerts,
      workContext: createBottleneckWorkContextAdapter(deps.repositories),
      organizations: deps.repositories.organizations.organizations,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    feedback: new FeedbackService({
      feedbacks: deps.repositories.feedback.feedbacks,
      feedbackCycles: deps.repositories.feedback.feedbackCycles,
      feedbackCategories: deps.repositories.feedback.feedbackCategories,
      feedbackMessages: deps.repositories.feedback.feedbackMessages,
      feedbackInternalNotes: deps.repositories.feedback.feedbackInternalNotes,
      feedbackAttachments: deps.repositories.feedback.feedbackAttachments,
      feedbackContests: deps.repositories.feedback.feedbackContests,
      feedbackContestReasons: deps.repositories.feedback.feedbackContestReasons,
      feedbackSlaSnapshots: deps.repositories.feedback.feedbackSlaSnapshots,
      feedbackReopenRequests: deps.repositories.feedback.feedbackReopenRequests,
      attachmentBlobStore,
      feedbackContext: createFeedbackContextAdapter(deps.repositories),
      organizations: deps.repositories.organizations.organizations,
      organizationMembers: deps.repositories.organizations.organizationMembers,
      organizationSettings: deps.repositories.settings.organizationSettings,
      permissionGrants: deps.repositories.authorization.permissionGrants,
      explicitDenyRules: deps.repositories.authorization.explicitDenyRules,
      auditEvents: deps.repositories.audit.auditEvents,
      transactionPort: deps.transactionPort,
      eventBus: deps.eventBus,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.generateUuid !== undefined ? { generateUuid: deps.generateUuid } : {}),
    }),
    analytics: analyticsService,
    reports: reportService,
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

    // -------------------------------------------------------------------------
    // Phase 06 — Projects & Participants (delegating strictly to ProjectService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/projects',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const includeArchived = url.searchParams.get('includeArchived') === 'true';

        const projects = await services.projects.listProjects(actorUserId, organizationId, {
          includeArchived,
        });
        return buildSuccessResponse(projects, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateProjectInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for project creation.');
        }

        const created = await services.projects.createProject(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');

        const details = await services.projects.getProjectDetails(
          actorUserId,
          organizationId,
          projectId,
        );
        return buildSuccessResponse(details, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/projects/:projectId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as UpdateProjectInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for project update.');
        }

        const updated = await services.projects.updateProject(
          actorUserId,
          organizationId,
          projectId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/projects/:projectId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const url = new URL(request.url);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;
        const reason = rawBody?.reason ?? url.searchParams.get('reason') ?? undefined;

        const deleted = await services.projects.deleteProject(
          actorUserId,
          organizationId,
          projectId,
          {
            ...(reason !== undefined ? { reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/transfer',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as
          (Partial<TransferProjectTeamInput> & Record<string, unknown>) | null;

        if (
          !rawBody ||
          typeof rawBody !== 'object' ||
          (rawBody.targetTeamId !== null && typeof rawBody.targetTeamId !== 'string')
        ) {
          throw new ValidationError(
            'Field "targetTeamId" (UUID string or null) is required to transfer project team.',
          );
        }

        const transferred = await services.projects.transferProjectTeam(
          actorUserId,
          organizationId,
          projectId,
          {
            targetTeamId: rawBody.targetTeamId as TransferProjectTeamInput['targetTeamId'],
            ...(typeof rawBody.reason === 'string' ? { reason: rawBody.reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(transferred, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/archive',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        const archived = await services.projects.archiveProject(
          actorUserId,
          organizationId,
          projectId,
          {
            ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(archived, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/restore',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        const restored = await services.projects.restoreProject(
          actorUserId,
          organizationId,
          projectId,
          {
            ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(restored, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/participants',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly userId?: string;
          readonly role?: ProjectMemberRole;
        } | null;

        if (!rawBody || typeof rawBody.userId !== 'string') {
          throw new ValidationError('Field "userId" is required to add a project participant.');
        }

        const participant = await services.projects.addProjectParticipant(
          actorUserId,
          organizationId,
          projectId,
          asUserId(rawBody.userId, 'userId'),
          rawBody.role,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(participant, correlationId, now, 201);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/projects/:projectId/participants/:userId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const targetUserId = asUserId(String(params.userId ?? ''), 'userId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly role?: ProjectMemberRole;
        } | null;

        if (!rawBody || typeof rawBody.role !== 'string') {
          throw new ValidationError('Field "role" is required to update project participant role.');
        }

        const updated = await services.projects.updateProjectParticipantRole(
          actorUserId,
          organizationId,
          projectId,
          targetUserId,
          rawBody.role,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/projects/:projectId/participants/:userId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const targetUserId = asUserId(String(params.userId ?? ''), 'userId');
        const url = new URL(request.url);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;
        const reason = rawBody?.reason ?? url.searchParams.get('reason') ?? undefined;

        const removed = await services.projects.removeProjectParticipant(
          actorUserId,
          organizationId,
          projectId,
          targetUserId,
          {
            ...(reason !== undefined ? { reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(removed, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId/export',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');

        const exported = await services.projects.exportProjectData(
          actorUserId,
          organizationId,
          projectId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(exported, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 06 — Kanban Board, Columns & Cards (delegating strictly to KanbanService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId/tasks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const url = new URL(request.url);
        const includeDeleted = url.searchParams.get('includeDeleted') === 'true';

        if (includeDeleted) {
          const tasks = await services.tasks.listProjectTasks(
            actorUserId,
            organizationId,
            projectId,
            { includeDeleted: true },
          );
          return buildSuccessResponse(tasks, correlationId, now, 200);
        }

        const board = await services.kanban.getProjectBoard(actorUserId, organizationId, projectId);
        return buildSuccessResponse(
          board.cards.map((card) => card.task),
          correlationId,
          now,
          200,
        );
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');

        const board = await services.kanban.getProjectBoard(actorUserId, organizationId, projectId);
        return buildSuccessResponse(board, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board/columns',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as CreateColumnInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for board column creation.');
        }

        const created = await services.kanban.createColumn(actorUserId, organizationId, projectId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board/columns/reorder',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly orderedColumnIds?: readonly BoardColumnId[];
        } | null;

        if (!rawBody || !Array.isArray(rawBody.orderedColumnIds)) {
          throw new ValidationError(
            'Field "orderedColumnIds" (array of column UUIDs) is required.',
          );
        }

        const reordered = await services.kanban.reorderColumns(
          actorUserId,
          organizationId,
          projectId,
          rawBody.orderedColumnIds,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(reordered, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board/columns/:columnId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const columnId = asBoardColumnId(String(params.columnId ?? ''), 'columnId');
        const rawBody = (await request.json().catch(() => null)) as UpdateColumnInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for board column update.');
        }

        const updated = await services.kanban.updateColumn(
          actorUserId,
          organizationId,
          projectId,
          columnId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board/columns/:columnId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const columnId = asBoardColumnId(String(params.columnId ?? ''), 'columnId');
        const url = new URL(request.url);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly migrationTargetColumnId?: string;
        } | null;
        const rawTargetId =
          rawBody?.migrationTargetColumnId ??
          url.searchParams.get('migrationTargetColumnId') ??
          undefined;

        const result = await services.kanban.deleteColumn(
          actorUserId,
          organizationId,
          projectId,
          columnId,
          {
            ...(rawTargetId !== undefined
              ? {
                  migrationTargetColumnId: asBoardColumnId(rawTargetId, 'migrationTargetColumnId'),
                }
              : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board/columns/:columnId/archive',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const columnId = asBoardColumnId(String(params.columnId ?? ''), 'columnId');

        const archived = await services.kanban.archiveColumn(
          actorUserId,
          organizationId,
          projectId,
          columnId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(archived, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/board/columns/:columnId/restore',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const columnId = asBoardColumnId(String(params.columnId ?? ''), 'columnId');

        const restored = await services.kanban.restoreColumn(
          actorUserId,
          organizationId,
          projectId,
          columnId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(restored, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/cards',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as CreateQuickCardInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for quick card creation.');
        }

        const card = await services.kanban.createQuickCard(actorUserId, organizationId, projectId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(card, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/cards/:taskId/move',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as MoveCardInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for card movement.');
        }

        const moved = await services.kanban.moveCard(
          actorUserId,
          organizationId,
          projectId,
          taskId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(moved, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 07 — Tasks, Subtasks, Comments, Attachments, Tags, Dependencies & Impediments
    // -------------------------------------------------------------------------
    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/tasks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request.json().catch(() => null)) as CreateTaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for task creation.');
        }

        const created = await services.tasks.createTask(actorUserId, organizationId, projectId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const detail = await services.tasks.getTaskDetail(actorUserId, organizationId, taskId);
        return buildSuccessResponse(detail, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/tasks/:taskId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as UpdateTaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for task update.');
        }

        const updated = await services.tasks.updateTask(actorUserId, organizationId, taskId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tasks/:taskId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const url = new URL(request.url);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;
        const reason = rawBody?.reason ?? url.searchParams.get('reason') ?? undefined;

        const deleted = await services.tasks.deleteTask(actorUserId, organizationId, taskId, {
          ...(reason !== undefined ? { reason } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/restore',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;

        const restored = await services.tasks.restoreTask(actorUserId, organizationId, taskId, {
          ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(restored, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/assign',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as AssignTaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for task assignment.');
        }

        const assigned = await services.tasks.assignTask(actorUserId, organizationId, taskId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(assigned, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/participants',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly userId?: string;
        } | null;

        if (!rawBody || typeof rawBody.userId !== 'string') {
          throw new ValidationError('Field "userId" is required to add a task participant.');
        }

        const participant = await services.tasks.addTaskParticipant(
          actorUserId,
          organizationId,
          taskId,
          {
            userId: asUserId(rawBody.userId, 'userId'),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(participant, correlationId, now, 201);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/participants/:userId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const targetUserId = asUserId(String(params.userId ?? ''), 'userId');

        const removed = await services.tasks.removeTaskParticipant(
          actorUserId,
          organizationId,
          taskId,
          targetUserId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(removed, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/start',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const started = await services.tasks.startTask(actorUserId, organizationId, taskId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(started, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/pause',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as PauseTaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for task pause.');
        }

        const result = await services.tasks.pauseTask(actorUserId, organizationId, taskId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/resume',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const resumed = await services.tasks.resumeTask(actorUserId, organizationId, taskId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(resumed, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/complete',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as CompleteTaskInput | null;

        const completed = await services.tasks.completeTask(actorUserId, organizationId, taskId, {
          ...(rawBody?.dependencyOverrideJustification !== undefined
            ? { dependencyOverrideJustification: rawBody.dependencyOverrideJustification }
            : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(completed, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/cancel',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as CancelTaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for task cancellation.');
        }

        const cancelled = await services.tasks.cancelTask(actorUserId, organizationId, taskId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(cancelled, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/cancellation-requests',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as CancelTaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for task cancellation request.');
        }

        const requested = await services.tasks.requestTaskCancellation(
          actorUserId,
          organizationId,
          taskId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(requested, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/reopen',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as ReopenTaskInput | null;

        const reopened = await services.tasks.reopenTask(actorUserId, organizationId, taskId, {
          ...(rawBody?.reason !== undefined ? { reason: rawBody.reason } : {}),
          ...(rawBody?.targetColumnId !== undefined
            ? { targetColumnId: asBoardColumnId(rawBody.targetColumnId, 'targetColumnId') }
            : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(reopened, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/deadline-history',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const history = await services.tasks.listTaskDeadlineHistory(
          actorUserId,
          organizationId,
          taskId,
        );

        return buildSuccessResponse(history, correlationId, now, 200);
      }),
    ),

    // Subtasks
    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/subtasks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as CreateSubtaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for subtask creation.');
        }

        const created = await services.tasks.createSubtask(actorUserId, organizationId, taskId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/subtasks/reorder',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly orderedSubtaskIds?: readonly SubtaskId[];
        } | null;

        if (!rawBody || !Array.isArray(rawBody.orderedSubtaskIds)) {
          throw new ValidationError('Field "orderedSubtaskIds" (array of UUIDs) is required.');
        }

        const reordered = await services.tasks.reorderSubtasks(
          actorUserId,
          organizationId,
          taskId,
          rawBody.orderedSubtaskIds,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(reordered, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/subtasks/:subtaskId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const subtaskId = asSubtaskId(String(params.subtaskId ?? ''), 'subtaskId');
        const rawBody = (await request.json().catch(() => null)) as UpdateSubtaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for subtask update.');
        }

        const updated = await services.tasks.updateSubtask(
          actorUserId,
          organizationId,
          taskId,
          subtaskId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/subtasks/:subtaskId/assign',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const subtaskId = asSubtaskId(String(params.subtaskId ?? ''), 'subtaskId');
        const rawBody = (await request.json().catch(() => null)) as AssignSubtaskInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for subtask assignment.');
        }

        const assigned = await services.tasks.assignSubtask(
          actorUserId,
          organizationId,
          taskId,
          subtaskId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(assigned, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/subtasks/:subtaskId/complete',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const subtaskId = asSubtaskId(String(params.subtaskId ?? ''), 'subtaskId');

        const completed = await services.tasks.completeSubtask(
          actorUserId,
          organizationId,
          taskId,
          subtaskId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(completed, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/subtasks/:subtaskId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const subtaskId = asSubtaskId(String(params.subtaskId ?? ''), 'subtaskId');

        const result = await services.tasks.deleteSubtask(
          actorUserId,
          organizationId,
          taskId,
          subtaskId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    // Comments
    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/comments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const comments = await services.tasks.listTaskComments(actorUserId, organizationId, taskId);
        return buildSuccessResponse(comments, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/comments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as TaskCommentInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for comment creation.');
        }

        const created = await services.tasks.addTaskComment(actorUserId, organizationId, taskId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/comments/:commentId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const commentId = asTaskCommentId(String(params.commentId ?? ''), 'commentId');
        const rawBody = (await request.json().catch(() => null)) as TaskCommentInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for comment update.');
        }

        const updated = await services.tasks.updateTaskComment(
          actorUserId,
          organizationId,
          taskId,
          commentId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/comments/:commentId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const commentId = asTaskCommentId(String(params.commentId ?? ''), 'commentId');
        const url = new URL(request.url);
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;
        const reason = rawBody?.reason ?? url.searchParams.get('reason') ?? undefined;

        const deleted = await services.tasks.deleteTaskComment(
          actorUserId,
          organizationId,
          taskId,
          commentId,
          {
            ...(reason !== undefined ? { reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    // Attachments (contentBase64 <-> Uint8Array conversion strictly at MSW boundary)
    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/attachments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const attachments = await services.tasks.listTaskAttachments(
          actorUserId,
          organizationId,
          taskId,
        );
        return buildSuccessResponse(attachments, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/attachments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly fileName?: string;
          readonly mimeType?: string;
          readonly contentBase64?: string;
        } | null;

        if (
          !rawBody ||
          typeof rawBody.fileName !== 'string' ||
          typeof rawBody.mimeType !== 'string' ||
          typeof rawBody.contentBase64 !== 'string'
        ) {
          throw new ValidationError(
            'Attachment upload requires "fileName", "mimeType", and "contentBase64" strings.',
          );
        }

        const bytes = decodeBase64ToUint8Array(rawBody.contentBase64);
        const uploaded = await services.tasks.uploadTaskAttachment(
          actorUserId,
          organizationId,
          taskId,
          {
            fileName: rawBody.fileName,
            mimeType: rawBody.mimeType,
            bytes,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(uploaded, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/attachments/:attachmentId/content',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const attachmentId = asAttachmentId(String(params.attachmentId ?? ''), 'attachmentId');

        const content = await services.tasks.getTaskAttachmentContent(
          actorUserId,
          organizationId,
          taskId,
          attachmentId,
        );

        return buildSuccessResponse(
          {
            attachment: content.attachment,
            mimeType: content.mimeType,
            contentBase64: encodeUint8ArrayToBase64(content.bytes),
          },
          correlationId,
          now,
          200,
        );
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/attachments/:attachmentId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const attachmentId = asAttachmentId(String(params.attachmentId ?? ''), 'attachmentId');

        const deleted = await services.tasks.deleteTaskAttachment(
          actorUserId,
          organizationId,
          taskId,
          attachmentId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    // Tags
    http.get(
      '*/api/v1/organizations/:organizationId/tags',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const tags = await services.tasks.listTags(actorUserId, organizationId);
        return buildSuccessResponse(tags, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tags',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateTagInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for tag creation.');
        }

        const created = await services.tasks.createTag(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/tags/:tagId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const tagId = asTagId(String(params.tagId ?? ''), 'tagId');
        const rawBody = (await request.json().catch(() => null)) as UpdateTagInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for tag update.');
        }

        const updated = await services.tasks.updateTag(actorUserId, organizationId, tagId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tags/:tagId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const tagId = asTagId(String(params.tagId ?? ''), 'tagId');

        const deleted = await services.tasks.deleteTag(actorUserId, organizationId, tagId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    // Dependencies
    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/dependencies',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const dependencies = await services.dependencies.listTaskDependencies(
          actorUserId,
          organizationId,
          taskId,
        );
        return buildSuccessResponse(dependencies, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/dependencies',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as AddTaskDependencyInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for dependency creation.');
        }

        const added = await services.dependencies.addDependency(
          actorUserId,
          organizationId,
          taskId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(added, correlationId, now, 201);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/dependencies/:dependencyId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const dependencyId = asTaskDependencyId(String(params.dependencyId ?? ''), 'dependencyId');

        const removed = await services.dependencies.removeDependency(
          actorUserId,
          organizationId,
          taskId,
          dependencyId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(removed, correlationId, now, 200);
      }),
    ),

    // Impediments
    http.get(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/impediments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');

        const impediments = await services.impediments.listTaskImpediments(
          actorUserId,
          organizationId,
          taskId,
        );
        return buildSuccessResponse(impediments, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/impediments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const rawBody = (await request.json().catch(() => null)) as CreateImpedimentInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for impediment creation.');
        }

        const created = await services.impediments.createImpediment(
          actorUserId,
          organizationId,
          taskId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/impediments/:impedimentId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const impedimentId = asImpedimentId(String(params.impedimentId ?? ''), 'impedimentId');
        const rawBody = (await request.json().catch(() => null)) as UpdateImpedimentInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for impediment update.');
        }

        const updated = await services.impediments.updateImpediment(
          actorUserId,
          organizationId,
          taskId,
          impedimentId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/tasks/:taskId/impediments/:impedimentId/transition',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const taskId = asTaskId(String(params.taskId ?? ''), 'taskId');
        const impedimentId = asImpedimentId(String(params.impedimentId ?? ''), 'impedimentId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as TransitionImpedimentInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for impediment transition.');
        }

        const transitioned = await services.impediments.transitionImpediment(
          actorUserId,
          organizationId,
          taskId,
          impedimentId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );

        return buildSuccessResponse(transitioned, correlationId, now, 200);
      }),
    ),

    // -------------------------------------------------------------------------
    // Phase 08 — Focus Mode, Workload 0–100 & Bottlenecks (FocusService & BottleneckService)
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/focus',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const rawProjectId = url.searchParams.get('projectId')?.trim();
        const rawOnlyMyTasks = url.searchParams.get('onlyMyTasks')?.trim();

        const view = await services.focus.getMyFocusView(actorUserId, organizationId, {
          ...(rawProjectId ? { projectId: asProjectId(rawProjectId, 'projectId') } : {}),
          ...(rawOnlyMyTasks === 'true' ? { onlyMyTasks: true } : {}),
        });
        return buildSuccessResponse(view, correlationId, now, 200);
      }),
    ),

    http.put(
      '*/api/v1/organizations/:organizationId/focus/preferences',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as UpdateFocusPreferencesInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for focus preferences update.');
        }

        const updated = await services.focus.updateFocusPreferences(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });
        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/focus/preferences/reset',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const reset = await services.focus.resetFocusPreferences(actorUserId, organizationId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });
        return buildSuccessResponse(reset, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/workload/me',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const summary = await services.bottlenecks.getMyWorkloadSummary(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(summary, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/bottlenecks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const rawProjectId = url.searchParams.get('projectId')?.trim();
        const rawIndicator = url.searchParams.get('indicator')?.trim();
        const rawStatus = url.searchParams.get('status')?.trim();
        const rawIncludeResolved = url.searchParams.get('includeResolved')?.trim();

        const alerts = await services.bottlenecks.listOrganizationAlerts(
          actorUserId,
          organizationId,
          {
            ...(rawProjectId ? { projectId: asProjectId(rawProjectId, 'projectId') } : {}),
            ...(rawIndicator ? { indicator: rawIndicator as BottleneckIndicator } : {}),
            ...(rawStatus ? { status: rawStatus as BottleneckAlertStatus } : {}),
            ...(rawIncludeResolved === 'true' ? { includeResolved: true } : {}),
          },
        );
        return buildSuccessResponse(alerts, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId/bottlenecks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');

        const overview = await services.bottlenecks.getProjectBottlenecksOverview(
          actorUserId,
          organizationId,
          projectId,
        );
        return buildSuccessResponse(overview, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/evaluate',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');

        const result = await services.bottlenecks.evaluateProjectBottlenecks(
          actorUserId,
          organizationId,
          projectId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/thresholds',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const projectId = asProjectId(String(params.projectId ?? ''), 'projectId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as UpdateProjectBottleneckRulesInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for bottleneck thresholds update.');
        }

        const updated = await services.bottlenecks.updateProjectBottleneckRules(
          actorUserId,
          organizationId,
          projectId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/bottlenecks/:alertId/acknowledge',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const alertId = asBottleneckAlertId(String(params.alertId ?? ''), 'alertId');

        const acknowledged = await services.bottlenecks.acknowledgeAlert(
          actorUserId,
          organizationId,
          alertId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(acknowledged, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/bottlenecks/:alertId/resolve',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const alertId = asBottleneckAlertId(String(params.alertId ?? ''), 'alertId');

        const resolved = await services.bottlenecks.resolveAlert(
          actorUserId,
          organizationId,
          alertId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(resolved, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/settings/productivity-visibility',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const visibility = await services.bottlenecks.getIndividualProductivityVisibility(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(visibility, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/settings/productivity-visibility',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as UpdateIndividualProductivityVisibilityInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for productivity visibility update.');
        }

        const updated = await services.bottlenecks.updateIndividualProductivityVisibility(
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

    // =========================================================================
    // Phase 09 — Feedbacks, SLA, Contestations & Exceptional Reopen (FeedbackService)
    // =========================================================================

    http.get(
      '*/api/v1/organizations/:organizationId/feedbacks/export',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const formatParam = url.searchParams.get('format');
        const statusParam = url.searchParams.get('status');
        const assigneeIdParam = url.searchParams.get('assigneeId');
        const authorUserIdParam = url.searchParams.get('authorUserId');
        const feedbackIdParam = url.searchParams.get('feedbackId');

        const result = await services.feedback.exportFeedbacks(actorUserId, organizationId, {
          format: (formatParam ? formatParam.toUpperCase() : 'JSON') as FeedbackExportFormat,
          ...(statusParam ? { status: statusParam as FeedbackStatus } : {}),
          ...(assigneeIdParam ? { assigneeId: asUserId(assigneeIdParam, 'assigneeId') } : {}),
          ...(authorUserIdParam
            ? { authorUserId: asUserId(authorUserIdParam, 'authorUserId') }
            : {}),
          ...(feedbackIdParam ? { feedbackId: asFeedbackId(feedbackIdParam, 'feedbackId') } : {}),
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });
        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/evaluate-sla',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const result = await services.feedback.evaluateFeedbackSlas(actorUserId, organizationId, {
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });
        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/feedbacks/assignable-handlers',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const handlers = await services.feedback.listAssignableHandlers(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(handlers, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/feedbacks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const statusParam = url.searchParams.get('status');
        const assigneeIdParam = url.searchParams.get('assigneeId');
        const authorUserIdParam = url.searchParams.get('authorUserId');
        const moduleKeyParam = url.searchParams.get('moduleKey');
        const categoryIdParam = url.searchParams.get('categoryId');
        const priorityParam = url.searchParams.get('priority');
        const searchParam = url.searchParams.get('search');
        const pageParam = url.searchParams.get('page');
        const pageSizeParam = url.searchParams.get('pageSize');

        const result = await services.feedback.listFeedbacks(actorUserId, organizationId, {
          ...(statusParam ? { status: statusParam as FeedbackStatus } : {}),
          ...(assigneeIdParam ? { assigneeId: asUserId(assigneeIdParam, 'assigneeId') } : {}),
          ...(authorUserIdParam
            ? { authorUserId: asUserId(authorUserIdParam, 'authorUserId') }
            : {}),
          ...(moduleKeyParam ? { moduleKey: moduleKeyParam } : {}),
          ...(categoryIdParam
            ? { categoryId: asFeedbackCategoryId(categoryIdParam, 'categoryId') }
            : {}),
          ...(priorityParam ? { priority: priorityParam as Priority } : {}),
          ...(searchParam ? { search: searchParam } : {}),
          ...(pageParam ? { page: Number(pageParam) } : {}),
          ...(pageSizeParam ? { pageSize: Number(pageSizeParam) } : {}),
        });
        return buildSuccessResponse(result, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateFeedbackInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback creation.');
        }

        const created = await services.feedback.createFeedback(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });
        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');

        const detail = await services.feedback.getFeedbackDetail(
          actorUserId,
          organizationId,
          feedbackId,
        );
        return buildSuccessResponse(detail, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/assign',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request.json().catch(() => null)) as AssignFeedbackInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback assignment.');
        }

        const assigned = await services.feedback.assignFeedback(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(assigned, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/status',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as TransitionFeedbackStatusInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback status transition.');
        }

        const transitioned = await services.feedback.transitionFeedbackStatus(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(transitioned, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/triage',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as UpdateFeedbackTriageInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback triage update.');
        }

        const updated = await services.feedback.updateFeedbackTriage(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/messages',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request.json().catch(() => null)) as AddFeedbackMessageInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback message.');
        }

        const result = await services.feedback.addFeedbackMessage(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(result, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/internal-notes',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as AddFeedbackInternalNoteInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback internal note.');
        }

        const note = await services.feedback.addFeedbackInternalNote(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(note, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/attachments',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly fileName?: string;
          readonly mimeType?: string;
          readonly contentBase64?: string;
          readonly messageId?: string;
          readonly internalNoteId?: string;
        } | null;

        if (
          !rawBody ||
          typeof rawBody.fileName !== 'string' ||
          typeof rawBody.mimeType !== 'string' ||
          typeof rawBody.contentBase64 !== 'string'
        ) {
          throw new ValidationError(
            'Feedback attachment upload requires "fileName", "mimeType", and "contentBase64" strings.',
          );
        }

        const bytes = decodeBase64ToUint8Array(rawBody.contentBase64);
        const uploaded = await services.feedback.uploadFeedbackAttachment(
          actorUserId,
          organizationId,
          feedbackId,
          {
            fileName: rawBody.fileName,
            mimeType: rawBody.mimeType,
            bytes,
            ...(rawBody.messageId !== undefined
              ? { messageId: asFeedbackMessageId(rawBody.messageId, 'messageId') }
              : {}),
            ...(rawBody.internalNoteId !== undefined
              ? {
                  internalNoteId: asFeedbackInternalNoteId(
                    rawBody.internalNoteId,
                    'internalNoteId',
                  ),
                }
              : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(uploaded, correlationId, now, 201);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/attachments/:attachmentId/download',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const attachmentId = asAttachmentId(String(params.attachmentId ?? ''), 'attachmentId');

        const content = await services.feedback.getFeedbackAttachmentContent(
          actorUserId,
          organizationId,
          feedbackId,
          attachmentId,
        );

        return buildSuccessResponse(
          {
            attachment: content.attachment,
            mimeType: content.mimeType,
            contentBase64: encodeUint8ArrayToBase64(content.bytes),
          },
          correlationId,
          now,
          200,
        );
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/confirm-resolution',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');

        const confirmed = await services.feedback.confirmFeedbackResolution(
          actorUserId,
          organizationId,
          feedbackId,
          {
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(confirmed, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/contests',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request.json().catch(() => null)) as OpenFeedbackContestInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for opening feedback contest.');
        }

        const contest = await services.feedback.openFeedbackContest(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(contest, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/contests/:contestId/delegate',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const contestId = asFeedbackContestId(String(params.contestId ?? ''), 'contestId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as DelegateContestAnalysisInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for contest analysis delegation.');
        }

        const contest = await services.feedback.delegateFeedbackContestAnalysis(
          actorUserId,
          organizationId,
          feedbackId,
          contestId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(contest, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/contests/:contestId/analysis',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const contestId = asFeedbackContestId(String(params.contestId ?? ''), 'contestId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as SubmitContestAnalysisInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for contest analysis submission.');
        }

        const analysis = await services.feedback.submitFeedbackContestAnalysis(
          actorUserId,
          organizationId,
          feedbackId,
          contestId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(analysis, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/contests/:contestId/decision',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const contestId = asFeedbackContestId(String(params.contestId ?? ''), 'contestId');
        const rawBody = (await request.json().catch(() => null)) as DecideContestInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for contest decision.');
        }

        const decided = await services.feedback.decideFeedbackContest(
          actorUserId,
          organizationId,
          feedbackId,
          contestId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(decided, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/reopen-requests',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as RequestExceptionalReopenInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for exceptional reopen request.');
        }

        const reopenedReq = await services.feedback.requestExceptionalReopen(
          actorUserId,
          organizationId,
          feedbackId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(reopenedReq, correlationId, now, 201);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedbacks/:feedbackId/reopen-requests/:requestId/decision',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const feedbackId = asFeedbackId(String(params.feedbackId ?? ''), 'feedbackId');
        const requestId = asFeedbackReopenRequestId(String(params.requestId ?? ''), 'requestId');
        const rawBody = (await request
          .json()
          .catch(() => null)) as DecideExceptionalReopenInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for exceptional reopen decision.');
        }

        const decided = await services.feedback.decideExceptionalReopen(
          actorUserId,
          organizationId,
          feedbackId,
          requestId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(decided, correlationId, now, 200);
      }),
    ),

    // Feedback Categories (versioned catalog)
    http.get(
      '*/api/v1/organizations/:organizationId/feedback-categories',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true';

        const categories = await services.feedback.listFeedbackCategories(
          actorUserId,
          organizationId,
          { includeInactive },
        );
        return buildSuccessResponse(categories, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedback-categories/reorder',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as ReorderFeedbackCategoriesInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for category reorder.');
        }

        const reordered = await services.feedback.reorderFeedbackCategories(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(reordered, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedback-categories',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateCatalogItemInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback category creation.');
        }

        const created = await services.feedback.createFeedbackCategory(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/feedback-categories/:categoryId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const categoryId = asFeedbackCategoryId(String(params.categoryId ?? ''), 'categoryId');
        const rawBody = (await request.json().catch(() => null)) as UpdateCatalogItemInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback category update.');
        }

        const updated = await services.feedback.updateFeedbackCategory(
          actorUserId,
          organizationId,
          categoryId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/feedback-categories/:categoryId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const categoryId = asFeedbackCategoryId(String(params.categoryId ?? ''), 'categoryId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;
        const reason =
          rawBody?.reason ?? new URL(request.url).searchParams.get('reason') ?? undefined;

        const deleted = await services.feedback.deleteFeedbackCategory(
          actorUserId,
          organizationId,
          categoryId,
          {
            ...(reason !== undefined ? { reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    // Feedback Contest Reasons (versioned catalog)
    http.get(
      '*/api/v1/organizations/:organizationId/feedback-contest-reasons',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true';

        const reasons = await services.feedback.listFeedbackContestReasons(
          actorUserId,
          organizationId,
          { includeInactive },
        );
        return buildSuccessResponse(reasons, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedback-contest-reasons/reorder',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as ReorderFeedbackContestReasonsInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for contest reason reorder.');
        }

        const reordered = await services.feedback.reorderFeedbackContestReasons(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(reordered, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/feedback-contest-reasons',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as CreateCatalogItemInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for contest reason creation.');
        }

        const created = await services.feedback.createFeedbackContestReason(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(created, correlationId, now, 201);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/feedback-contest-reasons/:reasonId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const reasonId = asFeedbackContestReasonId(String(params.reasonId ?? ''), 'reasonId');
        const rawBody = (await request.json().catch(() => null)) as UpdateCatalogItemInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for contest reason update.');
        }

        const updated = await services.feedback.updateFeedbackContestReason(
          actorUserId,
          organizationId,
          reasonId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.delete(
      '*/api/v1/organizations/:organizationId/feedback-contest-reasons/:reasonId',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const reasonId = asFeedbackContestReasonId(String(params.reasonId ?? ''), 'reasonId');
        const rawBody = (await request.json().catch(() => null)) as {
          readonly reason?: string;
        } | null;
        const reason =
          rawBody?.reason ?? new URL(request.url).searchParams.get('reason') ?? undefined;

        const deleted = await services.feedback.deleteFeedbackContestReason(
          actorUserId,
          organizationId,
          reasonId,
          {
            ...(reason !== undefined ? { reason } : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(deleted, correlationId, now, 200);
      }),
    ),

    // Feedback SLA Settings
    http.get(
      '*/api/v1/organizations/:organizationId/settings/feedback-sla',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const settingsView = await services.feedback.getFeedbackSlaSettings(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(settingsView, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/settings/feedback-sla',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as UpdateFeedbackSlaSettingsInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for feedback SLA settings update.');
        }

        const updated = await services.feedback.updateFeedbackSlaSettings(
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
      '*/api/v1/organizations/:organizationId/audit-events',
      withSimulatedEndpoint(deps, async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const contextLookup = createAuthorizationContextLookupAdapter(deps.repositories);
        const [org, membership, scopeSummary, grants, explicitDenies] = await Promise.all([
          deps.repositories.organizations.organizations.findById(organizationId),
          contextLookup.getOrganizationMembership(organizationId, actorUserId),
          contextLookup.getActorScopeSummary(organizationId, actorUserId),
          deps.repositories.authorization.permissionGrants.listActiveByGrantee(
            organizationId,
            actorUserId,
            now,
          ),
          deps.repositories.authorization.explicitDenyRules.listActiveByTargetUser(
            organizationId,
            actorUserId,
            now,
          ),
        ]);

        assertAuthorized({
          actor: {
            isAuthenticated: true,
            userId: actorUserId,
            ...(membership !== null ? { organizationMembership: membership } : {}),
            ...scopeSummary,
            grants,
            explicitDenies,
          },
          action: PERMISSION_CODES.AUDIT_ORGANIZATION_VIEW,
          resource: {
            kind: 'AUDIT',
            exists: org !== null && !isSoftDeleted(org),
            organizationId,
            deletedAt: org?.deletedAt,
          },
          context: { now },
        });

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

    ...createAnalyticsAndReportsMswHandlers({
      services,
      withSimulatedEndpoint: (handler) => withSimulatedEndpoint(deps, handler),
      requireActorUserId,
      buildSuccessResponse,
    }),
  ];
}
