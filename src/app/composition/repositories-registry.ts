import type { DashboardPreferenceRepositoryPort } from '@/modules/analytics';
import { DexieDashboardPreferenceRepository } from '@/modules/analytics/infrastructure/repositories/dexie-analytics.repository';
import type { AuditEventRepositoryPort } from '@/modules/audit';
import { DexieAuditEventRepository } from '@/modules/audit/infrastructure/repositories/dexie-audit.repository';
import type { UserSessionRepositoryPort } from '@/modules/authentication';
import { DexieUserSessionRepository } from '@/modules/authentication/infrastructure/repositories/dexie-user-session.repository';
import type {
  ExplicitDenyRuleRepositoryPort,
  PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import {
  DexieExplicitDenyRuleRepository,
  DexiePermissionGrantRepository,
} from '@/modules/authorization/infrastructure/repositories/dexie-authorization.repository';
import type { BackupRepositoryPort } from '@/modules/backups';
import { DexieBackupRepository } from '@/modules/backups/infrastructure/repositories/dexie-backup.repository';
import type { BottleneckAlertRepositoryPort } from '@/modules/bottlenecks';
import { DexieBottleneckAlertRepository } from '@/modules/bottlenecks/infrastructure/repositories/dexie-bottleneck.repository';
import type { MaintenanceEventRepositoryPort } from '@/modules/demo';
import { DexieMaintenanceEventRepository } from '@/modules/demo/infrastructure/repositories/dexie-demo.repository';
import type { TaskDependencyRepositoryPort } from '@/modules/dependencies';
import { DexieTaskDependencyRepository } from '@/modules/dependencies/infrastructure/repositories/dexie-task-dependency.repository';
import type {
  FeedbackAttachmentRepositoryPort,
  FeedbackCategoryRepositoryPort,
  FeedbackContestReasonRepositoryPort,
  FeedbackContestRepositoryPort,
  FeedbackCycleRepositoryPort,
  FeedbackInternalNoteRepositoryPort,
  FeedbackMessageRepositoryPort,
  FeedbackReopenRequestRepositoryPort,
  FeedbackRepositoryPort,
  FeedbackSlaSnapshotRepositoryPort,
} from '@/modules/feedback';
import {
  DexieFeedbackAttachmentRepository,
  DexieFeedbackCategoryRepository,
  DexieFeedbackContestReasonRepository,
  DexieFeedbackContestRepository,
  DexieFeedbackCycleRepository,
  DexieFeedbackInternalNoteRepository,
  DexieFeedbackMessageRepository,
  DexieFeedbackReopenRequestRepository,
  DexieFeedbackRepository,
  DexieFeedbackSlaSnapshotRepository,
} from '@/modules/feedback/infrastructure/repositories/dexie-feedback.repository';
import type { FocusPreferenceRepositoryPort } from '@/modules/focus';
import { DexieFocusPreferenceRepository } from '@/modules/focus/infrastructure/repositories/dexie-focus.repository';
import type { ImpedimentRepositoryPort } from '@/modules/impediments';
import { DexieImpedimentRepository } from '@/modules/impediments/infrastructure/repositories/dexie-impediment.repository';
import type { InvitationRepositoryPort } from '@/modules/invitations';
import { DexieInvitationRepository } from '@/modules/invitations/infrastructure/repositories/dexie-invitation.repository';
import type { BoardColumnRepositoryPort, ProjectBoardRepositoryPort } from '@/modules/kanban';
import {
  DexieBoardColumnRepository,
  DexieProjectBoardRepository,
} from '@/modules/kanban/infrastructure/repositories/dexie-kanban.repository';
import type {
  NotificationPreferenceRepositoryPort,
  NotificationRepositoryPort,
} from '@/modules/notifications';
import {
  DexieNotificationPreferenceRepository,
  DexieNotificationRepository,
} from '@/modules/notifications/infrastructure/repositories/dexie-notification.repository';
import type { OnboardingProgressRepositoryPort } from '@/modules/onboarding';
import { DexieOnboardingProgressRepository } from '@/modules/onboarding/infrastructure/repositories/dexie-onboarding.repository';
import type {
  OrganizationMemberRepositoryPort,
  OrganizationRepositoryPort,
} from '@/modules/organizations';
import {
  DexieOrganizationMemberRepository,
  DexieOrganizationRepository,
} from '@/modules/organizations/infrastructure/repositories/dexie-organization.repository';
import type { ProjectMemberRepositoryPort, ProjectRepositoryPort } from '@/modules/projects';
import {
  DexieProjectMemberRepository,
  DexieProjectRepository,
} from '@/modules/projects/infrastructure/repositories/dexie-project.repository';
import type { OrganizationSettingsRepositoryPort } from '@/modules/settings';
import { DexieOrganizationSettingsRepository } from '@/modules/settings/infrastructure/repositories/dexie-settings.repository';
import type {
  SubtaskRepositoryPort,
  TagRepositoryPort,
  TaskAttachmentRepositoryPort,
  TaskCommentRepositoryPort,
  TaskDeadlineHistoryRepositoryPort,
  TaskExecutionCycleRepositoryPort,
  TaskParticipantRepositoryPort,
  TaskPauseRepositoryPort,
  TaskRepositoryPort,
} from '@/modules/tasks';
import {
  DexieSubtaskRepository,
  DexieTagRepository,
  DexieTaskAttachmentRepository,
  DexieTaskCommentRepository,
  DexieTaskDeadlineHistoryRepository,
  DexieTaskExecutionCycleRepository,
  DexieTaskParticipantRepository,
  DexieTaskPauseRepository,
  DexieTaskRepository,
} from '@/modules/tasks/infrastructure/repositories/dexie-task.repository';
import type { TeamMemberRepositoryPort, TeamRepositoryPort } from '@/modules/teams';
import {
  DexieTeamMemberRepository,
  DexieTeamRepository,
} from '@/modules/teams/infrastructure/repositories/dexie-team.repository';
import type { UserRepositoryPort } from '@/modules/users';
import { DexieUserRepository } from '@/modules/users/infrastructure/repositories/dexie-user.repository';
import type { PmsDatabase } from '@/shared/persistence';

export interface AppRepositoriesRegistry {
  readonly authorization: {
    readonly permissionGrants: PermissionGrantRepositoryPort;
    readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  };
  readonly authentication: {
    readonly userSessions: UserSessionRepositoryPort;
  };
  readonly users: {
    readonly users: UserRepositoryPort;
  };
  readonly organizations: {
    readonly organizations: OrganizationRepositoryPort;
    readonly organizationMembers: OrganizationMemberRepositoryPort;
  };
  readonly invitations: {
    readonly invitations: InvitationRepositoryPort;
  };
  readonly teams: {
    readonly teams: TeamRepositoryPort;
    readonly teamMembers: TeamMemberRepositoryPort;
  };
  readonly projects: {
    readonly projects: ProjectRepositoryPort;
    readonly projectMembers: ProjectMemberRepositoryPort;
  };
  readonly kanban: {
    readonly projectBoards: ProjectBoardRepositoryPort;
    readonly boardColumns: BoardColumnRepositoryPort;
  };
  readonly tasks: {
    readonly tasks: TaskRepositoryPort;
    readonly taskParticipants: TaskParticipantRepositoryPort;
    readonly subtasks: SubtaskRepositoryPort;
    readonly taskPauses: TaskPauseRepositoryPort;
    readonly taskExecutionCycles: TaskExecutionCycleRepositoryPort;
    readonly taskComments: TaskCommentRepositoryPort;
    readonly taskAttachments: TaskAttachmentRepositoryPort;
    readonly tags: TagRepositoryPort;
    readonly taskDeadlineHistory: TaskDeadlineHistoryRepositoryPort;
  };
  readonly dependencies: {
    readonly taskDependencies: TaskDependencyRepositoryPort;
  };
  readonly impediments: {
    readonly impediments: ImpedimentRepositoryPort;
  };
  readonly focus: {
    readonly focusPreferences: FocusPreferenceRepositoryPort;
  };
  readonly bottlenecks: {
    readonly bottleneckAlerts: BottleneckAlertRepositoryPort;
  };
  readonly analytics: {
    readonly dashboardPreferences: DashboardPreferenceRepositoryPort;
  };
  readonly feedback: {
    readonly feedbacks: FeedbackRepositoryPort;
    readonly feedbackCycles: FeedbackCycleRepositoryPort;
    readonly feedbackCategories: FeedbackCategoryRepositoryPort;
    readonly feedbackMessages: FeedbackMessageRepositoryPort;
    readonly feedbackInternalNotes: FeedbackInternalNoteRepositoryPort;
    readonly feedbackAttachments: FeedbackAttachmentRepositoryPort;
    readonly feedbackContests: FeedbackContestRepositoryPort;
    readonly feedbackContestReasons: FeedbackContestReasonRepositoryPort;
    readonly feedbackSlaSnapshots: FeedbackSlaSnapshotRepositoryPort;
    readonly feedbackReopenRequests: FeedbackReopenRequestRepositoryPort;
  };
  readonly notifications: {
    readonly notifications: NotificationRepositoryPort;
    readonly notificationPreferences: NotificationPreferenceRepositoryPort;
  };
  readonly audit: {
    readonly auditEvents: AuditEventRepositoryPort;
  };
  readonly backups: {
    readonly backups: BackupRepositoryPort;
  };
  readonly settings: {
    readonly organizationSettings: OrganizationSettingsRepositoryPort;
  };
  readonly onboarding: {
    readonly onboardingProgress: OnboardingProgressRepositoryPort;
  };
  readonly demo: {
    readonly maintenanceEvents: MaintenanceEventRepositoryPort;
  };
}

/**
 * Instantiates all 44 Dexie repository implementations over `db` (ADR-0005, ADR-0007 §2.2).
 */
export function createRepositoriesRegistry(db: PmsDatabase): AppRepositoriesRegistry {
  return Object.freeze({
    authorization: Object.freeze({
      permissionGrants: new DexiePermissionGrantRepository(db),
      explicitDenyRules: new DexieExplicitDenyRuleRepository(db),
    }),
    authentication: Object.freeze({
      userSessions: new DexieUserSessionRepository(db),
    }),
    users: Object.freeze({
      users: new DexieUserRepository(db),
    }),
    organizations: Object.freeze({
      organizations: new DexieOrganizationRepository(db),
      organizationMembers: new DexieOrganizationMemberRepository(db),
    }),
    invitations: Object.freeze({
      invitations: new DexieInvitationRepository(db),
    }),
    teams: Object.freeze({
      teams: new DexieTeamRepository(db),
      teamMembers: new DexieTeamMemberRepository(db),
    }),
    projects: Object.freeze({
      projects: new DexieProjectRepository(db),
      projectMembers: new DexieProjectMemberRepository(db),
    }),
    kanban: Object.freeze({
      projectBoards: new DexieProjectBoardRepository(db),
      boardColumns: new DexieBoardColumnRepository(db),
    }),
    tasks: Object.freeze({
      tasks: new DexieTaskRepository(db),
      taskParticipants: new DexieTaskParticipantRepository(db),
      subtasks: new DexieSubtaskRepository(db),
      taskPauses: new DexieTaskPauseRepository(db),
      taskExecutionCycles: new DexieTaskExecutionCycleRepository(db),
      taskComments: new DexieTaskCommentRepository(db),
      taskAttachments: new DexieTaskAttachmentRepository(db),
      tags: new DexieTagRepository(db),
      taskDeadlineHistory: new DexieTaskDeadlineHistoryRepository(db),
    }),
    dependencies: Object.freeze({
      taskDependencies: new DexieTaskDependencyRepository(db),
    }),
    impediments: Object.freeze({
      impediments: new DexieImpedimentRepository(db),
    }),
    focus: Object.freeze({
      focusPreferences: new DexieFocusPreferenceRepository(db),
    }),
    bottlenecks: Object.freeze({
      bottleneckAlerts: new DexieBottleneckAlertRepository(db),
    }),
    analytics: Object.freeze({
      dashboardPreferences: new DexieDashboardPreferenceRepository(db),
    }),
    feedback: Object.freeze({
      feedbacks: new DexieFeedbackRepository(db),
      feedbackCycles: new DexieFeedbackCycleRepository(db),
      feedbackCategories: new DexieFeedbackCategoryRepository(db),
      feedbackMessages: new DexieFeedbackMessageRepository(db),
      feedbackInternalNotes: new DexieFeedbackInternalNoteRepository(db),
      feedbackAttachments: new DexieFeedbackAttachmentRepository(db),
      feedbackContests: new DexieFeedbackContestRepository(db),
      feedbackContestReasons: new DexieFeedbackContestReasonRepository(db),
      feedbackSlaSnapshots: new DexieFeedbackSlaSnapshotRepository(db),
      feedbackReopenRequests: new DexieFeedbackReopenRequestRepository(db),
    }),
    notifications: Object.freeze({
      notifications: new DexieNotificationRepository(db),
      notificationPreferences: new DexieNotificationPreferenceRepository(db),
    }),
    audit: Object.freeze({
      auditEvents: new DexieAuditEventRepository(db),
    }),
    backups: Object.freeze({
      backups: new DexieBackupRepository(db),
    }),
    settings: Object.freeze({
      organizationSettings: new DexieOrganizationSettingsRepository(db),
    }),
    onboarding: Object.freeze({
      onboardingProgress: new DexieOnboardingProgressRepository(db),
    }),
    demo: Object.freeze({
      maintenanceEvents: new DexieMaintenanceEventRepository(db),
    }),
  });
}
