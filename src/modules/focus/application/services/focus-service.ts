import { z } from 'zod';
import {
  PERMISSION_CODES,
  assertAuthorized,
  evaluateAuthorization,
  type AuthorizationActor,
  type AuthorizationPolicyConfig,
  type AuthorizationResource,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import {
  calculateWorkloadScore,
  type WorkloadCalculationOptions,
  type WorkloadScoreResult,
  type WorkloadSubtaskSnapshot,
  type WorkloadTaskSnapshot,
} from '@/modules/bottlenecks';
import type {
  OrganizationMemberRepositoryPort,
  OrganizationRepositoryPort,
} from '@/modules/organizations';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type CalibratableWeightsConfig,
  type OrganizationSettingsRepositoryPort,
} from '@/modules/settings';
import { NotFoundError, ValidationError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
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
  parseIsoDateTimeMs,
  type CorrelationId,
  type DomainEventPublisherPort,
  type ImpedimentSeverity,
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
  FOCUS_MODES,
  asFocusPreferenceId,
  rankFocusTasks,
  type FocusBlockingReason,
  type FocusMode,
  type FocusPreference,
  type FocusRankingResult,
  type FocusScoringWeights,
  type FocusTaskCandidate,
} from '../../domain/focus';
import type { FocusPreferenceRepositoryPort } from '../ports/focus-repository.port';
import type {
  FocusProjectSummary,
  FocusSubtaskWorkSnapshot,
  FocusTaskWorkSnapshot,
  FocusWorkContextPort,
} from '../ports/focus-work-context.port';

const focusModeSchema = z.enum([FOCUS_MODES.AUTO, FOCUS_MODES.MANUAL]);

const updateFocusPreferencesInputSchema = z
  .object({
    mode: focusModeSchema.optional(),
    pinnedTaskIds: z.array(z.string().uuid()).max(200).optional(),
    hiddenTaskIds: z.array(z.string().uuid()).max(500).optional(),
    manualOrderTaskIds: z.array(z.string().uuid()).max(500).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.mode !== undefined ||
      data.pinnedTaskIds !== undefined ||
      data.hiddenTaskIds !== undefined ||
      data.manualOrderTaskIds !== undefined,
    'At least one field ("mode", "pinnedTaskIds", "hiddenTaskIds", or "manualOrderTaskIds") must be provided.',
  );

const IMPEDIMENT_SEVERITY_RANK: Readonly<Record<ImpedimentSeverity, number>> = {
  [IMPEDIMENT_SEVERITIES.LOW]: 1,
  [IMPEDIMENT_SEVERITIES.MEDIUM]: 2,
  [IMPEDIMENT_SEVERITIES.HIGH]: 3,
  [IMPEDIMENT_SEVERITIES.CRITICAL]: 4,
};

export interface FocusServiceDependencies {
  readonly focusPreferences: FocusPreferenceRepositoryPort;
  readonly workContext: FocusWorkContextPort;
  readonly organizations: OrganizationRepositoryPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly organizationSettings: OrganizationSettingsRepositoryPort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface GetMyFocusViewOptions {
  readonly projectId?: ProjectId;
  readonly onlyMyTasks?: boolean;
}

export interface UpdateFocusPreferencesInput {
  readonly mode?: FocusMode;
  readonly pinnedTaskIds?: readonly TaskId[];
  readonly hiddenTaskIds?: readonly TaskId[];
  readonly manualOrderTaskIds?: readonly TaskId[];
  readonly correlationId?: CorrelationId;
}

export interface FocusOperationOptions {
  readonly correlationId?: CorrelationId;
}

export interface HiddenFocusTaskSummary {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
}

export interface FocusPersonalCounters {
  readonly actionableCount: number;
  readonly blockedCount: number;
  readonly pinnedCount: number;
  readonly hiddenCount: number;
  readonly overdueCount: number;
  readonly inProgressCount: number;
  readonly todoCount: number;
  readonly pausedCount: number;
  readonly myAssignedTaskCount: number;
  readonly myOpenSubtaskCount: number;
  readonly totalVisibleActiveCount: number;
}

export interface MyFocusView {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly mode: FocusMode;
  readonly preference: FocusPreference | null;
  readonly workload: WorkloadScoreResult;
  readonly ranking: FocusRankingResult;
  readonly hiddenTasks: readonly HiddenFocusTaskSummary[];
  readonly counters: FocusPersonalCounters;
  readonly generatedAt: IsoDateTime;
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
    throw new ValidationError('Invalid focus preferences input payload.', {
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

function deduplicateTaskIds(ids: readonly string[]): readonly TaskId[] {
  const seen = new Set<TaskId>();
  const result: TaskId[] = [];
  for (const rawId of ids) {
    const taskId = asTaskId(rawId, 'taskId');
    if (!seen.has(taskId)) {
      seen.add(taskId);
      result.push(taskId);
    }
  }
  return Object.freeze(result);
}

function toWorkloadOptions(weights: CalibratableWeightsConfig): WorkloadCalculationOptions {
  return {
    weights: {
      priority: weights.workloadPriorityWeight,
      delay: weights.workloadDelayWeight,
      impediments: weights.workloadImpedimentsWeight,
      operationalState: weights.workloadOperationalStateWeight,
    },
    pausedFactor: weights.workloadPausedFactor,
  };
}

function toFocusWeights(weights: CalibratableWeightsConfig): FocusScoringWeights {
  return {
    priority: weights.focusPriorityWeight,
    deadline: weights.focusDeadlineWeight,
    dependencies: weights.focusDependenciesWeight,
    inactivity: weights.focusInactivityWeight,
    workloadCompatibility: weights.focusWorkloadCompatibilityWeight,
  };
}

function resolveMaxImpedimentSeverity(
  impediments: FocusTaskWorkSnapshot['openBlockingImpediments'],
): ImpedimentSeverity | undefined {
  let maxSeverity: ImpedimentSeverity | undefined;
  let maxRank = 0;
  for (const imp of impediments) {
    const rank = IMPEDIMENT_SEVERITY_RANK[imp.severity];
    if (rank > maxRank) {
      maxRank = rank;
      maxSeverity = imp.severity;
    }
  }
  return maxSeverity;
}

function buildTaskResource(
  organizationId: OrganizationId,
  task: FocusTaskWorkSnapshot,
  project: FocusProjectSummary,
): AuthorizationResource {
  return {
    kind: 'TASK',
    id: asEntityId(task.id),
    exists: true,
    organizationId,
    projectId: task.projectId,
    teamId: project.teamId,
    ownerUserId: project.ownerUserId,
    projectArchivedAt: project.archivedAt,
    deletedAt: task.deletedAt ?? project.deletedAt,
    taskId: task.id,
    createdBy: task.createdByUserId,
    assigneeId: task.assigneeId,
    participantIds: task.participantIds,
  };
}

function countDistinctTaskAssignees(task: FocusTaskWorkSnapshot): number {
  const participants = new Set<UserId>(task.participantIds);
  if (task.assigneeId !== undefined) {
    participants.add(task.assigneeId);
  }
  return Math.max(1, participants.size);
}

function isUserAssignedOrParticipating(task: FocusTaskWorkSnapshot, userId: UserId): boolean {
  return task.assigneeId === userId || task.participantIds.includes(userId);
}

function isProjectActiveOperational(project: FocusProjectSummary): boolean {
  return !isSoftDeleted(project) && project.status === 'ACTIVE' && project.archivedAt === undefined;
}

export class FocusService {
  private readonly deps: FocusServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: FocusServiceDependencies) {
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

  private canViewTask(
    actor: AuthorizationActor,
    organizationId: OrganizationId,
    task: FocusTaskWorkSnapshot,
    project: FocusProjectSummary,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
  ): boolean {
    const decision = evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.TASK_VIEW,
      resource: buildTaskResource(organizationId, task, project),
      context: { now, policyConfig },
    });
    return decision.allowed;
  }

  private buildBlockingReasons(
    actor: AuthorizationActor,
    organizationId: OrganizationId,
    task: FocusTaskWorkSnapshot,
    projectsById: ReadonlyMap<ProjectId, FocusProjectSummary>,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
  ): readonly FocusBlockingReason[] {
    const reasons: FocusBlockingReason[] = [];

    for (const impediment of task.openBlockingImpediments) {
      reasons.push({
        code: 'OPEN_IMPEDIMENT',
        description: `Impedimento ativo (${impediment.severity}): ${impediment.description}`,
        unblockCondition: 'Resolver ou cancelar os impedimentos bloqueantes desta tarefa.',
      });
    }

    if (task.pendingRequiredDependencies.length > 0) {
      const accessibleTitles: string[] = [];
      for (const dep of task.pendingRequiredDependencies) {
        const depProject = projectsById.get(dep.dependsOnTaskProjectId);
        if (depProject && !isSoftDeleted(depProject) && dep.dependsOnTaskDeletedAt === undefined) {
          const depDecision = evaluateAuthorization({
            actor,
            action: PERMISSION_CODES.TASK_VIEW,
            resource: {
              kind: 'TASK',
              id: asEntityId(dep.dependsOnTaskId),
              exists: true,
              organizationId,
              projectId: dep.dependsOnTaskProjectId,
              teamId: depProject.teamId,
              ownerUserId: depProject.ownerUserId,
              projectArchivedAt: depProject.archivedAt,
              deletedAt: dep.dependsOnTaskDeletedAt,
              taskId: dep.dependsOnTaskId,
              createdBy: dep.dependsOnTaskCreatedByUserId,
              assigneeId: dep.dependsOnTaskAssigneeId,
              participantIds: dep.dependsOnTaskParticipantIds,
            },
            context: { now, policyConfig },
          });
          if (depDecision.allowed) {
            accessibleTitles.push(`"${dep.dependsOnTaskTitle}"`);
          }
        }
      }

      const depCount = task.pendingRequiredDependencies.length;
      const description =
        accessibleTitles.length === depCount && accessibleTitles.length > 0
          ? `Aguardando conclusão de dependência(s) obrigatória(s): ${accessibleTitles.join(', ')}.`
          : `Aguardando conclusão de ${depCount} dependência(s) obrigatória(s) pendente(s).`;

      reasons.push({
        code: 'PENDING_DEPENDENCY',
        description,
        unblockCondition:
          'Concluir as tarefas predecessoras obrigatórias ou ajustar a dependência.',
      });
    }

    if (task.status === TASK_STATUSES.PAUSED || task.openPauseReason !== undefined) {
      reasons.push({
        code: 'PAUSED',
        description: task.openPauseReason
          ? `Tarefa pausada: ${task.openPauseReason}`
          : 'Tarefa atualmente pausada.',
        unblockCondition: 'Retomar a execução da tarefa.',
      });
    }

    if (task.status === TASK_STATUSES.BLOCKED && reasons.length === 0) {
      reasons.push({
        code: 'OTHER',
        description: 'Tarefa marcada como bloqueada.',
        unblockCondition: 'Remover condição bloqueante e restaurar estado operacional da tarefa.',
      });
    }

    return Object.freeze(reasons);
  }

  private computeUserWorkload(
    actorUserId: UserId,
    tasks: readonly FocusTaskWorkSnapshot[],
    subtasks: readonly FocusSubtaskWorkSnapshot[],
    activeProjectsById: ReadonlyMap<ProjectId, FocusProjectSummary>,
    now: IsoDateTime,
    calibratableWeights: CalibratableWeightsConfig,
  ): WorkloadScoreResult {
    const workloadTasks: WorkloadTaskSnapshot[] = [];
    for (const task of tasks) {
      if (isSoftDeleted(task)) {
        continue;
      }
      const project = activeProjectsById.get(task.projectId);
      if (!project) {
        continue;
      }
      if (!isUserAssignedOrParticipating(task, actorUserId)) {
        continue;
      }

      const maxSeverity = resolveMaxImpedimentSeverity(task.openBlockingImpediments);
      workloadTasks.push({
        taskId: task.id,
        status: task.status,
        priority: task.priority,
        ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        participantCount: countDistinctTaskAssignees(task),
        ...(maxSeverity !== undefined ? { openImpedimentsMaxSeverity: maxSeverity } : {}),
      });
    }

    const workloadSubtasks: WorkloadSubtaskSnapshot[] = [];
    for (const subtask of subtasks) {
      if (subtask.assigneeId !== actorUserId) {
        continue;
      }
      if (subtask.parentTaskDeletedAt !== undefined) {
        continue;
      }
      if (
        subtask.parentTaskStatus === TASK_STATUSES.DONE ||
        subtask.parentTaskStatus === TASK_STATUSES.CANCELLED
      ) {
        continue;
      }
      if (!activeProjectsById.has(subtask.projectId)) {
        continue;
      }

      workloadSubtasks.push({
        subtaskId: subtask.id,
        status: subtask.status,
        priority: subtask.priority,
        ...(subtask.dueDate !== undefined ? { dueDate: subtask.dueDate } : {}),
      });
    }

    return calculateWorkloadScore(
      workloadTasks,
      workloadSubtasks,
      now,
      toWorkloadOptions(calibratableWeights),
    );
  }

  async getMyFocusView(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options?: GetMyFocusViewOptions,
  ): Promise<MyFocusView> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const filterProjectId =
      options?.projectId !== undefined ? asProjectId(options.projectId, 'projectId') : undefined;
    const onlyMyTasks = options?.onlyMyTasks ?? false;
    const now = this.now();

    const [org, actor, settings, preference, projects, tasks, subtasks] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.focusPreferences.findByUser(validatedOrgId, validatedActorId),
      this.deps.workContext.listProjectsByOrganization(validatedOrgId),
      this.deps.workContext.listOrganizationTaskSnapshots(validatedOrgId),
      this.deps.workContext.listOrganizationSubtaskSnapshots(validatedOrgId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    const baseResource: AuthorizationResource = {
      kind: 'FOCUS',
      id: asEntityId(validatedActorId),
      exists: org !== null,
      organizationId: validatedOrgId,
      ownerUserId: validatedActorId,
      ...(org?.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
    };

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE,
      resource: baseResource,
      context: { now, policyConfig },
    });

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW,
      resource: { ...baseResource, kind: 'ANALYTICS' },
      context: { now, policyConfig },
    });

    const projectsById = new Map<ProjectId, FocusProjectSummary>();
    const activeProjectsById = new Map<ProjectId, FocusProjectSummary>();
    for (const project of projects) {
      projectsById.set(project.id, project);
      if (isProjectActiveOperational(project)) {
        activeProjectsById.set(project.id, project);
      }
    }

    const workload = this.computeUserWorkload(
      validatedActorId,
      tasks,
      subtasks,
      activeProjectsById,
      now,
      effectiveSettings.calibratableWeights,
    );

    const hiddenIdSet = new Set<TaskId>(preference?.hiddenTaskIds ?? []);
    const candidates: FocusTaskCandidate[] = [];
    const hiddenTasks: HiddenFocusTaskSummary[] = [];
    const visibleActiveTasks: FocusTaskWorkSnapshot[] = [];

    for (const task of tasks) {
      if (
        isSoftDeleted(task) ||
        task.status === TASK_STATUSES.DONE ||
        task.status === TASK_STATUSES.CANCELLED
      ) {
        continue;
      }

      if (filterProjectId !== undefined && task.projectId !== filterProjectId) {
        continue;
      }

      const project = activeProjectsById.get(task.projectId);
      if (!project) {
        continue;
      }

      if (onlyMyTasks && !isUserAssignedOrParticipating(task, validatedActorId)) {
        continue;
      }

      if (!this.canViewTask(actor, validatedOrgId, task, project, now, policyConfig)) {
        continue;
      }

      visibleActiveTasks.push(task);

      if (hiddenIdSet.has(task.id)) {
        hiddenTasks.push({
          taskId: task.id,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        });
        continue;
      }

      const blockingReasons = this.buildBlockingReasons(
        actor,
        validatedOrgId,
        task,
        projectsById,
        now,
        policyConfig,
      );
      const isBlocked =
        task.status === TASK_STATUSES.BLOCKED ||
        task.status === TASK_STATUSES.PAUSED ||
        blockingReasons.length > 0;

      candidates.push({
        organizationId: validatedOrgId,
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        lastMovedAt: task.lastMovedAt,
        inactivityThresholdDays: project.inactivityThresholdDays,
        hasPendingRequiredDependencies: task.pendingRequiredDependencies.length > 0,
        isBlocked,
        blockingReasons,
        currentUserWorkloadScore: workload.score,
      });
    }

    const ranking = rankFocusTasks(
      candidates,
      preference,
      now,
      toFocusWeights(effectiveSettings.calibratableWeights),
    );

    const nowMs = parseIsoDateTimeMs(now);
    const nonHiddenVisibleTasks = visibleActiveTasks.filter((task) => !hiddenIdSet.has(task.id));

    const counters: FocusPersonalCounters = Object.freeze({
      actionableCount: ranking.actionableTasks.length,
      blockedCount: ranking.blockedTasks.length,
      pinnedCount: ranking.actionableTasks.filter((item) => item.isPinned).length,
      hiddenCount: hiddenTasks.length,
      overdueCount: nonHiddenVisibleTasks.filter(
        (task) => task.dueDate !== undefined && parseIsoDateTimeMs(task.dueDate) < nowMs,
      ).length,
      inProgressCount: nonHiddenVisibleTasks.filter(
        (task) => task.status === TASK_STATUSES.IN_PROGRESS,
      ).length,
      todoCount: nonHiddenVisibleTasks.filter((task) => task.status === TASK_STATUSES.TODO).length,
      pausedCount: nonHiddenVisibleTasks.filter((task) => task.status === TASK_STATUSES.PAUSED)
        .length,
      myAssignedTaskCount: visibleActiveTasks.filter((task) =>
        isUserAssignedOrParticipating(task, validatedActorId),
      ).length,
      myOpenSubtaskCount: workload.activeSubtaskCount,
      totalVisibleActiveCount: visibleActiveTasks.length,
    });

    return Object.freeze({
      organizationId: validatedOrgId,
      userId: validatedActorId,
      mode: ranking.mode,
      preference,
      workload,
      ranking,
      hiddenTasks: Object.freeze(hiddenTasks),
      counters,
      generatedAt: now,
    });
  }

  async updateFocusPreferences(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: UpdateFocusPreferencesInput,
  ): Promise<FocusPreference> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(updateFocusPreferencesInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [org, actor, settings, projects] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.workContext.listProjectsByOrganization(validatedOrgId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE,
      resource: {
        kind: 'FOCUS',
        id: asEntityId(validatedActorId),
        exists: org !== null,
        organizationId: validatedOrgId,
        ownerUserId: validatedActorId,
        ...(org?.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
      },
      context: { now, policyConfig },
    });

    const projectsById = new Map<ProjectId, FocusProjectSummary>();
    for (const project of projects) {
      projectsById.set(project.id, project);
    }

    const pinnedTaskIds =
      parsed.pinnedTaskIds !== undefined ? deduplicateTaskIds(parsed.pinnedTaskIds) : undefined;
    const hiddenTaskIds =
      parsed.hiddenTaskIds !== undefined ? deduplicateTaskIds(parsed.hiddenTaskIds) : undefined;
    const manualOrderTaskIds =
      parsed.manualOrderTaskIds !== undefined
        ? deduplicateTaskIds(parsed.manualOrderTaskIds)
        : undefined;

    const referencedTaskIds = deduplicateTaskIds([
      ...(pinnedTaskIds ?? []),
      ...(hiddenTaskIds ?? []),
      ...(manualOrderTaskIds ?? []),
    ]);

    for (const taskId of referencedTaskIds) {
      const task = await this.deps.workContext.findTaskSnapshot(validatedOrgId, taskId);
      if (!task || isSoftDeleted(task)) {
        throw new NotFoundError(`Task "${taskId}" was not found in this organization.`, {
          details: { organizationId: validatedOrgId, taskId },
        });
      }

      const project = projectsById.get(task.projectId);
      if (!project || isSoftDeleted(project)) {
        throw new NotFoundError(`Project for task "${taskId}" was not found.`, {
          details: { organizationId: validatedOrgId, taskId, projectId: task.projectId },
        });
      }

      assertAuthorized({
        actor,
        action: PERMISSION_CODES.TASK_VIEW,
        resource: buildTaskResource(validatedOrgId, task, project),
        context: { now, policyConfig },
      });
    }

    const updatedPreference = await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FOCUS_PREFERENCES],
      async () => {
        const existing = await this.deps.focusPreferences.findByUser(
          validatedOrgId,
          validatedActorId,
        );

        const nextPreference: FocusPreference = Object.freeze({
          id: existing?.id ?? asFocusPreferenceId(this.nextUuid()),
          organizationId: validatedOrgId,
          userId: validatedActorId,
          mode: parsed.mode ?? existing?.mode ?? FOCUS_MODES.AUTO,
          pinnedTaskIds: pinnedTaskIds ?? existing?.pinnedTaskIds ?? [],
          hiddenTaskIds: hiddenTaskIds ?? existing?.hiddenTaskIds ?? [],
          manualOrderTaskIds: manualOrderTaskIds ?? existing?.manualOrderTaskIds ?? [],
          updatedAt: now,
        });

        await this.deps.focusPreferences.save(nextPreference);
        return nextPreference;
      },
    );

    await this.deps.eventBus.publish(
      createDomainEvent({
        eventId: asEventId(this.nextUuid()),
        eventType: 'focus.preferences.updated',
        occurredAt: now,
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        correlationId,
        aggregateType: 'FocusPreference',
        aggregateId: updatedPreference.id,
        payload: {
          userId: validatedActorId,
          mode: updatedPreference.mode,
          pinnedCount: updatedPreference.pinnedTaskIds.length,
          hiddenCount: updatedPreference.hiddenTaskIds.length,
          manualOrderCount: updatedPreference.manualOrderTaskIds.length,
          reset: false,
        },
      }),
    );

    this.deps.logger?.info('Focus preferences updated', {
      organizationId: validatedOrgId,
      userId: validatedActorId,
      mode: updatedPreference.mode,
      correlationId,
    });

    return updatedPreference;
  }

  async resetFocusPreferences(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options?: FocusOperationOptions,
  ): Promise<FocusPreference> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options?.correlationId);

    const [org, actor, settings] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE,
      resource: {
        kind: 'FOCUS',
        id: asEntityId(validatedActorId),
        exists: org !== null,
        organizationId: validatedOrgId,
        ownerUserId: validatedActorId,
        ...(org?.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
      },
      context: { now, policyConfig },
    });

    const resetPreference = await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.FOCUS_PREFERENCES],
      async () => {
        const existing = await this.deps.focusPreferences.findByUser(
          validatedOrgId,
          validatedActorId,
        );

        const nextPreference: FocusPreference = Object.freeze({
          id: existing?.id ?? asFocusPreferenceId(this.nextUuid()),
          organizationId: validatedOrgId,
          userId: validatedActorId,
          mode: FOCUS_MODES.AUTO,
          pinnedTaskIds: [],
          hiddenTaskIds: [],
          manualOrderTaskIds: [],
          updatedAt: now,
        });

        await this.deps.focusPreferences.save(nextPreference);
        return nextPreference;
      },
    );

    await this.deps.eventBus.publish(
      createDomainEvent({
        eventId: asEventId(this.nextUuid()),
        eventType: 'focus.preferences.updated',
        occurredAt: now,
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        correlationId,
        aggregateType: 'FocusPreference',
        aggregateId: resetPreference.id,
        payload: {
          userId: validatedActorId,
          mode: resetPreference.mode,
          pinnedCount: 0,
          hiddenCount: 0,
          manualOrderCount: 0,
          reset: true,
        },
      }),
    );

    return resetPreference;
  }
}
