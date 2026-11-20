/**
 * Logical aggregate/store identifiers aligned with ADR-0006 entities.
 * Used declaratively by TransactionPort so Phase 03 Dexie adapters can map them
 * directly to `db.transaction('rw', tables, fn)` without leaking Dexie types into domain/application.
 */
export const TRANSACTION_RESOURCES = {
  USERS: 'users',
  LOCAL_CREDENTIALS: 'localCredentials',
  USER_SESSIONS: 'userSessions',
  ORGANIZATIONS: 'organizations',
  ORGANIZATION_MEMBERS: 'organizationMembers',
  ORGANIZATION_SETTINGS: 'organizationSettings',
  INVITATIONS: 'invitations',
  TEAMS: 'teams',
  TEAM_MEMBERS: 'teamMembers',
  PERMISSION_GRANTS: 'permissionGrants',
  EXPLICIT_DENY_RULES: 'explicitDenyRules',
  PROJECTS: 'projects',
  PROJECT_MEMBERS: 'projectMembers',
  PROJECT_BOARDS: 'projectBoards',
  BOARD_COLUMNS: 'boardColumns',
  TASKS: 'tasks',
  TASK_PARTICIPANTS: 'taskParticipants',
  SUBTASKS: 'subtasks',
  TASK_DEPENDENCIES: 'taskDependencies',
  IMPEDIMENTS: 'impediments',
  TASK_PAUSES: 'taskPauses',
  TASK_EXECUTION_CYCLES: 'taskExecutionCycles',
  TASK_COMMENTS: 'taskComments',
  TASK_ATTACHMENTS: 'taskAttachments',
  TASK_DEADLINE_HISTORY: 'taskDeadlineHistory',
  TAGS: 'tags',
  FOCUS_PREFERENCES: 'focusPreferences',
  BOTTLENECK_ALERTS: 'bottleneckAlerts',
  DASHBOARD_PREFERENCES: 'dashboardPreferences',
  FEEDBACKS: 'feedbacks',
  FEEDBACK_CYCLES: 'feedbackCycles',
  FEEDBACK_MESSAGES: 'feedbackMessages',
  FEEDBACK_INTERNAL_NOTES: 'feedbackInternalNotes',
  FEEDBACK_ATTACHMENTS: 'feedbackAttachments',
  FEEDBACK_CATEGORIES: 'feedbackCategories',
  FEEDBACK_CATEGORY_VERSIONS: 'feedbackCategoryVersions',
  FEEDBACK_CONTESTS: 'feedbackContests',
  FEEDBACK_CONTEST_REASONS: 'feedbackContestReasons',
  FEEDBACK_CONTEST_REASON_VERSIONS: 'feedbackContestReasonVersions',
  FEEDBACK_CONTEST_ANALYSES: 'feedbackContestAnalyses',
  FEEDBACK_CONTEST_DECISIONS: 'feedbackContestDecisions',
  FEEDBACK_SLA_SNAPSHOTS: 'feedbackSlaSnapshots',
  FEEDBACK_REOPEN_REQUESTS: 'feedbackReopenRequests',
  NOTIFICATIONS: 'notifications',
  NOTIFICATION_PREFERENCES: 'notificationPreferences',
  AUDIT_EVENTS: 'auditEvents',
  BACKUPS: 'backups',
  ONBOARDING_PROGRESS: 'onboardingProgress',
  MAINTENANCE_EVENTS: 'maintenanceEvents',
  ATTACHMENT_BLOBS: 'attachmentBlobs',
} as const;

export type TransactionResource =
  (typeof TRANSACTION_RESOURCES)[keyof typeof TRANSACTION_RESOURCES];

export interface TransactionPort {
  run<TResult>(
    resources: readonly TransactionResource[],
    work: () => Promise<TResult>,
  ): Promise<TResult>;
}
