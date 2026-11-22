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
  type AuthorizationActor,
  type AuthorizationResource,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import type { OrganizationMemberRepositoryPort } from '@/modules/organizations';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettingsRepositoryPort,
} from '@/modules/settings';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asImpedimentId,
  asIsoDateTime,
  asOrganizationId,
  asTaskId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  type CorrelationId,
  type DomainEventPublisherPort,
  type ImpedimentId,
  type ImpedimentSeverity,
  type IsoDateTime,
  type OrganizationId,
  type TaskId,
  type TaskStatus,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_STATUSES,
  assertImpedimentTransitionAllowed,
  isImpedimentBlocking,
  type Impediment,
  type ImpedimentCategory,
  type ImpedimentStatus,
} from '../../domain/impediment';
import type { ImpedimentRepositoryPort } from '../ports/impediment-repository.port';
import type {
  ImpedimentProjectSummary,
  ImpedimentTaskSummary,
  ImpedimentWorkContextPort,
} from '../ports/impediment-work-context.port';

const impedimentCategorySchema = z.enum([
  IMPEDIMENT_CATEGORIES.EXTERNAL_DEPENDENCY,
  IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
  IMPEDIMENT_CATEGORIES.MISSING_INFORMATION,
  IMPEDIMENT_CATEGORIES.RESOURCE_UNAVAILABILITY,
  IMPEDIMENT_CATEGORIES.AWAITING_APPROVAL,
  IMPEDIMENT_CATEGORIES.COMMUNICATION,
  IMPEDIMENT_CATEGORIES.OTHER,
]);

const impedimentSeveritySchema = z.enum([
  IMPEDIMENT_SEVERITIES.LOW,
  IMPEDIMENT_SEVERITIES.MEDIUM,
  IMPEDIMENT_SEVERITIES.HIGH,
  IMPEDIMENT_SEVERITIES.CRITICAL,
]);

const impedimentStatusSchema = z.enum([
  IMPEDIMENT_STATUSES.OPEN,
  IMPEDIMENT_STATUSES.IN_RESOLUTION,
  IMPEDIMENT_STATUSES.RESOLVED,
  IMPEDIMENT_STATUSES.CANCELLED,
]);

const createImpedimentInputSchema = z.object({
  category: impedimentCategorySchema,
  severity: impedimentSeveritySchema,
  description: z.string().trim().min(1).max(2000),
  ownerUserId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
});

const updateImpedimentInputSchema = z
  .object({
    category: impedimentCategorySchema.optional(),
    severity: impedimentSeveritySchema.optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    ownerUserId: z.union([z.string().uuid(), z.null()]).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.category !== undefined ||
      data.severity !== undefined ||
      data.description !== undefined ||
      data.ownerUserId !== undefined,
    'At least one field ("category", "severity", "description", or "ownerUserId") must be provided.',
  );

const transitionImpedimentInputSchema = z.object({
  targetStatus: impedimentStatusSchema,
  resolutionNote: z.string().trim().max(2000).optional(),
  correlationId: z.string().uuid().optional(),
});

export interface ImpedimentServiceDependencies {
  readonly impediments: ImpedimentRepositoryPort;
  readonly workContext: ImpedimentWorkContextPort;
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

export interface CreateImpedimentInput {
  readonly category: ImpedimentCategory;
  readonly severity: ImpedimentSeverity;
  readonly description: string;
  readonly ownerUserId?: UserId;
  readonly correlationId?: CorrelationId;
}

export interface UpdateImpedimentInput {
  readonly category?: ImpedimentCategory;
  readonly severity?: ImpedimentSeverity;
  readonly description?: string;
  readonly ownerUserId?: UserId | null;
  readonly correlationId?: CorrelationId;
}

export interface TransitionImpedimentInput {
  readonly targetStatus: ImpedimentStatus;
  readonly resolutionNote?: string;
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
    throw new ValidationError('Invalid impediment input payload.', {
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

function assertProjectOperational(project: ImpedimentProjectSummary): void {
  if (isSoftDeleted(project)) {
    throw new ConflictError('Cannot manage impediments on a deleted project.', {
      details: { projectId: project.id },
    });
  }

  if (project.status === 'ARCHIVED' || project.archivedAt !== undefined) {
    throw new ConflictError('Cannot manage impediments on an archived project.', {
      details: { projectId: project.id },
    });
  }
}

function resolveRestoredTaskStatus(task: ImpedimentTaskSummary): TaskStatus {
  if (task.hasOpenPause) {
    return TASK_STATUSES.PAUSED;
  }

  if (task.startedAt !== undefined || task.columnRole === 'OPERATIONAL') {
    return TASK_STATUSES.IN_PROGRESS;
  }

  return TASK_STATUSES.TODO;
}

function buildImpedimentResource(
  organizationId: OrganizationId,
  taskId: TaskId,
  task: ImpedimentTaskSummary | null,
  project: ImpedimentProjectSummary | null,
  createdBy?: UserId,
  existsOverride?: boolean,
): AuthorizationResource {
  return {
    kind: 'IMPEDIMENT',
    id: asEntityId(taskId),
    exists: existsOverride ?? (task !== null && project !== null),
    organizationId,
    projectId: task?.projectId ?? project?.id,
    teamId: project?.teamId,
    ownerUserId: project?.ownerUserId,
    taskId,
    createdBy: createdBy ?? task?.createdByUserId,
    assigneeId: task?.assigneeId,
    participantIds: task?.participantIds,
    deletedAt: task?.deletedAt ?? project?.deletedAt,
    archivedAt: project?.archivedAt,
    projectArchivedAt: project?.archivedAt,
  };
}

export class ImpedimentService {
  private readonly deps: ImpedimentServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: ImpedimentServiceDependencies) {
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
    const [membership, projectScopes, grants, explicitDenies] = await Promise.all([
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
      this.deps.workContext.listActorProjectScopes(organizationId, actorUserId),
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

  async listTaskImpediments(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly Impediment[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const now = this.now();

    const [actor, task, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedTaskId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const project =
      task !== null
        ? await this.deps.workContext.findProjectById(validatedOrgId, task.projectId)
        : null;
    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.IMPEDIMENT_VIEW,
      resource: buildImpedimentResource(validatedOrgId, validatedTaskId, task, project),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`, {
        details: { organizationId: validatedOrgId, taskId: validatedTaskId },
      });
    }

    return this.deps.impediments.listByTask(validatedOrgId, validatedTaskId);
  }

  async createImpediment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: CreateImpedimentInput,
  ): Promise<Impediment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(createImpedimentInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, task, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedTaskId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const project =
      task !== null
        ? await this.deps.workContext.findProjectById(validatedOrgId, task.projectId)
        : null;
    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.IMPEDIMENT_CREATE,
      resource: buildImpedimentResource(validatedOrgId, validatedTaskId, task, project),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`, {
        details: { organizationId: validatedOrgId, taskId: validatedTaskId },
      });
    }

    assertProjectOperational(project);

    if (task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED) {
      throw new ConflictError('Cannot open an impediment on a completed or cancelled task.', {
        details: { taskId: validatedTaskId, status: task.status },
      });
    }

    const validatedOwnerId =
      parsed.ownerUserId !== undefined ? asUserId(parsed.ownerUserId, 'ownerUserId') : undefined;
    if (validatedOwnerId !== undefined) {
      const ownerMembership = await this.deps.organizationMembers.findByOrganizationAndUser(
        validatedOrgId,
        validatedOwnerId,
      );
      if (!ownerMembership || ownerMembership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
        throw new NotFoundError('Impediment owner must be an active member of the organization.', {
          details: { organizationId: validatedOrgId, ownerUserId: validatedOwnerId },
        });
      }
    }

    const impediment: Impediment = {
      id: asImpedimentId(this.nextUuid()),
      organizationId: validatedOrgId,
      projectId: task.projectId,
      taskId: validatedTaskId,
      category: parsed.category,
      severity: parsed.severity,
      description: parsed.description,
      ...(validatedOwnerId !== undefined ? { ownerUserId: validatedOwnerId } : {}),
      status: IMPEDIMENT_STATUSES.OPEN,
      openedByUserId: validatedActorId,
      openedAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.IMPEDIMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.impediments.save(impediment);
        await this.deps.workContext.syncTaskAfterImpedimentChange({
          organizationId: validatedOrgId,
          taskId: validatedTaskId,
          nextStatus: TASK_STATUSES.BLOCKED,
          now,
        });

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.impediment.created',
          resourceType: 'Impediment',
          resourceId: impediment.id,
          after: {
            taskId: validatedTaskId,
            category: impediment.category,
            severity: impediment.severity,
            status: impediment.status,
            ...(impediment.ownerUserId !== undefined
              ? { ownerUserId: impediment.ownerUserId }
              : {}),
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.impediment.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Impediment',
            aggregateId: impediment.id,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              impedimentId: impediment.id,
              category: impediment.category,
              severity: impediment.severity,
              status: impediment.status,
            },
          }),
        );
      },
    );

    return impediment;
  }

  async updateImpediment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    impedimentId: ImpedimentId,
    input: UpdateImpedimentInput,
  ): Promise<Impediment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedImpedimentId = asImpedimentId(impedimentId, 'impedimentId');
    const parsed = parseWithZod(updateImpedimentInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, existing, task, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.impediments.findById(validatedOrgId, validatedImpedimentId),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedTaskId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;
    const project =
      task !== null
        ? await this.deps.workContext.findProjectById(validatedOrgId, task.projectId)
        : null;
    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.IMPEDIMENT_CREATE,
      resource: buildImpedimentResource(
        validatedOrgId,
        validatedTaskId,
        matchesTask ? task : null,
        matchesTask ? project : null,
        existing?.openedByUserId,
        matchesTask && task !== null && project !== null,
      ),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Impediment "${validatedImpedimentId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    if (
      existing.status === IMPEDIMENT_STATUSES.RESOLVED ||
      existing.status === IMPEDIMENT_STATUSES.CANCELLED
    ) {
      throw new ConflictError('Cannot update a resolved or cancelled impediment.', {
        details: { impedimentId: validatedImpedimentId, status: existing.status },
      });
    }

    let nextOwnerId = existing.ownerUserId;
    if (parsed.ownerUserId !== undefined) {
      if (parsed.ownerUserId === null) {
        nextOwnerId = undefined;
      } else {
        const validatedOwnerId = asUserId(parsed.ownerUserId, 'ownerUserId');
        const ownerMembership = await this.deps.organizationMembers.findByOrganizationAndUser(
          validatedOrgId,
          validatedOwnerId,
        );
        if (!ownerMembership || ownerMembership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
          throw new NotFoundError(
            'Impediment owner must be an active member of the organization.',
            {
              details: { organizationId: validatedOrgId, ownerUserId: validatedOwnerId },
            },
          );
        }
        nextOwnerId = validatedOwnerId;
      }
    }

    const { ownerUserId: _prevOwner, ...baseExisting } = existing;
    const updated: Impediment = {
      ...baseExisting,
      category: parsed.category ?? existing.category,
      severity: parsed.severity ?? existing.severity,
      description: parsed.description ?? existing.description,
      ...(nextOwnerId !== undefined ? { ownerUserId: nextOwnerId } : {}),
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.IMPEDIMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.impediments.save(updated);
        await this.deps.workContext.syncTaskAfterImpedimentChange({
          organizationId: validatedOrgId,
          taskId: validatedTaskId,
          now,
        });

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.impediment.updated',
          resourceType: 'Impediment',
          resourceId: validatedImpedimentId,
          before: {
            category: existing.category,
            severity: existing.severity,
            description: existing.description,
            ownerUserId: existing.ownerUserId ?? null,
          },
          after: {
            category: updated.category,
            severity: updated.severity,
            description: updated.description,
            ownerUserId: updated.ownerUserId ?? null,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.impediment.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Impediment',
            aggregateId: validatedImpedimentId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              impedimentId: validatedImpedimentId,
              category: updated.category,
              severity: updated.severity,
            },
          }),
        );
      },
    );

    return updated;
  }

  async transitionImpediment(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    impedimentId: ImpedimentId,
    input: TransitionImpedimentInput,
  ): Promise<Impediment> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedImpedimentId = asImpedimentId(impedimentId, 'impedimentId');
    const parsed = parseWithZod(transitionImpedimentInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, existing, task, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.impediments.findById(validatedOrgId, validatedImpedimentId),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedTaskId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const matchesTask = existing !== null && existing.taskId === validatedTaskId;
    const project =
      task !== null
        ? await this.deps.workContext.findProjectById(validatedOrgId, task.projectId)
        : null;
    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    const requiredPermission =
      parsed.targetStatus === IMPEDIMENT_STATUSES.RESOLVED ||
      parsed.targetStatus === IMPEDIMENT_STATUSES.CANCELLED
        ? PERMISSION_CODES.IMPEDIMENT_RESOLVE
        : PERMISSION_CODES.IMPEDIMENT_CREATE;

    assertAuthorized({
      actor,
      action: requiredPermission,
      resource: buildImpedimentResource(
        validatedOrgId,
        validatedTaskId,
        matchesTask ? task : null,
        matchesTask ? project : null,
        existing?.openedByUserId,
        matchesTask && task !== null && project !== null,
      ),
      context: { now, policyConfig },
    });

    if (!existing || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Impediment "${validatedImpedimentId}" was not found for task "${validatedTaskId}".`,
      );
    }

    assertProjectOperational(project);

    const transitionResult = assertImpedimentTransitionAllowed(
      existing.status,
      parsed.targetStatus,
    );

    const trimmedNote = parsed.resolutionNote?.trim();
    const isTerminalTransition =
      parsed.targetStatus === IMPEDIMENT_STATUSES.RESOLVED ||
      parsed.targetStatus === IMPEDIMENT_STATUSES.CANCELLED;

    const transitioned: Impediment = {
      ...existing,
      status: parsed.targetStatus,
      ...(isTerminalTransition
        ? {
            resolvedAt: now,
            resolvedByUserId: validatedActorId,
            ...(trimmedNote !== undefined && trimmedNote.length > 0
              ? { resolutionNote: trimmedNote }
              : {}),
          }
        : {}),
      updatedAt: now,
    };

    let nextTaskStatus: TaskStatus | undefined;
    if (isTerminalTransition) {
      const taskImpediments = await this.deps.impediments.listByTask(
        validatedOrgId,
        validatedTaskId,
      );
      const hasRemainingBlocking = taskImpediments.some(
        (candidate) => candidate.id !== validatedImpedimentId && isImpedimentBlocking(candidate),
      );

      if (!hasRemainingBlocking && task.status === TASK_STATUSES.BLOCKED) {
        // Resolving/cancelling the last blocking impediment NEVER auto-completes the task (autoCompletesTask: false)
        nextTaskStatus = resolveRestoredTaskStatus(task);
      }
    } else if (
      task.status !== TASK_STATUSES.BLOCKED &&
      task.status !== TASK_STATUSES.DONE &&
      task.status !== TASK_STATUSES.CANCELLED
    ) {
      nextTaskStatus = TASK_STATUSES.BLOCKED;
    }

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.IMPEDIMENTS,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.impediments.save(transitioned);
        await this.deps.workContext.syncTaskAfterImpedimentChange({
          organizationId: validatedOrgId,
          taskId: validatedTaskId,
          ...(nextTaskStatus !== undefined ? { nextStatus: nextTaskStatus } : {}),
          now,
        });

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.impediment.transitioned',
          resourceType: 'Impediment',
          resourceId: validatedImpedimentId,
          before: { status: existing.status },
          after: {
            status: transitioned.status,
            autoCompletesTask: transitionResult.autoCompletesTask,
            ...(nextTaskStatus !== undefined ? { taskStatusRestoredTo: nextTaskStatus } : {}),
          },
          ...(trimmedNote !== undefined && trimmedNote.length > 0
            ? { justification: trimmedNote }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.impediment.transitioned',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Impediment',
            aggregateId: validatedImpedimentId,
            payload: {
              projectId: task.projectId,
              taskId: validatedTaskId,
              impedimentId: validatedImpedimentId,
              fromStatus: existing.status,
              toStatus: transitioned.status,
              autoCompletesTask: transitionResult.autoCompletesTask,
              ...(nextTaskStatus !== undefined ? { nextTaskStatus } : {}),
            },
          }),
        );
      },
    );

    return transitioned;
  }
}
