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
import type { OrganizationMemberRepositoryPort } from '@/modules/organizations';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettingsRepositoryPort,
} from '@/modules/settings';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asTaskId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type TaskId,
  type TaskStatus,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  asTaskDependencyId,
  assertNoDependencyCycle,
  type TaskDependency,
  type TaskDependencyId,
} from '../../domain/task-dependency';
import type { TaskDependencyRepositoryPort } from '../ports/task-dependency-repository.port';
import type {
  DependencyProjectSummary,
  DependencyTaskSummary,
  DependencyWorkContextPort,
} from '../ports/dependency-work-context.port';

const addDependencyInputSchema = z.object({
  dependsOnTaskId: z.string().uuid(),
  required: z.boolean().default(true),
  correlationId: z.string().uuid().optional(),
});

export interface DependencyServiceDependencies {
  readonly taskDependencies: TaskDependencyRepositoryPort;
  readonly workContext: DependencyWorkContextPort;
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

export interface AddTaskDependencyInput {
  readonly dependsOnTaskId: TaskId;
  readonly required?: boolean;
  readonly correlationId?: CorrelationId;
}

export interface DependencyOperationOptions {
  readonly correlationId?: CorrelationId;
}

export interface RelatedTaskProjection {
  readonly id: TaskId;
  readonly title: string;
  readonly status: TaskStatus;
}

export interface TaskDependencyListItem extends TaskDependency {
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly relatedTask: RelatedTaskProjection;
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
    throw new ValidationError('Invalid task dependency input payload.', {
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

function assertProjectOperational(project: DependencyProjectSummary): void {
  if (isSoftDeleted(project)) {
    throw new ConflictError('Cannot manage dependencies on a deleted project.', {
      details: { projectId: project.id },
    });
  }

  if (project.status === 'ARCHIVED' || project.archivedAt !== undefined) {
    throw new ConflictError('Cannot manage dependencies on an archived project.', {
      details: { projectId: project.id },
    });
  }
}

function buildTaskResource(
  organizationId: OrganizationId,
  taskId: TaskId,
  task: DependencyTaskSummary | null,
  project: DependencyProjectSummary | null,
  relatedTasksAccessible?: boolean,
): AuthorizationResource {
  return {
    kind: 'DEPENDENCY',
    id: asEntityId(taskId),
    exists: task !== null && project !== null,
    organizationId,
    projectId: task?.projectId ?? project?.id,
    teamId: project?.teamId,
    ownerUserId: project?.ownerUserId,
    taskId,
    createdBy: task?.createdByUserId,
    assigneeId: task?.assigneeId,
    participantIds: task?.participantIds,
    deletedAt: task?.deletedAt ?? project?.deletedAt,
    archivedAt: project?.archivedAt,
    projectArchivedAt: project?.archivedAt,
    ...(relatedTasksAccessible !== undefined ? { relatedTasksAccessible } : {}),
  };
}

export class DependencyService {
  private readonly deps: DependencyServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: DependencyServiceDependencies) {
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

  async listTaskDependencies(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskDependencyListItem[]> {
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
      action: PERMISSION_CODES.DEPENDENCY_VIEW,
      resource: buildTaskResource(validatedOrgId, validatedTaskId, task, project, true),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`, {
        details: { organizationId: validatedOrgId, taskId: validatedTaskId },
      });
    }

    const dependencies = await this.deps.taskDependencies.listByTask(
      validatedOrgId,
      validatedTaskId,
    );
    if (dependencies.length === 0) {
      return [];
    }

    const relatedTaskIds = Array.from(
      new Set(
        dependencies.map((dep) =>
          dep.taskId === validatedTaskId ? dep.dependsOnTaskId : dep.taskId,
        ),
      ),
    );
    const relatedTasks = await this.deps.workContext.findTasksWorkContext(
      validatedOrgId,
      relatedTaskIds,
    );
    const relatedTaskById = new Map(relatedTasks.map((candidate) => [candidate.id, candidate]));

    const visibleDependencies: TaskDependencyListItem[] = [];

    for (const dependency of dependencies) {
      const direction = dependency.taskId === validatedTaskId ? 'OUTGOING' : 'INCOMING';
      const otherTaskId =
        dependency.taskId === validatedTaskId ? dependency.dependsOnTaskId : dependency.taskId;
      const relatedTask = relatedTaskById.get(otherTaskId) ?? null;

      const canViewRelatedTask =
        relatedTask !== null &&
        !isSoftDeleted(relatedTask) &&
        evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.TASK_VIEW,
          resource: {
            kind: 'TASK',
            id: asEntityId(relatedTask.id),
            exists: true,
            organizationId: validatedOrgId,
            projectId: relatedTask.projectId,
            teamId: project.teamId,
            ownerUserId: project.ownerUserId,
            taskId: relatedTask.id,
            createdBy: relatedTask.createdByUserId,
            assigneeId: relatedTask.assigneeId,
            participantIds: relatedTask.participantIds,
            deletedAt: relatedTask.deletedAt ?? project.deletedAt,
            archivedAt: project.archivedAt,
            projectArchivedAt: project.archivedAt,
          },
          context: { now, policyConfig },
        }).allowed;

      const edgeDecision = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.DEPENDENCY_VIEW,
        resource: buildTaskResource(
          validatedOrgId,
          validatedTaskId,
          task,
          project,
          canViewRelatedTask,
        ),
        context: { now, policyConfig },
      });

      if (!edgeDecision.allowed || relatedTask === null) {
        continue;
      }

      visibleDependencies.push({
        ...dependency,
        direction,
        relatedTask: Object.freeze({
          id: relatedTask.id,
          title: relatedTask.title,
          status: relatedTask.status,
        }),
      });
    }

    return visibleDependencies;
  }

  async addDependency(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    input: AddTaskDependencyInput,
  ): Promise<TaskDependency> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const parsed = parseWithZod(addDependencyInputSchema, input);
    const validatedDependsOnId = asTaskId(parsed.dependsOnTaskId, 'dependsOnTaskId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, task, dependsOnTask, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedTaskId),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedDependsOnId),
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
      action: PERMISSION_CODES.DEPENDENCY_MANAGE,
      resource: buildTaskResource(validatedOrgId, validatedTaskId, task, project),
      context: { now, policyConfig },
    });

    if (!task || !project) {
      throw new NotFoundError(`Task "${validatedTaskId}" was not found.`, {
        details: { organizationId: validatedOrgId, taskId: validatedTaskId },
      });
    }

    assertProjectOperational(project);

    if (!dependsOnTask || isSoftDeleted(dependsOnTask)) {
      throw new NotFoundError(
        `Target dependency task "${validatedDependsOnId}" was not found in this organization.`,
        {
          details: { organizationId: validatedOrgId, dependsOnTaskId: validatedDependsOnId },
        },
      );
    }

    if (dependsOnTask.projectId !== task.projectId) {
      throw new ConflictError('Task dependencies must belong to the same project.', {
        details: {
          taskId: validatedTaskId,
          dependsOnTaskId: validatedDependsOnId,
          projectId: task.projectId,
          targetProjectId: dependsOnTask.projectId,
        },
      });
    }

    if (
      task.status === TASK_STATUSES.CANCELLED ||
      dependsOnTask.status === TASK_STATUSES.CANCELLED
    ) {
      throw new ConflictError('Cannot create a dependency involving a cancelled task.', {
        details: { taskId: validatedTaskId, dependsOnTaskId: validatedDependsOnId },
      });
    }

    const existingPair = await this.deps.taskDependencies.findByPair(
      validatedOrgId,
      validatedTaskId,
      validatedDependsOnId,
    );
    if (existingPair !== null) {
      throw new ConflictError('This task dependency already exists.', {
        details: {
          dependencyId: existingPair.id,
          taskId: validatedTaskId,
          dependsOnTaskId: validatedDependsOnId,
        },
      });
    }

    const projectDependencies = await this.deps.taskDependencies.listByProject(
      validatedOrgId,
      task.projectId,
    );
    assertNoDependencyCycle(projectDependencies, {
      taskId: validatedTaskId,
      dependsOnTaskId: validatedDependsOnId,
    });

    const newDependency: TaskDependency = {
      id: asTaskDependencyId(this.nextUuid()),
      organizationId: validatedOrgId,
      projectId: task.projectId,
      taskId: validatedTaskId,
      dependsOnTaskId: validatedDependsOnId,
      required: parsed.required,
      createdByUserId: validatedActorId,
      createdAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_DEPENDENCIES,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskDependencies.save(newDependency);
        await this.deps.workContext.touchTaskActivity(validatedOrgId, validatedTaskId, now);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.dependency.added',
          resourceType: 'TaskDependency',
          resourceId: newDependency.id,
          after: {
            taskId: newDependency.taskId,
            dependsOnTaskId: newDependency.dependsOnTaskId,
            required: newDependency.required,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.dependency.added',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskDependency',
            aggregateId: newDependency.id,
            payload: {
              projectId: task.projectId,
              taskId: newDependency.taskId,
              dependsOnTaskId: newDependency.dependsOnTaskId,
              required: newDependency.required,
            },
          }),
        );
      },
    );

    return newDependency;
  }

  async removeDependency(
    actorUserId: UserId,
    organizationId: OrganizationId,
    taskId: TaskId,
    dependencyId: TaskDependencyId,
    options: DependencyOperationOptions = {},
  ): Promise<{ readonly deletedDependencyId: TaskDependencyId }> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTaskId = asTaskId(taskId, 'taskId');
    const validatedDependencyId = asTaskDependencyId(dependencyId, 'dependencyId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, dependency, task, settings] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.taskDependencies.findById(validatedOrgId, validatedDependencyId),
      this.deps.workContext.findTaskWorkContext(validatedOrgId, validatedTaskId),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const matchesTask = dependency !== null && dependency.taskId === validatedTaskId;
    const project =
      task !== null
        ? await this.deps.workContext.findProjectById(validatedOrgId, task.projectId)
        : null;
    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.DEPENDENCY_MANAGE,
      resource: buildTaskResource(
        validatedOrgId,
        validatedTaskId,
        matchesTask ? task : null,
        matchesTask ? project : null,
      ),
      context: { now, policyConfig },
    });

    if (!dependency || !matchesTask || !task || !project) {
      throw new NotFoundError(
        `Dependency "${validatedDependencyId}" was not found for task "${validatedTaskId}".`,
        {
          details: {
            organizationId: validatedOrgId,
            taskId: validatedTaskId,
            dependencyId: validatedDependencyId,
          },
        },
      );
    }

    assertProjectOperational(project);

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TASK_DEPENDENCIES,
        TRANSACTION_RESOURCES.TASKS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.taskDependencies.delete(validatedOrgId, validatedDependencyId);
        await this.deps.workContext.touchTaskActivity(validatedOrgId, validatedTaskId, now);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: task.projectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.TASK,
          eventType: 'task.dependency.removed',
          resourceType: 'TaskDependency',
          resourceId: validatedDependencyId,
          before: {
            taskId: dependency.taskId,
            dependsOnTaskId: dependency.dependsOnTaskId,
            required: dependency.required,
          },
          after: { deleted: true },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'task.dependency.removed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TaskDependency',
            aggregateId: validatedDependencyId,
            payload: {
              projectId: task.projectId,
              taskId: dependency.taskId,
              dependsOnTaskId: dependency.dependsOnTaskId,
            },
          }),
        );
      },
    );

    return Object.freeze({ deletedDependencyId: validatedDependencyId });
  }
}
