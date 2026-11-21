import {
  AuthService,
  type EphemeralSessionPointerPort,
  type PasswordVerifierPort,
} from '@/modules/authentication';
import { WebCryptoSimulatedPasswordVerifier } from '@/modules/authentication/infrastructure/security/web-crypto-password-verifier';
import {
  BrowserEphemeralSessionPointer,
  InMemoryEphemeralSessionPointer,
} from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { AuthorizationManagementService } from '@/modules/authorization';
import { InvitationService } from '@/modules/invitations';
import { KanbanService } from '@/modules/kanban';
import { OrganizationService } from '@/modules/organizations';
import { ProjectService } from '@/modules/projects';
import { TeamService } from '@/modules/teams';
import { UserService } from '@/modules/users';
import { env as defaultEnv, type AppEnv } from '@/shared/config';
import {
  SimulationScenarioController,
  createHttpClient,
  type CreateHttpClientOptions,
  type HttpClient,
} from '@/shared/http';
import {
  MEMBERSHIP_STATUSES,
  type AttachmentBlobStorePort,
  type IsoDateTime,
  type OrganizationId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import { createLogger, type Logger } from '@/shared/logging';
import {
  DexieAttachmentBlobStore,
  DexieTransactionAdapter,
  PostCommitDomainEventBus,
  createPmsDatabase,
  type CreatePmsDatabaseOptions,
  type PmsDatabase,
} from '@/shared/persistence';
import {
  createAuthorizationAuditWriterAdapter,
  createAuthorizationContextLookupAdapter,
} from './authorization-ports-adapter';
import { ensureDemoOrganizationSeeded, type DemoOrganizationSeedResult } from './demo-seed';
import {
  createProjectBoardInitializerAdapter,
  createProjectTeamLookupAdapter,
} from './project-ports-adapter';
import { createRepositoriesRegistry, type AppRepositoriesRegistry } from './repositories-registry';

export interface AppServicesRegistry {
  readonly auth: AuthService;
  readonly users: UserService;
  readonly organizations: OrganizationService;
  readonly invitations: InvitationService;
  readonly teams: TeamService;
  readonly projects: ProjectService;
  readonly kanban: KanbanService;
  readonly authorization: AuthorizationManagementService;
}

export interface AppCompositionContainer {
  readonly env: AppEnv;
  readonly logger: Logger;
  readonly db: PmsDatabase;
  readonly eventBus: PostCommitDomainEventBus;
  readonly transactionPort: TransactionPort;
  readonly attachmentBlobStore: AttachmentBlobStorePort;
  readonly repositories: AppRepositoriesRegistry;
  readonly passwordVerifier: PasswordVerifierPort;
  readonly ephemeralSessionPointer: EphemeralSessionPointerPort;
  readonly services: AppServicesRegistry;
  readonly simulationController: SimulationScenarioController;
  readonly httpClient: HttpClient;
  readonly seedDemoOrganization: (now?: IsoDateTime) => Promise<DemoOrganizationSeedResult>;
}

export interface CreateAppContainerOptions {
  readonly env?: AppEnv;
  readonly logger?: Logger;
  readonly db?: PmsDatabase;
  readonly dbOptions?: CreatePmsDatabaseOptions;
  readonly eventBus?: PostCommitDomainEventBus;
  readonly transactionPort?: TransactionPort;
  readonly attachmentBlobStore?: AttachmentBlobStorePort;
  readonly repositories?: AppRepositoriesRegistry;
  readonly passwordVerifier?: PasswordVerifierPort;
  readonly ephemeralSessionPointer?: EphemeralSessionPointerPort;
  readonly services?: AppServicesRegistry;
  readonly simulationController?: SimulationScenarioController;
  readonly httpClient?: HttpClient;
  readonly httpClientOptions?: CreateHttpClientOptions;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

function createDefaultEphemeralSessionPointer(): EphemeralSessionPointerPort {
  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    return new BrowserEphemeralSessionPointer();
  }
  return new InMemoryEphemeralSessionPointer();
}

export function createAppContainer(
  options: CreateAppContainerOptions = {},
): AppCompositionContainer {
  const resolvedEnv = options.env ?? defaultEnv;
  const resolvedLogger =
    options.logger ??
    createLogger({
      minLevel: resolvedEnv.VITE_LOG_LEVEL,
    });

  const resolvedDb = options.db ?? createPmsDatabase(options.dbOptions);
  const resolvedEventBus = options.eventBus ?? new PostCommitDomainEventBus();
  const resolvedTransactionPort =
    options.transactionPort ?? new DexieTransactionAdapter(resolvedDb, resolvedEventBus);
  const resolvedAttachmentBlobStore =
    options.attachmentBlobStore ?? new DexieAttachmentBlobStore(resolvedDb);
  const resolvedRepositories = options.repositories ?? createRepositoriesRegistry(resolvedDb);
  const resolvedPasswordVerifier =
    options.passwordVerifier ?? new WebCryptoSimulatedPasswordVerifier();
  const resolvedEphemeralSessionPointer =
    options.ephemeralSessionPointer ?? createDefaultEphemeralSessionPointer();
  const resolvedSimulationController =
    options.simulationController ?? new SimulationScenarioController();
  const resolvedHttpClient = options.httpClient ?? createHttpClient(options.httpClientOptions);

  const seedDemoOrganization = (now?: IsoDateTime): Promise<DemoOrganizationSeedResult> =>
    ensureDemoOrganizationSeeded(
      {
        repositories: resolvedRepositories,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        passwordVerifier: resolvedPasswordVerifier,
      },
      now,
    );

  const isActiveOrganizationMember = async (
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<boolean> => {
    const member =
      await resolvedRepositories.organizations.organizationMembers.findByOrganizationAndUser(
        organizationId,
        userId,
      );
    return member !== null && member.status === MEMBERSHIP_STATUSES.ACTIVE;
  };

  const resolvedServices: AppServicesRegistry =
    options.services ??
    Object.freeze({
      auth: new AuthService({
        users: resolvedRepositories.users.users,
        localCredentials: resolvedRepositories.authentication.localCredentials,
        userSessions: resolvedRepositories.authentication.userSessions,
        auditEvents: resolvedRepositories.audit.auditEvents,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        passwordVerifier: resolvedPasswordVerifier,
        ephemeralSessionPointer: resolvedEphemeralSessionPointer,
        seedDemoOrganization,
        isActiveOrganizationMember,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      users: new UserService({
        users: resolvedRepositories.users.users,
        auditEvents: resolvedRepositories.audit.auditEvents,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        isActiveOrganizationMember,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      organizations: new OrganizationService({
        organizations: resolvedRepositories.organizations.organizations,
        organizationMembers: resolvedRepositories.organizations.organizationMembers,
        organizationSettings: resolvedRepositories.settings.organizationSettings,
        users: resolvedRepositories.users.users,
        permissionGrants: resolvedRepositories.authorization.permissionGrants,
        explicitDenyRules: resolvedRepositories.authorization.explicitDenyRules,
        auditEvents: resolvedRepositories.audit.auditEvents,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      invitations: new InvitationService({
        invitations: resolvedRepositories.invitations.invitations,
        organizations: resolvedRepositories.organizations.organizations,
        organizationMembers: resolvedRepositories.organizations.organizationMembers,
        users: resolvedRepositories.users.users,
        permissionGrants: resolvedRepositories.authorization.permissionGrants,
        explicitDenyRules: resolvedRepositories.authorization.explicitDenyRules,
        auditEvents: resolvedRepositories.audit.auditEvents,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      teams: new TeamService({
        teams: resolvedRepositories.teams.teams,
        teamMembers: resolvedRepositories.teams.teamMembers,
        projects: resolvedRepositories.projects.projects,
        organizationMembers: resolvedRepositories.organizations.organizationMembers,
        users: resolvedRepositories.users.users,
        permissionGrants: resolvedRepositories.authorization.permissionGrants,
        explicitDenyRules: resolvedRepositories.authorization.explicitDenyRules,
        auditEvents: resolvedRepositories.audit.auditEvents,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      projects: new ProjectService({
        projects: resolvedRepositories.projects.projects,
        projectMembers: resolvedRepositories.projects.projectMembers,
        tasks: resolvedRepositories.tasks.tasks,
        taskParticipants: resolvedRepositories.tasks.taskParticipants,
        organizationMembers: resolvedRepositories.organizations.organizationMembers,
        users: resolvedRepositories.users.users,
        permissionGrants: resolvedRepositories.authorization.permissionGrants,
        explicitDenyRules: resolvedRepositories.authorization.explicitDenyRules,
        auditEvents: resolvedRepositories.audit.auditEvents,
        teamLookup: createProjectTeamLookupAdapter(resolvedRepositories),
        boardInitializer: createProjectBoardInitializerAdapter(resolvedRepositories),
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      kanban: new KanbanService({
        projects: resolvedRepositories.projects.projects,
        projectMembers: resolvedRepositories.projects.projectMembers,
        projectBoards: resolvedRepositories.kanban.projectBoards,
        boardColumns: resolvedRepositories.kanban.boardColumns,
        tasks: resolvedRepositories.tasks.tasks,
        taskParticipants: resolvedRepositories.tasks.taskParticipants,
        subtasks: resolvedRepositories.tasks.subtasks,
        taskDependencies: resolvedRepositories.dependencies.taskDependencies,
        impediments: resolvedRepositories.impediments.impediments,
        taskPauses: resolvedRepositories.tasks.taskPauses,
        taskExecutionCycles: resolvedRepositories.tasks.taskExecutionCycles,
        organizationMembers: resolvedRepositories.organizations.organizationMembers,
        organizationSettings: resolvedRepositories.settings.organizationSettings,
        permissionGrants: resolvedRepositories.authorization.permissionGrants,
        explicitDenyRules: resolvedRepositories.authorization.explicitDenyRules,
        auditEvents: resolvedRepositories.audit.auditEvents,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
      authorization: new AuthorizationManagementService({
        permissionGrants: resolvedRepositories.authorization.permissionGrants,
        explicitDenyRules: resolvedRepositories.authorization.explicitDenyRules,
        contextLookup: createAuthorizationContextLookupAdapter(resolvedRepositories),
        auditWriter: createAuthorizationAuditWriterAdapter(
          resolvedRepositories,
          options.generateUuid,
        ),
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
        logger: resolvedLogger,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.generateUuid !== undefined ? { generateUuid: options.generateUuid } : {}),
      }),
    });

  return Object.freeze({
    env: resolvedEnv,
    logger: resolvedLogger,
    db: resolvedDb,
    eventBus: resolvedEventBus,
    transactionPort: resolvedTransactionPort,
    attachmentBlobStore: resolvedAttachmentBlobStore,
    repositories: resolvedRepositories,
    passwordVerifier: resolvedPasswordVerifier,
    ephemeralSessionPointer: resolvedEphemeralSessionPointer,
    services: resolvedServices,
    simulationController: resolvedSimulationController,
    httpClient: resolvedHttpClient,
    seedDemoOrganization,
  });
}
