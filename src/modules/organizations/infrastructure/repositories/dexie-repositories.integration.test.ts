import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositoriesRegistry, type AppRepositoriesRegistry } from '@/app/composition';
import { AUDIT_CATEGORIES, AUDIT_RESULTS, type AuditEvent } from '@/modules/audit';
import {
  GRANT_STATUSES,
  PERMISSION_CODES,
  PERMISSION_SCOPE_TYPES,
  type PermissionGrant,
} from '@/modules/authorization';
import { BACKUP_KINDS, type Backup } from '@/modules/backups';
import {
  MAINTENANCE_ACTIONS,
  MAINTENANCE_STATUSES,
  asMaintenanceEventId,
  type MaintenanceEvent,
} from '@/modules/demo';
import { asTaskDependencyId, type TaskDependency } from '@/modules/dependencies';
import {
  CONTEST_RECOMMENDATIONS,
  FEEDBACK_STATUSES,
  asFeedbackCategoryId,
  asFeedbackCategoryVersionId,
  asFeedbackContestAnalysisId,
  asFeedbackContestDecisionId,
  asFeedbackContestReasonId,
  asFeedbackContestReasonVersionId,
  asFeedbackInternalNoteId,
  asFeedbackMessageId,
  asFeedbackSlaSnapshotId,
  type Feedback,
  type FeedbackCategoryVersion,
  type FeedbackContestAnalysis,
  type FeedbackContestDecision,
  type FeedbackContestReasonVersion,
  type FeedbackInternalNote,
  type FeedbackMessage,
  type FeedbackSlaSnapshot,
} from '@/modules/feedback';
import { IMPEDIMENT_CATEGORIES, IMPEDIMENT_STATUSES, type Impediment } from '@/modules/impediments';
import { BOARD_COLUMN_ROLES, type BoardColumn } from '@/modules/kanban';
import {
  NOTIFICATION_CATEGORIES,
  buildNotificationDeduplicationKey,
  type Notification,
} from '@/modules/notifications';
import { PROJECT_STATUSES, type Project } from '@/modules/projects';
import {
  SUBTASK_STATUSES,
  asTaskDeadlineHistoryEntryId,
  type Subtask,
  type Task,
  type TaskDeadlineHistoryEntry,
} from '@/modules/tasks';
import type { Team } from '@/modules/teams';
import { AuthorizationError, ConflictError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  asAuditEventId,
  asBackupId,
  asBoardColumnId,
  asBoardId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asFeedbackContestId,
  asFeedbackCycleId,
  asFeedbackId,
  asGrantId,
  asImpedimentId,
  asIsoDateTime,
  asNotificationId,
  asOrganizationId,
  asProjectId,
  asSubtaskId,
  asTaskId,
  asTeamId,
  asUserId,
} from '@/shared/kernel';
import {
  AUXILIARY_TABLES,
  PMS_DATABASE_NAME,
  createPmsDatabase,
  ensureDatabaseOpen,
  type PmsDatabase,
} from '@/shared/persistence';

const ORG_A_ID = asOrganizationId('aaaaaaaa-0000-4000-8000-000000000001');
const ORG_B_ID = asOrganizationId('bbbbbbbb-0000-4000-8000-000000000002');
const USER_1_ID = asUserId('cccccccc-0000-4000-8000-000000000001');
const USER_2_ID = asUserId('cccccccc-0000-4000-8000-000000000002');
const TEAM_1_ID = asTeamId('dddddddd-0000-4000-8000-000000000001');
const PROJECT_1_ID = asProjectId('eeeeeeee-0000-4000-8000-000000000001');
const PROJECT_2_ID = asProjectId('eeeeeeee-0000-4000-8000-000000000002');
const BOARD_1_ID = asBoardId('ffffffff-0000-4000-8000-000000000001');
const COLUMN_1_ID = asBoardColumnId('12121212-0000-4000-8000-000000000001');
const TASK_1_ID = asTaskId('13131313-0000-4000-8000-000000000001');
const TASK_2_ID = asTaskId('13131313-0000-4000-8000-000000000002');
const TASK_3_ID = asTaskId('13131313-0000-4000-8000-000000000003');
const SUBTASK_1_ID = asSubtaskId('14141414-0000-4000-8000-000000000001');
const DEP_1_ID = asTaskDependencyId('15151515-0000-4000-8000-000000000001');
const DEP_2_ID = asTaskDependencyId('15151515-0000-4000-8000-000000000002');
const DEP_3_ID = asTaskDependencyId('15151515-0000-4000-8000-000000000003');
const IMPEDIMENT_1_ID = asImpedimentId('16161616-0000-4000-8000-000000000001');
const GRANT_1_ID = asGrantId('17171717-0000-4000-8000-000000000001');
const GRANT_2_ID = asGrantId('17171717-0000-4000-8000-000000000002');
const GRANT_3_ID = asGrantId('17171717-0000-4000-8000-000000000003');
const GRANT_4_ID = asGrantId('17171717-0000-4000-8000-000000000004');
const FEEDBACK_1_ID = asFeedbackId('18181818-0000-4000-8000-000000000001');
const CYCLE_1_ID = asFeedbackCycleId('19191919-0000-4000-8000-000000000001');
const CATEGORY_1_ID = asFeedbackCategoryId('20202020-0000-4000-8000-000000000001');
const CAT_VER_1_ID = asFeedbackCategoryVersionId('20202020-0000-4000-8000-000000000002');
const REASON_1_ID = asFeedbackContestReasonId('21212121-0000-4000-8000-000000000001');
const REASON_VER_1_ID = asFeedbackContestReasonVersionId('21212121-0000-4000-8000-000000000002');
const CONTEST_1_ID = asFeedbackContestId('23232323-0000-4000-8000-000000000001');
const NOTIFICATION_1_ID = asNotificationId('24242424-0000-4000-8000-000000000001');
const BACKUP_1_ID = asBackupId('25252525-0000-4000-8000-000000000001');
const NOW = asIsoDateTime('2026-03-01T12:00:00.000Z');
const LATER = asIsoDateTime('2026-03-01T15:00:00.000Z');

describe('Dexie Repositories Multi-Tenant, Append-Only Immutability & Compound Queries Integration', () => {
  let db: PmsDatabase;
  let repositories: AppRepositoriesRegistry;

  beforeEach(async () => {
    db = createPmsDatabase({
      databaseName: `${PMS_DATABASE_NAME}_repos_${crypto.randomUUID()}`,
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    });
    await ensureDatabaseOpen(db);
    repositories = createRepositoriesRegistry(db);
  });

  afterEach(async () => {
    if (db.isOpen()) {
      db.close();
    }
    await db.delete();
  });

  describe('Isolamento Multi-Organização e Anti-Colisão Cross-Tenant (Cenário Crítico #1)', () => {
    it('nunca expõe registros da Organização A em consultas findById ou list* da Organização B e bloqueia sobrescrita cross-tenant com AuthorizationError', async () => {
      const projectA: Project = {
        id: PROJECT_1_ID,
        organizationId: ORG_A_ID,
        name: 'Projeto Org A',
        status: PROJECT_STATUSES.ACTIVE,
        ownerUserId: USER_1_ID,
        inactivityThresholdDays: 7,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await repositories.projects.projects.save(projectA);

      const columnA: BoardColumn = {
        id: COLUMN_1_ID,
        organizationId: ORG_A_ID,
        boardId: BOARD_1_ID,
        name: 'Coluna Org A',
        columnRole: BOARD_COLUMN_ROLES.INITIAL,
        order: 1,
        wipLimit: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await repositories.kanban.boardColumns.saveMany(ORG_A_ID, [columnA]);

      const taskA: Task = {
        id: TASK_1_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        boardId: BOARD_1_ID,
        columnId: COLUMN_1_ID,
        title: 'Tarefa Org A',
        status: TASK_STATUSES.TODO,
        priority: PRIORITIES.HIGH,
        order: 1,
        tagIds: [],
        lastMovedAt: NOW,
        lastActivityAt: NOW,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await repositories.tasks.tasks.save(taskA);

      const subtaskA: Subtask = {
        id: SUBTASK_1_ID,
        organizationId: ORG_A_ID,
        taskId: TASK_1_ID,
        title: 'Subtarefa Org A',
        required: true,
        status: SUBTASK_STATUSES.OPEN,
        order: 1,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await repositories.tasks.subtasks.save(subtaskA);

      const dependencyA: TaskDependency = {
        id: DEP_1_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        taskId: TASK_1_ID,
        dependsOnTaskId: TASK_2_ID,
        required: true,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
      };
      await repositories.dependencies.taskDependencies.save(dependencyA);

      const impedimentA: Impediment = {
        id: IMPEDIMENT_1_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        taskId: TASK_1_ID,
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.HIGH,
        description: 'Impedimento Org A',
        status: IMPEDIMENT_STATUSES.OPEN,
        openedByUserId: USER_1_ID,
        openedAt: NOW,
        updatedAt: NOW,
      };
      await repositories.impediments.impediments.save(impedimentA);

      const grantA: PermissionGrant = {
        id: GRANT_1_ID,
        organizationId: ORG_A_ID,
        granteeUserId: USER_1_ID,
        permission: PERMISSION_CODES.PROJECT_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: asEntityId(PROJECT_1_ID),
        grantedByUserId: USER_2_ID,
        grantedByRole: ORGANIZATION_ROLES.ADMIN,
        grantedAt: NOW,
        reason: 'Concessao Org A',
        status: GRANT_STATUSES.ACTIVE,
      };
      await repositories.authorization.permissionGrants.save(grantA);

      const feedbackA: Feedback = {
        id: FEEDBACK_1_ID,
        organizationId: ORG_A_ID,
        authorUserId: USER_1_ID,
        moduleKey: 'kanban',
        categoryId: CATEGORY_1_ID,
        categoryVersionId: CAT_VER_1_ID,
        title: 'Feedback Org A',
        description: 'Descricao Feedback Org A',
        priority: PRIORITIES.MEDIUM,
        status: FEEDBACK_STATUSES.RECEIVED,
        currentCycleId: CYCLE_1_ID,
        authorConfirmedResolution: false,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await repositories.feedback.feedbacks.save(feedbackA);

      const eventId = asEventId('26262626-0000-4000-8000-000000000001');
      const notificationA: Notification = {
        id: NOTIFICATION_1_ID,
        organizationId: ORG_A_ID,
        recipientUserId: USER_1_ID,
        eventId,
        deduplicationKey: buildNotificationDeduplicationKey(eventId, USER_1_ID),
        category: NOTIFICATION_CATEGORIES.TASK,
        priority: PRIORITIES.MEDIUM,
        titleKey: 'notifications.task.assigned',
        summaryMetadata: { taskId: TASK_1_ID },
        resourceType: 'Task',
        resourceId: TASK_1_ID,
        createdAt: NOW,
      };
      await repositories.notifications.notifications.save(notificationA);

      const backupA: Backup = {
        id: BACKUP_1_ID,
        organizationId: ORG_A_ID,
        kind: BACKUP_KINDS.MANUAL,
        schemaVersion: 1,
        integrityHash: 'hash-org-a',
        entityCounts: { projects: 1, tasks: 1 },
        createdAt: NOW,
        createdByUserId: USER_1_ID,
      };
      const backupPayloadA = JSON.stringify({ organizationId: ORG_A_ID, secretData: 'org-a-only' });
      await repositories.backups.backups.save(backupA, backupPayloadA);

      // 1. Consultas findById e list* pela Organização B nunca enxergam dados da Organização A
      expect(await repositories.projects.projects.findById(ORG_B_ID, PROJECT_1_ID)).toBeNull();
      expect(await repositories.projects.projects.listByOrganization(ORG_B_ID)).toHaveLength(0);

      expect(await repositories.kanban.boardColumns.findById(ORG_B_ID, COLUMN_1_ID)).toBeNull();
      expect(await repositories.kanban.boardColumns.listByBoard(ORG_B_ID, BOARD_1_ID)).toHaveLength(
        0,
      );

      expect(await repositories.tasks.tasks.findById(ORG_B_ID, TASK_1_ID)).toBeNull();
      expect(await repositories.tasks.tasks.listByProject(ORG_B_ID, PROJECT_1_ID)).toHaveLength(0);

      expect(await repositories.tasks.subtasks.findById(ORG_B_ID, SUBTASK_1_ID)).toBeNull();
      expect(await repositories.tasks.subtasks.listByTask(ORG_B_ID, TASK_1_ID)).toHaveLength(0);

      expect(
        await repositories.dependencies.taskDependencies.findById(ORG_B_ID, DEP_1_ID),
      ).toBeNull();
      expect(
        await repositories.dependencies.taskDependencies.listByProject(ORG_B_ID, PROJECT_1_ID),
      ).toHaveLength(0);
      expect(
        await repositories.dependencies.taskDependencies.listByTask(ORG_B_ID, TASK_1_ID),
      ).toHaveLength(0);

      expect(
        await repositories.impediments.impediments.findById(ORG_B_ID, IMPEDIMENT_1_ID),
      ).toBeNull();
      expect(
        await repositories.impediments.impediments.listOpenByOrganization(ORG_B_ID),
      ).toHaveLength(0);

      expect(
        await repositories.authorization.permissionGrants.findById(ORG_B_ID, GRANT_1_ID),
      ).toBeNull();
      expect(
        await repositories.authorization.permissionGrants.listByOrganization(ORG_B_ID),
      ).toHaveLength(0);

      expect(await repositories.feedback.feedbacks.findById(ORG_B_ID, FEEDBACK_1_ID)).toBeNull();
      expect(await repositories.feedback.feedbacks.listByOrganization(ORG_B_ID)).toHaveLength(0);

      const orgBNotifications = await repositories.notifications.notifications.listByRecipient(
        ORG_B_ID,
        USER_1_ID,
        { page: 1, pageSize: 20 },
      );
      expect(orgBNotifications.items).toHaveLength(0);

      expect(await repositories.backups.backups.findById(ORG_B_ID, BACKUP_1_ID)).toBeNull();
      expect(await repositories.backups.backups.listByOrganization(ORG_B_ID)).toHaveLength(0);
      expect(await repositories.backups.backups.getPayloadJson(ORG_B_ID, BACKUP_1_ID)).toBeNull();

      // 2. Tentativas da Organização B de sobrescrever registros da Organização A (save / saveMany) lançam AuthorizationError
      await expect(
        repositories.projects.projects.save({
          ...projectA,
          organizationId: ORG_B_ID,
          name: 'Tentativa Invasao Org B',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        repositories.kanban.boardColumns.saveMany(ORG_B_ID, [
          {
            ...columnA,
            organizationId: ORG_B_ID,
            name: 'Coluna Invadida Org B',
          },
        ]),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        repositories.tasks.tasks.save({
          ...taskA,
          organizationId: ORG_B_ID,
          title: 'Tarefa Invadida Org B',
        }),
      ).rejects.toThrowError(AuthorizationError);

      await expect(
        repositories.backups.backups.save(
          {
            ...backupA,
            organizationId: ORG_B_ID,
          },
          '{"hacked":true}',
        ),
      ).rejects.toThrowError(AuthorizationError);

      await expect(repositories.backups.backups.delete(ORG_B_ID, BACKUP_1_ID)).rejects.toThrowError(
        AuthorizationError,
      );

      // 3. Confirma que todos os registros da Organização A permanecem intactos no IndexedDB
      const intactProjectA = await repositories.projects.projects.findById(ORG_A_ID, PROJECT_1_ID);
      expect(intactProjectA?.name).toBe('Projeto Org A');

      const intactColumnA = await repositories.kanban.boardColumns.findById(ORG_A_ID, COLUMN_1_ID);
      expect(intactColumnA?.name).toBe('Coluna Org A');

      const intactTaskA = await repositories.tasks.tasks.findById(ORG_A_ID, TASK_1_ID);
      expect(intactTaskA?.title).toBe('Tarefa Org A');

      const intactBackupA = await repositories.backups.backups.findById(ORG_A_ID, BACKUP_1_ID);
      expect(intactBackupA?.integrityHash).toBe('hash-org-a');
      expect(await repositories.backups.backups.getPayloadJson(ORG_A_ID, BACKUP_1_ID)).toBe(
        backupPayloadA,
      );
    });
  });

  describe('Imutabilidade Física Append-Only (Table.add)', () => {
    it('garante que todas as 10 stores append-only aceitam a primeira inserção e rejeitam duplicatas com ConflictError sem sobrescrever o original', async () => {
      // 1. DexieAuditEventRepository.append
      const auditEvent: AuditEvent = {
        id: asAuditEventId('30000000-0000-4000-8000-000000000001'),
        organizationId: ORG_A_ID,
        actorId: USER_1_ID,
        occurredAt: NOW,
        category: AUDIT_CATEGORIES.PROJECT,
        eventType: 'project.created',
        resourceType: 'Project',
        resourceId: PROJECT_1_ID,
        result: AUDIT_RESULTS.SUCCESS,
        correlationId: asCorrelationId('30000000-0000-4000-8000-000000000099'),
      };
      await repositories.audit.auditEvents.append(auditEvent);
      await expect(
        repositories.audit.auditEvents.append({
          ...auditEvent,
          eventType: 'project.tampered',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedAudits = await repositories.audit.auditEvents.listByOrganization(ORG_A_ID, {
        page: 1,
        pageSize: 10,
      });
      expect(persistedAudits.items[0]?.eventType).toBe('project.created');

      // 2. DexieMaintenanceEventRepository.append
      const maintenanceEvent: MaintenanceEvent = {
        id: asMaintenanceEventId('30000000-0000-4000-8000-000000000002'),
        organizationId: ORG_A_ID,
        action: MAINTENANCE_ACTIONS.SEED,
        performedByUserId: USER_1_ID,
        status: MAINTENANCE_STATUSES.SUCCESS,
        details: 'Initial seed original',
        occurredAt: NOW,
      };
      await repositories.demo.maintenanceEvents.append(maintenanceEvent);
      await expect(
        repositories.demo.maintenanceEvents.append({
          ...maintenanceEvent,
          details: 'Tampered seed details',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedMaintenance =
        await repositories.demo.maintenanceEvents.listByOrganization(ORG_A_ID);
      expect(persistedMaintenance[0]?.details).toBe('Initial seed original');

      // 3. DexieFeedbackMessageRepository.append
      const feedbackMessage: FeedbackMessage = {
        id: asFeedbackMessageId('30000000-0000-4000-8000-000000000003'),
        organizationId: ORG_A_ID,
        feedbackId: FEEDBACK_1_ID,
        cycleId: CYCLE_1_ID,
        authorUserId: USER_1_ID,
        body: 'Mensagem original imutavel',
        createdAt: NOW,
      };
      await repositories.feedback.feedbackMessages.append(feedbackMessage);
      await expect(
        repositories.feedback.feedbackMessages.append({
          ...feedbackMessage,
          body: 'Mensagem adulterada',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedMessages = await repositories.feedback.feedbackMessages.listByFeedback(
        ORG_A_ID,
        FEEDBACK_1_ID,
      );
      expect(persistedMessages[0]?.body).toBe('Mensagem original imutavel');

      // 4. DexieFeedbackInternalNoteRepository.append
      const internalNote: FeedbackInternalNote = {
        id: asFeedbackInternalNoteId('30000000-0000-4000-8000-000000000004'),
        organizationId: ORG_A_ID,
        feedbackId: FEEDBACK_1_ID,
        cycleId: CYCLE_1_ID,
        authorUserId: USER_2_ID,
        body: 'Nota interna original',
        mentionedUserIds: [],
        createdAt: NOW,
      };
      await repositories.feedback.feedbackInternalNotes.append(internalNote);
      await expect(
        repositories.feedback.feedbackInternalNotes.append({
          ...internalNote,
          body: 'Nota interna adulterada',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedNotes = await repositories.feedback.feedbackInternalNotes.listByFeedback(
        ORG_A_ID,
        FEEDBACK_1_ID,
      );
      expect(persistedNotes[0]?.body).toBe('Nota interna original');

      // 5. DexieFeedbackContestRepository.appendAnalysis
      const contestAnalysis: FeedbackContestAnalysis = {
        id: asFeedbackContestAnalysisId('30000000-0000-4000-8000-000000000005'),
        organizationId: ORG_A_ID,
        contestId: CONTEST_1_ID,
        analystUserId: USER_2_ID,
        recommendation: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        summary: 'Parecer tecnico original',
        createdAt: NOW,
      };
      await repositories.feedback.feedbackContests.appendAnalysis(contestAnalysis);
      await expect(
        repositories.feedback.feedbackContests.appendAnalysis({
          ...contestAnalysis,
          summary: 'Parecer tecnico adulterado',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedAnalyses = await repositories.feedback.feedbackContests.listAnalyses(
        ORG_A_ID,
        CONTEST_1_ID,
      );
      expect(persistedAnalyses[0]?.summary).toBe('Parecer tecnico original');

      // 6. DexieFeedbackContestRepository.appendDecision
      const contestDecision: FeedbackContestDecision = {
        id: asFeedbackContestDecisionId('30000000-0000-4000-8000-000000000006'),
        organizationId: ORG_A_ID,
        contestId: CONTEST_1_ID,
        decidedByAdminUserId: USER_1_ID,
        outcome: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
        divergedFromAnalysis: true,
        justification: 'Decisao administrativa original',
        decidedAt: NOW,
      };
      await repositories.feedback.feedbackContests.appendDecision(contestDecision);
      await expect(
        repositories.feedback.feedbackContests.appendDecision({
          ...contestDecision,
          justification: 'Decisao administrativa adulterada',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedDecisions = await repositories.feedback.feedbackContests.listDecisions(
        ORG_A_ID,
        CONTEST_1_ID,
      );
      expect(persistedDecisions[0]?.justification).toBe('Decisao administrativa original');

      // 7. DexieTaskDeadlineHistoryRepository.append
      const deadlineEntry: TaskDeadlineHistoryEntry = {
        id: asTaskDeadlineHistoryEntryId('30000000-0000-4000-8000-000000000007'),
        organizationId: ORG_A_ID,
        taskId: TASK_1_ID,
        newDueDate: LATER,
        changedByUserId: USER_1_ID,
        changedAt: NOW,
        justification: 'Prazo original',
      };
      await repositories.tasks.taskDeadlineHistory.append(deadlineEntry);
      await expect(
        repositories.tasks.taskDeadlineHistory.append({
          ...deadlineEntry,
          justification: 'Prazo adulterado',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedDeadlines = await repositories.tasks.taskDeadlineHistory.listByTask(
        ORG_A_ID,
        TASK_1_ID,
      );
      expect(persistedDeadlines[0]?.justification).toBe('Prazo original');

      // 8. DexieFeedbackCategoryRepository.saveVersion
      const categoryVersion: FeedbackCategoryVersion = {
        id: CAT_VER_1_ID,
        organizationId: ORG_A_ID,
        categoryId: CATEGORY_1_ID,
        versionNumber: 1,
        name: 'Categoria v1 Original',
        active: true,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
      };
      await repositories.feedback.feedbackCategories.saveVersion(categoryVersion);
      await expect(
        repositories.feedback.feedbackCategories.saveVersion({
          ...categoryVersion,
          id: asFeedbackCategoryVersionId('30000000-0000-4000-8000-000000000088'),
          name: 'Categoria v1 Duplicada',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedCategoryVersions = await repositories.feedback.feedbackCategories.listVersions(
        ORG_A_ID,
        CATEGORY_1_ID,
      );
      expect(persistedCategoryVersions).toHaveLength(1);
      expect(persistedCategoryVersions[0]?.name).toBe('Categoria v1 Original');

      // 9. DexieFeedbackContestReasonRepository.saveVersion
      const reasonVersion: FeedbackContestReasonVersion = {
        id: REASON_VER_1_ID,
        organizationId: ORG_A_ID,
        reasonId: REASON_1_ID,
        versionNumber: 1,
        name: 'Motivo v1 Original',
        active: true,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
      };
      await repositories.feedback.feedbackContestReasons.saveVersion(reasonVersion);
      await expect(
        repositories.feedback.feedbackContestReasons.saveVersion({
          ...reasonVersion,
          id: asFeedbackContestReasonVersionId('30000000-0000-4000-8000-000000000089'),
          name: 'Motivo v1 Duplicado',
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedReasonVersions =
        await repositories.feedback.feedbackContestReasons.listVersions(ORG_A_ID, REASON_1_ID);
      expect(persistedReasonVersions).toHaveLength(1);
      expect(persistedReasonVersions[0]?.name).toBe('Motivo v1 Original');

      // 10. DexieFeedbackSlaSnapshotRepository.save (1 por cycleId e imutável)
      const slaSnapshot: FeedbackSlaSnapshot = {
        id: asFeedbackSlaSnapshotId('30000000-0000-4000-8000-000000000010'),
        organizationId: ORG_A_ID,
        feedbackId: FEEDBACK_1_ID,
        cycleId: CYCLE_1_ID,
        prioritySnapshot: PRIORITIES.HIGH,
        calendarMode: 'BUSINESS_HOURS',
        workDaysOfWeekUtc: [1, 2, 3, 4, 5],
        workStartHourUtc: 9,
        workEndHourUtc: 18,
        breakIntervalsUtc: [],
        holidayDates: [],
        firstResponseTargetMs: 3_600_000,
        resolutionTargetMs: 14_400_000,
        manifestationWindowMs: 86_400_000,
        contestWindowMs: 86_400_000,
        capturedAt: NOW,
      };
      await repositories.feedback.feedbackSlaSnapshots.save(slaSnapshot);

      // Tentativa com outro ID mas mesmo cycleId
      await expect(
        repositories.feedback.feedbackSlaSnapshots.save({
          ...slaSnapshot,
          id: asFeedbackSlaSnapshotId('30000000-0000-4000-8000-000000000011'),
          firstResponseTargetMs: 999_999,
        }),
      ).rejects.toThrowError(ConflictError);

      const persistedSnapshot = await repositories.feedback.feedbackSlaSnapshots.findById(
        ORG_A_ID,
        slaSnapshot.id,
      );
      expect(persistedSnapshot?.firstResponseTargetMs).toBe(3_600_000);
    });
  });

  describe('Consultas Compostas, SoftDeletable e revokeByScope', () => {
    it('omite registros com deletedAt nas listagens por padrão, inclui quando includeDeleted: true e retorna em findById (Project, Team e Task)', async () => {
      const deletedProject: Project = {
        id: PROJECT_1_ID,
        organizationId: ORG_A_ID,
        name: 'Projeto na Lixeira',
        status: PROJECT_STATUSES.ACTIVE,
        ownerUserId: USER_1_ID,
        inactivityThresholdDays: 7,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
        updatedAt: LATER,
        deletedAt: LATER,
        deletedBy: USER_1_ID,
      };
      await repositories.projects.projects.save(deletedProject);

      expect(await repositories.projects.projects.listByOrganization(ORG_A_ID)).toHaveLength(0);
      expect(
        await repositories.projects.projects.listByOrganization(ORG_A_ID, { includeDeleted: true }),
      ).toHaveLength(1);
      expect(await repositories.projects.projects.findById(ORG_A_ID, PROJECT_1_ID)).not.toBeNull();

      const deletedTeam: Team = {
        id: TEAM_1_ID,
        organizationId: ORG_A_ID,
        name: 'Equipe na Lixeira',
        managerUserIds: [USER_1_ID],
        createdByUserId: USER_1_ID,
        createdAt: NOW,
        updatedAt: LATER,
        deletedAt: LATER,
        deletedBy: USER_1_ID,
      };
      await repositories.teams.teams.save(deletedTeam);

      expect(await repositories.teams.teams.listByOrganization(ORG_A_ID)).toHaveLength(0);
      expect(
        await repositories.teams.teams.listByOrganization(ORG_A_ID, { includeDeleted: true }),
      ).toHaveLength(1);
      expect(await repositories.teams.teams.findById(ORG_A_ID, TEAM_1_ID)).not.toBeNull();

      const deletedTask: Task = {
        id: TASK_1_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        boardId: BOARD_1_ID,
        columnId: COLUMN_1_ID,
        title: 'Tarefa na Lixeira',
        status: TASK_STATUSES.TODO,
        priority: PRIORITIES.LOW,
        order: 1,
        tagIds: [],
        lastMovedAt: NOW,
        lastActivityAt: NOW,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
        updatedAt: LATER,
        deletedAt: LATER,
        deletedBy: USER_1_ID,
      };
      await repositories.tasks.tasks.save(deletedTask);

      expect(await repositories.tasks.tasks.listByProject(ORG_A_ID, PROJECT_1_ID)).toHaveLength(0);
      expect(
        await repositories.tasks.tasks.listByProject(ORG_A_ID, PROJECT_1_ID, {
          includeDeleted: true,
        }),
      ).toHaveLength(1);
      expect(await repositories.tasks.tasks.findById(ORG_A_ID, TASK_1_ID)).not.toBeNull();
    });

    it('DexiePermissionGrantRepository.revokeByScope revoga apenas as concessões ativas do usuário e escopo alvo na organização e retorna a contagem exata', async () => {
      const targetScopeId = asEntityId(PROJECT_1_ID);
      const otherScopeId = asEntityId(PROJECT_2_ID);

      const grantTarget1: PermissionGrant = {
        id: GRANT_1_ID,
        organizationId: ORG_A_ID,
        granteeUserId: USER_1_ID,
        permission: PERMISSION_CODES.PROJECT_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: targetScopeId,
        grantedByUserId: USER_2_ID,
        grantedByRole: ORGANIZATION_ROLES.ADMIN,
        grantedAt: NOW,
        reason: 'Grant 1 no Projeto 1',
        status: GRANT_STATUSES.ACTIVE,
      };

      const grantTarget2: PermissionGrant = {
        id: GRANT_2_ID,
        organizationId: ORG_A_ID,
        granteeUserId: USER_1_ID,
        permission: PERMISSION_CODES.TASK_CREATE,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: targetScopeId,
        grantedByUserId: USER_2_ID,
        grantedByRole: ORGANIZATION_ROLES.ADMIN,
        grantedAt: NOW,
        reason: 'Grant 2 no Projeto 1',
        status: GRANT_STATUSES.ACTIVE,
      };

      const grantOtherProject: PermissionGrant = {
        id: GRANT_3_ID,
        organizationId: ORG_A_ID,
        granteeUserId: USER_1_ID,
        permission: PERMISSION_CODES.PROJECT_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: otherScopeId,
        grantedByUserId: USER_2_ID,
        grantedByRole: ORGANIZATION_ROLES.ADMIN,
        grantedAt: NOW,
        reason: 'Grant no Projeto 2 (nao deve ser revogado)',
        status: GRANT_STATUSES.ACTIVE,
      };

      const grantOtherUser: PermissionGrant = {
        id: GRANT_4_ID,
        organizationId: ORG_A_ID,
        granteeUserId: USER_2_ID,
        permission: PERMISSION_CODES.PROJECT_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: targetScopeId,
        grantedByUserId: USER_2_ID,
        grantedByRole: ORGANIZATION_ROLES.ADMIN,
        grantedAt: NOW,
        reason: 'Grant de outro usuario no Projeto 1',
        status: GRANT_STATUSES.ACTIVE,
      };

      await repositories.authorization.permissionGrants.save(grantTarget1);
      await repositories.authorization.permissionGrants.save(grantTarget2);
      await repositories.authorization.permissionGrants.save(grantOtherProject);
      await repositories.authorization.permissionGrants.save(grantOtherUser);

      const revokedCount = await repositories.authorization.permissionGrants.revokeByScope(
        ORG_A_ID,
        USER_1_ID,
        PERMISSION_SCOPE_TYPES.PROJECT,
        targetScopeId,
        USER_2_ID,
        LATER,
      );

      expect(revokedCount).toBe(2);

      // Segunda chamada idempotente retorna 0
      const secondRevokeCount = await repositories.authorization.permissionGrants.revokeByScope(
        ORG_A_ID,
        USER_1_ID,
        PERMISSION_SCOPE_TYPES.PROJECT,
        targetScopeId,
        USER_2_ID,
        LATER,
      );
      expect(secondRevokeCount).toBe(0);

      const activeForUser1 = await repositories.authorization.permissionGrants.listActiveByGrantee(
        ORG_A_ID,
        USER_1_ID,
        LATER,
      );
      expect(activeForUser1.map((g) => g.id)).toEqual([GRANT_3_ID]);

      const activeForUser2 = await repositories.authorization.permissionGrants.listActiveByGrantee(
        ORG_A_ID,
        USER_2_ID,
        LATER,
      );
      expect(activeForUser2.map((g) => g.id)).toEqual([GRANT_4_ID]);
    });

    it('DexieTaskDependencyRepository.listByTask retorna dependências onde a tarefa é origem ou destino sem duplicatas', async () => {
      const depOutgoing: TaskDependency = {
        id: DEP_1_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        taskId: TASK_2_ID,
        dependsOnTaskId: TASK_1_ID,
        required: true,
        createdByUserId: USER_1_ID,
        createdAt: NOW,
      };

      const depIncoming: TaskDependency = {
        id: DEP_2_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        taskId: TASK_3_ID,
        dependsOnTaskId: TASK_2_ID,
        required: true,
        createdByUserId: USER_1_ID,
        createdAt: LATER,
      };

      const depUnrelated: TaskDependency = {
        id: DEP_3_ID,
        organizationId: ORG_A_ID,
        projectId: PROJECT_1_ID,
        taskId: TASK_3_ID,
        dependsOnTaskId: TASK_1_ID,
        required: false,
        createdByUserId: USER_1_ID,
        createdAt: LATER,
      };

      await repositories.dependencies.taskDependencies.save(depOutgoing);
      await repositories.dependencies.taskDependencies.save(depIncoming);
      await repositories.dependencies.taskDependencies.save(depUnrelated);

      const task2Dependencies = await repositories.dependencies.taskDependencies.listByTask(
        ORG_A_ID,
        TASK_2_ID,
      );
      expect(task2Dependencies.map((d) => d.id)).toEqual([DEP_1_ID, DEP_2_ID]);
    });

    it('DexieBackupRepository grava e recupera payloadJson separado em backupPayloads e remove ambos no delete', async () => {
      const backup: Backup = {
        id: BACKUP_1_ID,
        organizationId: ORG_A_ID,
        kind: BACKUP_KINDS.AUTO_DAILY,
        schemaVersion: 1,
        integrityHash: 'sha256-backup-1',
        entityCounts: { projects: 2, tasks: 5 },
        createdAt: NOW,
        createdByUserId: USER_1_ID,
      };
      const payloadJson = JSON.stringify({
        formatVersion: '1.0.0',
        schemaVersion: 1,
        organizationId: ORG_A_ID,
      });

      await repositories.backups.backups.save(backup, payloadJson);

      const foundMeta = await repositories.backups.backups.findById(ORG_A_ID, BACKUP_1_ID);
      expect(foundMeta).toEqual(backup);
      expect('payloadJson' in (foundMeta ?? {})).toBe(false);

      const foundPayload = await repositories.backups.backups.getPayloadJson(ORG_A_ID, BACKUP_1_ID);
      expect(foundPayload).toBe(payloadJson);

      await repositories.backups.backups.delete(ORG_A_ID, BACKUP_1_ID);

      expect(await repositories.backups.backups.findById(ORG_A_ID, BACKUP_1_ID)).toBeNull();
      expect(await repositories.backups.backups.getPayloadJson(ORG_A_ID, BACKUP_1_ID)).toBeNull();
      expect(await db.getTable(AUXILIARY_TABLES.BACKUP_PAYLOADS).get(BACKUP_1_ID)).toBeUndefined();
    });
  });
});
