import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import {
  PERMISSION_CODES,
  PERMISSION_SCOPE_TYPES,
  assertAuthorized,
  evaluateAuthorization,
  type AuthorizationActor,
  type AuthorizationPolicyConfig,
  type AuthorizationResource,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
  type TaskUpdatableField,
} from '@/modules/authorization';
import {
  getPendingRequiredDependencies,
  type TaskDependencyRepositoryPort,
} from '@/modules/dependencies';
import { isImpedimentBlocking, type ImpedimentRepositoryPort } from '@/modules/impediments';
import type { OrganizationMemberRepositoryPort } from '@/modules/organizations';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
  type OrganizationSettingsRepositoryPort,
} from '@/modules/settings';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asAttachmentId,
  asAuditEventId,
  asBoardColumnId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asSubtaskId,
  asTaskId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  validateAttachmentQuota,
  type AttachmentBlobStorePort,
  type AttachmentId,
  type BoardColumnId,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type Priority,
  type ProjectId,
  type SubtaskId,
  type TaskId,
  type TaskStatus,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  SUBTASK_STATUSES,
  asTagId,
  asTaskCommentId,
  asTaskDeadlineHistoryEntryId,
  asTaskExecutionCycleId,
  asTaskParticipantId,
  asTaskPauseId,
  type Subtask,
  type SubtaskStatus,
  type Tag,
  type TagId,
  type Task,
  type TaskAttachment,
  type TaskComment,
  type TaskCommentId,
  type TaskDeadlineHistoryEntry,
  type TaskExecutionCycle,
  type TaskParticipant,
  type TaskPause,
} from '../../domain/task';
import {
  assertTaskCanBeCancelled,
  assertTaskCanBeCompleted,
  assertTaskCommentCanBeDeletedByActor,
  assertTaskCommentCanBeEditedByAuthor,
  assertTaskPauseJustification,
  assertTaskReopenCreatesNewCycle,
  normalizeTagName,
} from '../../domain/task-policies';
import type {
  TaskBoardColumnSummary,
  TaskProjectContextPort,
  TaskProjectSummary,
} from '../ports/task-project-context.port';
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
} from '../ports/task-repository.port';

const prioritySchema = z.enum([
  PRIORITIES.LOW,
  PRIORITIES.MEDIUM,
  PRIORITIES.HIGH,
  PRIORITIES.CRITICAL,
]);

const subtaskStatusSchema = z.enum([
  SUBTASK_STATUSES.OPEN,
  SUBTASK_STATUSES.DONE,
  SUBTASK_STATUSES.CANCELLED,
]);

const createTaskInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  columnId: z.string().uuid().optional(),
  priority: prioritySchema.default(PRIORITIES.MEDIUM),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  deadlineJustification: z.string().trim().max(500).optional(),
  correlationId: z.string().uuid().optional(),
});

const updateTaskInputSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: z.union([z.string().trim().max(4000), z.null()]).optional(),
    priority: prioritySchema.optional(),
    dueDate: z.union([z.string(), z.null()]).optional(),
    tagIds: z.array(z.string().uuid()).optional(),
    deadlineJustification: z.string().trim().max(500).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.priority !== undefined ||
      data.dueDate !== undefined ||
      data.tagIds !== undefined,
    'At least one updatable field ("title", "description", "priority", "dueDate", or "tagIds") must be provided.',
  );

const assignTaskInputSchema = z.object({
  assigneeId: z.union([z.string().uuid(), z.null()]),
  correlationId: z.string().uuid().optional(),
});

const addTaskParticipantInputSchema = z.object({
  userId: z.string().uuid(),
  correlationId: z.string().uuid().optional(),
});

const pauseTaskInputSchema = z.object({
  reason: z.string(),
  correlationId: z.string().uuid().optional(),
});

const completeTaskInputSchema = z.object({
  dependencyOverrideJustification: z.string().optional(),
  correlationId: z.string().uuid().optional(),
});

const cancelTaskInputSchema = z.object({
  justification: z.string(),
  correlationId: z.string().uuid().optional(),
});

const reopenTaskInputSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  targetColumnId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
});

const createSubtaskInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  required: z.boolean().default(false),
  assigneeId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
});

const updateSubtaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    required: z.boolean().optional(),
    status: subtaskStatusSchema.optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => data.title !== undefined || data.required !== undefined || data.status !== undefined,
    'At least one updatable field ("title", "required", or "status") must be provided.',
  );

const assignSubtaskInputSchema = z.object({
  assigneeId: z.union([z.string().uuid(), z.null()]),
  correlationId: z.string().uuid().optional(),
});

const reorderSubtasksInputSchema = z.object({
  orderedSubtaskIds: z.array(z.string().uuid()),
  correlationId: z.string().uuid().optional(),
});

const commentBodyInputSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  correlationId: z.string().uuid().optional(),
});

const createTagInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  colorToken: z.string().trim().min(1).max(40).optional(),
  correlationId: z.string().uuid().optional(),
});

const updateTagInputSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    colorToken: z.union([z.string().trim().min(1).max(40), z.null()]).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => data.name !== undefined || data.colorToken !== undefined,
    'At least one updatable field ("name" or "colorToken") must be provided.',
  );

export interface TaskServiceDependencies {
  readonly tasks: TaskRepositoryPort;
  readonly taskParticipants: TaskParticipantRepositoryPort;
  readonly subtasks: SubtaskRepositoryPort;
  readonly taskPauses: TaskPauseRepositoryPort;
  readonly taskExecutionCycles: TaskExecutionCycleRepositoryPort;
  readonly taskComments: TaskCommentRepositoryPort;
  readonly taskAttachments: TaskAttachmentRepositoryPort;
  readonly tags: TagRepositoryPort;
  readonly taskDeadlineHistory: TaskDeadlineHistoryRepositoryPort;
  readonly taskDependencies: TaskDependencyRepositoryPort;
  readonly impediments: ImpedimentRepositoryPort;
  readonly attachmentBlobStore: AttachmentBlobStorePort;
  readonly projectContext: TaskProjectContextPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly organizationSettings: OrganizationSettingsRepositoryPort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface ListProjectTasksOptions {
  readonly includeDeleted?: boolean;
}

export interface TaskDetail {
  readonly task: Task;
  readonly project: TaskProjectSummary;
  readonly column?: TaskBoardColumnSummary;
  readonly participants: readonly TaskParticipant[];
  readonly subtasks: readonly Subtask[];
  readonly comments: readonly TaskComment[];
  readonly attachments: readonly TaskAttachment[];
  readonly pauses: readonly TaskPause[];
  readonly executionCycles: readonly TaskExecutionCycle[];
  readonly deadlineHistory: readonly TaskDeadlineHistoryEntry[];
  readonly tags: readonly Tag[];
}

export interface TaskAttachmentContentResult {
  readonly attachment: TaskAttachment;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface CreateTaskInput {
  readonly id?: TaskId;
  readonly title: string;
  readonly description?: string;
  readonly columnId?: BoardColumnId;
  readonly priority?: Priority;
  readonly assigneeId?: UserId;
  readonly dueDate?: IsoDateTime;
  readonly tagIds?: readonly TagId[];
  readonly deadlineJustification?: string;
  readonly correlationId?: CorrelationId;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: Priority;
  readonly dueDate?: IsoDateTime | null;
  readonly tagIds?: readonly TagId[];
  readonly deadlineJustification?: string;
  readonly correlationId?: CorrelationId;
}

export interface AssignTaskInput {
  readonly assigneeId: UserId | null;
  readonly correlationId?: CorrelationId;
}

export interface AddTaskParticipantInput {
  readonly userId: UserId;
  readonly correlationId?: CorrelationId;
}

export interface TaskOperationOptions {
  readonly reason?: string;
  readonly correlationId?: CorrelationId;
}

export interface PauseTaskInput {
  readonly reason: string;
  readonly correlationId?: CorrelationId;
}

export interface PauseTaskResult {
  readonly task: Task;
  readonly pause: TaskPause;
}

export interface CompleteTaskInput {
  readonly dependencyOverrideJustification?: string;
  readonly correlationId?: CorrelationId;
}

export interface CancelTaskInput {
  readonly justification: string;
  readonly correlationId?: CorrelationId;
}

export interface ReopenTaskInput {
  readonly reason?: string;
  readonly targetColumnId?: BoardColumnId;
  readonly correlationId?: CorrelationId;
}

export interface CreateSubtaskInput {
  readonly title: string;
  readonly required?: boolean;
  readonly assigneeId?: UserId;
  readonly correlationId?: CorrelationId;
}

export interface UpdateSubtaskInput {
  readonly title?: string;
  readonly required?: boolean;
  readonly status?: SubtaskStatus;
  readonly correlationId?: CorrelationId;
}

export interface AssignSubtaskInput {
  readonly assigneeId: UserId | null;
  readonly correlationId?: CorrelationId;
}

export interface TaskCommentInput {
  readonly body: string;
  readonly correlationId?: CorrelationId;
}

export interface UploadTaskAttachmentInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly correlationId?: CorrelationId;
}

export interface CreateTagInput {
  readonly name: string;
  readonly colorToken?: string;
  readonly correlationId?: CorrelationId;
}

export interface UpdateTagInput {
  readonly name?: string;
  readonly colorToken?: string | null;
  readonly correlationId?: CorrelationId;
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
    throw new ValidationError('Invalid task input payload.', {
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

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes SHA-256 hex digest over binary attachment bytes.
 * Must ALWAYS be called strictly BEFORE opening any `TransactionPort.run(...)` (ADR-0011 §2.1).
 */
async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
    return bytesToHex(new Uint8Array(digest));
  }

  throw new ValidationError('WebCrypto SHA-256 digest is unavailable in this environment.');
}

function assertProjectOperational(project: TaskProjectSummary): void {
  if (isSoftDeleted(project)) {
    throw new ConflictError('Cannot execute operational task actions on a deleted project.', {
      details: { projectId: project.id },
    });
  }

  if (project.status === 'ARCHIVED' || project.archivedAt !== undefined) {
    throw new ConflictError('Cannot execute operational task actions on an archived project.', {
      details: { projectId: project.id },
    });
  }
}

function deduplicateTagIds(rawTagIds: readonly string[]): TagId[] {
  const seen = new Set<TagId>();
  const result: TagId[] = [];
  for (const rawId of rawTagIds) {
    const tagId = asTagId(rawId, 'tagIds');
    if (!seen.has(tagId)) {
      seen.add(tagId);
      result.push(tagId);
    }
  }
  return result;
}

function resolveTaskReadAction(
  task: Task | null,
  project: TaskProjectSummary | null,
  activeAction:
    | typeof PERMISSION_CODES.TASK_VIEW
    | typeof PERMISSION_CODES.TASK_HISTORY_VIEW = PERMISSION_CODES.TASK_VIEW,
):
  | typeof PERMISSION_CODES.TRASH_VIEW
  | typeof PERMISSION_CODES.TASK_VIEW
  | typeof PERMISSION_CODES.TASK_HISTORY_VIEW {
  return task !== null && isSoftDeleted(task) && project !== null && !isSoftDeleted(project)
    ? PERMISSION_CODES.TRASH_VIEW
    : activeAction;
}

function buildTaskResource(input: {
  readonly organizationId: OrganizationId;
  readonly taskId: TaskId;
  readonly task: Task | null;
  readonly project: TaskProjectSummary | null;
  readonly participantIds: readonly UserId[];
  readonly createdByOverride?: UserId;
  readonly subtaskId?: SubtaskId;
  readonly subtaskAssigneeId?: UserId;
  readonly requestedFields?: readonly TaskUpdatableField[];
}): AuthorizationResource {
  return {
    kind: input.subtaskId !== undefined ? 'SUBTASK' : 'TASK',
    id: asEntityId(input.subtaskId ?? input.taskId),
    exists: input.task !== null && input.project !== null,
    organizationId: input.organizationId,
    projectId: input.task?.projectId ?? input.project?.id,
    teamId: input.project?.teamId,
    ownerUserId: input.project?.ownerUserId,
    taskId: input.taskId,
    ...(input.subtaskId !== undefined ? { subtaskId: input.subtaskId } : {}),
    ...(input.subtaskAssigneeId !== undefined
      ? { subtaskAssigneeId: input.subtaskAssigneeId }
      : {}),
    createdBy: input.createdByOverride ?? input.task?.createdByUserId,
    assigneeId: input.task?.assigneeId,
    participantIds: input.participantIds,
    deletedAt: input.task?.deletedAt ?? input.project?.deletedAt,
    archivedAt: input.project?.archivedAt,
    projectArchivedAt: input.project?.archivedAt,
    ...(input.requestedFields !== undefined ? { requestedFields: input.requestedFields } : {}),
  };
}

export class TaskService {
  private readonly deps: TaskServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: TaskServiceDependencies) {
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

  private async loadEffectivePolicy(
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<{
    readonly settings: OrganizationSettings;
    readonly policyConfig: AuthorizationPolicyConfig;
  }> {
    const persisted = await this.deps.organizationSettings.findByOrganization(organizationId);
    const settings = persisted ?? createDefaultOrganizationSettings(organizationId, now);
    return {
      settings,
      policyConfig: toAuthorizationPolicyConfig(settings),
    };
  }

  private async buildAuthorizationActor(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<AuthorizationActor> {
    const [membership, projectScopes, grants, explicitDenies] = await Promise.all([
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
      this.deps.projectContext.listActorProjectScopes(organizationId, actorUserId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
    ]);

    return {
      isAuthenticated: true,
      userId: actorUserId,
      ...(membership !== null
        ? {
            organizationMembership: {
              organizationId: membership.organizationId,
              role: membership.role,
              status: membership.status,
            },
          }
        : {}),
      managedProjectIds: projectScopes.managedProjectIds,
      participatedProjectIds: projectScopes.participatedProjectIds,
      grants,
      explicitDenies,
    };
  }

  private async loadTaskAuthContext(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    now: IsoDateTime,
  ): Promise<{
    readonly actor: AuthorizationActor;
    readonly task: Task | null;
    readonly project: TaskProjectSummary | null;
    readonly activeParticipantIds: readonly UserId[];
    readonly settings: OrganizationSettings;
    readonly policyConfig: AuthorizationPolicyConfig;
  }> {
    const [actor, task, { settings, policyConfig }] = await Promise.all([
      this.buildAuthorizationActor(actorUserId, organizationId, now),
      this.deps.tasks.findById(organizationId, taskId),
      this.loadEffectivePolicy(organizationId, now),
    ]);

    const [project, participants] = await Promise.all([
      task !== null
        ? this.deps.projectContext.findProjectById(organizationId, task.projectId)
        : Promise.resolve(null),
      task !== null
        ? this.deps.taskParticipants.listByTask(organizationId, taskId)
        : Promise.resolve([]),
    ]);

    const activeParticipantIds = participants
      .filter((participant) => participant.removedAt === undefined)
      .map((participant) => participant.userId);

    return {
      actor,
      task,
      project,
      activeParticipantIds,
      settings,
      policyConfig,
    };
  }

  private async validateProjectAssignee(
    organizationId: OrganizationId,
    projectId: ProjectId,
    assigneeId: UserId,
  ): Promise<void> {
    const member = await this.deps.organizationMembers.findByOrganizationAndUser(
      organizationId,
      assigneeId,
    );
    if (!member || member.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new NotFoundError('Task assignee must be an active member of the organization.', {
        details: { organizationId, assigneeId },
      });
    }

    const participates = await this.deps.projectContext.isProjectParticipant(
      organizationId,
      projectId,
      assigneeId,
    );
    if (!participates) {
      throw new ConflictError('Task assignee must be an active participant of the project.', {
        details: { projectId, assigneeId },
      });
    }
  }

  private async validateOrganizationTags(
    organizationId: OrganizationId,
    tagIds: readonly TagId[],
  ): Promise<void> {
    if (tagIds.length === 0) {
      return;
    }

    const orgTags = await this.deps.tags.listByOrganization(organizationId);
    const existingIds = new Set(orgTags.map((tag) => tag.id));

    for (const tagId of tagIds) {
      if (!existingIds.has(tagId)) {
        throw new NotFoundError(`Tag "${tagId}" was not found in this organization.`, {
          details: { organizationId, tagId },
        });
      }
    }
  }

  private async buildCrossColumnMoveSaves(input: {
    readonly organizationId: OrganizationId;
    readonly movingTask: Task;
    readonly sourceColumnId: BoardColumnId;
    readonly targetColumnId: BoardColumnId;
  }): Promise<{ readonly updatedMovingTask: Task; readonly tasksToSave: readonly Task[] }> {
    const [sourceTasks, targetTasks] = await Promise.all([
      this.deps.tasks.listByColumn(input.organizationId, input.sourceColumnId),
      this.deps.tasks.listByColumn(input.organizationId, input.targetColumnId),
    ]);

    const tasksToSave: Task[] = [];
    const remainingSource = sourceTasks.filter((candidate) => candidate.id !== input.movingTask.id);
    remainingSource.forEach((candidate, index) => {
      const nextOrder = index + 1;
      if (candidate.order !== nextOrder) {
        tasksToSave.push({ ...candidate, order: nextOrder });
      }
    });

    const targetWithoutMoving = targetTasks.filter(
      (candidate) => candidate.id !== input.movingTask.id,
    );
    const nextTargetOrder =
      targetWithoutMoving.length === 0
        ? 1
        : Math.max(...targetWithoutMoving.map((candidate) => candidate.order)) + 1;

    const updatedMovingTask: Task = {
      ...input.movingTask,
      columnId: input.targetColumnId,
      order: nextTargetOrder,
    };
    tasksToSave.push(updatedMovingTask);

    return { updatedMovingTask, tasksToSave };
  }

  // ===========================================================================
  // Consultas
  // ===========================================================================

  async listProjectTasks(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: ListProjectTasksOptions = {},
  ): Promise<readonly Task[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();

    const [actor, project, { policyConfig }] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projectContext.findProjectById(validatedOrgId, validatedProjectId),
      this.loadEffectivePolicy(validatedOrgId, now),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_VIEW,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
        projectArchivedAt: project?.archivedAt,
      },
      context: { now, policyConfig },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    const projectTasks = await this.deps.tasks.listByProject(validatedOrgId, validatedProjectId, {
      includeDeleted: options.includeDeleted ?? false,
    });

    const visibleTasks: Task[] = [];

    for (const task of projectTasks) {
      const participants = await this.deps.taskParticipants.listByTask(validatedOrgId, task.id);
      const participantIds = participants
        .filter((participant) => participant.removedAt === undefined)
        .map((participant) => participant.userId);

      const action = isSoftDeleted(task) ? PERMISSION_CODES.TRASH_VIEW : PERMISSION_CODES.TASK_VIEW;

      const decision = evaluateAuthorization({
        actor,
        action,
        resource: buildTaskResource({
          organizationId: validatedOrgId,
          taskId: task.id,
          task,
          project,
          participantIds,
        }),
        context: { now, policyConfig },
      });

      if (decision.allowed) {
        visibleTasks.push(task);
      }
    }

    return visibleTasks;
  }

  async getTaskDetail(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<TaskDetail> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    const taskResource = buildTaskResource({
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      task,
      project,
      participantIds: activeParticipantIds,
    });

    const viewAction = resolveTaskReadAction(task, project);

    assertAuthorized({
      actor,
      action: viewAction,
      resource: taskResource,
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`, {
        details: { organizationId: validatedOrgId, taskId: validatedTaskId },
      });
    }

    const canViewHistory = evaluateAuthorization({
      actor,
      action: resolveTaskReadAction(task, project, PERMISSION_CODES.TASK_HISTORY_VIEW),
      resource: taskResource,
      context: { now, policyConfig },
    }).allowed;

    const [
      allParticipants,
      subtasks,
      comments,
      attachments,
      pauses,
      executionCycles,
      deadlineHistory,
      orgTags,
      boardContext,
    ] = await Promise.all([
      this.deps.taskParticipants.listByTask(validatedOrgId, validatedTaskId),
      this.deps.subtasks.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskComments.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskAttachments.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskPauses.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
      canViewHistory
        ? this.deps.taskDeadlineHistory.listByTask(validatedOrgId, validatedTaskId)
        : Promise.resolve([]),
      this.deps.tags.listByOrganization(validatedOrgId),
      this.deps.projectContext.findPrimaryBoardWithColumns(validatedOrgId, task.projectId),
    ]);

    const activeParticipants = allParticipants.filter(
      (participant) => participant.removedAt === undefined,
    );
    const tagById = new Map(orgTags.map((tag) => [tag.id, tag]));
    const taskTags = task.tagIds
      .map((tagId) => tagById.get(tagId))
      .filter((tag): tag is Tag => tag !== undefined);
    const column = boardContext?.columns.find((candidate) => candidate.id === task.columnId);

    return Object.freeze({
      task,
      project,
      ...(column !== undefined ? { column } : {}),
      participants: activeParticipants,
      subtasks,
      comments,
      attachments,
      pauses,
      executionCycles,
      deadlineHistory,
      tags: taskTags,
    });
  }

  async listTaskComments(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskComment[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: resolveTaskReadAction(task, project),
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    return this.deps.taskComments.listByTask(validatedOrgId, validatedTaskId);
  }

  async listTaskAttachments(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskAttachment[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: resolveTaskReadAction(task, project),
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    return this.deps.taskAttachments.listByTask(validatedOrgId, validatedTaskId);
  }

  async getTaskAttachmentContent(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    attachmentId: AttachmentId,
  ): Promise<TaskAttachmentContentResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedAttachmentId = asAttachmentId(attachmentId, 'attachmentId');
    const now = this.now();

    const [{ actor, task, project, activeParticipantIds, policyConfig }, attachment] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.taskAttachments.findById(validatedOrgId, validatedAttachmentId),
      ]);

    // Revalidates strict read permission (TASK_VIEW or TRASH_VIEW for soft-deleted task in active project)
    // on the owning task BEFORE ever touching AttachmentBlobStorePort (ADR-0011 §2.4)
    assertAuthorized({
      actor,
      action: resolveTaskReadAction(task, project),
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    if (!attachment || attachment.taskId !== validatedTaskId) {
      throw new NotFoundError(
        `Attachment "${validatedAttachmentId}" was not found for task "${validatedTaskId}".`,
      );
    }

    const blob = await this.deps.attachmentBlobStore.getBlob(validatedOrgId, validatedAttachmentId);
    if (!blob) {
      throw new NotFoundError(
        `Binary payload for attachment "${validatedAttachmentId}" is missing.`,
      );
    }

    return Object.freeze({
      attachment,
      mimeType: blob.mimeType,
      bytes: blob.bytes,
    });
  }

  async listTaskDeadlineHistory(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskDeadlineHistoryEntry[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: resolveTaskReadAction(task, project, PERMISSION_CODES.TASK_HISTORY_VIEW),
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    return this.deps.taskDeadlineHistory.listByTask(validatedOrgId, validatedTaskId);
  }

  // ===========================================================================
  // Ciclo de Vida da Tarefa
  // ===========================================================================

  async createTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    input: CreateTaskInput,
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const parsed = parseWithZod(createTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, project, { policyConfig }] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projectContext.findProjectById(validatedOrgId, validatedProjectId),
      this.loadEffectivePolicy(validatedOrgId, now),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_CREATE,
      resource: {
        kind: 'TASK',
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
        projectArchivedAt: project?.archivedAt,
      },
      context: { now, policyConfig },
    });

    const validatedAssigneeId =
      parsed.assigneeId !== undefined ? asUserId(parsed.assigneeId, 'assigneeId') : undefined;

    if (validatedAssigneeId !== undefined && validatedAssigneeId !== validatedActorId) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.TASK_ASSIGN,
        resource: {
          kind: 'TASK',
          exists: project !== null,
          organizationId: validatedOrgId,
          projectId: validatedProjectId,
          teamId: project?.teamId,
          ownerUserId: project?.ownerUserId,
          assigneeId: validatedAssigneeId,
          deletedAt: project?.deletedAt,
          archivedAt: project?.archivedAt,
          projectArchivedAt: project?.archivedAt,
        },
        context: { now, policyConfig },
      });
    }

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (validatedAssigneeId !== undefined) {
      await this.validateProjectAssignee(validatedOrgId, validatedProjectId, validatedAssigneeId);
    }

    const validatedDueDate =
      parsed.dueDate !== undefined ? asIsoDateTime(parsed.dueDate, 'dueDate') : undefined;
    const tagIds = parsed.tagIds !== undefined ? deduplicateTagIds(parsed.tagIds) : [];
    await this.validateOrganizationTags(validatedOrgId, tagIds);

    const boardContext = await this.deps.projectContext.findPrimaryBoardWithColumns(
      validatedOrgId,
      validatedProjectId,
    );
    if (!boardContext) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    let targetColumn: TaskBoardColumnSummary | undefined;
    if (parsed.columnId !== undefined) {
      const requestedColumnId = asBoardColumnId(parsed.columnId, 'columnId');
      targetColumn = boardContext.columns.find((col) => col.id === requestedColumnId);
      if (!targetColumn) {
        throw new NotFoundError(`BoardColumn "${requestedColumnId}" was not found on this board.`);
      }
      if (targetColumn.archivedAt !== undefined) {
        throw new ConflictError('Cannot create a task inside an archived column.', {
          details: { columnId: requestedColumnId },
        });
      }
    } else {
      const activeColumns = boardContext.columns.filter((col) => col.archivedAt === undefined);
      targetColumn =
        activeColumns.find((col) => col.columnRole === 'INITIAL') ??
        activeColumns.find((col) => col.columnRole === 'OPERATIONAL');
      if (!targetColumn) {
        throw new ConflictError('No active operational column is available to create a task.');
      }
    }

    if (targetColumn.columnRole === 'FINAL') {
      throw new ConflictError('Cannot create a new task directly inside a final column.', {
        details: { columnId: targetColumn.id },
      });
    }

    const taskId =
      parsed.id !== undefined ? asTaskId(parsed.id, 'id') : asTaskId(this.nextUuid(), 'taskId');
    const existingTask = await this.deps.tasks.findById(validatedOrgId, taskId);
    if (existingTask !== null) {
      throw new ConflictError(`Task "${taskId}" already exists in this organization.`);
    }

    const initialStatus: TaskStatus =
      targetColumn.columnRole === 'OPERATIONAL' ? TASK_STATUSES.IN_PROGRESS : TASK_STATUSES.TODO;

    const existingColumnTasks = await this.deps.tasks.listByColumn(validatedOrgId, targetColumn.id);
    this.deps.projectContext.assertWipAllowsPlacement({
      targetColumn,
      currentColumnTasks: existingColumnTasks,
      movingTaskStatus: initialStatus,
    });

    const nextOrder =
      existingColumnTasks.length === 0
        ? 1
        : Math.max(...existingColumnTasks.map((t) => t.order)) + 1;

    const newTask: Task = {
      id: taskId,
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      boardId: boardContext.boardId,
      columnId: targetColumn.id,
      title: parsed.title,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      status: initialStatus,
      priority: parsed.priority,
      ...(validatedAssigneeId !== undefined ? { assigneeId: validatedAssigneeId } : {}),
      ...(validatedDueDate !== undefined ? { dueDate: validatedDueDate } : {}),
      order: nextOrder,
      tagIds,
      lastMovedAt: now,
      lastActivityAt: now,
      ...(initialStatus === TASK_STATUSES.IN_PROGRESS ? { startedAt: now } : {}),
      createdByUserId: validatedActorId,
      createdAt: now,
      updatedAt: now,
    };

    const initialCycle: TaskExecutionCycle = {
      id: asTaskExecutionCycleId(this.nextUuid()),
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      taskId: newTask.id,
      cycleNumber: 1,
      startedAt: now,
      ...(initialStatus === TASK_STATUSES.IN_PROGRESS ? { effectiveStartedAt: now } : {}),
    };

    const trimmedDeadlineReason = parsed.deadlineJustification?.trim();
    const initialDeadlineEntry: TaskDeadlineHistoryEntry | null =
      validatedDueDate !== undefined
        ? {
            id: asTaskDeadlineHistoryEntryId(this.nextUuid()),
            organizationId: validatedOrgId,
            taskId: newTask.id,
            newDueDate: validatedDueDate,
            changedByUserId: validatedActorId,
            changedAt: now,
            ...(trimmedDeadlineReason !== undefined && trimmedDeadlineReason.length > 0
              ? { justification: trimmedDeadlineReason }
              : {}),
          }
        : null;

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.TASK_DEADLINE_HISTORY,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.save(newTask);
        await this.deps.taskExecutionCycles.save(initialCycle);
        if (initialDeadlineEntry !== null) {
          await this.deps.taskDeadlineHistory.append(initialDeadlineEntry);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.created',
          resourceType: 'Task',
          resourceId: newTask.id,
          after: {
            projectId: validatedProjectId,
            boardId: boardContext.boardId,
            columnId: targetColumn.id,
            title: newTask.title,
            status: newTask.status,
            priority: newTask.priority,
            ...(newTask.assigneeId !== undefined ? { assigneeId: newTask.assigneeId } : {}),
            ...(newTask.dueDate !== undefined ? { dueDate: newTask.dueDate } : {}),
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: newTask.id,
            payload: {
              projectId: validatedProjectId,
              boardId: boardContext.boardId,
              columnId: targetColumn.id,
              taskId: newTask.id,
              title: newTask.title,
            },
          }),
        );
      },
    );

    return newTask;
  }

  async updateTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: UpdateTaskInput,
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(updateTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const requestedFields: TaskUpdatableField[] = [];
    if (parsed.title !== undefined) requestedFields.push('title');
    if (parsed.description !== undefined) requestedFields.push('description');
    if (parsed.priority !== undefined) requestedFields.push('priority');
    if (parsed.dueDate !== undefined) requestedFields.push('dueDate');
    if (parsed.tagIds !== undefined) requestedFields.push('tags');

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_UPDATE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
        requestedFields,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot update a cancelled task.', {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    let nextTagIds = task.tagIds;
    if (parsed.tagIds !== undefined) {
      nextTagIds = deduplicateTagIds(parsed.tagIds);
      await this.validateOrganizationTags(validatedOrgId, nextTagIds);
    }

    let nextDueDate = task.dueDate;
    let deadlineEntry: TaskDeadlineHistoryEntry | null = null;
    if (parsed.dueDate !== undefined) {
      nextDueDate = parsed.dueDate === null ? undefined : asIsoDateTime(parsed.dueDate, 'dueDate');
      if (nextDueDate !== task.dueDate) {
        const trimmedReason = parsed.deadlineJustification?.trim();
        deadlineEntry = {
          id: asTaskDeadlineHistoryEntryId(this.nextUuid()),
          organizationId: validatedOrgId,
          taskId: validatedTaskId,
          ...(task.dueDate !== undefined ? { previousDueDate: task.dueDate } : {}),
          ...(nextDueDate !== undefined ? { newDueDate: nextDueDate } : {}),
          changedByUserId: validatedActorId,
          changedAt: now,
          ...(trimmedReason !== undefined && trimmedReason.length > 0
            ? { justification: trimmedReason }
            : {}),
        };
      }
    }

    let nextDescription = task.description;
    if (parsed.description !== undefined) {
      nextDescription =
        parsed.description === null || parsed.description.length === 0
          ? undefined
          : parsed.description;
    }

    const { description: _prevDesc, dueDate: _prevDue, ...taskWithoutOptionalUpdated } = task;

    const updatedTask: Task = {
      ...taskWithoutOptionalUpdated,
      title: parsed.title ?? task.title,
      ...(nextDescription !== undefined ? { description: nextDescription } : {}),
      priority: parsed.priority ?? task.priority,
      ...(nextDueDate !== undefined ? { dueDate: nextDueDate } : {}),
      tagIds: nextTagIds,
      // PRD.md §12.1: updating fields never alters lastMovedAt
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_DEADLINE_HISTORY,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.save(updatedTask);
        if (deadlineEntry !== null) {
          await this.deps.taskDeadlineHistory.append(deadlineEntry);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.updated',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: {
            title: task.title,
            priority: task.priority,
            dueDate: task.dueDate ?? null,
            tagIds: task.tagIds,
          },
          after: {
            title: updatedTask.title,
            priority: updatedTask.priority,
            dueDate: updatedTask.dueDate ?? null,
            tagIds: updatedTask.tagIds,
            requestedFields,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              requestedFields,
            },
          }),
        );
      },
    );

    return updatedTask;
  }

  async assignTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: AssignTaskInput,
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(assignTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_ASSIGN,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot assign a cancelled task.');
    }

    const nextAssigneeId =
      parsed.assigneeId !== null ? asUserId(parsed.assigneeId, 'assigneeId') : undefined;
    if (nextAssigneeId !== undefined) {
      await this.validateProjectAssignee(validatedOrgId, task.projectId, nextAssigneeId);
    }

    const { assigneeId: _prevAssignee, ...taskBase } = task;
    const updatedTask: Task = {
      ...taskBase,
      ...(nextAssigneeId !== undefined ? { assigneeId: nextAssigneeId } : {}),
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TASKS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.assigned',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { assigneeId: task.assigneeId ?? null },
          after: { assigneeId: nextAssigneeId ?? null },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.assigned',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              assigneeId: nextAssigneeId ?? null,
            },
          }),
        );
      },
    );

    return updatedTask;
  }

  async addTaskParticipant(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: AddTaskParticipantInput,
  ): Promise<TaskParticipant> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(addTaskParticipantInputSchema, input);
    const targetUserId = asUserId(parsed.userId, 'userId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_PARTICIPANTS_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot add participants to a cancelled task.');
    }

    await this.validateProjectAssignee(validatedOrgId, task.projectId, targetUserId);

    const existing = await this.deps.taskParticipants.findByTaskAndUser(
      validatedOrgId,
      validatedTaskId,
      targetUserId,
    );
    if (existing !== null && existing.removedAt === undefined) {
      throw new ConflictError('User is already an active participant of this task.', {
        details: { taskId: validatedTaskId, userId: targetUserId },
      });
    }

    // Reuses existing.id on readmission to respect &[organizationId+taskId+userId] (ADR-0011 §1.2)
    const participant: TaskParticipant = {
      id: existing?.id ?? asTaskParticipantId(this.nextUuid()),
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      userId: targetUserId,
      addedByUserId: validatedActorId,
      joinedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_PARTICIPANTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskParticipants.save(participant);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.participant.added',
          resourceType: 'TaskParticipant',
          resourceId: participant.id,
          after: {
            taskId: validatedTaskId,
            userId: targetUserId,
            reactivated: existing !== null,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.participant.added',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskParticipant',
            aggregateId: participant.id,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              userId: targetUserId,
            },
          }),
        );
      },
    );

    return participant;
  }

  async removeTaskParticipant(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    targetUserId: UserId,
    options: TaskOperationOptions = {},
  ): Promise<TaskParticipant> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedTargetUserId = asUserId(targetUserId, 'targetUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_PARTICIPANTS_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    const existing = await this.deps.taskParticipants.findByTaskAndUser(
      validatedOrgId,
      validatedTaskId,
      validatedTargetUserId,
    );
    if (!existing || existing.removedAt !== undefined) {
      throw new NotFoundError(
        `Active participant "${validatedTargetUserId}" was not found on task "${validatedTaskId}".`,
      );
    }

    const removedParticipant: TaskParticipant = {
      ...existing,
      removedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_PARTICIPANTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskParticipants.save(removedParticipant);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.participant.removed',
          resourceType: 'TaskParticipant',
          resourceId: existing.id,
          before: { removedAt: null },
          after: { removedAt: now, userId: validatedTargetUserId },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.participant.removed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskParticipant',
            aggregateId: existing.id,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              userId: validatedTargetUserId,
            },
          }),
        );
      },
    );

    return removedParticipant;
  }

  async startTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    options: TaskOperationOptions = {},
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_START,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status !== TASK_STATUSES.TODO) {
      throw new ConflictError('Only tasks in TODO status can be started.', {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const [cycles, boardContext] = await Promise.all([
      this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
      this.deps.projectContext.findPrimaryBoardWithColumns(validatedOrgId, task.projectId),
    ]);

    if (!boardContext) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${task.projectId}".`,
      );
    }

    const currentColumn = boardContext.columns.find((col) => col.id === task.columnId);
    const activeOperationalColumn =
      currentColumn?.columnRole === 'INITIAL'
        ? boardContext.columns.find(
            (col) => col.archivedAt === undefined && col.columnRole === 'OPERATIONAL',
          )
        : undefined;

    const shouldMoveColumn =
      activeOperationalColumn !== undefined && activeOperationalColumn.id !== task.columnId;

    if (shouldMoveColumn && activeOperationalColumn !== undefined) {
      const targetColumnTasks = await this.deps.tasks.listByColumn(
        validatedOrgId,
        activeOperationalColumn.id,
      );
      this.deps.projectContext.assertWipAllowsPlacement({
        targetColumn: activeOperationalColumn,
        currentColumnTasks: targetColumnTasks,
        movingTaskStatus: TASK_STATUSES.IN_PROGRESS,
      });
    }

    const startedTaskBase: Task = {
      ...task,
      status: TASK_STATUSES.IN_PROGRESS,
      startedAt: task.startedAt ?? now,
      lastMovedAt: shouldMoveColumn ? now : task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    let finalStartedTask: Task = startedTaskBase;
    let tasksToSave: readonly Task[] = [startedTaskBase];

    if (shouldMoveColumn && activeOperationalColumn !== undefined) {
      const moveResult = await this.buildCrossColumnMoveSaves({
        organizationId: validatedOrgId,
        movingTask: startedTaskBase,
        sourceColumnId: task.columnId,
        targetColumnId: activeOperationalColumn.id,
      });
      finalStartedTask = moveResult.updatedMovingTask;
      tasksToSave = moveResult.tasksToSave;
    }

    const openCycle = cycles.find((cycle) => cycle.completedAt === undefined);
    const cycleToSave: TaskExecutionCycle =
      openCycle !== undefined
        ? {
            ...openCycle,
            effectiveStartedAt: openCycle.effectiveStartedAt ?? now,
          }
        : {
            id: asTaskExecutionCycleId(this.nextUuid()),
            organizationId: validatedOrgId,
            projectId: task.projectId,
            taskId: validatedTaskId,
            cycleNumber: cycles.length + 1,
            startedAt: task.createdAt,
            effectiveStartedAt: now,
          };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.saveMany(validatedOrgId, tasksToSave);
        await this.deps.taskExecutionCycles.save(cycleToSave);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.started',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { status: task.status, columnId: task.columnId },
          after: {
            status: finalStartedTask.status,
            columnId: finalStartedTask.columnId,
            startedAt: finalStartedTask.startedAt,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.started',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              columnId: finalStartedTask.columnId,
            },
          }),
        );
      },
    );

    return finalStartedTask;
  }

  async pauseTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: PauseTaskInput,
  ): Promise<PauseTaskResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(pauseTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_PAUSE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);
    assertTaskPauseJustification(parsed.reason);

    if (
      task.status === TASK_STATUSES.DONE ||
      task.status === TASK_STATUSES.CANCELLED ||
      task.status === TASK_STATUSES.PAUSED
    ) {
      throw new ConflictError(`Cannot pause task while in "${task.status}" status.`, {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const [pauses, cycles] = await Promise.all([
      this.deps.taskPauses.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
    ]);

    if (pauses.some((pause) => pause.endedAt === undefined)) {
      throw new ConflictError('Task already has an open pause interval.', {
        details: { taskId: validatedTaskId },
      });
    }

    const openCycle = cycles.find((cycle) => cycle.completedAt === undefined);
    const cycleToPersist: TaskExecutionCycle | null =
      openCycle === undefined
        ? {
            id: asTaskExecutionCycleId(this.nextUuid()),
            organizationId: validatedOrgId,
            projectId: task.projectId,
            taskId: validatedTaskId,
            cycleNumber: cycles.length + 1,
            startedAt: task.startedAt ?? task.createdAt,
            ...(task.startedAt !== undefined ? { effectiveStartedAt: task.startedAt } : {}),
          }
        : null;

    const targetCycleId = openCycle?.id ?? cycleToPersist!.id;
    const trimmedReason = parsed.reason.trim();

    const newPause: TaskPause = {
      id: asTaskPauseId(this.nextUuid()),
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      cycleId: targetCycleId,
      startedAt: now,
      startedByUserId: validatedActorId,
      reason: trimmedReason,
    };

    const pausedTask: Task = {
      ...task,
      status: TASK_STATUSES.PAUSED,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_PAUSES,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        if (cycleToPersist !== null) {
          await this.deps.taskExecutionCycles.save(cycleToPersist);
        }
        await this.deps.taskPauses.save(newPause);
        await this.deps.tasks.save(pausedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.paused',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { status: task.status },
          after: { status: pausedTask.status, pauseId: newPause.id },
          justification: trimmedReason,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.paused',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              pauseId: newPause.id,
              reason: trimmedReason,
            },
          }),
        );
      },
    );

    return Object.freeze({ task: pausedTask, pause: newPause });
  }

  async resumeTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    options: TaskOperationOptions = {},
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_PAUSE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    const [pauses, taskImpediments, boardContext] = await Promise.all([
      this.deps.taskPauses.listByTask(validatedOrgId, validatedTaskId),
      this.deps.impediments.listByTask(validatedOrgId, validatedTaskId),
      this.deps.projectContext.findPrimaryBoardWithColumns(validatedOrgId, task.projectId),
    ]);

    const openPauses = pauses.filter((pause) => pause.endedAt === undefined);
    if (task.status !== TASK_STATUSES.PAUSED && openPauses.length === 0) {
      throw new ConflictError('Task is not currently paused.', {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const hasBlockingImpediment = taskImpediments.some(isImpedimentBlocking);
    const currentColumn = boardContext?.columns.find((col) => col.id === task.columnId);

    let nextStatus: TaskStatus;
    if (hasBlockingImpediment) {
      nextStatus = TASK_STATUSES.BLOCKED;
    } else if (task.startedAt !== undefined || currentColumn?.columnRole === 'OPERATIONAL') {
      nextStatus = TASK_STATUSES.IN_PROGRESS;
    } else {
      nextStatus = TASK_STATUSES.TODO;
    }

    const closedPauses: TaskPause[] = openPauses.map((pause) => ({
      ...pause,
      endedAt: now,
      endedByUserId: validatedActorId,
    }));

    const resumedTask: Task = {
      ...task,
      status: nextStatus,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_PAUSES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        for (const pause of closedPauses) {
          await this.deps.taskPauses.save(pause);
        }
        await this.deps.tasks.save(resumedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.resumed',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { status: task.status },
          after: { status: resumedTask.status, closedPauseCount: closedPauses.length },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.resumed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              status: resumedTask.status,
            },
          }),
        );
      },
    );

    return resumedTask;
  }

  async completeTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: CompleteTaskInput = {},
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(completeTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    const taskResource = buildTaskResource({
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      task,
      project,
      participantIds: activeParticipantIds,
    });

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_COMPLETE,
      resource: taskResource,
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot complete a task already in "${task.status}" status.`, {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const [subtasks, dependencies, impediments, cycles, pauses, boardContext] = await Promise.all([
      this.deps.subtasks.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskDependencies.listByTask(validatedOrgId, validatedTaskId),
      this.deps.impediments.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskPauses.listByTask(validatedOrgId, validatedTaskId),
      this.deps.projectContext.findPrimaryBoardWithColumns(validatedOrgId, task.projectId),
    ]);

    if (!boardContext) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${task.projectId}".`,
      );
    }

    const requiredDeps = dependencies.filter(
      (dep) => dep.taskId === validatedTaskId && dep.required,
    );
    const completedDepIds = new Set<TaskId>();
    if (requiredDeps.length > 0) {
      const referencedTasks = await Promise.all(
        Array.from(new Set(requiredDeps.map((dep) => dep.dependsOnTaskId))).map((depTaskId) =>
          this.deps.tasks.findById(validatedOrgId, depTaskId),
        ),
      );
      for (const depTask of referencedTasks) {
        if (depTask !== null && !isSoftDeleted(depTask) && depTask.status === TASK_STATUSES.DONE) {
          completedDepIds.add(depTask.id);
        }
      }
    }

    const pendingRequiredDependencyIds = getPendingRequiredDependencies(
      validatedTaskId,
      dependencies,
      completedDepIds,
    ).map((dep) => dep.dependsOnTaskId);

    const openBlockingImpedimentIds = impediments
      .filter(isImpedimentBlocking)
      .map((impediment) => impediment.id);

    const dependencyException =
      parsed.dependencyOverrideJustification !== undefined
        ? {
            authorized: evaluateAuthorization({
              actor,
              action: PERMISSION_CODES.DEPENDENCY_MANAGE,
              resource: taskResource,
              context: { now, policyConfig },
            }).allowed,
            justification: parsed.dependencyOverrideJustification,
          }
        : undefined;

    const completionCheck = assertTaskCanBeCompleted({
      requiredSubtasks: subtasks,
      pendingRequiredDependencyIds,
      openBlockingImpedimentIds,
      ...(dependencyException !== undefined ? { dependencyException } : {}),
    });

    const currentColumn = boardContext.columns.find((col) => col.id === task.columnId);
    const activeFinalColumn =
      currentColumn?.columnRole === 'FINAL' && currentColumn.archivedAt === undefined
        ? currentColumn
        : boardContext.columns.find(
            (col) => col.archivedAt === undefined && col.columnRole === 'FINAL',
          );

    if (!activeFinalColumn) {
      throw new ConflictError('No active final column is available on the project board.');
    }

    const isMovingToFinal = activeFinalColumn.id !== task.columnId;
    const baseCompletedTask: Task = {
      ...task,
      status: TASK_STATUSES.DONE,
      completedAt: now,
      lastMovedAt: isMovingToFinal ? now : task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    let finalCompletedTask = baseCompletedTask;
    let tasksToSave: readonly Task[] = [baseCompletedTask];

    if (isMovingToFinal) {
      const moveResult = await this.buildCrossColumnMoveSaves({
        organizationId: validatedOrgId,
        movingTask: baseCompletedTask,
        sourceColumnId: task.columnId,
        targetColumnId: activeFinalColumn.id,
      });
      finalCompletedTask = moveResult.updatedMovingTask;
      tasksToSave = moveResult.tasksToSave;
    }

    const openCycle = cycles.find((cycle) => cycle.completedAt === undefined);
    const cycleToSave: TaskExecutionCycle | null =
      openCycle !== undefined
        ? { ...openCycle, completedAt: now }
        : cycles.length === 0
          ? {
              id: asTaskExecutionCycleId(this.nextUuid()),
              organizationId: validatedOrgId,
              projectId: task.projectId,
              taskId: validatedTaskId,
              cycleNumber: 1,
              startedAt: task.startedAt ?? task.createdAt,
              effectiveStartedAt: task.startedAt ?? task.createdAt,
              completedAt: now,
            }
          : null;

    const openPausesToClose: TaskPause[] = pauses
      .filter((pause) => pause.endedAt === undefined)
      .map((pause) => ({
        ...pause,
        endedAt: now,
        endedByUserId: validatedActorId,
      }));

    const trimmedOverrideReason = parsed.dependencyOverrideJustification?.trim();

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.TASK_PAUSES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.saveMany(validatedOrgId, tasksToSave);
        if (cycleToSave !== null) {
          await this.deps.taskExecutionCycles.save(cycleToSave);
        }
        for (const pause of openPausesToClose) {
          await this.deps.taskPauses.save(pause);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.completed',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { status: task.status, columnId: task.columnId },
          after: {
            status: finalCompletedTask.status,
            columnId: finalCompletedTask.columnId,
            completedAt: now,
            usedDependencyException: completionCheck.usedDependencyException,
          },
          ...(completionCheck.usedDependencyException &&
          trimmedOverrideReason !== undefined &&
          trimmedOverrideReason.length > 0
            ? { justification: trimmedOverrideReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.completed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              columnId: finalCompletedTask.columnId,
              usedDependencyException: completionCheck.usedDependencyException,
            },
          }),
        );
      },
    );

    return finalCompletedTask;
  }

  async cancelTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: CancelTaskInput,
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(cancelTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_CANCEL,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);
    assertTaskCanBeCancelled(parsed.justification);

    if (task.status === TASK_STATUSES.CANCELLED || task.status === TASK_STATUSES.DONE) {
      throw new ConflictError(`Cannot cancel task already in "${task.status}" status.`, {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const trimmedReason = parsed.justification.trim();
    const [cycles, pauses] = await Promise.all([
      this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
      this.deps.taskPauses.listByTask(validatedOrgId, validatedTaskId),
    ]);

    const openCycle = cycles.find((cycle) => cycle.completedAt === undefined);
    const cycleToSave: TaskExecutionCycle | null =
      openCycle !== undefined
        ? { ...openCycle, completedAt: now }
        : cycles.length === 0
          ? {
              id: asTaskExecutionCycleId(this.nextUuid()),
              organizationId: validatedOrgId,
              projectId: task.projectId,
              taskId: validatedTaskId,
              cycleNumber: 1,
              startedAt: task.startedAt ?? task.createdAt,
              ...(task.startedAt !== undefined ? { effectiveStartedAt: task.startedAt } : {}),
              completedAt: now,
            }
          : null;

    const openPausesToClose: TaskPause[] = pauses
      .filter((pause) => pause.endedAt === undefined)
      .map((pause) => ({
        ...pause,
        endedAt: now,
        endedByUserId: validatedActorId,
      }));

    const cancelledTask: Task = {
      ...task,
      status: TASK_STATUSES.CANCELLED,
      cancelledAt: now,
      cancellationReason: trimmedReason,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.TASK_PAUSES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.save(cancelledTask);
        if (cycleToSave !== null) {
          await this.deps.taskExecutionCycles.save(cycleToSave);
        }
        for (const pause of openPausesToClose) {
          await this.deps.taskPauses.save(pause);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.cancelled',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { status: task.status },
          after: { status: cancelledTask.status, cancelledAt: now },
          justification: trimmedReason,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.cancelled',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              cancellationReason: trimmedReason,
            },
          }),
        );
      },
    );

    return cancelledTask;
  }

  async requestTaskCancellation(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: CancelTaskInput,
  ): Promise<TaskComment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(cancelTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_COMMENT,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);
    assertTaskCanBeCancelled(parsed.justification);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot request cancellation for task in "${task.status}" status.`, {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const trimmedReason = parsed.justification.trim();
    const systemComment: TaskComment = {
      id: asTaskCommentId(this.nextUuid()),
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      authorUserId: validatedActorId,
      body: `Solicitação de cancelamento: ${trimmedReason}`,
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    };

    const touchedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_COMMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskComments.save(systemComment);
        await this.deps.tasks.save(touchedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.cancellation_requested',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          after: {
            commentId: systemComment.id,
            statusUnchanged: task.status,
          },
          justification: trimmedReason,
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.cancellation_requested',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              commentId: systemComment.id,
              justification: trimmedReason,
            },
          }),
        );
      },
    );

    return systemComment;
  }

  async reopenTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: ReopenTaskInput = {},
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(reopenTaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_REOPEN,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status !== TASK_STATUSES.DONE && task.status !== TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Only DONE or CANCELLED tasks can be reopened.', {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const [cycles, boardContext] = await Promise.all([
      this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
      this.deps.projectContext.findPrimaryBoardWithColumns(validatedOrgId, task.projectId),
    ]);

    if (!boardContext) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${task.projectId}".`,
      );
    }

    let targetColumn: TaskBoardColumnSummary | undefined;
    if (parsed.targetColumnId !== undefined) {
      const requestedColumnId = asBoardColumnId(parsed.targetColumnId, 'targetColumnId');
      targetColumn = boardContext.columns.find((col) => col.id === requestedColumnId);
      if (!targetColumn) {
        throw new NotFoundError(`BoardColumn "${requestedColumnId}" was not found on this board.`);
      }
      if (targetColumn.archivedAt !== undefined || targetColumn.columnRole === 'FINAL') {
        throw new ConflictError('Cannot reopen a task into an archived or final column.', {
          details: { columnId: requestedColumnId },
        });
      }
    } else {
      const currentColumn = boardContext.columns.find((col) => col.id === task.columnId);
      if (
        currentColumn !== undefined &&
        currentColumn.archivedAt === undefined &&
        currentColumn.columnRole !== 'FINAL'
      ) {
        targetColumn = currentColumn;
      } else {
        const activeColumns = boardContext.columns.filter((col) => col.archivedAt === undefined);
        targetColumn =
          activeColumns.find((col) => col.columnRole === 'OPERATIONAL') ??
          activeColumns.find((col) => col.columnRole === 'INITIAL');
      }
    }

    if (!targetColumn) {
      throw new ConflictError(
        'No active operational or initial column is available to reopen task.',
      );
    }

    const nextStatus: TaskStatus =
      targetColumn.columnRole === 'INITIAL' ? TASK_STATUSES.TODO : TASK_STATUSES.IN_PROGRESS;

    const targetColumnTasks = await this.deps.tasks.listByColumn(validatedOrgId, targetColumn.id);
    this.deps.projectContext.assertWipAllowsPlacement({
      targetColumn,
      currentColumnTasks: targetColumnTasks.filter((t) => t.id !== validatedTaskId),
      movingTaskStatus: nextStatus,
    });

    const newCycle = assertTaskReopenCreatesNewCycle(
      cycles,
      now,
      asTaskExecutionCycleId(this.nextUuid()),
      parsed.reason,
    );

    const isMovingColumn = targetColumn.id !== task.columnId;
    const {
      completedAt: _clearedCompletedAt,
      cancelledAt: _clearedCancelledAt,
      cancellationReason: _clearedCancelReason,
      ...taskBase
    } = task;

    const reopenedBase: Task = {
      ...taskBase,
      status: nextStatus,
      ...(nextStatus === TASK_STATUSES.IN_PROGRESS ? { startedAt: task.startedAt ?? now } : {}),
      lastMovedAt: isMovingColumn ? now : task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    let finalReopenedTask = reopenedBase;
    let tasksToSave: readonly Task[] = [reopenedBase];

    if (isMovingColumn) {
      const moveResult = await this.buildCrossColumnMoveSaves({
        organizationId: validatedOrgId,
        movingTask: reopenedBase,
        sourceColumnId: task.columnId,
        targetColumnId: targetColumn.id,
      });
      finalReopenedTask = moveResult.updatedMovingTask;
      tasksToSave = moveResult.tasksToSave;
    }

    const trimmedReason = parsed.reason?.trim();

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.saveMany(validatedOrgId, tasksToSave);
        await this.deps.taskExecutionCycles.save(newCycle);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.reopened',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { status: task.status, columnId: task.columnId },
          after: {
            status: finalReopenedTask.status,
            columnId: finalReopenedTask.columnId,
            newCycleId: newCycle.id,
            cycleNumber: newCycle.cycleNumber,
          },
          ...(trimmedReason !== undefined && trimmedReason.length > 0
            ? { justification: trimmedReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.reopened',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              cycleId: newCycle.id,
              cycleNumber: newCycle.cycleNumber,
            },
          }),
        );
      },
    );

    return finalReopenedTask;
  }

  async deleteTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    options: TaskOperationOptions = {},
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    // Normative Decision A (ADR-0011 §4): deleteTask protected by TASK_CANCEL + full ABAC
    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_CANCEL,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    const trimmedReason = options.reason?.trim();
    const deletedTask: Task = {
      ...task,
      deletedAt: now,
      deletedBy: validatedActorId,
      ...(trimmedReason !== undefined && trimmedReason.length > 0
        ? { deletionReason: trimmedReason }
        : {}),
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.save(deletedTask);

        const revokedGrantsCount = await this.deps.permissionGrants.revokeAllByScope(
          validatedOrgId,
          PERMISSION_SCOPE_TYPES.RESOURCE,
          asEntityId(validatedTaskId),
          validatedActorId,
          now,
        );

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.deleted',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { deletedAt: null },
          after: {
            deletedAt: now,
            deletionReason: deletedTask.deletionReason ?? null,
            revokedGrantsCount,
          },
          ...(trimmedReason !== undefined && trimmedReason.length > 0
            ? { justification: trimmedReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              revokedGrantsCount,
            },
          }),
        );
      },
    );

    return deletedTask;
  }

  async restoreTask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    options: TaskOperationOptions = {},
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TRASH_RESTORE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    const boardContext = await this.deps.projectContext.findPrimaryBoardWithColumns(
      validatedOrgId,
      task.projectId,
    );
    if (!boardContext) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${task.projectId}".`,
      );
    }

    const originalColumn = boardContext.columns.find((col) => col.id === task.columnId);
    const activeColumns = boardContext.columns.filter((col) => col.archivedAt === undefined);
    let targetColumn: TaskBoardColumnSummary | undefined;

    if (originalColumn !== undefined && originalColumn.archivedAt === undefined) {
      targetColumn = originalColumn;
    } else if (task.status === TASK_STATUSES.DONE) {
      targetColumn = activeColumns.find((col) => col.columnRole === 'FINAL');
    } else {
      targetColumn =
        activeColumns.find((col) => col.columnRole === 'INITIAL') ??
        activeColumns.find((col) => col.columnRole === 'OPERATIONAL');
    }

    if (!targetColumn) {
      throw new ConflictError('No eligible active column is available to restore this task.');
    }

    const targetColumnTasks = await this.deps.tasks.listByColumn(validatedOrgId, targetColumn.id);
    this.deps.projectContext.assertWipAllowsPlacement({
      targetColumn,
      currentColumnTasks: targetColumnTasks,
      movingTaskStatus: task.status,
    });

    const isRelocated = targetColumn.id !== task.columnId;
    const nextOrder = isRelocated
      ? targetColumnTasks.length === 0
        ? 1
        : Math.max(...targetColumnTasks.map((t) => t.order)) + 1
      : task.order;

    const {
      deletedAt: _clearedDeletedAt,
      deletedBy: _clearedDeletedBy,
      deletionReason: _clearedDeletionReason,
      ...taskWithoutDeletion
    } = task;

    const restoredTask: Task = {
      ...taskWithoutDeletion,
      columnId: targetColumn.id,
      order: nextOrder,
      lastMovedAt: isRelocated ? now : task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    const trimmedReason = options.reason?.trim();

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TASKS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.tasks.save(restoredTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.restored',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { deletedAt: task.deletedAt ?? null, columnId: task.columnId },
          after: { deletedAt: null, columnId: restoredTask.columnId, relocated: isRelocated },
          ...(trimmedReason !== undefined && trimmedReason.length > 0
            ? { justification: trimmedReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.restored',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              columnId: restoredTask.columnId,
            },
          }),
        );
      },
    );

    return restoredTask;
  }

  // ===========================================================================
  // Subtarefas (1 nível)
  // ===========================================================================

  async createSubtask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: CreateSubtaskInput,
  ): Promise<Subtask> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(createSubtaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    const taskResource = buildTaskResource({
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      task,
      project,
      participantIds: activeParticipantIds,
    });

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.SUBTASK_MANAGE,
      resource: taskResource,
      context: { now, policyConfig },
    });

    const validatedAssigneeId =
      parsed.assigneeId !== undefined ? asUserId(parsed.assigneeId, 'assigneeId') : undefined;
    if (validatedAssigneeId !== undefined) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.SUBTASK_ASSIGN,
        resource: taskResource,
        context: { now, policyConfig },
      });
    }

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot create subtasks on a "${task.status}" task.`);
    }

    if (validatedAssigneeId !== undefined) {
      await this.validateProjectAssignee(validatedOrgId, task.projectId, validatedAssigneeId);
    }

    const existingSubtasks = await this.deps.subtasks.listByTask(validatedOrgId, validatedTaskId);
    const nextOrder =
      existingSubtasks.length === 0 ? 1 : Math.max(...existingSubtasks.map((s) => s.order)) + 1;

    const subtask: Subtask = {
      id: asSubtaskId(this.nextUuid()),
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      title: parsed.title,
      required: parsed.required,
      status: SUBTASK_STATUSES.OPEN,
      ...(validatedAssigneeId !== undefined ? { assigneeId: validatedAssigneeId } : {}),
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.SUBTASKS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.subtasks.save(subtask);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.subtask.created',
          resourceType: 'Subtask',
          resourceId: subtask.id,
          after: {
            taskId: validatedTaskId,
            title: subtask.title,
            required: subtask.required,
            ...(subtask.assigneeId !== undefined ? { assigneeId: subtask.assigneeId } : {}),
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.subtask.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Subtask',
            aggregateId: subtask.id,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              subtaskId: subtask.id,
              required: subtask.required,
            },
          }),
        );
      },
    );

    return subtask;
  }

  async updateSubtask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    subtaskId: SubtaskId,
    input: UpdateSubtaskInput,
  ): Promise<Subtask> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedSubtaskId = asSubtaskId(subtaskId, 'subtaskId');
    const parsed = parseWithZod(updateSubtaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ actor, task, project, activeParticipantIds, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.subtasks.findById(validatedOrgId, validatedSubtaskId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.SUBTASK_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        subtaskId: validatedSubtaskId,
        subtaskAssigneeId: existing?.assigneeId,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Subtask "${validatedSubtaskId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot update subtasks on a "${task.status}" task.`);
    }

    const nextStatus = parsed.status ?? existing.status;
    const { completedAt: _prevCompletedAt, ...subtaskBase } = existing;
    const nextCompletedAt =
      nextStatus === SUBTASK_STATUSES.DONE ? (existing.completedAt ?? now) : undefined;

    const updatedSubtask: Subtask = {
      ...subtaskBase,
      title: parsed.title ?? existing.title,
      required: parsed.required ?? existing.required,
      status: nextStatus,
      ...(nextCompletedAt !== undefined ? { completedAt: nextCompletedAt } : {}),
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.SUBTASKS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.subtasks.save(updatedSubtask);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.subtask.updated',
          resourceType: 'Subtask',
          resourceId: validatedSubtaskId,
          before: {
            title: existing.title,
            required: existing.required,
            status: existing.status,
          },
          after: {
            title: updatedSubtask.title,
            required: updatedSubtask.required,
            status: updatedSubtask.status,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.subtask.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Subtask',
            aggregateId: validatedSubtaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              subtaskId: validatedSubtaskId,
              status: updatedSubtask.status,
            },
          }),
        );
      },
    );

    return updatedSubtask;
  }

  async assignSubtask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    subtaskId: SubtaskId,
    input: AssignSubtaskInput,
  ): Promise<Subtask> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedSubtaskId = asSubtaskId(subtaskId, 'subtaskId');
    const parsed = parseWithZod(assignSubtaskInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ actor, task, project, activeParticipantIds, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.subtasks.findById(validatedOrgId, validatedSubtaskId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.SUBTASK_ASSIGN,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        subtaskId: validatedSubtaskId,
        subtaskAssigneeId: existing?.assigneeId,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Subtask "${validatedSubtaskId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot assign subtasks on a "${task.status}" task.`);
    }

    const nextAssigneeId =
      parsed.assigneeId !== null ? asUserId(parsed.assigneeId, 'assigneeId') : undefined;
    if (nextAssigneeId !== undefined) {
      await this.validateProjectAssignee(validatedOrgId, task.projectId, nextAssigneeId);
    }

    const { assigneeId: _prevAssignee, ...subtaskBase } = existing;
    const updatedSubtask: Subtask = {
      ...subtaskBase,
      ...(nextAssigneeId !== undefined ? { assigneeId: nextAssigneeId } : {}),
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.SUBTASKS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.subtasks.save(updatedSubtask);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.subtask.assigned',
          resourceType: 'Subtask',
          resourceId: validatedSubtaskId,
          before: { assigneeId: existing.assigneeId ?? null },
          after: { assigneeId: nextAssigneeId ?? null },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.subtask.assigned',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Subtask',
            aggregateId: validatedSubtaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              subtaskId: validatedSubtaskId,
              assigneeId: nextAssigneeId ?? null,
            },
          }),
        );
      },
    );

    return updatedSubtask;
  }

  async completeSubtask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    subtaskId: SubtaskId,
    options: TaskOperationOptions = {},
  ): Promise<Subtask> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedSubtaskId = asSubtaskId(subtaskId, 'subtaskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor, task, project, activeParticipantIds, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.subtasks.findById(validatedOrgId, validatedSubtaskId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.SUBTASK_COMPLETE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        subtaskId: validatedSubtaskId,
        subtaskAssigneeId: existing?.assigneeId,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Subtask "${validatedSubtaskId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot complete subtasks on a "${task.status}" task.`);
    }

    if (existing.status === SUBTASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot complete a cancelled subtask.', {
        details: { subtaskId: validatedSubtaskId },
      });
    }

    if (existing.status === SUBTASK_STATUSES.DONE) {
      return existing;
    }

    const completedSubtask: Subtask = {
      ...existing,
      status: SUBTASK_STATUSES.DONE,
      completedAt: now,
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.SUBTASKS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.subtasks.save(completedSubtask);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.subtask.completed',
          resourceType: 'Subtask',
          resourceId: validatedSubtaskId,
          before: { status: existing.status },
          after: { status: completedSubtask.status, completedAt: now },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.subtask.completed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Subtask',
            aggregateId: validatedSubtaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              subtaskId: validatedSubtaskId,
            },
          }),
        );
      },
    );

    return completedSubtask;
  }

  async reorderSubtasks(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    orderedSubtaskIds: readonly SubtaskId[],
    options: TaskOperationOptions = {},
  ): Promise<readonly Subtask[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(reorderSubtasksInputSchema, {
      orderedSubtaskIds,
      correlationId: options.correlationId,
    });
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.SUBTASK_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot reorder subtasks on a cancelled task.');
    }

    const existingSubtasks = await this.deps.subtasks.listByTask(validatedOrgId, validatedTaskId);
    const validatedIds = parsed.orderedSubtaskIds.map((id, index) =>
      asSubtaskId(id, `orderedSubtaskIds[${index}]`),
    );

    const seenIds = new Set<SubtaskId>();
    for (const id of validatedIds) {
      if (seenIds.has(id)) {
        throw new ValidationError(`Duplicate subtask id "${id}" in reorder payload.`, {
          details: { subtaskId: id },
        });
      }
      seenIds.add(id);
    }

    const byId = new Map(existingSubtasks.map((subtask) => [subtask.id, subtask]));
    if (validatedIds.length !== existingSubtasks.length) {
      throw new ValidationError(
        'Subtask reorder payload must be an exact permutation of the task subtasks.',
        {
          details: {
            expectedCount: existingSubtasks.length,
            receivedCount: validatedIds.length,
          },
        },
      );
    }

    for (const id of validatedIds) {
      if (!byId.has(id)) {
        throw new ValidationError(`Subtask "${id}" does not belong to task "${validatedTaskId}".`, {
          details: { subtaskId: id, taskId: validatedTaskId },
        });
      }
    }

    const reorderedSubtasks: Subtask[] = validatedIds.map((id, index) => ({
      ...byId.get(id)!,
      order: index + 1,
      updatedAt: now,
    }));

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.SUBTASKS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.subtasks.saveMany(validatedOrgId, reorderedSubtasks);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.subtasks.reordered',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: { orderedSubtaskIds: existingSubtasks.map((s) => s.id) },
          after: { orderedSubtaskIds: reorderedSubtasks.map((s) => s.id) },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.subtasks.reordered',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              orderedSubtaskIds: reorderedSubtasks.map((s) => s.id),
            },
          }),
        );
      },
    );

    return reorderedSubtasks;
  }

  async deleteSubtask(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    subtaskId: SubtaskId,
    options: TaskOperationOptions = {},
  ): Promise<{ readonly deletedSubtaskId: SubtaskId }> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedSubtaskId = asSubtaskId(subtaskId, 'subtaskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor, task, project, activeParticipantIds, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.subtasks.findById(validatedOrgId, validatedSubtaskId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.SUBTASK_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        subtaskId: validatedSubtaskId,
        subtaskAssigneeId: existing?.assigneeId,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Subtask "${validatedSubtaskId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError(`Cannot delete subtasks on a "${task.status}" task.`);
    }

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.SUBTASKS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.subtasks.delete(validatedOrgId, validatedSubtaskId);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.subtask.deleted',
          resourceType: 'Subtask',
          resourceId: validatedSubtaskId,
          before: { title: existing.title, required: existing.required, status: existing.status },
          after: { deleted: true },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.subtask.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Subtask',
            aggregateId: validatedSubtaskId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              subtaskId: validatedSubtaskId,
            },
          }),
        );
      },
    );

    return Object.freeze({ deletedSubtaskId: validatedSubtaskId });
  }

  // ===========================================================================
  // Comentários
  // ===========================================================================

  async addTaskComment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: TaskCommentInput,
  ): Promise<TaskComment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(commentBodyInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const { actor, task, project, activeParticipantIds, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_COMMENT,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    const comment: TaskComment = {
      id: asTaskCommentId(this.nextUuid()),
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      authorUserId: validatedActorId,
      body: parsed.body,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_COMMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskComments.save(comment);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.comment.created',
          resourceType: 'TaskComment',
          resourceId: comment.id,
          after: { taskId: validatedTaskId, isSystem: false },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.comment.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskComment',
            aggregateId: comment.id,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              commentId: comment.id,
            },
          }),
        );
      },
    );

    return comment;
  }

  async updateTaskComment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    commentId: TaskCommentId,
    input: TaskCommentInput,
  ): Promise<TaskComment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedCommentId = asTaskCommentId(commentId, 'commentId');
    const parsed = parseWithZod(commentBodyInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ actor, task, project, activeParticipantIds, settings, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.taskComments.findById(validatedOrgId, validatedCommentId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_COMMENT,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        createdByOverride: existing?.authorUserId,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Comment "${validatedCommentId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    assertTaskCommentCanBeEditedByAuthor({
      comment: existing,
      actorUserId: validatedActorId,
      commentEditWindowMinutes: settings.pendingPermissionDefaults.commentEditWindowMinutes,
      now,
    });

    const updatedComment: TaskComment = {
      ...existing,
      body: parsed.body,
      editedAt: now,
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_COMMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskComments.save(updatedComment);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.comment.updated',
          resourceType: 'TaskComment',
          resourceId: validatedCommentId,
          before: { editedAt: existing.editedAt ?? null },
          after: { editedAt: now },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.comment.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskComment',
            aggregateId: validatedCommentId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              commentId: validatedCommentId,
            },
          }),
        );
      },
    );

    return updatedComment;
  }

  async deleteTaskComment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    commentId: TaskCommentId,
    options: TaskOperationOptions = {},
  ): Promise<TaskComment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedCommentId = asTaskCommentId(commentId, 'commentId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor, task, project, activeParticipantIds, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.taskComments.findById(validatedOrgId, validatedCommentId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_COMMENT,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        createdByOverride: existing?.authorUserId,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Comment "${validatedCommentId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    const actorRole = actor.organizationMembership?.role;
    const canModerateComments =
      actorRole === ORGANIZATION_ROLES.ADMIN ||
      (actorRole === ORGANIZATION_ROLES.MANAGER &&
        (actor.managedProjectIds?.includes(task.projectId) ?? false));

    assertTaskCommentCanBeDeletedByActor({
      comment: existing,
      actorUserId: validatedActorId,
      canModerateComments,
    });

    const trimmedReason = options.reason?.trim();
    const deletedComment: TaskComment = {
      ...existing,
      deletedAt: now,
      deletedBy: validatedActorId,
      ...(trimmedReason !== undefined && trimmedReason.length > 0
        ? { deletionReason: trimmedReason }
        : {}),
      updatedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_COMMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskComments.save(deletedComment);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.comment.deleted',
          resourceType: 'TaskComment',
          resourceId: validatedCommentId,
          before: { deletedAt: null },
          after: {
            deletedAt: now,
            deletionReason: deletedComment.deletionReason ?? null,
          },
          ...(trimmedReason !== undefined && trimmedReason.length > 0
            ? { justification: trimmedReason }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.comment.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskComment',
            aggregateId: validatedCommentId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              commentId: validatedCommentId,
            },
          }),
        );
      },
    );

    return deletedComment;
  }

  // ===========================================================================
  // Anexos Binários
  // ===========================================================================

  async uploadTaskAttachment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: UploadTaskAttachmentInput,
  ): Promise<TaskAttachment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(input.correlationId);

    if (Object.prototype.toString.call(input.bytes) !== '[object Uint8Array]') {
      throw new ValidationError('Attachment "bytes" must be a Uint8Array.', {
        details: { field: 'bytes' },
      });
    }

    const { actor, task, project, activeParticipantIds, settings, policyConfig } =
      await this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_ATTACHMENT_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task,
        project,
        participantIds: activeParticipantIds,
      }),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`);
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot attach files to a cancelled task.');
    }

    const existingAttachments = await this.deps.taskAttachments.listByTask(
      validatedOrgId,
      validatedTaskId,
    );
    const defaults = settings.pendingPermissionDefaults;

    if (existingAttachments.length >= defaults.maxAttachmentsPerContext) {
      throw new ValidationError(
        `Maximum attachment count (${defaults.maxAttachmentsPerContext}) reached for this task.`,
        {
          details: {
            field: 'attachments',
            currentCount: existingAttachments.length,
            maxAttachmentsPerContext: defaults.maxAttachmentsPerContext,
          },
        },
      );
    }

    const existingTotalBytes = existingAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
    const trimmedFileName = input.fileName.trim();
    const normalizedMimeType = input.mimeType.trim().toLowerCase();
    const defensiveBytes = new Uint8Array(input.bytes);

    validateAttachmentQuota({
      fileName: trimmedFileName,
      mimeType: normalizedMimeType,
      sizeBytes: defensiveBytes.byteLength,
      existingContextTotalBytes: existingTotalBytes,
      maxFileSizeBytes: defaults.maxAttachmentSizeBytes,
      maxContextTotalBytes: defaults.maxContextAttachmentsSizeBytes,
    });

    // CRITICAL (ADR-0011 §2.1): SHA-256 digest computed strictly BEFORE TransactionPort.run
    const checksumSha256 = await computeSha256Hex(defensiveBytes);
    const attachmentId = asAttachmentId(this.nextUuid());

    const attachment: TaskAttachment = {
      id: attachmentId,
      organizationId: validatedOrgId,
      taskId: validatedTaskId,
      fileName: trimmedFileName,
      mimeType: normalizedMimeType,
      sizeBytes: defensiveBytes.byteLength,
      checksumSha256,
      uploadedBy: validatedActorId,
      uploadedAt: now,
    };

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_ATTACHMENTS,
        TRANSACTION_RESOURCES.ATTACHMENT_BLOBS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskAttachments.save(attachment);
        await this.deps.attachmentBlobStore.putBlob({
          attachmentId,
          organizationId: validatedOrgId,
          mimeType: normalizedMimeType,
          bytes: defensiveBytes,
        });
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.attachment.uploaded',
          resourceType: 'TaskAttachment',
          resourceId: attachmentId,
          after: {
            taskId: validatedTaskId,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            checksumSha256,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.attachment.uploaded',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskAttachment',
            aggregateId: attachmentId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              attachmentId,
              fileName: attachment.fileName,
              sizeBytes: attachment.sizeBytes,
            },
          }),
        );
      },
    );

    return attachment;
  }

  async deleteTaskAttachment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    attachmentId: AttachmentId,
    options: TaskOperationOptions = {},
  ): Promise<{ readonly deletedAttachmentId: AttachmentId }> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedAttachmentId = asAttachmentId(attachmentId, 'attachmentId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor, task, project, activeParticipantIds, policyConfig }, existing] =
      await Promise.all([
        this.loadTaskAuthContext(validatedActorId, validatedOrgId, validatedTaskId, now),
        this.deps.taskAttachments.findById(validatedOrgId, validatedAttachmentId),
      ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_ATTACHMENT_MANAGE,
      resource: buildTaskResource({
        organizationId: validatedOrgId,
        taskId: validatedTaskId,
        task: matchesTask ? task : null,
        project: matchesTask ? project : null,
        participantIds: activeParticipantIds,
        createdByOverride: existing?.uploadedBy,
      }),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Attachment "${validatedAttachmentId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    const updatedTask: Task = {
      ...task,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_ATTACHMENTS,
        TRANSACTION_RESOURCES.ATTACHMENT_BLOBS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskAttachments.delete(validatedOrgId, validatedAttachmentId);
        await this.deps.attachmentBlobStore.deleteBlob(validatedOrgId, validatedAttachmentId);
        await this.deps.tasks.save(updatedTask);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.attachment.deleted',
          resourceType: 'TaskAttachment',
          resourceId: validatedAttachmentId,
          before: {
            fileName: existing.fileName,
            sizeBytes: existing.sizeBytes,
          },
          after: { deleted: true },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.attachment.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskAttachment',
            aggregateId: validatedAttachmentId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              attachmentId: validatedAttachmentId,
            },
          }),
        );
      },
    );

    return Object.freeze({ deletedAttachmentId: validatedAttachmentId });
  }

  // ===========================================================================
  // Etiquetas (Tag — Decisão Normativa B)
  // ===========================================================================

  async listTags(actorUserId: UserId, organizationId: OrganizationId): Promise<readonly Tag[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');

    const membership = await this.deps.organizationMembers.findByOrganizationAndUser(
      validatedOrgId,
      validatedActorId,
    );
    if (!membership || membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new AuthorizationError(
        'Actor does not have an active membership in this organization.',
      );
    }

    return this.deps.tags.listByOrganization(validatedOrgId);
  }

  async createTag(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateTagInput,
  ): Promise<Tag> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(createTagInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, { policyConfig }] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.loadEffectivePolicy(validatedOrgId, now),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: true,
        organizationId: validatedOrgId,
      },
      context: { now, policyConfig },
    });

    const collision = await this.deps.tags.findByNormalizedName(validatedOrgId, parsed.name);
    if (collision !== null) {
      throw new ConflictError(`Tag "${parsed.name}" already exists in this organization.`, {
        details: { organizationId: validatedOrgId, tagId: collision.id },
      });
    }

    const newTag: Tag = {
      id: asTagId(this.nextUuid()),
      organizationId: validatedOrgId,
      name: parsed.name,
      ...(parsed.colorToken !== undefined ? { colorToken: parsed.colorToken } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TAGS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.tags.save(newTag);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'tag.created',
          resourceType: 'Tag',
          resourceId: newTag.id,
          after: {
            name: newTag.name,
            ...(newTag.colorToken !== undefined ? { colorToken: newTag.colorToken } : {}),
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'tag.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Tag',
            aggregateId: newTag.id,
            payload: {
              tagId: newTag.id,
              name: newTag.name,
              normalizedName: normalizeTagName(newTag.name),
            },
          }),
        );
      },
    );

    return newTag;
  }

  async updateTag(
    actorUserId: UserId,
    organizationId: OrganizationId,
    tagId: TagId,
    input: UpdateTagInput,
  ): Promise<Tag> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTagId = asTagId(tagId, 'tagId');
    const parsed = parseWithZod(updateTagInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, existing, { policyConfig }] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.tags.findById(validatedOrgId, validatedTagId),
      this.loadEffectivePolicy(validatedOrgId, now),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedTagId),
        exists: existing !== null,
        organizationId: validatedOrgId,
      },
      context: { now, policyConfig },
    });

    if (!existing) {
      throw new NotFoundError(`Tag "${validatedTagId}" was not found.`);
    }

    if (parsed.name !== undefined) {
      const collision = await this.deps.tags.findByNormalizedName(validatedOrgId, parsed.name);
      if (collision !== null && collision.id !== validatedTagId) {
        throw new ConflictError(`Tag "${parsed.name}" already exists in this organization.`, {
          details: { organizationId: validatedOrgId, tagId: collision.id },
        });
      }
    }

    const { colorToken: _prevColor, ...tagBase } = existing;
    const nextColorToken =
      parsed.colorToken !== undefined
        ? parsed.colorToken === null
          ? undefined
          : parsed.colorToken
        : existing.colorToken;

    const updatedTag: Tag = {
      ...tagBase,
      name: parsed.name ?? existing.name,
      ...(nextColorToken !== undefined ? { colorToken: nextColorToken } : {}),
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TAGS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.tags.save(updatedTag);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'tag.updated',
          resourceType: 'Tag',
          resourceId: validatedTagId,
          before: { name: existing.name, colorToken: existing.colorToken ?? null },
          after: { name: updatedTag.name, colorToken: updatedTag.colorToken ?? null },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'tag.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Tag',
            aggregateId: validatedTagId,
            payload: { tagId: validatedTagId, name: updatedTag.name },
          }),
        );
      },
    );

    return updatedTag;
  }

  async deleteTag(
    actorUserId: UserId,
    organizationId: OrganizationId,
    tagId: TagId,
    options: TaskOperationOptions = {},
  ): Promise<{ readonly deletedTagId: TagId; readonly updatedTaskCount: number }> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTagId = asTagId(tagId, 'tagId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, existing, { policyConfig }] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.tags.findById(validatedOrgId, validatedTagId),
      this.loadEffectivePolicy(validatedOrgId, now),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedTagId),
        exists: existing !== null,
        organizationId: validatedOrgId,
      },
      context: { now, policyConfig },
    });

    if (!existing) {
      throw new NotFoundError(`Tag "${validatedTagId}" was not found.`);
    }

    const orgTasks = await this.deps.tasks.listByOrganization(validatedOrgId, {
      includeDeleted: true,
    });
    const affectedTasks: Task[] = orgTasks
      .filter((task) => task.tagIds.includes(validatedTagId))
      .map((task) => ({
        ...task,
        tagIds: task.tagIds.filter((id) => id !== validatedTagId),
        lastMovedAt: task.lastMovedAt,
        updatedAt: now,
      }));

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TAGS, TRANSACTION_RESOURCES.TASKS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        if (affectedTasks.length > 0) {
          await this.deps.tasks.saveMany(validatedOrgId, affectedTasks);
        }
        await this.deps.tags.delete(validatedOrgId, validatedTagId);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'tag.deleted',
          resourceType: 'Tag',
          resourceId: validatedTagId,
          before: { name: existing.name },
          after: { deleted: true, updatedTaskCount: affectedTasks.length },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'tag.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Tag',
            aggregateId: validatedTagId,
            payload: { tagId: validatedTagId, updatedTaskCount: affectedTasks.length },
          }),
        );
      },
    );

    return Object.freeze({
      deletedTagId: validatedTagId,
      updatedTaskCount: affectedTasks.length,
    });
  }
}
