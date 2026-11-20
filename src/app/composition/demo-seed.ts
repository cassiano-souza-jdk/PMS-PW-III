import {
  DEMO_CREDENTIALS_BY_ROLE,
  type LocalCredential,
  type PasswordVerifierPort,
} from '@/modules/authentication';
import { WebCryptoSimulatedPasswordVerifier } from '@/modules/authentication/infrastructure/security/web-crypto-password-verifier';
import {
  DEMO_SEED_VERSION,
  MAINTENANCE_ACTIONS,
  MAINTENANCE_STATUSES,
  asMaintenanceEventId,
} from '@/modules/demo';
import {
  INITIAL_CONTEST_REASONS,
  INITIAL_FEEDBACK_CATEGORIES,
  asFeedbackCategoryId,
  asFeedbackCategoryVersionId,
  asFeedbackContestReasonId,
  asFeedbackContestReasonVersionId,
  type FeedbackCategory,
  type FeedbackCategoryVersion,
  type FeedbackContestReason,
  type FeedbackContestReasonVersion,
} from '@/modules/feedback';
import { BOARD_COLUMN_ROLES, type BoardColumn, type ProjectBoard } from '@/modules/kanban';
import {
  asOrganizationMemberId,
  type Organization,
  type OrganizationMember,
} from '@/modules/organizations';
import {
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  asProjectMemberId,
  type Project,
  type ProjectMember,
} from '@/modules/projects';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import type { Task } from '@/modules/tasks';
import { asTeamMemberId, type Team, type TeamMember } from '@/modules/teams';
import type { User } from '@/modules/users';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asBoardColumnId,
  asBoardId,
  asCorrelationId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTaskId,
  asTeamId,
  asUserId,
  createDomainEvent,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type TransactionPort,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';

export const DEMO_DEFAULT_SEED_TIMESTAMP = asIsoDateTime('2026-01-15T12:00:00.000Z');

export const DEMO_ORG_ID = asOrganizationId('11111111-1111-4111-8111-111111111101');
export const DEMO_ORG_SLUG = 'pms-demo' as const;

export const DEMO_ADMIN_USER_ID = asUserId('11111111-1111-4111-8111-111111111201');
export const DEMO_MANAGER_USER_ID = asUserId('11111111-1111-4111-8111-111111111202');
export const DEMO_MEMBER_USER_ID = asUserId('11111111-1111-4111-8111-111111111203');

export const DEMO_ADMIN_MEMBERSHIP_ID = asOrganizationMemberId(
  '11111111-1111-4111-8111-111111111301',
);
export const DEMO_MANAGER_MEMBERSHIP_ID = asOrganizationMemberId(
  '11111111-1111-4111-8111-111111111302',
);
export const DEMO_MEMBER_MEMBERSHIP_ID = asOrganizationMemberId(
  '11111111-1111-4111-8111-111111111303',
);

export const DEMO_TEAM_ID = asTeamId('11111111-1111-4111-8111-111111111401');
export const DEMO_PROJECT_ID = asProjectId('11111111-1111-4111-8111-111111111501');
export const DEMO_BOARD_ID = asBoardId('11111111-1111-4111-8111-111111111601');

export const DEMO_COLUMN_IDS = Object.freeze({
  TODO: asBoardColumnId('11111111-1111-4111-8111-111111111701'),
  IN_PROGRESS: asBoardColumnId('11111111-1111-4111-8111-111111111702'),
  REVIEW: asBoardColumnId('11111111-1111-4111-8111-111111111703'),
  DONE: asBoardColumnId('11111111-1111-4111-8111-111111111704'),
});

export const DEMO_TASK_IDS = Object.freeze({
  FOUNDATION_TASK: asTaskId('11111111-1111-4111-8111-111111111801'),
  KANBAN_FLOW_TASK: asTaskId('11111111-1111-4111-8111-111111111802'),
});

export const DEMO_MAINTENANCE_EVENT_ID = asMaintenanceEventId(
  '11111111-1111-4111-8111-111111111901',
);

const DEMO_SEED_EVENT_ID = asEventId('11111111-1111-4111-8111-111111111998');
const DEMO_SEED_CORRELATION_ID = asCorrelationId('11111111-1111-4111-8111-111111111999');

export interface DemoSeedDependencies {
  readonly repositories: AppRepositoriesRegistry;
  readonly transactionPort: TransactionPort;
  readonly eventBus?: DomainEventPublisherPort;
  readonly passwordVerifier?: PasswordVerifierPort;
}

export interface DemoOrganizationSeedResult {
  readonly seeded: boolean;
  readonly organizationId: OrganizationId;
  readonly seedVersion: typeof DEMO_SEED_VERSION;
}

const FEEDBACK_CATEGORY_LABELS: Readonly<Record<keyof typeof INITIAL_FEEDBACK_CATEGORIES, string>> =
  {
    BUG_ERROR: 'Erro ou defeito',
    IMPROVEMENT: 'Melhoria continua',
    NEW_FEATURE: 'Nova funcionalidade',
    USABILITY: 'Usabilidade e experiencia',
    PERFORMANCE: 'Desempenho',
    SECURITY: 'Seguranca e privacidade',
    QUESTION_SUPPORT: 'Duvida ou suporte',
    OTHER: 'Outros',
  };

const CONTEST_REASON_LABELS: Readonly<Record<keyof typeof INITIAL_CONTEST_REASONS, string>> = {
  SOLUTION_DID_NOT_RESOLVE: 'A solucao apresentada nao resolveu o problema',
  PARTIALLY_APPLIED: 'A solucao foi aplicada apenas parcialmente',
  PROBLEM_RETURNED: 'O problema voltou a ocorrer',
  DIFFERENT_FROM_REQUESTED: 'A entrega diverge do solicitado originalmente',
  PROBLEM_PERSISTS: 'O comportamento incorreto persiste',
  NEW_EVIDENCE: 'Surgiram novas evidencias relevantes',
  DISAGREEMENT: 'Discordancia fundamentada sobre a conclusao',
  OTHER: 'Outro motivo justificado',
};

function buildDeterministicFeedbackCatalog(now: IsoDateTime): {
  readonly categories: readonly FeedbackCategory[];
  readonly categoryVersions: readonly FeedbackCategoryVersion[];
  readonly reasons: readonly FeedbackContestReason[];
  readonly reasonVersions: readonly FeedbackContestReasonVersion[];
} {
  const categoryCodes = Object.keys(
    INITIAL_FEEDBACK_CATEGORIES,
  ) as (keyof typeof INITIAL_FEEDBACK_CATEGORIES)[];

  const categories: FeedbackCategory[] = [];
  const categoryVersions: FeedbackCategoryVersion[] = [];

  categoryCodes.forEach((code, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const categoryId = asFeedbackCategoryId(`22222222-2222-4222-8222-2222222201${suffix}`);
    const versionId = asFeedbackCategoryVersionId(`22222222-2222-4222-8222-2222222202${suffix}`);

    categories.push({
      id: categoryId,
      organizationId: DEMO_ORG_ID,
      code,
      currentVersionId: versionId,
      active: true,
      sortOrder: index + 1,
      hasBeenUsed: false,
      createdAt: now,
      updatedAt: now,
    });

    categoryVersions.push({
      id: versionId,
      organizationId: DEMO_ORG_ID,
      categoryId,
      versionNumber: 1,
      name: FEEDBACK_CATEGORY_LABELS[code],
      active: true,
      createdByUserId: DEMO_ADMIN_USER_ID,
      createdAt: now,
    });
  });

  const reasonCodes = Object.keys(
    INITIAL_CONTEST_REASONS,
  ) as (keyof typeof INITIAL_CONTEST_REASONS)[];

  const reasons: FeedbackContestReason[] = [];
  const reasonVersions: FeedbackContestReasonVersion[] = [];

  reasonCodes.forEach((code, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const reasonId = asFeedbackContestReasonId(`22222222-2222-4222-8222-2222222203${suffix}`);
    const versionId = asFeedbackContestReasonVersionId(
      `22222222-2222-4222-8222-2222222204${suffix}`,
    );

    reasons.push({
      id: reasonId,
      organizationId: DEMO_ORG_ID,
      code,
      currentVersionId: versionId,
      active: true,
      sortOrder: index + 1,
      hasBeenUsed: false,
      createdAt: now,
      updatedAt: now,
    });

    reasonVersions.push({
      id: versionId,
      organizationId: DEMO_ORG_ID,
      reasonId,
      versionNumber: 1,
      name: CONTEST_REASON_LABELS[code],
      active: true,
      createdByUserId: DEMO_ADMIN_USER_ID,
      createdAt: now,
    });
  });

  return {
    categories,
    categoryVersions,
    reasons,
    reasonVersions,
  };
}

async function buildDemoLocalCredentials(
  passwordVerifier: PasswordVerifierPort,
  now: IsoDateTime,
): Promise<readonly LocalCredential[]> {
  const specs = [
    {
      userId: DEMO_ADMIN_USER_ID,
      descriptor: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.ADMIN],
      salt: 'demo-salt-admin-0000000000000001',
    },
    {
      userId: DEMO_MANAGER_USER_ID,
      descriptor: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MANAGER],
      salt: 'demo-salt-manager-00000000000002',
    },
    {
      userId: DEMO_MEMBER_USER_ID,
      descriptor: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MEMBER],
      salt: 'demo-salt-member-000000000000003',
    },
  ] as const;

  // CRITICAL (ADR-0008 §2.4): Compute all password verifiers OUTSIDE TransactionPort.run
  const credentials: LocalCredential[] = [];
  for (const spec of specs) {
    const hashed = await passwordVerifier.hashPassword(spec.descriptor.password, spec.salt);
    credentials.push({
      userId: spec.userId,
      email: spec.descriptor.email,
      passwordVerifier: hashed.passwordVerifier,
      salt: hashed.salt,
      algorithm: hashed.algorithm,
      updatedAt: now,
    });
  }

  return credentials;
}

/**
 * Idempotently seeds missing local credentials for the 3 canonical demo profiles
 * (supports non-destructive Dexie schema v1 -> v2 upgrades without overwriting existing records — ADR-0008 §2.5).
 */
export async function ensureDemoCredentialsSeeded(
  deps: DemoSeedDependencies,
  now: IsoDateTime = DEMO_DEFAULT_SEED_TIMESTAMP,
): Promise<number> {
  const passwordVerifier = deps.passwordVerifier ?? new WebCryptoSimulatedPasswordVerifier();

  const existingChecks = await Promise.all([
    deps.repositories.authentication.localCredentials.findByUserId(DEMO_ADMIN_USER_ID),
    deps.repositories.authentication.localCredentials.findByUserId(DEMO_MANAGER_USER_ID),
    deps.repositories.authentication.localCredentials.findByUserId(DEMO_MEMBER_USER_ID),
  ]);

  if (existingChecks.every((credential) => credential !== null)) {
    return 0;
  }

  // Compute outside Dexie transaction to prevent PrematureCommitError
  const credentials = await buildDemoLocalCredentials(passwordVerifier, now);

  return deps.transactionPort.run([TRANSACTION_RESOURCES.LOCAL_CREDENTIALS], async () => {
    let createdCount = 0;
    for (const credential of credentials) {
      const existing = await deps.repositories.authentication.localCredentials.findByUserId(
        credential.userId,
      );
      if (existing === null) {
        await deps.repositories.authentication.localCredentials.save(credential);
        createdCount += 1;
      }
    }
    return createdCount;
  });
}

/**
 * Idempotent and non-destructive deterministic seed for the isolated demo organization
 * (DATA-PERSISTENCE.md, PRD.md §18, ADR-0007 §5.3, ADR-0008 §2.5).
 *
 * If the canonical demo organization (`DEMO_ORG_ID`) already exists, ensures missing v2 demo
 * credentials are backfilled idempotently and returns `{ seeded: false }` without modifying
 * or overwriting any persisted record.
 */
export async function ensureDemoOrganizationSeeded(
  deps: DemoSeedDependencies,
  now: IsoDateTime = DEMO_DEFAULT_SEED_TIMESTAMP,
): Promise<DemoOrganizationSeedResult> {
  const existingBeforeTx =
    await deps.repositories.organizations.organizations.findById(DEMO_ORG_ID);
  if (existingBeforeTx !== null) {
    await ensureDemoCredentialsSeeded(deps, now);
    return Object.freeze({
      seeded: false,
      organizationId: DEMO_ORG_ID,
      seedVersion: DEMO_SEED_VERSION,
    });
  }

  const passwordVerifier = deps.passwordVerifier ?? new WebCryptoSimulatedPasswordVerifier();
  // CRITICAL (ADR-0008 §2.4): Compute demo password verifiers BEFORE opening Dexie transaction
  const demoCredentials = await buildDemoLocalCredentials(passwordVerifier, now);

  return deps.transactionPort.run(
    [
      TRANSACTION_RESOURCES.USERS,
      TRANSACTION_RESOURCES.LOCAL_CREDENTIALS,
      TRANSACTION_RESOURCES.ORGANIZATIONS,
      TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS,
      TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS,
      TRANSACTION_RESOURCES.TEAMS,
      TRANSACTION_RESOURCES.TEAM_MEMBERS,
      TRANSACTION_RESOURCES.PROJECTS,
      TRANSACTION_RESOURCES.PROJECT_MEMBERS,
      TRANSACTION_RESOURCES.PROJECT_BOARDS,
      TRANSACTION_RESOURCES.BOARD_COLUMNS,
      TRANSACTION_RESOURCES.TASKS,
      TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES,
      TRANSACTION_RESOURCES.FEEDBACK_CATEGORY_VERSIONS,
      TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS,
      TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASON_VERSIONS,
      TRANSACTION_RESOURCES.MAINTENANCE_EVENTS,
    ],
    async () => {
      const existingInsideTx =
        await deps.repositories.organizations.organizations.findById(DEMO_ORG_ID);
      if (existingInsideTx !== null) {
        return Object.freeze({
          seeded: false,
          organizationId: DEMO_ORG_ID,
          seedVersion: DEMO_SEED_VERSION,
        });
      }

      const demoUsers: readonly User[] = [
        {
          id: DEMO_ADMIN_USER_ID,
          email: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.ADMIN].email,
          displayName: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.ADMIN].displayName,
          acceptedTermsAt: now,
          emailVerifiedSimulated: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_MANAGER_USER_ID,
          email: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MANAGER].email,
          displayName: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MANAGER].displayName,
          acceptedTermsAt: now,
          emailVerifiedSimulated: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_MEMBER_USER_ID,
          email: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MEMBER].email,
          displayName: DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MEMBER].displayName,
          acceptedTermsAt: now,
          emailVerifiedSimulated: true,
          createdAt: now,
          updatedAt: now,
        },
      ];

      for (const user of demoUsers) {
        const existingUser = await deps.repositories.users.users.findById(user.id);
        if (!existingUser) {
          await deps.repositories.users.users.save(user);
        }
      }

      for (const credential of demoCredentials) {
        const existingCredential =
          await deps.repositories.authentication.localCredentials.findByUserId(credential.userId);
        if (!existingCredential) {
          await deps.repositories.authentication.localCredentials.save(credential);
        }
      }

      const demoOrganization: Organization = {
        id: DEMO_ORG_ID,
        name: 'Organizacao Demonstrativa PMS',
        slug: DEMO_ORG_SLUG,
        description:
          'Organizacao demonstrativa isolada para exploracao guiada do Project Management System.',
        isDemo: true,
        createdByUserId: DEMO_ADMIN_USER_ID,
        createdAt: now,
        updatedAt: now,
      };
      await deps.repositories.organizations.organizations.save(demoOrganization);

      const defaultSettings = createDefaultOrganizationSettings(DEMO_ORG_ID, now);
      await deps.repositories.settings.organizationSettings.save(defaultSettings);

      const memberships: readonly OrganizationMember[] = [
        {
          id: DEMO_ADMIN_MEMBERSHIP_ID,
          organizationId: DEMO_ORG_ID,
          userId: DEMO_ADMIN_USER_ID,
          role: ORGANIZATION_ROLES.ADMIN,
          status: MEMBERSHIP_STATUSES.ACTIVE,
          joinedAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_MANAGER_MEMBERSHIP_ID,
          organizationId: DEMO_ORG_ID,
          userId: DEMO_MANAGER_USER_ID,
          role: ORGANIZATION_ROLES.MANAGER,
          status: MEMBERSHIP_STATUSES.ACTIVE,
          joinedAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_MEMBER_MEMBERSHIP_ID,
          organizationId: DEMO_ORG_ID,
          userId: DEMO_MEMBER_USER_ID,
          role: ORGANIZATION_ROLES.MEMBER,
          status: MEMBERSHIP_STATUSES.ACTIVE,
          joinedAt: now,
          updatedAt: now,
        },
      ];

      for (const member of memberships) {
        await deps.repositories.organizations.organizationMembers.save(member);
      }

      const demoTeam: Team = {
        id: DEMO_TEAM_ID,
        organizationId: DEMO_ORG_ID,
        name: 'Equipe de Produto e Engenharia',
        description: 'Equipe demonstrativa responsavel pelas entregas do projeto.',
        managerUserIds: [DEMO_MANAGER_USER_ID],
        createdByUserId: DEMO_ADMIN_USER_ID,
        createdAt: now,
        updatedAt: now,
      };
      await deps.repositories.teams.teams.save(demoTeam);

      const teamMembers: readonly TeamMember[] = [
        {
          id: asTeamMemberId('11111111-1111-4111-8111-111111111411'),
          organizationId: DEMO_ORG_ID,
          teamId: DEMO_TEAM_ID,
          userId: DEMO_MANAGER_USER_ID,
          joinedAt: now,
        },
        {
          id: asTeamMemberId('11111111-1111-4111-8111-111111111412'),
          organizationId: DEMO_ORG_ID,
          teamId: DEMO_TEAM_ID,
          userId: DEMO_MEMBER_USER_ID,
          joinedAt: now,
        },
      ];
      for (const teamMember of teamMembers) {
        await deps.repositories.teams.teamMembers.save(teamMember);
      }

      const demoProject: Project = {
        id: DEMO_PROJECT_ID,
        organizationId: DEMO_ORG_ID,
        teamId: DEMO_TEAM_ID,
        name: 'Lancamento Plataforma PMS v1',
        description: 'Projeto demonstrativo com quadro Kanban, WIP e metricas operacionais.',
        status: PROJECT_STATUSES.ACTIVE,
        ownerUserId: DEMO_MANAGER_USER_ID,
        inactivityThresholdDays: 7,
        createdByUserId: DEMO_ADMIN_USER_ID,
        createdAt: now,
        updatedAt: now,
      };
      await deps.repositories.projects.projects.save(demoProject);

      const projectMembers: readonly ProjectMember[] = [
        {
          id: asProjectMemberId('11111111-1111-4111-8111-111111111511'),
          organizationId: DEMO_ORG_ID,
          projectId: DEMO_PROJECT_ID,
          userId: DEMO_MANAGER_USER_ID,
          projectRole: PROJECT_MEMBER_ROLES.MANAGER,
          joinedAt: now,
        },
        {
          id: asProjectMemberId('11111111-1111-4111-8111-111111111512'),
          organizationId: DEMO_ORG_ID,
          projectId: DEMO_PROJECT_ID,
          userId: DEMO_MEMBER_USER_ID,
          projectRole: PROJECT_MEMBER_ROLES.PARTICIPANT,
          joinedAt: now,
        },
      ];
      for (const projectMember of projectMembers) {
        await deps.repositories.projects.projectMembers.save(projectMember);
      }

      const demoBoard: ProjectBoard = {
        id: DEMO_BOARD_ID,
        organizationId: DEMO_ORG_ID,
        projectId: DEMO_PROJECT_ID,
        name: 'Quadro Principal',
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      };
      await deps.repositories.kanban.projectBoards.save(demoBoard);

      const demoColumns: readonly BoardColumn[] = [
        {
          id: DEMO_COLUMN_IDS.TODO,
          organizationId: DEMO_ORG_ID,
          boardId: DEMO_BOARD_ID,
          name: 'A Fazer',
          columnRole: BOARD_COLUMN_ROLES.INITIAL,
          order: 1,
          wipLimit: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_COLUMN_IDS.IN_PROGRESS,
          organizationId: DEMO_ORG_ID,
          boardId: DEMO_BOARD_ID,
          name: 'Em Execucao',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          order: 2,
          wipLimit: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_COLUMN_IDS.REVIEW,
          organizationId: DEMO_ORG_ID,
          boardId: DEMO_BOARD_ID,
          name: 'Em Revisao',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          order: 3,
          wipLimit: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_COLUMN_IDS.DONE,
          organizationId: DEMO_ORG_ID,
          boardId: DEMO_BOARD_ID,
          name: 'Concluido',
          columnRole: BOARD_COLUMN_ROLES.FINAL,
          order: 4,
          wipLimit: null,
          createdAt: now,
          updatedAt: now,
        },
      ];
      await deps.repositories.kanban.boardColumns.saveMany(DEMO_ORG_ID, demoColumns);

      const demoTasks: readonly Task[] = [
        {
          id: DEMO_TASK_IDS.FOUNDATION_TASK,
          organizationId: DEMO_ORG_ID,
          projectId: DEMO_PROJECT_ID,
          boardId: DEMO_BOARD_ID,
          columnId: DEMO_COLUMN_IDS.IN_PROGRESS,
          title: 'Validar persistencia local Dexie e isolamento multi-organizacao',
          description:
            'Garantir que todas as operacoes respeitem organizationId e transacoes atomicas.',
          status: TASK_STATUSES.IN_PROGRESS,
          priority: PRIORITIES.HIGH,
          assigneeId: DEMO_MEMBER_USER_ID,
          order: 1,
          tagIds: [],
          lastMovedAt: now,
          lastActivityAt: now,
          startedAt: now,
          createdByUserId: DEMO_MANAGER_USER_ID,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: DEMO_TASK_IDS.KANBAN_FLOW_TASK,
          organizationId: DEMO_ORG_ID,
          projectId: DEMO_PROJECT_ID,
          boardId: DEMO_BOARD_ID,
          columnId: DEMO_COLUMN_IDS.TODO,
          title: 'Revisar limites de WIP e fluxo operacional do quadro Kanban',
          description: 'Configurar limites de WIP e politicas de movimentacao de cartoes.',
          status: TASK_STATUSES.TODO,
          priority: PRIORITIES.MEDIUM,
          assigneeId: DEMO_MANAGER_USER_ID,
          order: 1,
          tagIds: [],
          lastMovedAt: now,
          lastActivityAt: now,
          createdByUserId: DEMO_MANAGER_USER_ID,
          createdAt: now,
          updatedAt: now,
        },
      ];
      for (const task of demoTasks) {
        await deps.repositories.tasks.tasks.save(task);
      }

      const catalog = buildDeterministicFeedbackCatalog(now);
      for (const category of catalog.categories) {
        await deps.repositories.feedback.feedbackCategories.saveCategory(category);
      }
      for (const version of catalog.categoryVersions) {
        await deps.repositories.feedback.feedbackCategories.saveVersion(version);
      }
      for (const reason of catalog.reasons) {
        await deps.repositories.feedback.feedbackContestReasons.saveReason(reason);
      }
      for (const version of catalog.reasonVersions) {
        await deps.repositories.feedback.feedbackContestReasons.saveVersion(version);
      }

      await deps.repositories.demo.maintenanceEvents.append({
        id: DEMO_MAINTENANCE_EVENT_ID,
        organizationId: DEMO_ORG_ID,
        action: MAINTENANCE_ACTIONS.SEED,
        performedByUserId: DEMO_ADMIN_USER_ID,
        status: MAINTENANCE_STATUSES.SUCCESS,
        details: `Deterministic demo organization seed v${DEMO_SEED_VERSION} completed.`,
        occurredAt: now,
      });

      if (deps.eventBus) {
        await deps.eventBus.publish(
          createDomainEvent({
            eventId: DEMO_SEED_EVENT_ID,
            eventType: 'demo.organization.seeded',
            occurredAt: now,
            organizationId: DEMO_ORG_ID,
            actorId: DEMO_ADMIN_USER_ID,
            correlationId: DEMO_SEED_CORRELATION_ID,
            aggregateType: 'Organization',
            aggregateId: DEMO_ORG_ID,
            payload: {
              seedVersion: DEMO_SEED_VERSION,
              isDemo: true,
            },
          }),
        );
      }

      return Object.freeze({
        seeded: true,
        organizationId: DEMO_ORG_ID,
        seedVersion: DEMO_SEED_VERSION,
      });
    },
  );
}
