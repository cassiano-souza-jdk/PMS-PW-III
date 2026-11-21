import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import {
  PERMISSION_CODES,
  assertAuthorized,
  evaluateAuthorization,
  type AuthorizationActor,
  type AuthorizationResource,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import {
  getPendingRequiredDependencies,
  type TaskDependencyRepositoryPort,
} from '@/modules/dependencies';
import { isImpedimentBlocking, type ImpedimentRepositoryPort } from '@/modules/impediments';
import type { OrganizationMemberRepositoryPort } from '@/modules/organizations';
import {
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  assertProjectOperational,
  type Project,
  type ProjectMemberRepositoryPort,
  type ProjectRepositoryPort,
} from '@/modules/projects';
import {
  createDefaultOrganizationSettings,
  type OrganizationSettingsRepositoryPort,
} from '@/modules/settings';
import {
  assertTaskCanBeCompleted,
  assertTaskReopenCreatesNewCycle,
  asTaskExecutionCycleId,
  type SubtaskRepositoryPort,
  type Task,
  type TaskExecutionCycle,
  type TaskExecutionCycleRepositoryPort,
  type TaskParticipantRepositoryPort,
  type TaskPauseRepositoryPort,
  type TaskRepositoryPort,
} from '@/modules/tasks';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  PRIORITIES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asBoardColumnId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTaskId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  type BoardColumnId,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type Priority,
  type ProjectId,
  type TaskId,
  type TaskStatus,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  BOARD_COLUMN_ROLES,
  assertCardMoveAllowed,
  assertColumnCanBeDeleted,
  assertValidBoardColumns,
  assertWipAllowsCardMove,
  doesTaskStatusOccupyWip,
  type BoardColumn,
  type BoardColumnRole,
  type ProjectBoard,
} from '../../domain/board';
import type {
  BoardColumnRepositoryPort,
  ProjectBoardRepositoryPort,
} from '../ports/kanban-repository.port';

const columnRoleSchema = z.enum([
  BOARD_COLUMN_ROLES.INITIAL,
  BOARD_COLUMN_ROLES.OPERATIONAL,
  BOARD_COLUMN_ROLES.FINAL,
]);

const createColumnInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  columnRole: columnRoleSchema,
  wipLimit: z.union([z.number().int().min(1), z.null()]),
  order: z.number().int().min(1).optional(),
  correlationId: z.string().uuid().optional(),
});

const updateColumnInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    columnRole: columnRoleSchema.optional(),
    wipLimit: z.union([z.number().int().min(1), z.null()]).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined || data.columnRole !== undefined || data.wipLimit !== undefined,
    'At least one field ("name", "columnRole", or "wipLimit") must be provided.',
  );

const moveCardInputSchema = z.object({
  targetColumnId: z.string().uuid(),
  targetOrder: z.number().int().min(1).optional(),
  wipOverrideJustification: z.string().trim().optional(),
  dependencyOverrideJustification: z.string().trim().optional(),
  pausedOverrideJustification: z.string().trim().optional(),
  reopenReason: z.string().trim().optional(),
  correlationId: z.string().uuid().optional(),
});

const createQuickCardInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  columnId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z
    .enum([PRIORITIES.LOW, PRIORITIES.MEDIUM, PRIORITIES.HIGH, PRIORITIES.CRITICAL])
    .default(PRIORITIES.MEDIUM),
  correlationId: z.string().uuid().optional(),
});

export interface KanbanServiceDependencies {
  readonly projects: ProjectRepositoryPort;
  readonly projectMembers: ProjectMemberRepositoryPort;
  readonly projectBoards: ProjectBoardRepositoryPort;
  readonly boardColumns: BoardColumnRepositoryPort;
  readonly tasks: TaskRepositoryPort;
  readonly taskParticipants: TaskParticipantRepositoryPort;
  readonly subtasks: SubtaskRepositoryPort;
  readonly taskDependencies: TaskDependencyRepositoryPort;
  readonly impediments: ImpedimentRepositoryPort;
  readonly taskPauses: TaskPauseRepositoryPort;
  readonly taskExecutionCycles: TaskExecutionCycleRepositoryPort;
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

export interface BoardColumnWithWip extends BoardColumn {
  readonly occupyingTaskCount: number;
}

export interface KanbanCardProjection {
  readonly task: Task;
  readonly isPaused: boolean;
  readonly participantUserIds: readonly UserId[];
  readonly canMove: boolean;
  readonly canComplete: boolean;
  readonly canReopen: boolean;
}

export interface KanbanBoardPermissions {
  readonly canConfigureBoard: boolean;
  readonly canManageColumns: boolean;
  readonly canManageWip: boolean;
  readonly canCreateQuickCard: boolean;
  readonly canMoveWithWipOverride: boolean;
}

export interface ProjectBoardView {
  readonly project: Project;
  readonly board: ProjectBoard;
  readonly columns: readonly BoardColumnWithWip[];
  readonly cards: readonly KanbanCardProjection[];
  readonly permissions: KanbanBoardPermissions;
}

export interface CreateColumnInput {
  readonly name: string;
  readonly columnRole: BoardColumnRole;
  readonly wipLimit: number | null;
  readonly order?: number;
  readonly correlationId?: CorrelationId;
}

export interface UpdateColumnInput {
  readonly name?: string;
  readonly columnRole?: BoardColumnRole;
  readonly wipLimit?: number | null;
  readonly correlationId?: CorrelationId;
}

export interface MoveCardInput {
  readonly targetColumnId: BoardColumnId;
  readonly targetOrder?: number;
  readonly wipOverrideJustification?: string;
  readonly dependencyOverrideJustification?: string;
  readonly pausedOverrideJustification?: string;
  readonly reopenReason?: string;
  readonly correlationId?: CorrelationId;
}

export interface CreateQuickCardInput {
  readonly title: string;
  readonly description?: string;
  readonly columnId?: BoardColumnId;
  readonly assigneeId?: UserId;
  readonly priority?: Priority;
  readonly correlationId?: CorrelationId;
}

export interface KanbanOperationOptions {
  readonly migrationTargetColumnId?: BoardColumnId;
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
    throw new ValidationError('Invalid Kanban input payload.', {
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

function buildBoardResource(
  organizationId: OrganizationId,
  projectId: ProjectId,
  boardId: string,
  project: Project | null,
): AuthorizationResource {
  return {
    kind: 'BOARD',
    id: asEntityId(boardId),
    exists: project !== null,
    organizationId,
    projectId,
    teamId: project?.teamId,
    ownerUserId: project?.ownerUserId,
    deletedAt: project?.deletedAt,
    archivedAt: project?.archivedAt,
    projectArchivedAt: project?.archivedAt,
  };
}

export class KanbanService {
  private readonly deps: KanbanServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: KanbanServiceDependencies) {
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

  private async buildAuthorizationActor(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<AuthorizationActor> {
    const [membership, orgProjects, actorProjectMemberships, grants, explicitDenies] =
      await Promise.all([
        this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
        this.deps.projects.listByOrganization(organizationId, {
          includeArchived: true,
          includeDeleted: true,
        }),
        this.deps.projectMembers.listByUser(organizationId, actorUserId),
        this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
        this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
      ]);

    const activeProjectIdSet = new Set(
      orgProjects.filter((project) => !isSoftDeleted(project)).map((project) => project.id),
    );

    const activeProjectMemberships = actorProjectMemberships.filter(
      (member) => member.removedAt === undefined && activeProjectIdSet.has(member.projectId),
    );

    const managedProjectIds: ProjectId[] = activeProjectMemberships
      .filter((member) => member.projectRole === PROJECT_MEMBER_ROLES.MANAGER)
      .map((member) => member.projectId);

    const participatedProjectIds: ProjectId[] = activeProjectMemberships.map(
      (member) => member.projectId,
    );

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
      managedProjectIds,
      participatedProjectIds,
      grants,
      explicitDenies,
    };
  }

  async getProjectBoard(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ProjectBoardView> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();

    const [actor, project, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_VIEW,
      resource: buildBoardResource(validatedOrgId, validatedProjectId, validatedProjectId, project),
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    const board = await this.deps.projectBoards.findPrimaryByProject(
      validatedOrgId,
      validatedProjectId,
    );
    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
        {
          details: { organizationId: validatedOrgId, projectId: validatedProjectId },
        },
      );
    }

    const [rawColumns, projectTasks] = await Promise.all([
      this.deps.boardColumns.listByBoard(validatedOrgId, board.id, { includeArchived: true }),
      this.deps.tasks.listByProject(validatedOrgId, validatedProjectId),
    ]);

    const occupyingCountByColumnId = new Map<BoardColumnId, number>();
    for (const task of projectTasks) {
      if (doesTaskStatusOccupyWip(task.status)) {
        occupyingCountByColumnId.set(
          task.columnId,
          (occupyingCountByColumnId.get(task.columnId) ?? 0) + 1,
        );
      }
    }

    const columns: BoardColumnWithWip[] = rawColumns.map((column) => ({
      ...column,
      occupyingTaskCount: occupyingCountByColumnId.get(column.id) ?? 0,
    }));

    const taskMetadata = await Promise.all(
      projectTasks.map(async (task) => {
        const [participants, pauses] = await Promise.all([
          this.deps.taskParticipants.listByTask(validatedOrgId, task.id),
          this.deps.taskPauses.listByTask(validatedOrgId, task.id),
        ]);

        const participantUserIds = participants
          .filter((participant) => participant.removedAt === undefined)
          .map((participant) => participant.userId);
        const isPaused =
          task.status === TASK_STATUSES.PAUSED ||
          pauses.some((pause) => pause.endedAt === undefined);

        return { task, participantUserIds, isPaused };
      }),
    );

    const cards: KanbanCardProjection[] = [];
    for (const item of taskMetadata) {
      const taskResource: AuthorizationResource = {
        kind: 'TASK',
        id: asEntityId(item.task.id),
        exists: true,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project.teamId,
        ownerUserId: project.ownerUserId,
        taskId: item.task.id,
        createdBy: item.task.createdByUserId,
        assigneeId: item.task.assigneeId,
        participantIds: item.participantUserIds,
        deletedAt: item.task.deletedAt ?? project.deletedAt,
        archivedAt: project.archivedAt,
        projectArchivedAt: project.archivedAt,
      };

      const viewDecision = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.TASK_VIEW,
        resource: taskResource,
        context: { now },
      });

      if (!viewDecision.allowed) {
        continue;
      }

      const canMove =
        item.task.status !== TASK_STATUSES.CANCELLED &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.BOARD_CARD_MOVE,
          resource: taskResource,
          context: { now },
        }).allowed &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.TASK_MOVE,
          resource: taskResource,
          context: { now },
        }).allowed;

      const canComplete = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.TASK_COMPLETE,
        resource: taskResource,
        context: { now },
      }).allowed;

      const canReopen = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.TASK_REOPEN,
        resource: taskResource,
        context: { now },
      }).allowed;

      cards.push({
        task: item.task,
        isPaused: item.isPaused,
        participantUserIds: item.participantUserIds,
        canMove,
        canComplete,
        canReopen,
      });
    }

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const boardResource = buildBoardResource(validatedOrgId, validatedProjectId, board.id, project);

    const canManageWip = evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.BOARD_WIP_MANAGE,
      resource: boardResource,
      context: { now },
    }).allowed;

    const permissions: KanbanBoardPermissions = Object.freeze({
      canConfigureBoard: evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.BOARD_CONFIGURE,
        resource: boardResource,
        context: { now },
      }).allowed,
      canManageColumns: evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
        resource: boardResource,
        context: { now },
      }).allowed,
      canManageWip,
      canCreateQuickCard: evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.TASK_CREATE,
        resource: {
          kind: 'TASK',
          exists: true,
          organizationId: validatedOrgId,
          projectId: validatedProjectId,
          teamId: project.teamId,
          ownerUserId: project.ownerUserId,
          deletedAt: project.deletedAt,
          archivedAt: project.archivedAt,
          projectArchivedAt: project.archivedAt,
        },
        context: {
          now,
          policyConfig: {
            allowMemberCreateTaskInProject:
              effectiveSettings.pendingPermissionDefaults.allowMemberCreateTaskWithoutGrant,
          },
        },
      }).allowed,
      canMoveWithWipOverride: canManageWip,
    });

    return Object.freeze({
      project,
      board,
      columns,
      cards,
      permissions,
    });
  }

  async createColumn(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    input: CreateColumnInput,
  ): Promise<BoardColumn> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const parsed = parseWithZod(createColumnInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    const board =
      project !== null
        ? await this.deps.projectBoards.findPrimaryByProject(validatedOrgId, validatedProjectId)
        : null;

    const boardResource = buildBoardResource(
      validatedOrgId,
      validatedProjectId,
      board?.id ?? validatedProjectId,
      project,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      resource: boardResource,
      context: { now },
    });

    if (parsed.wipLimit !== null) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.BOARD_WIP_MANAGE,
        resource: boardResource,
        context: { now },
      });
    }

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const existingColumns = await this.deps.boardColumns.listByBoard(validatedOrgId, board.id, {
      includeArchived: true,
    });

    const order =
      parsed.order ??
      (existingColumns.length === 0
        ? 1
        : Math.max(...existingColumns.map((column) => column.order)) + 1);

    const newColumn: BoardColumn = {
      id: asBoardColumnId(this.nextUuid()),
      organizationId: validatedOrgId,
      boardId: board.id,
      name: parsed.name,
      columnRole: parsed.columnRole,
      order,
      wipLimit: parsed.wipLimit,
      createdAt: now,
      updatedAt: now,
    };

    assertValidBoardColumns([...existingColumns, newColumn]);

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOARD_COLUMNS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.boardColumns.save(newColumn);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.column.created',
          resourceType: 'BoardColumn',
          resourceId: newColumn.id,
          after: {
            boardId: board.id,
            name: newColumn.name,
            columnRole: newColumn.columnRole,
            order: newColumn.order,
            wipLimit: newColumn.wipLimit,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.column.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'BoardColumn',
            aggregateId: newColumn.id,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              columnId: newColumn.id,
              name: newColumn.name,
            },
          }),
        );
      },
    );

    return newColumn;
  }

  async updateColumn(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    columnId: BoardColumnId,
    input: UpdateColumnInput,
  ): Promise<BoardColumn> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedColumnId = asBoardColumnId(columnId, 'columnId');
    const parsed = parseWithZod(updateColumnInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    const board =
      project !== null
        ? await this.deps.projectBoards.findPrimaryByProject(validatedOrgId, validatedProjectId)
        : null;

    const boardResource = buildBoardResource(
      validatedOrgId,
      validatedProjectId,
      board?.id ?? validatedProjectId,
      project,
    );

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      resource: boardResource,
      context: { now },
    });

    if (parsed.wipLimit !== undefined) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.BOARD_WIP_MANAGE,
        resource: boardResource,
        context: { now },
      });
    }

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const allColumns = await this.deps.boardColumns.listByBoard(validatedOrgId, board.id, {
      includeArchived: true,
    });
    const existing = allColumns.find((column) => column.id === validatedColumnId);

    if (!existing) {
      throw new NotFoundError(`BoardColumn "${validatedColumnId}" was not found on this board.`, {
        details: { boardId: board.id, columnId: validatedColumnId },
      });
    }

    const updatedColumn: BoardColumn = {
      ...existing,
      name: parsed.name ?? existing.name,
      columnRole: parsed.columnRole ?? existing.columnRole,
      wipLimit: parsed.wipLimit !== undefined ? parsed.wipLimit : existing.wipLimit,
      updatedAt: now,
    };

    const nextColumns = allColumns.map((column) =>
      column.id === validatedColumnId ? updatedColumn : column,
    );
    assertValidBoardColumns(nextColumns);

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOARD_COLUMNS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.boardColumns.save(updatedColumn);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.column.updated',
          resourceType: 'BoardColumn',
          resourceId: validatedColumnId,
          before: {
            name: existing.name,
            columnRole: existing.columnRole,
            wipLimit: existing.wipLimit,
          },
          after: {
            name: updatedColumn.name,
            columnRole: updatedColumn.columnRole,
            wipLimit: updatedColumn.wipLimit,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.column.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'BoardColumn',
            aggregateId: validatedColumnId,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              columnId: validatedColumnId,
              wipLimit: updatedColumn.wipLimit,
            },
          }),
        );
      },
    );

    return updatedColumn;
  }

  async reorderColumns(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    orderedColumnIds: readonly BoardColumnId[],
    options: KanbanOperationOptions = {},
  ): Promise<readonly BoardColumn[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    if (!Array.isArray(orderedColumnIds)) {
      throw new ValidationError('Parameter "orderedColumnIds" must be an array of UUIDs.');
    }

    const validatedIds = orderedColumnIds.map((id, index) =>
      asBoardColumnId(id, `orderedColumnIds[${index}]`),
    );

    const [actor, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    const board =
      project !== null
        ? await this.deps.projectBoards.findPrimaryByProject(validatedOrgId, validatedProjectId)
        : null;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      resource: buildBoardResource(
        validatedOrgId,
        validatedProjectId,
        board?.id ?? validatedProjectId,
        project,
      ),
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const allColumns = await this.deps.boardColumns.listByBoard(validatedOrgId, board.id, {
      includeArchived: true,
    });
    const activeColumns = allColumns.filter((column) => column.archivedAt === undefined);
    const archivedColumns = allColumns.filter((column) => column.archivedAt !== undefined);

    const seenIds = new Set<BoardColumnId>();
    for (const id of validatedIds) {
      if (seenIds.has(id)) {
        throw new ValidationError(`Duplicate column id "${id}" in reorder payload.`, {
          details: { columnId: id },
        });
      }
      seenIds.add(id);
    }

    const columnById = new Map(allColumns.map((column) => [column.id, column]));
    for (const id of validatedIds) {
      if (!columnById.has(id)) {
        throw new ValidationError(`Column id "${id}" does not belong to this board.`, {
          details: { columnId: id, boardId: board.id },
        });
      }
    }

    const activeColumnSet = new Set(activeColumns.map((column) => column.id));
    const isExactAllPermutation = validatedIds.length === allColumns.length;
    const isExactActivePermutation =
      archivedColumns.length > 0 &&
      validatedIds.length === activeColumns.length &&
      validatedIds.every((id) => activeColumnSet.has(id));

    if (!isExactAllPermutation && !isExactActivePermutation) {
      throw new ValidationError(
        'Column reorder payload must be an exact permutation of the current board columns.',
        {
          details: {
            expectedCount: allColumns.length,
            activeCount: activeColumns.length,
            receivedCount: validatedIds.length,
          },
        },
      );
    }

    const orderedList: BoardColumn[] = validatedIds.map((id, index) => {
      const column = columnById.get(id)!;
      return {
        ...column,
        order: index + 1,
        updatedAt: now,
      };
    });

    if (isExactActivePermutation) {
      archivedColumns.forEach((column, index) => {
        orderedList.push({
          ...column,
          order: validatedIds.length + index + 1,
          updatedAt: now,
        });
      });
    }

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOARD_COLUMNS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.boardColumns.saveMany(validatedOrgId, orderedList);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.columns.reordered',
          resourceType: 'ProjectBoard',
          resourceId: board.id,
          before: { orderedColumnIds: allColumns.map((column) => column.id) },
          after: { orderedColumnIds: orderedList.map((column) => column.id) },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.columns.reordered',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'ProjectBoard',
            aggregateId: board.id,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              orderedColumnIds: orderedList.map((column) => column.id),
            },
          }),
        );
      },
    );

    return orderedList;
  }

  async archiveColumn(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    columnId: BoardColumnId,
    options: KanbanOperationOptions = {},
  ): Promise<BoardColumn> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedColumnId = asBoardColumnId(columnId, 'columnId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    const board =
      project !== null
        ? await this.deps.projectBoards.findPrimaryByProject(validatedOrgId, validatedProjectId)
        : null;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      resource: buildBoardResource(
        validatedOrgId,
        validatedProjectId,
        board?.id ?? validatedProjectId,
        project,
      ),
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const [allColumns, activeTasks] = await Promise.all([
      this.deps.boardColumns.listByBoard(validatedOrgId, board.id, { includeArchived: true }),
      this.deps.tasks.listByColumn(validatedOrgId, validatedColumnId),
    ]);

    const existing = allColumns.find((column) => column.id === validatedColumnId);
    if (!existing) {
      throw new NotFoundError(`BoardColumn "${validatedColumnId}" was not found on this board.`);
    }

    if (existing.archivedAt !== undefined) {
      throw new ConflictError('Board column is already archived.', {
        details: { columnId: validatedColumnId },
      });
    }

    if (activeTasks.length > 0) {
      throw new ConflictError(
        'Cannot archive a board column containing active tasks. Move or migrate tasks before archiving.',
        {
          details: { columnId: validatedColumnId, activeTaskCount: activeTasks.length },
        },
      );
    }

    const archivedColumn: BoardColumn = {
      ...existing,
      archivedAt: now,
      updatedAt: now,
    };

    assertValidBoardColumns(
      allColumns.map((column) => (column.id === validatedColumnId ? archivedColumn : column)),
    );

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOARD_COLUMNS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.boardColumns.save(archivedColumn);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.column.archived',
          resourceType: 'BoardColumn',
          resourceId: validatedColumnId,
          before: { archivedAt: null },
          after: { archivedAt: now },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.column.archived',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'BoardColumn',
            aggregateId: validatedColumnId,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              columnId: validatedColumnId,
            },
          }),
        );
      },
    );

    return archivedColumn;
  }

  async restoreColumn(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    columnId: BoardColumnId,
    options: KanbanOperationOptions = {},
  ): Promise<BoardColumn> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedColumnId = asBoardColumnId(columnId, 'columnId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    const board =
      project !== null
        ? await this.deps.projectBoards.findPrimaryByProject(validatedOrgId, validatedProjectId)
        : null;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      resource: buildBoardResource(
        validatedOrgId,
        validatedProjectId,
        board?.id ?? validatedProjectId,
        project,
      ),
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const allColumns = await this.deps.boardColumns.listByBoard(validatedOrgId, board.id, {
      includeArchived: true,
    });
    const existing = allColumns.find((column) => column.id === validatedColumnId);
    if (!existing) {
      throw new NotFoundError(`BoardColumn "${validatedColumnId}" was not found on this board.`);
    }

    if (existing.archivedAt === undefined) {
      throw new ConflictError('Board column is already active.', {
        details: { columnId: validatedColumnId },
      });
    }

    const { archivedAt: _removedArchivedAt, ...rest } = existing;
    const restoredColumn: BoardColumn = {
      ...rest,
      updatedAt: now,
    };

    assertValidBoardColumns(
      allColumns.map((column) => (column.id === validatedColumnId ? restoredColumn : column)),
    );

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOARD_COLUMNS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.boardColumns.save(restoredColumn);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.column.restored',
          resourceType: 'BoardColumn',
          resourceId: validatedColumnId,
          before: { archivedAt: existing.archivedAt },
          after: { archivedAt: null },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.column.restored',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'BoardColumn',
            aggregateId: validatedColumnId,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              columnId: validatedColumnId,
            },
          }),
        );
      },
    );

    return restoredColumn;
  }

  async deleteColumn(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    columnId: BoardColumnId,
    options: KanbanOperationOptions = {},
  ): Promise<{ readonly deletedColumnId: BoardColumnId; readonly migratedTaskCount: number }> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedColumnId = asBoardColumnId(columnId, 'columnId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const validatedMigrationTargetId =
      options.migrationTargetColumnId !== undefined
        ? asBoardColumnId(options.migrationTargetColumnId, 'migrationTargetColumnId')
        : undefined;

    const [actor, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    const board =
      project !== null
        ? await this.deps.projectBoards.findPrimaryByProject(validatedOrgId, validatedProjectId)
        : null;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      resource: buildBoardResource(
        validatedOrgId,
        validatedProjectId,
        board?.id ?? validatedProjectId,
        project,
      ),
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const [allColumns, allTasksInColumn] = await Promise.all([
      this.deps.boardColumns.listByBoard(validatedOrgId, board.id, { includeArchived: true }),
      this.deps.tasks.listByColumn(validatedOrgId, validatedColumnId, { includeDeleted: true }),
    ]);

    const existing = allColumns.find((column) => column.id === validatedColumnId);
    if (!existing) {
      throw new NotFoundError(`BoardColumn "${validatedColumnId}" was not found on this board.`);
    }

    let explicitTargetColumn: BoardColumn | undefined;
    if (validatedMigrationTargetId !== undefined) {
      explicitTargetColumn = allColumns.find((column) => column.id === validatedMigrationTargetId);
      if (!explicitTargetColumn) {
        throw new NotFoundError(
          `Migration target column "${validatedMigrationTargetId}" was not found on this board.`,
          {
            details: { boardId: board.id, migrationTargetColumnId: validatedMigrationTargetId },
          },
        );
      }
    }

    const activeTasks = allTasksInColumn.filter((task) => !isSoftDeleted(task));
    const deletedTasks = allTasksInColumn.filter((task) => isSoftDeleted(task));

    assertColumnCanBeDeleted(existing, allColumns, activeTasks.length, explicitTargetColumn);

    const remainingActiveColumns = allColumns.filter(
      (column) => column.id !== validatedColumnId && column.archivedAt === undefined,
    );
    const resolvedTargetColumn =
      explicitTargetColumn ??
      remainingActiveColumns.find((column) => column.columnRole === BOARD_COLUMN_ROLES.INITIAL) ??
      remainingActiveColumns[0];

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.BOARD_COLUMNS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        if (allTasksInColumn.length > 0 && resolvedTargetColumn !== undefined) {
          const existingTargetTasks = await this.deps.tasks.listByColumn(
            validatedOrgId,
            resolvedTargetColumn.id,
          );
          let nextOrder =
            existingTargetTasks.length === 0
              ? 1
              : Math.max(...existingTargetTasks.map((task) => task.order)) + 1;

          const migratedActive: Task[] = activeTasks.map((task) => ({
            ...task,
            columnId: resolvedTargetColumn.id,
            order: nextOrder++,
            updatedAt: now,
          }));

          const migratedDeleted: Task[] = deletedTasks.map((task) => ({
            ...task,
            columnId: resolvedTargetColumn.id,
            updatedAt: now,
          }));

          await this.deps.tasks.saveMany(validatedOrgId, [...migratedActive, ...migratedDeleted]);
        }

        await this.deps.boardColumns.delete(validatedOrgId, validatedColumnId);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.column.deleted',
          resourceType: 'BoardColumn',
          resourceId: validatedColumnId,
          before: {
            name: existing.name,
            columnRole: existing.columnRole,
            wipLimit: existing.wipLimit,
          },
          after: {
            deleted: true,
            migratedTaskCount: allTasksInColumn.length,
            ...(resolvedTargetColumn !== undefined
              ? { migrationTargetColumnId: resolvedTargetColumn.id }
              : {}),
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.column.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'BoardColumn',
            aggregateId: validatedColumnId,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              columnId: validatedColumnId,
              migratedTaskCount: allTasksInColumn.length,
            },
          }),
        );
      },
    );

    return Object.freeze({
      deletedColumnId: validatedColumnId,
      migratedTaskCount: allTasksInColumn.length,
    });
  }

  async moveCard(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskId: TaskId,
    input: MoveCardInput,
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(moveCardInputSchema, input);
    const validatedTargetColumnId = asBoardColumnId(parsed.targetColumnId, 'targetColumnId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, project, task] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
      this.deps.tasks.findById(validatedOrgId, validatedTaskId),
    ]);

    const taskInProject =
      project !== null && task !== null && task.projectId === validatedProjectId;
    const taskParticipants = taskInProject
      ? await this.deps.taskParticipants.listByTask(validatedOrgId, validatedTaskId)
      : [];
    const activeParticipantIds = taskParticipants
      .filter((participant) => participant.removedAt === undefined)
      .map((participant) => participant.userId);

    const taskResource: AuthorizationResource = {
      kind: 'TASK',
      id: asEntityId(validatedTaskId),
      exists: taskInProject,
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      teamId: project?.teamId,
      ownerUserId: project?.ownerUserId,
      taskId: validatedTaskId,
      createdBy: task?.createdByUserId,
      assigneeId: task?.assigneeId,
      participantIds: activeParticipantIds,
      deletedAt: task?.deletedAt ?? project?.deletedAt,
      archivedAt: project?.archivedAt,
      projectArchivedAt: project?.archivedAt,
    };

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOARD_CARD_MOVE,
      resource: taskResource,
      context: { now },
    });

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TASK_MOVE,
      resource: taskResource,
      context: { now },
    });

    if (!project || !task || task.projectId !== validatedProjectId) {
      throw new NotFoundError(
        `Task "${validatedTaskId}" was not found in project "${validatedProjectId}".`,
      );
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot move a cancelled task on the Kanban board.', {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const board = await this.deps.projectBoards.findPrimaryByProject(
      validatedOrgId,
      validatedProjectId,
    );
    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const allColumns = await this.deps.boardColumns.listByBoard(validatedOrgId, board.id, {
      includeArchived: true,
    });

    const sourceColumn = allColumns.find((column) => column.id === task.columnId);
    const targetColumn = allColumns.find((column) => column.id === validatedTargetColumnId);

    if (!sourceColumn) {
      throw new NotFoundError(`Source column "${task.columnId}" was not found on this board.`);
    }

    if (!targetColumn) {
      throw new NotFoundError(
        `Target column "${validatedTargetColumnId}" was not found on this board.`,
      );
    }

    const isSameColumnReorder = sourceColumn.id === targetColumn.id;

    const pauses = await this.deps.taskPauses.listByTask(validatedOrgId, validatedTaskId);
    const isTaskPaused =
      task.status === TASK_STATUSES.PAUSED || pauses.some((pause) => pause.endedAt === undefined);

    const boardResource = buildBoardResource(validatedOrgId, validatedProjectId, board.id, project);

    const pausedMoveException =
      parsed.pausedOverrideJustification !== undefined
        ? {
            authorized: evaluateAuthorization({
              actor,
              action: PERMISSION_CODES.BOARD_CONFIGURE,
              resource: boardResource,
              context: { now },
            }).allowed,
            justification: parsed.pausedOverrideJustification,
          }
        : undefined;

    let nextStatus: TaskStatus = task.status;
    let nextStartedAt: IsoDateTime | undefined = task.startedAt;
    let nextCompletedAt: IsoDateTime | undefined = task.completedAt;
    let cycleToSave: TaskExecutionCycle | null = null;
    let usedDependencyException = false;

    const isEnteringFinalColumn =
      !isSameColumnReorder &&
      targetColumn.columnRole === BOARD_COLUMN_ROLES.FINAL &&
      task.status !== TASK_STATUSES.DONE;

    const isLeavingFinalColumn =
      !isSameColumnReorder &&
      sourceColumn.columnRole === BOARD_COLUMN_ROLES.FINAL &&
      targetColumn.columnRole !== BOARD_COLUMN_ROLES.FINAL &&
      task.status === TASK_STATUSES.DONE;

    if (isEnteringFinalColumn) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.TASK_COMPLETE,
        resource: taskResource,
        context: { now },
      });

      const [subtasks, dependencies, impediments, cycles] = await Promise.all([
        this.deps.subtasks.listByTask(validatedOrgId, validatedTaskId),
        this.deps.taskDependencies.listByTask(validatedOrgId, validatedTaskId),
        this.deps.impediments.listByTask(validatedOrgId, validatedTaskId),
        this.deps.taskExecutionCycles.listByTask(validatedOrgId, validatedTaskId),
      ]);

      const requiredDeps = dependencies.filter((dep) => dep.required);
      const completedDepIds = new Set<TaskId>();
      if (requiredDeps.length > 0) {
        const referencedTasks = await Promise.all(
          Array.from(new Set(requiredDeps.map((dep) => dep.dependsOnTaskId))).map((depTaskId) =>
            this.deps.tasks.findById(validatedOrgId, depTaskId),
          ),
        );
        for (const depTask of referencedTasks) {
          if (
            depTask !== null &&
            !isSoftDeleted(depTask) &&
            depTask.status === TASK_STATUSES.DONE
          ) {
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
                context: { now },
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
      usedDependencyException = completionCheck.usedDependencyException;

      nextStatus = TASK_STATUSES.DONE;
      nextCompletedAt = now;

      const openCycle = cycles.find((cycle) => cycle.completedAt === undefined);
      if (openCycle !== undefined) {
        cycleToSave = {
          ...openCycle,
          completedAt: now,
        };
      } else if (cycles.length === 0) {
        cycleToSave = {
          id: asTaskExecutionCycleId(this.nextUuid()),
          organizationId: validatedOrgId,
          projectId: validatedProjectId,
          taskId: validatedTaskId,
          cycleNumber: 1,
          startedAt: task.startedAt ?? task.createdAt,
          effectiveStartedAt: task.startedAt ?? task.createdAt,
          completedAt: now,
        };
      }
    } else if (isLeavingFinalColumn) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.TASK_REOPEN,
        resource: taskResource,
        context: { now },
      });

      const cycles = await this.deps.taskExecutionCycles.listByTask(
        validatedOrgId,
        validatedTaskId,
      );
      cycleToSave = assertTaskReopenCreatesNewCycle(
        cycles,
        now,
        asTaskExecutionCycleId(this.nextUuid()),
        parsed.reopenReason,
      );

      nextStatus =
        targetColumn.columnRole === BOARD_COLUMN_ROLES.INITIAL
          ? TASK_STATUSES.TODO
          : TASK_STATUSES.IN_PROGRESS;
      nextCompletedAt = undefined;
      if (nextStatus === TASK_STATUSES.IN_PROGRESS && nextStartedAt === undefined) {
        nextStartedAt = now;
      }
    }

    const targetColumnTasks = await this.deps.tasks.listByColumn(validatedOrgId, targetColumn.id);
    const currentColumnOccupyingTaskCount = targetColumnTasks.filter((t) =>
      doesTaskStatusOccupyWip(t.status),
    ).length;

    const wipException =
      parsed.wipOverrideJustification !== undefined
        ? {
            authorized: evaluateAuthorization({
              actor,
              action: PERMISSION_CODES.BOARD_WIP_MANAGE,
              resource: boardResource,
              context: { now },
            }).allowed,
            justification: parsed.wipOverrideJustification,
          }
        : undefined;

    const moveCheck = assertCardMoveAllowed({
      targetColumn,
      currentColumnOccupyingTaskCount,
      movingTaskStatus: nextStatus,
      isSameColumnReorder,
      projectArchived:
        project.status === PROJECT_STATUSES.ARCHIVED || project.archivedAt !== undefined,
      isTaskPaused,
      ...(pausedMoveException !== undefined ? { pausedMoveException } : {}),
      ...(wipException !== undefined ? { wipException } : {}),
    });

    const { completedAt: _prevCompletedAt, startedAt: _prevStartedAt, ...taskBase } = task;
    const baseMovedTask: Task = {
      ...taskBase,
      columnId: targetColumn.id,
      status: nextStatus,
      ...(nextStartedAt !== undefined ? { startedAt: nextStartedAt } : {}),
      ...(nextCompletedAt !== undefined ? { completedAt: nextCompletedAt } : {}),
      // PRD.md §12.1: cross-column move updates lastMovedAt; same-column reorder preserves original lastMovedAt
      lastMovedAt: isSameColumnReorder ? task.lastMovedAt : now,
      lastActivityAt: now,
      updatedAt: now,
    };

    const tasksToSave: Task[] = [];
    let finalMovedTask: Task;

    if (isSameColumnReorder) {
      const siblings = targetColumnTasks.filter((t) => t.id !== task.id);
      const insertIndex =
        parsed.targetOrder !== undefined
          ? Math.max(0, Math.min(siblings.length, parsed.targetOrder - 1))
          : siblings.length;

      const reordered = [...siblings];
      reordered.splice(insertIndex, 0, baseMovedTask);

      reordered.forEach((candidate, index) => {
        const nextOrder = index + 1;
        if (candidate.id === task.id) {
          finalMovedTask = { ...candidate, order: nextOrder };
          tasksToSave.push(finalMovedTask);
        } else if (candidate.order !== nextOrder) {
          tasksToSave.push({ ...candidate, order: nextOrder });
        }
      });
    } else {
      const sourceColumnTasks = await this.deps.tasks.listByColumn(validatedOrgId, sourceColumn.id);
      const remainingSource = sourceColumnTasks.filter((t) => t.id !== task.id);
      remainingSource.forEach((candidate, index) => {
        const nextOrder = index + 1;
        if (candidate.order !== nextOrder) {
          tasksToSave.push({ ...candidate, order: nextOrder });
        }
      });

      const targetSiblings = targetColumnTasks.filter((t) => t.id !== task.id);
      const insertIndex =
        parsed.targetOrder !== undefined
          ? Math.max(0, Math.min(targetSiblings.length, parsed.targetOrder - 1))
          : targetSiblings.length;

      const reorderedTarget = [...targetSiblings];
      reorderedTarget.splice(insertIndex, 0, baseMovedTask);

      reorderedTarget.forEach((candidate, index) => {
        const nextOrder = index + 1;
        if (candidate.id === task.id) {
          finalMovedTask = { ...candidate, order: nextOrder };
          tasksToSave.push(finalMovedTask);
        } else if (candidate.order !== nextOrder) {
          tasksToSave.push({ ...candidate, order: nextOrder });
        }
      });
    }

    const resolvedMovedTask = finalMovedTask!;
    const justificationParts = [
      moveCheck.exceededWip ? parsed.wipOverrideJustification : undefined,
      isTaskPaused ? parsed.pausedOverrideJustification : undefined,
      usedDependencyException ? parsed.dependencyOverrideJustification : undefined,
      isLeavingFinalColumn ? parsed.reopenReason : undefined,
    ].filter((value): value is string => value !== undefined && value.trim().length > 0);
    const combinedJustification =
      justificationParts.length > 0 ? justificationParts.join(' | ') : undefined;

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.saveMany(validatedOrgId, tasksToSave);

        if (cycleToSave !== null) {
          await this.deps.taskExecutionCycles.save(cycleToSave);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.KANBAN,
          eventType: 'kanban.card.moved',
          resourceType: 'Task',
          resourceId: validatedTaskId,
          before: {
            columnId: sourceColumn.id,
            status: task.status,
            order: task.order,
          },
          after: {
            columnId: targetColumn.id,
            status: resolvedMovedTask.status,
            order: resolvedMovedTask.order,
            isSameColumnReorder,
            exceededWip: moveCheck.exceededWip,
            usedWipOverride: moveCheck.exceededWip,
            usedPausedOverride: isTaskPaused,
            usedDependencyOverride: usedDependencyException,
            reopened: isLeavingFinalColumn,
            completed: isEnteringFinalColumn,
          },
          ...(combinedJustification !== undefined ? { justification: combinedJustification } : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'kanban.card.moved',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Task',
            aggregateId: validatedTaskId,
            payload: {
              projectId: validatedProjectId,
              boardId: board.id,
              taskId: validatedTaskId,
              sourceColumnId: sourceColumn.id,
              targetColumnId: targetColumn.id,
              status: resolvedMovedTask.status,
              order: resolvedMovedTask.order,
              exceededWip: moveCheck.exceededWip,
            },
          }),
        );
      },
    );

    return resolvedMovedTask;
  }

  async createQuickCard(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    input: CreateQuickCardInput,
  ): Promise<Task> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const parsed = parseWithZod(createQuickCardInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, project, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);

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
      context: {
        now,
        policyConfig: {
          allowMemberCreateTaskInProject:
            effectiveSettings.pendingPermissionDefaults.allowMemberCreateTaskWithoutGrant,
        },
      },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    const board = await this.deps.projectBoards.findPrimaryByProject(
      validatedOrgId,
      validatedProjectId,
    );
    if (!board) {
      throw new NotFoundError(
        `Primary Kanban board was not found for project "${validatedProjectId}".`,
      );
    }

    const allColumns = await this.deps.boardColumns.listByBoard(validatedOrgId, board.id, {
      includeArchived: true,
    });

    let targetColumn: BoardColumn | undefined;
    if (parsed.columnId !== undefined) {
      const requestedColumnId = asBoardColumnId(parsed.columnId, 'columnId');
      targetColumn = allColumns.find((column) => column.id === requestedColumnId);
      if (!targetColumn) {
        throw new NotFoundError(`BoardColumn "${requestedColumnId}" was not found on this board.`);
      }
      if (targetColumn.archivedAt !== undefined) {
        throw new ConflictError('Cannot create a quick card inside an archived column.', {
          details: { columnId: requestedColumnId },
        });
      }
    } else {
      const activeColumns = allColumns.filter((column) => column.archivedAt === undefined);
      targetColumn =
        activeColumns.find((column) => column.columnRole === BOARD_COLUMN_ROLES.INITIAL) ??
        activeColumns.find((column) => column.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL);
      if (!targetColumn) {
        throw new ConflictError(
          'No active operational column is available to create a quick card.',
        );
      }
    }

    if (targetColumn.columnRole === BOARD_COLUMN_ROLES.FINAL) {
      throw new ConflictError(
        'Cannot create a new quick card directly in a final completion column.',
        {
          details: { columnId: targetColumn.id },
        },
      );
    }

    const validatedAssigneeId =
      parsed.assigneeId !== undefined ? asUserId(parsed.assigneeId, 'assigneeId') : undefined;
    if (validatedAssigneeId !== undefined) {
      const assigneeProjectMember = await this.deps.projectMembers.findByProjectAndUser(
        validatedOrgId,
        validatedProjectId,
        validatedAssigneeId,
      );
      if (!assigneeProjectMember || assigneeProjectMember.removedAt !== undefined) {
        throw new ConflictError('Task assignee must be an active participant of the project.', {
          details: { projectId: validatedProjectId, assigneeId: validatedAssigneeId },
        });
      }
    }

    const existingColumnTasks = await this.deps.tasks.listByColumn(validatedOrgId, targetColumn.id);
    const currentOccupyingCount = existingColumnTasks.filter((task) =>
      doesTaskStatusOccupyWip(task.status),
    ).length;

    const initialStatus: TaskStatus =
      targetColumn.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL
        ? TASK_STATUSES.IN_PROGRESS
        : TASK_STATUSES.TODO;

    assertWipAllowsCardMove({
      targetColumn,
      currentColumnOccupyingTaskCount: currentOccupyingCount,
      movingTaskStatus: initialStatus,
    });

    const nextOrder =
      existingColumnTasks.length === 0
        ? 1
        : Math.max(...existingColumnTasks.map((task) => task.order)) + 1;

    const newTask: Task = {
      id: asTaskId(this.nextUuid()),
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      boardId: board.id,
      columnId: targetColumn.id,
      title: parsed.title,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      status: initialStatus,
      priority: parsed.priority,
      ...(validatedAssigneeId !== undefined ? { assigneeId: validatedAssigneeId } : {}),
      order: nextOrder,
      tagIds: [],
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

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.tasks.save(newTask);
        await this.deps.taskExecutionCycles.save(initialCycle);

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
            boardId: board.id,
            columnId: targetColumn.id,
            title: newTask.title,
            status: newTask.status,
            priority: newTask.priority,
            ...(newTask.assigneeId !== undefined ? { assigneeId: newTask.assigneeId } : {}),
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
              boardId: board.id,
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
}
