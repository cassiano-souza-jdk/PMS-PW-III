import { Dexie, type DexieOptions, type Table } from 'dexie';
import {
  TRANSACTION_RESOURCES,
  type AttachmentBlobPayload,
  type AttachmentId,
  type BackupId,
  type OrganizationId,
  type TransactionResource,
} from '@/shared/kernel';
import { withPersistenceErrorHandling } from './quota-error';

export const PMS_DATABASE_NAME = 'pms_local_db' as const;

export const PMS_SCHEMA_VERSION = 1 as const;

export const AUXILIARY_TABLES = {
  BACKUP_PAYLOADS: 'backupPayloads',
} as const;

export type AuxiliaryTableName = (typeof AUXILIARY_TABLES)[keyof typeof AUXILIARY_TABLES];

export type PmsTableName = TransactionResource | AuxiliaryTableName;

export interface BackupPayloadRecord {
  readonly backupId: BackupId;
  readonly organizationId: OrganizationId;
  readonly payloadJson: string;
}

/**
 * Exact 50-table Dexie v4 schema v1 (49 TRANSACTION_RESOURCES + auxiliary `backupPayloads`).
 *
 * Rules enforced (ADR-0007 §1, DATA-PERSISTENCE.md):
 * - Natural primary keys where applicable: `organizationId` for `organizationSettings`,
 *   `attachmentId` for `attachmentBlobs`, `backupId` for `backupPayloads`, `id` for the remaining 47 stores.
 * - All organizational stores declare compound indexes prefixed by `organizationId`.
 * - Zero boolean properties and zero optional (`undefined`) properties inside compound indexes.
 */
export const PMS_SCHEMA_V1_STORES: Readonly<Record<PmsTableName, string>> = Object.freeze({
  [TRANSACTION_RESOURCES.USERS]: 'id, &email',
  [TRANSACTION_RESOURCES.USER_SESSIONS]: 'id, userId, [userId+createdAt]',
  [TRANSACTION_RESOURCES.ORGANIZATIONS]: 'id, &slug',
  [TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS]:
    'id, &[organizationId+userId], organizationId, userId, [organizationId+role], [organizationId+status]',
  [TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS]: 'organizationId',
  [TRANSACTION_RESOURCES.INVITATIONS]:
    'id, &code, organizationId, [organizationId+status], [organizationId+email]',
  [TRANSACTION_RESOURCES.TEAMS]: 'id, organizationId, [organizationId+name]',
  [TRANSACTION_RESOURCES.TEAM_MEMBERS]:
    'id, &[organizationId+teamId+userId], [organizationId+teamId], [organizationId+userId]',
  [TRANSACTION_RESOURCES.PERMISSION_GRANTS]:
    'id, organizationId, [organizationId+granteeUserId], [organizationId+granteeUserId+scopeType]',
  [TRANSACTION_RESOURCES.EXPLICIT_DENY_RULES]:
    'id, organizationId, [organizationId+targetUserId], [organizationId+targetUserId+scopeType]',
  [TRANSACTION_RESOURCES.PROJECTS]:
    'id, organizationId, [organizationId+status], [organizationId+teamId], [organizationId+ownerUserId]',
  [TRANSACTION_RESOURCES.PROJECT_MEMBERS]:
    'id, &[organizationId+projectId+userId], [organizationId+projectId], [organizationId+userId]',
  [TRANSACTION_RESOURCES.PROJECT_BOARDS]: 'id, organizationId, [organizationId+projectId]',
  [TRANSACTION_RESOURCES.BOARD_COLUMNS]:
    'id, organizationId, [organizationId+boardId], [organizationId+boardId+order]',
  [TRANSACTION_RESOURCES.TASKS]:
    'id, organizationId, [organizationId+projectId], [organizationId+columnId], [organizationId+assigneeId], [organizationId+projectId+status], [organizationId+lastMovedAt]',
  [TRANSACTION_RESOURCES.TASK_PARTICIPANTS]:
    'id, &[organizationId+taskId+userId], [organizationId+taskId], [organizationId+userId]',
  [TRANSACTION_RESOURCES.SUBTASKS]:
    'id, organizationId, [organizationId+taskId], [organizationId+taskId+order]',
  [TRANSACTION_RESOURCES.TASK_DEPENDENCIES]:
    'id, &[organizationId+taskId+dependsOnTaskId], [organizationId+projectId], [organizationId+taskId], [organizationId+dependsOnTaskId]',
  [TRANSACTION_RESOURCES.IMPEDIMENTS]:
    'id, organizationId, [organizationId+taskId], [organizationId+projectId], [organizationId+status], [organizationId+projectId+status]',
  [TRANSACTION_RESOURCES.TASK_PAUSES]:
    'id, organizationId, [organizationId+taskId], [organizationId+cycleId]',
  [TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES]:
    'id, organizationId, [organizationId+taskId], [organizationId+projectId], [organizationId+taskId+cycleNumber]',
  [TRANSACTION_RESOURCES.TASK_COMMENTS]:
    'id, organizationId, [organizationId+taskId], [organizationId+taskId+createdAt]',
  [TRANSACTION_RESOURCES.TASK_ATTACHMENTS]:
    'id, organizationId, [organizationId+taskId], [organizationId+taskId+uploadedAt]',
  [TRANSACTION_RESOURCES.TASK_DEADLINE_HISTORY]:
    'id, organizationId, [organizationId+taskId], [organizationId+taskId+changedAt]',
  [TRANSACTION_RESOURCES.TAGS]: 'id, organizationId, [organizationId+name]',
  [TRANSACTION_RESOURCES.FOCUS_PREFERENCES]: 'id, &[organizationId+userId], organizationId',
  [TRANSACTION_RESOURCES.BOTTLENECK_ALERTS]:
    'id, organizationId, [organizationId+deduplicationKey], [organizationId+projectId], [organizationId+status], [organizationId+projectId+status]',
  [TRANSACTION_RESOURCES.DASHBOARD_PREFERENCES]:
    'id, organizationId, [organizationId+userId], [organizationId+userId+scope]',
  [TRANSACTION_RESOURCES.FEEDBACKS]:
    'id, organizationId, [organizationId+authorUserId], [organizationId+assigneeId], [organizationId+status], [organizationId+createdAt]',
  [TRANSACTION_RESOURCES.FEEDBACK_CYCLES]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+feedbackId+cycleNumber]',
  [TRANSACTION_RESOURCES.FEEDBACK_MESSAGES]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+feedbackId+createdAt]',
  [TRANSACTION_RESOURCES.FEEDBACK_INTERNAL_NOTES]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+feedbackId+createdAt]',
  [TRANSACTION_RESOURCES.FEEDBACK_ATTACHMENTS]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+cycleId]',
  [TRANSACTION_RESOURCES.FEEDBACK_CATEGORIES]:
    'id, &[organizationId+code], organizationId, [organizationId+sortOrder]',
  [TRANSACTION_RESOURCES.FEEDBACK_CATEGORY_VERSIONS]:
    'id, &[organizationId+categoryId+versionNumber], [organizationId+categoryId]',
  [TRANSACTION_RESOURCES.FEEDBACK_CONTESTS]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+cycleId], [organizationId+status]',
  [TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASONS]:
    'id, &[organizationId+code], organizationId, [organizationId+sortOrder]',
  [TRANSACTION_RESOURCES.FEEDBACK_CONTEST_REASON_VERSIONS]:
    'id, &[organizationId+reasonId+versionNumber], [organizationId+reasonId]',
  [TRANSACTION_RESOURCES.FEEDBACK_CONTEST_ANALYSES]:
    'id, organizationId, [organizationId+contestId], [organizationId+contestId+createdAt]',
  [TRANSACTION_RESOURCES.FEEDBACK_CONTEST_DECISIONS]:
    'id, organizationId, [organizationId+contestId], [organizationId+contestId+decidedAt]',
  [TRANSACTION_RESOURCES.FEEDBACK_SLA_SNAPSHOTS]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+cycleId]',
  [TRANSACTION_RESOURCES.FEEDBACK_REOPEN_REQUESTS]:
    'id, organizationId, [organizationId+feedbackId], [organizationId+status]',
  [TRANSACTION_RESOURCES.NOTIFICATIONS]:
    'id, &[organizationId+deduplicationKey], [organizationId+recipientUserId], [organizationId+recipientUserId+createdAt]',
  [TRANSACTION_RESOURCES.NOTIFICATION_PREFERENCES]: 'id, &[organizationId+userId], organizationId',
  [TRANSACTION_RESOURCES.AUDIT_EVENTS]:
    'id, organizationId, [organizationId+occurredAt], [organizationId+category+occurredAt], [organizationId+result+occurredAt], [organizationId+projectId+occurredAt]',
  [TRANSACTION_RESOURCES.BACKUPS]:
    'id, organizationId, [organizationId+createdAt], [organizationId+kind+createdAt]',
  [TRANSACTION_RESOURCES.ONBOARDING_PROGRESS]: 'id, &[organizationId+userId], organizationId',
  [TRANSACTION_RESOURCES.MAINTENANCE_EVENTS]: 'id, organizationId, [organizationId+occurredAt]',
  [TRANSACTION_RESOURCES.ATTACHMENT_BLOBS]: 'attachmentId, organizationId',
  [AUXILIARY_TABLES.BACKUP_PAYLOADS]: 'backupId, organizationId',
});

export interface CreatePmsDatabaseOptions extends DexieOptions {
  readonly databaseName?: string;
}

/**
 * Core Dexie v4 database for the Project Management System (ADR-0002, ADR-0007 §1).
 *
 * Lives in `shared-infra` (`src/shared/persistence/`) and stays decoupled from `src/modules/*`
 * domain entity types so modular repositories in `src/modules/<module>/infrastructure/repositories/`
 * can request strongly typed tables via `db.getTable<EntityType, IdType>(TRANSACTION_RESOURCES.X)`.
 */
export class PmsDatabase extends Dexie {
  readonly users!: Table<Record<string, unknown>, string>;
  readonly userSessions!: Table<Record<string, unknown>, string>;
  readonly organizations!: Table<Record<string, unknown>, string>;
  readonly organizationMembers!: Table<Record<string, unknown>, string>;
  readonly organizationSettings!: Table<Record<string, unknown>, OrganizationId>;
  readonly invitations!: Table<Record<string, unknown>, string>;
  readonly teams!: Table<Record<string, unknown>, string>;
  readonly teamMembers!: Table<Record<string, unknown>, string>;
  readonly permissionGrants!: Table<Record<string, unknown>, string>;
  readonly explicitDenyRules!: Table<Record<string, unknown>, string>;
  readonly projects!: Table<Record<string, unknown>, string>;
  readonly projectMembers!: Table<Record<string, unknown>, string>;
  readonly projectBoards!: Table<Record<string, unknown>, string>;
  readonly boardColumns!: Table<Record<string, unknown>, string>;
  readonly tasks!: Table<Record<string, unknown>, string>;
  readonly taskParticipants!: Table<Record<string, unknown>, string>;
  readonly subtasks!: Table<Record<string, unknown>, string>;
  readonly taskDependencies!: Table<Record<string, unknown>, string>;
  readonly impediments!: Table<Record<string, unknown>, string>;
  readonly taskPauses!: Table<Record<string, unknown>, string>;
  readonly taskExecutionCycles!: Table<Record<string, unknown>, string>;
  readonly taskComments!: Table<Record<string, unknown>, string>;
  readonly taskAttachments!: Table<Record<string, unknown>, string>;
  readonly taskDeadlineHistory!: Table<Record<string, unknown>, string>;
  readonly tags!: Table<Record<string, unknown>, string>;
  readonly focusPreferences!: Table<Record<string, unknown>, string>;
  readonly bottleneckAlerts!: Table<Record<string, unknown>, string>;
  readonly dashboardPreferences!: Table<Record<string, unknown>, string>;
  readonly feedbacks!: Table<Record<string, unknown>, string>;
  readonly feedbackCycles!: Table<Record<string, unknown>, string>;
  readonly feedbackMessages!: Table<Record<string, unknown>, string>;
  readonly feedbackInternalNotes!: Table<Record<string, unknown>, string>;
  readonly feedbackAttachments!: Table<Record<string, unknown>, string>;
  readonly feedbackCategories!: Table<Record<string, unknown>, string>;
  readonly feedbackCategoryVersions!: Table<Record<string, unknown>, string>;
  readonly feedbackContests!: Table<Record<string, unknown>, string>;
  readonly feedbackContestReasons!: Table<Record<string, unknown>, string>;
  readonly feedbackContestReasonVersions!: Table<Record<string, unknown>, string>;
  readonly feedbackContestAnalyses!: Table<Record<string, unknown>, string>;
  readonly feedbackContestDecisions!: Table<Record<string, unknown>, string>;
  readonly feedbackSlaSnapshots!: Table<Record<string, unknown>, string>;
  readonly feedbackReopenRequests!: Table<Record<string, unknown>, string>;
  readonly notifications!: Table<Record<string, unknown>, string>;
  readonly notificationPreferences!: Table<Record<string, unknown>, string>;
  readonly auditEvents!: Table<Record<string, unknown>, string>;
  readonly backups!: Table<Record<string, unknown>, string>;
  readonly onboardingProgress!: Table<Record<string, unknown>, string>;
  readonly maintenanceEvents!: Table<Record<string, unknown>, string>;
  readonly attachmentBlobs!: Table<AttachmentBlobPayload, AttachmentId>;
  readonly backupPayloads!: Table<BackupPayloadRecord, BackupId>;

  constructor(databaseName: string = PMS_DATABASE_NAME, options?: DexieOptions) {
    super(databaseName, options);
    this.version(PMS_SCHEMA_VERSION).stores({ ...PMS_SCHEMA_V1_STORES });
  }

  /**
   * Returns a strongly-typed Dexie `Table<TRecord, TKey>` for any canonical PMS store name.
   */
  getTable<TRecord, TKey = string>(tableName: PmsTableName): Table<TRecord, TKey, TRecord> {
    return this.table<TRecord, TKey, TRecord>(tableName);
  }
}

export function createPmsDatabase(options: CreatePmsDatabaseOptions = {}): PmsDatabase {
  const { databaseName = PMS_DATABASE_NAME, ...dexieOptions } = options;
  return new PmsDatabase(databaseName, dexieOptions);
}

/**
 * Non-destructive database initialization helper (DATA-PERSISTENCE.md, ADR-0007 §1.3).
 * Opens the database and upgrades schema versions safely without deleting or overwriting existing stores.
 */
export async function ensureDatabaseOpen(db: PmsDatabase): Promise<PmsDatabase> {
  return withPersistenceErrorHandling('PmsDatabase.ensureDatabaseOpen', async () => {
    if (!db.isOpen()) {
      await db.open();
    }
    return db;
  });
}
