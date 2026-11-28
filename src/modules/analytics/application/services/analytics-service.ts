import { z } from 'zod';
import {
  PERMISSION_CODES,
  assertAuthorized,
  evaluateAuthorization,
  type AuthorizationActor,
  type AuthorizationPolicyConfig,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import { NotFoundError, ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asUserId,
  availableMetric,
  createDomainEvent,
  isUuid,
  parseIsoDateTimeMs,
  unavailableMetric,
  type CorrelationId,
  type DateRange,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type MetricValue,
  type OrganizationId,
  type ProjectId,
  type TaskId,
  type TaskStatus,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  ANALYTICS_PERIOD_PRESETS,
  DASHBOARD_SCOPES,
  asDashboardPreferenceId,
  calculateCohortCompletionRate,
  calculateCycleTimeMs,
  calculateLeadTimeMs,
  calculateThroughput,
  countPeriodCompletions,
  countUniqueCompletedTasks,
  resolveAnalyticsPeriodRange,
  resolveEquivalentPreviousPeriod,
  type AnalyticsPauseSnapshot,
  type AnalyticsPeriodPreset,
  type AnalyticsTaskCycleSnapshot,
  type AnalyticsTaskSnapshot,
  type DashboardPreference,
  type DashboardScope,
  type DashboardWidgetConfig,
} from '../../domain/analytics';
import {
  calculateAnalyticsWorkloadScore,
  type AnalyticsWorkloadSubtaskInput,
  type AnalyticsWorkloadTaskInput,
} from '../../domain/analytics-workload';
import type {
  AnalyticsBottleneckAlertItem,
  AnalyticsBottlenecksSummary,
  AnalyticsCalibrationSettingsView,
  AnalyticsCountBucket,
  AnalyticsFeedbackAssigneePerformance,
  AnalyticsFeedbackSummary,
  AnalyticsFeedbackVersionBucket,
  AnalyticsFlowMetricsSnapshot,
  AnalyticsFlowSummary,
  AnalyticsImpedimentsSummary,
  AnalyticsMemberWorkloadItem,
  AnalyticsOverview,
  AnalyticsWorkloadSummary,
  DashboardPreferenceResult,
  GetAnalyticsOverviewInput,
  GetDashboardPreferenceInput,
  ResetDashboardPreferenceInput,
  SaveDashboardPreferenceInput,
  UpdateCalibrationSettingsInput,
} from '../contracts';
import type {
  AnalyticsActorProfileSnapshot,
  AnalyticsCatalogVersionSnapshot,
  AnalyticsExecutionCycleSnapshot,
  AnalyticsFeedbackContestDecisionSnapshot,
  AnalyticsFeedbackContestSnapshot,
  AnalyticsFeedbackCycleSnapshot,
  AnalyticsFeedbackSnapshot,
  AnalyticsImpedimentSnapshot,
  AnalyticsProjectSnapshot,
  AnalyticsTaskPauseSnapshot,
  AnalyticsWorkContextPort,
  AnalyticsWorkTaskSnapshot,
} from '../ports/analytics-context.port';
import type {
  AnalyticsCalibratableWeightsSnapshot,
  AnalyticsGovernancePort,
  AnalyticsOrganizationSettingsSnapshot,
  AnalyticsSubtaskSnapshot,
} from '../ports/analytics-governance.port';
import type { DashboardPreferenceRepositoryPort } from '../ports/analytics-repository.port';

const scopeSchema = z.enum([
  DASHBOARD_SCOPES.PERSONAL,
  DASHBOARD_SCOPES.PROJECT,
  DASHBOARD_SCOPES.ORGANIZATION,
]);

const presetSchema = z.enum([
  ANALYTICS_PERIOD_PRESETS.LAST_7_DAYS,
  ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
  ANALYTICS_PERIOD_PRESETS.LAST_90_DAYS,
  ANALYTICS_PERIOD_PRESETS.CURRENT_YEAR,
  ANALYTICS_PERIOD_PRESETS.CUSTOM,
]);

const dateRangeSchema = z
  .object({
    start: z.string().min(1),
    end: z.string().min(1),
  })
  .strict();

const getOverviewSchema = z
  .object({
    scope: scopeSchema,
    projectId: z.string().uuid().optional(),
    preset: presetSchema.optional(),
    customRange: dateRangeSchema.optional(),
    compareWithPreviousPeriod: z.boolean().optional(),
  })
  .strict();

const widgetConfigSchema = z
  .object({
    widgetKey: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    order: z.number().int().min(0).max(200),
    filters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

const getDashboardPreferenceSchema = z
  .object({
    scope: scopeSchema,
    projectId: z.string().uuid().optional(),
  })
  .strict();

const saveDashboardPreferenceSchema = z
  .object({
    scope: scopeSchema,
    projectId: z.string().uuid().optional(),
    widgets: z.array(widgetConfigSchema).min(1).max(50),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const resetDashboardPreferenceSchema = z
  .object({
    scope: scopeSchema,
    projectId: z.string().uuid().optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const calibratableWeightsPatchSchema = z
  .object({
    workloadPriorityWeight: z.number().min(0).max(1).optional(),
    workloadDelayWeight: z.number().min(0).max(1).optional(),
    workloadImpedimentsWeight: z.number().min(0).max(1).optional(),
    workloadOperationalStateWeight: z.number().min(0).max(1).optional(),
    workloadPausedFactor: z.number().min(0).max(1).optional(),
    focusPriorityWeight: z.number().min(0).max(1).optional(),
    focusDeadlineWeight: z.number().min(0).max(1).optional(),
    focusDependenciesWeight: z.number().min(0).max(1).optional(),
    focusInactivityWeight: z.number().min(0).max(1).optional(),
    focusWorkloadCompatibilityWeight: z.number().min(0).max(1).optional(),
    defaultProjectInactivityThresholdDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

const updateCalibrationSchema = z
  .object({
    calibratableWeights: calibratableWeightsPatchSchema,
    justification: z.string().trim().max(500).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

const DEFAULT_WIDGETS_BY_SCOPE: Readonly<Record<DashboardScope, readonly DashboardWidgetConfig[]>> =
  Object.freeze({
    [DASHBOARD_SCOPES.PERSONAL]: Object.freeze([
      Object.freeze({ widgetKey: 'flow-kpis', visible: true, order: 0 }),
      Object.freeze({ widgetKey: 'my-workload', visible: true, order: 1 }),
      Object.freeze({ widgetKey: 'impediments-summary', visible: true, order: 2 }),
      Object.freeze({ widgetKey: 'feedback-summary', visible: true, order: 3 }),
    ]),
    [DASHBOARD_SCOPES.PROJECT]: Object.freeze([
      Object.freeze({ widgetKey: 'flow-kpis', visible: true, order: 0 }),
      Object.freeze({ widgetKey: 'task-status-breakdown', visible: true, order: 1 }),
      Object.freeze({ widgetKey: 'impediments-summary', visible: true, order: 2 }),
      Object.freeze({ widgetKey: 'bottlenecks-alerts', visible: true, order: 3 }),
      Object.freeze({ widgetKey: 'team-workload', visible: true, order: 4 }),
      Object.freeze({ widgetKey: 'feedback-summary', visible: true, order: 5 }),
    ]),
    [DASHBOARD_SCOPES.ORGANIZATION]: Object.freeze([
      Object.freeze({ widgetKey: 'flow-kpis', visible: true, order: 0 }),
      Object.freeze({ widgetKey: 'task-status-breakdown', visible: true, order: 1 }),
      Object.freeze({ widgetKey: 'impediments-summary', visible: true, order: 2 }),
      Object.freeze({ widgetKey: 'bottlenecks-alerts', visible: true, order: 3 }),
      Object.freeze({ widgetKey: 'team-workload', visible: true, order: 4 }),
      Object.freeze({ widgetKey: 'feedback-summary', visible: true, order: 5 }),
    ]),
  });

export interface AnalyticsServiceDependencies {
  readonly dashboardPreferences: DashboardPreferenceRepositoryPort;
  readonly workContext: AnalyticsWorkContextPort;
  readonly governance: AnalyticsGovernancePort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

interface ResolvedActorEvaluationContext {
  readonly actor: AuthorizationActor;
  readonly profile: AnalyticsActorProfileSnapshot | null;
  readonly settings: AnalyticsOrganizationSettingsSnapshot | null;
  readonly policyConfig: AuthorizationPolicyConfig | undefined;
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
  message: string,
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(message, {
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

function assertScopeProjectCoherence(scope: DashboardScope, projectId?: ProjectId): void {
  if (scope === DASHBOARD_SCOPES.PROJECT && projectId === undefined) {
    throw new ValidationError('Project-scoped analytics requires "projectId".', {
      details: { field: 'projectId', scope },
    });
  }
  if (scope !== DASHBOARD_SCOPES.PROJECT && projectId !== undefined) {
    throw new ValidationError(`Scope "${scope}" must not define "projectId".`, {
      details: { field: 'projectId', scope },
    });
  }
}

function isTimestampWithinRange(timestamp: IsoDateTime | undefined, range: DateRange): boolean {
  if (timestamp === undefined) {
    return false;
  }
  const ms = parseIsoDateTimeMs(timestamp);
  return ms >= parseIsoDateTimeMs(range.start) && ms <= parseIsoDateTimeMs(range.end);
}

function roundWeight(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toCountBuckets(counts: ReadonlyMap<string, number>): readonly AnalyticsCountBucket[] {
  return [...counts.entries()]
    .map(([key, count]) => Object.freeze({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function createEmptyTaskStatusCounts(): Record<TaskStatus, number> {
  return {
    [TASK_STATUSES.TODO]: 0,
    [TASK_STATUSES.IN_PROGRESS]: 0,
    [TASK_STATUSES.PAUSED]: 0,
    [TASK_STATUSES.BLOCKED]: 0,
    [TASK_STATUSES.DONE]: 0,
    [TASK_STATUSES.CANCELLED]: 0,
  };
}

function computeFlowMetrics(
  tasks: readonly AnalyticsTaskSnapshot[],
  cycles: readonly AnalyticsTaskCycleSnapshot[],
  pauses: readonly AnalyticsPauseSnapshot[],
  period: DateRange,
): AnalyticsFlowMetricsSnapshot {
  return Object.freeze({
    leadTimeMs: calculateLeadTimeMs(tasks, period),
    effectiveCycleTimeMs: calculateCycleTimeMs(cycles, pauses, period, 'EFFECTIVE'),
    totalCycleTimeMs: calculateCycleTimeMs(cycles, pauses, period, 'TOTAL'),
    throughput: calculateThroughput(cycles, period),
    uniqueCompletedTasks: countUniqueCompletedTasks(cycles, period),
    periodCompletions: countPeriodCompletions(cycles, period),
    cohortCompletionRate: calculateCohortCompletionRate(tasks, period, period.end),
  });
}

function isUserAssignedOrParticipatingInTask(
  task: AnalyticsWorkTaskSnapshot,
  userId: UserId,
): boolean {
  return (
    task.primaryAssigneeId === userId ||
    task.assigneeUserIds.includes(userId) ||
    (task.participantUserIds?.includes(userId) ?? false)
  );
}

function isThirdPartyOverloadAlert(
  alert: {
    readonly indicator: string;
    readonly targetEntityType: string;
    readonly targetEntityId: string;
  },
  actorUserId: UserId,
): boolean {
  return (
    alert.indicator === 'OVERLOAD' &&
    alert.targetEntityType === 'USER' &&
    alert.targetEntityId !== actorUserId
  );
}

export class AnalyticsService {
  private readonly deps: AnalyticsServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: AnalyticsServiceDependencies) {
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

  private async resolveActorContext(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<ResolvedActorEvaluationContext> {
    const [profile, settings, grants, explicitDenies] = await Promise.all([
      this.deps.workContext.getActorProfile(organizationId, actorUserId),
      this.deps.governance.getOrganizationSettings(organizationId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
    ]);

    const actor: AuthorizationActor = {
      isAuthenticated: true,
      userId: actorUserId,
      ...(profile !== null
        ? {
            organizationMembership: {
              organizationId: profile.organizationId,
              role: profile.role,
              status: profile.membershipStatus ?? MEMBERSHIP_STATUSES.ACTIVE,
            },
            managedProjectIds: profile.managedProjectIds,
            participatedProjectIds: profile.participatedProjectIds ?? [],
          }
        : {}),
      grants,
      explicitDenies,
    };

    return {
      actor,
      profile,
      settings,
      policyConfig: settings?.policyConfig,
    };
  }

  private authorizeScopeAccess(
    ctx: ResolvedActorEvaluationContext,
    organizationId: OrganizationId,
    scope: DashboardScope,
    project: AnalyticsProjectSnapshot | null,
    projectId: ProjectId | undefined,
    now: IsoDateTime,
  ): { readonly includesThirdPartyIndividualMetrics: boolean } {
    const orgExists = ctx.settings?.organizationExists ?? false;

    if (scope === DASHBOARD_SCOPES.PERSONAL) {
      assertAuthorized({
        actor: ctx.actor,
        action: PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW,
        resource: {
          kind: 'ANALYTICS',
          id: asEntityId(ctx.actor.userId ?? organizationId),
          exists: orgExists,
          organizationId,
          ...(ctx.actor.userId !== undefined ? { ownerUserId: ctx.actor.userId } : {}),
        },
        context: { now, policyConfig: ctx.policyConfig },
      });

      return { includesThirdPartyIndividualMetrics: false };
    }

    if (scope === DASHBOARD_SCOPES.ORGANIZATION) {
      assertAuthorized({
        actor: ctx.actor,
        action: PERMISSION_CODES.ANALYTICS_ORGANIZATION_VIEW,
        resource: {
          kind: 'ANALYTICS',
          id: asEntityId(organizationId),
          exists: orgExists,
          organizationId,
        },
        context: { now, policyConfig: ctx.policyConfig },
      });

      return {
        includesThirdPartyIndividualMetrics: ctx.profile?.role === ORGANIZATION_ROLES.ADMIN,
      };
    }

    // PROJECT scope
    const projectExists = orgExists && project !== null && !project.isDeleted;
    assertAuthorized({
      actor: ctx.actor,
      action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
      resource: {
        kind: 'ANALYTICS',
        id: asEntityId(projectId ?? organizationId),
        exists: projectExists,
        organizationId,
        ...(projectId !== undefined ? { projectId } : {}),
        ...(project?.teamId !== undefined ? { teamId: project.teamId } : {}),
        ...(project?.ownerUserId !== undefined ? { ownerUserId: project.ownerUserId } : {}),
        ...(project?.archivedAt !== undefined
          ? { archivedAt: project.archivedAt, projectArchivedAt: project.archivedAt }
          : {}),
        ...(project?.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
        includesThirdPartyIndividualMetrics: false,
      },
      context: { now, policyConfig: ctx.policyConfig },
    });

    if (project === null || projectId === undefined) {
      return { includesThirdPartyIndividualMetrics: false };
    }

    const thirdPartyDecision = evaluateAuthorization({
      actor: ctx.actor,
      action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
      resource: {
        kind: 'ANALYTICS',
        id: asEntityId(projectId),
        exists: projectExists,
        organizationId,
        projectId,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        ...(project.ownerUserId !== undefined ? { ownerUserId: project.ownerUserId } : {}),
        ...(project.archivedAt !== undefined
          ? { archivedAt: project.archivedAt, projectArchivedAt: project.archivedAt }
          : {}),
        ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
        includesThirdPartyIndividualMetrics: true,
      },
      context: { now, policyConfig: ctx.policyConfig },
    });

    const isRoleAllowed =
      ctx.profile?.role === ORGANIZATION_ROLES.ADMIN ||
      (ctx.profile?.role === ORGANIZATION_ROLES.MANAGER &&
        ctx.profile.managedProjectIds.includes(projectId) &&
        ctx.settings?.allowManagerViewIndividualProductivity === true);

    return {
      includesThirdPartyIndividualMetrics: thirdPartyDecision.allowed && isRoleAllowed,
    };
  }

  private canViewTask(
    ctx: ResolvedActorEvaluationContext,
    organizationId: OrganizationId,
    task: AnalyticsWorkTaskSnapshot,
    project: AnalyticsProjectSnapshot | undefined,
    now: IsoDateTime,
  ): boolean {
    if (task.isDeleted || task.deletedAt !== undefined) {
      return false;
    }
    if (!project || project.isDeleted || project.deletedAt !== undefined) {
      return false;
    }

    const decision = evaluateAuthorization({
      actor: ctx.actor,
      action: PERMISSION_CODES.TASK_VIEW,
      resource: {
        kind: 'TASK',
        id: asEntityId(task.taskId),
        exists: true,
        organizationId,
        projectId: task.projectId,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        ...(project.ownerUserId !== undefined ? { ownerUserId: project.ownerUserId } : {}),
        ...(project.archivedAt !== undefined ? { projectArchivedAt: project.archivedAt } : {}),
        taskId: task.taskId,
        ...(task.createdByUserId !== undefined ? { createdBy: task.createdByUserId } : {}),
        ...(task.primaryAssigneeId !== undefined
          ? { assigneeId: task.primaryAssigneeId }
          : task.assigneeUserIds[0] !== undefined
            ? { assigneeId: task.assigneeUserIds[0] }
            : {}),
        participantIds: task.participantUserIds ?? task.assigneeUserIds,
      },
      context: { now, policyConfig: ctx.policyConfig },
    });

    return decision.allowed;
  }

  private canViewFeedback(
    ctx: ResolvedActorEvaluationContext,
    organizationId: OrganizationId,
    feedback: AnalyticsFeedbackSnapshot,
    now: IsoDateTime,
  ): boolean {
    const decision = evaluateAuthorization({
      actor: ctx.actor,
      action: PERMISSION_CODES.FEEDBACK_VIEW,
      resource: {
        kind: 'FEEDBACK',
        id: asEntityId(feedback.feedbackId),
        exists: true,
        organizationId,
        createdBy: feedback.authorUserId,
        ...(feedback.assigneeUserId !== undefined ? { assigneeId: feedback.assigneeUserId } : {}),
      },
      context: { now, policyConfig: ctx.policyConfig },
    });

    return decision.allowed;
  }

  async getAnalyticsOverview(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: GetAnalyticsOverviewInput,
  ): Promise<AnalyticsOverview> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(getOverviewSchema, input, 'Invalid analytics overview query.');
    const requestedProjectId =
      parsed.projectId !== undefined ? asProjectId(parsed.projectId, 'projectId') : undefined;
    assertScopeProjectCoherence(parsed.scope, requestedProjectId);

    const now = this.now();
    const preset: AnalyticsPeriodPreset = parsed.preset ?? ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS;
    const customRange: DateRange | undefined = parsed.customRange
      ? {
          start: asIsoDateTime(parsed.customRange.start, 'customRange.start'),
          end: asIsoDateTime(parsed.customRange.end, 'customRange.end'),
        }
      : undefined;
    const period = resolveAnalyticsPeriodRange(preset, now, customRange);
    const compareWithPreviousPeriod = parsed.compareWithPreviousPeriod ?? true;
    const previousPeriod = compareWithPreviousPeriod
      ? resolveEquivalentPreviousPeriod(period)
      : undefined;

    const ctx = await this.resolveActorContext(validatedActorId, validatedOrgId, now);
    const projects = await this.deps.workContext.listProjects(validatedOrgId);
    const projectsById = new Map<ProjectId, AnalyticsProjectSnapshot>(
      projects.map((project) => [project.projectId, project]),
    );
    const targetProject =
      requestedProjectId !== undefined ? (projectsById.get(requestedProjectId) ?? null) : null;

    const { includesThirdPartyIndividualMetrics } = this.authorizeScopeAccess(
      ctx,
      validatedOrgId,
      parsed.scope,
      targetProject,
      requestedProjectId,
      now,
    );

    const [
      allTasks,
      allCycles,
      allPauses,
      allImpediments,
      allFeedbacks,
      allFeedbackCycles,
      allFeedbackContests,
      allFeedbackDecisions,
      categoryVersions,
      contestReasonVersions,
      allBottleneckAlerts,
      allSubtasks,
    ] = await Promise.all([
      this.deps.workContext.listTasks(validatedOrgId),
      this.deps.workContext.listExecutionCycles(validatedOrgId),
      this.deps.workContext.listTaskPauses(validatedOrgId),
      this.deps.workContext.listImpediments(validatedOrgId),
      this.deps.workContext.listFeedbacks(validatedOrgId),
      this.deps.workContext.listFeedbackCycles(validatedOrgId),
      this.deps.workContext.listFeedbackContests(validatedOrgId),
      this.deps.workContext.listFeedbackContestDecisions(validatedOrgId),
      this.deps.workContext.listFeedbackCategoryVersions(validatedOrgId),
      this.deps.workContext.listFeedbackContestReasonVersions(validatedOrgId),
      this.deps.governance.listBottleneckAlerts(validatedOrgId),
      this.deps.governance.listSubtasks(validatedOrgId),
    ]);

    // Item-by-item TASK_VIEW authorization BEFORE any aggregation
    const visibleTasks = allTasks.filter((task) => {
      if (parsed.scope === DASHBOARD_SCOPES.PROJECT && task.projectId !== requestedProjectId) {
        return false;
      }
      if (!this.canViewTask(ctx, validatedOrgId, task, projectsById.get(task.projectId), now)) {
        return false;
      }
      if (
        parsed.scope === DASHBOARD_SCOPES.PERSONAL &&
        !isUserAssignedOrParticipatingInTask(task, validatedActorId)
      ) {
        return false;
      }
      return true;
    });

    const visibleTaskIds = new Set<TaskId>(visibleTasks.map((task) => task.taskId));
    const visibleCycles = allCycles.filter((cycle) => visibleTaskIds.has(cycle.taskId));
    const visibleCycleIds = new Set<string>(visibleCycles.map((cycle) => cycle.cycleId));
    const visiblePauses = allPauses.filter(
      (pause) => visibleTaskIds.has(pause.taskId) && visibleCycleIds.has(pause.cycleId),
    );
    const visibleImpediments = allImpediments.filter((imp) => visibleTaskIds.has(imp.taskId));
    const visibleSubtasks = allSubtasks.filter(
      (subtask) =>
        visibleTaskIds.has(subtask.taskId) &&
        subtask.parentTaskDeletedAt === undefined &&
        (parsed.scope !== DASHBOARD_SCOPES.PERSONAL || subtask.assigneeId === validatedActorId),
    );

    // 1. Flow & delivery metrics
    const flow = this.buildFlowSummary(
      visibleTasks,
      visibleCycles,
      visiblePauses,
      period,
      previousPeriod,
    );

    // 2. Impediments summary
    const impediments = this.buildImpedimentsSummary(visibleImpediments, period);

    // 3. Workload & Bottlenecks (guarded for third-party individual privacy)
    const userIdsToResolve = new Set<UserId>([validatedActorId]);
    if (includesThirdPartyIndividualMetrics) {
      if (targetProject) {
        for (const uid of targetProject.memberUserIds) {
          userIdsToResolve.add(uid);
        }
      } else if (parsed.scope === DASHBOARD_SCOPES.ORGANIZATION) {
        for (const project of projects) {
          if (!project.isDeleted) {
            for (const uid of project.memberUserIds) {
              userIdsToResolve.add(uid);
            }
          }
        }
      }
      for (const task of visibleTasks) {
        for (const uid of task.assigneeUserIds) {
          userIdsToResolve.add(uid);
        }
      }
      for (const subtask of visibleSubtasks) {
        if (subtask.assigneeId !== undefined) {
          userIdsToResolve.add(subtask.assigneeId);
        }
      }
      for (const fb of allFeedbacks) {
        if (fb.assigneeUserId !== undefined) {
          userIdsToResolve.add(fb.assigneeUserId);
        }
      }
    }

    const userDisplayNames = await this.deps.governance.listUserDisplayNames(validatedOrgId, [
      ...userIdsToResolve,
    ]);

    const workload = this.buildWorkloadSummary({
      actorUserId: validatedActorId,
      scope: parsed.scope,
      includesThirdPartyIndividualMetrics,
      visibleTasks,
      visibleSubtasks,
      targetProject,
      projects,
      calibratableWeights: ctx.settings?.calibratableWeights,
      userDisplayNames,
      now,
    });

    const bottlenecks = this.buildBottlenecksSummary({
      actorUserId: validatedActorId,
      scope: parsed.scope,
      projectId: requestedProjectId,
      includesThirdPartyIndividualMetrics,
      alerts: allBottleneckAlerts,
      projectsById,
      visibleProjectOverloadedCount: workload.overloadedMemberCount,
    });

    // 4. Historical Feedback Analytics (item-by-item FEEDBACK_VIEW, zero internal notes)
    const visibleFeedbacks = allFeedbacks.filter((fb) => {
      if (parsed.scope === DASHBOARD_SCOPES.PROJECT && fb.projectId !== requestedProjectId) {
        return false;
      }
      if (!this.canViewFeedback(ctx, validatedOrgId, fb, now)) {
        return false;
      }
      if (
        parsed.scope === DASHBOARD_SCOPES.PERSONAL &&
        fb.authorUserId !== validatedActorId &&
        fb.assigneeUserId !== validatedActorId
      ) {
        return false;
      }
      return true;
    });

    const feedback = this.buildFeedbackSummary({
      actorUserId: validatedActorId,
      includesThirdPartyIndividualMetrics,
      visibleFeedbacks,
      allFeedbackCycles,
      allFeedbackContests,
      allFeedbackDecisions,
      categoryVersions,
      contestReasonVersions,
      userDisplayNames,
      period,
    });

    return Object.freeze({
      organizationId: validatedOrgId,
      scope: parsed.scope,
      ...(requestedProjectId !== undefined ? { projectId: requestedProjectId } : {}),
      isDemoOrganization: ctx.profile?.isDemoOrganization ?? false,
      preset,
      period,
      ...(previousPeriod !== undefined ? { previousPeriod } : {}),
      includesThirdPartyIndividualMetrics,
      generatedAt: now,
      flow,
      impediments,
      workload,
      bottlenecks,
      feedback,
    });
  }

  private buildFlowSummary(
    visibleTasks: readonly AnalyticsWorkTaskSnapshot[],
    visibleCycles: readonly AnalyticsExecutionCycleSnapshot[],
    visiblePauses: readonly AnalyticsTaskPauseSnapshot[],
    period: DateRange,
    previousPeriod?: DateRange,
  ): AnalyticsFlowSummary {
    const taskSnapshots: AnalyticsTaskSnapshot[] = visibleTasks.map((task) => ({
      taskId: task.taskId,
      projectId: task.projectId,
      status: task.status,
      createdAt: task.createdAt,
      ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
    }));

    const cycleSnapshots: AnalyticsTaskCycleSnapshot[] = visibleCycles.map((cycle) => ({
      cycleId: cycle.cycleId,
      taskId: cycle.taskId,
      startedAt: cycle.startedAt,
      ...(cycle.effectiveStartedAt !== undefined
        ? { effectiveStartedAt: cycle.effectiveStartedAt }
        : {}),
      ...(cycle.completedAt !== undefined ? { completedAt: cycle.completedAt } : {}),
    }));

    const pauseSnapshots: AnalyticsPauseSnapshot[] = visiblePauses.map((pause) => ({
      cycleId: pause.cycleId,
      startedAt: pause.startedAt,
      ...(pause.endedAt !== undefined ? { endedAt: pause.endedAt } : {}),
    }));

    const countsByStatus = createEmptyTaskStatusCounts();
    for (const task of visibleTasks) {
      countsByStatus[task.status] += 1;
    }

    const currentMetrics = computeFlowMetrics(
      taskSnapshots,
      cycleSnapshots,
      pauseSnapshots,
      period,
    );
    const previousMetrics = previousPeriod
      ? computeFlowMetrics(taskSnapshots, cycleSnapshots, pauseSnapshots, previousPeriod)
      : undefined;

    return Object.freeze({
      ...currentMetrics,
      totalVisibleTasks: visibleTasks.length,
      countsByStatus: Object.freeze(countsByStatus),
      ...(previousMetrics !== undefined ? { previousPeriod: previousMetrics } : {}),
    });
  }

  private buildImpedimentsSummary(
    visibleImpediments: readonly AnalyticsImpedimentSnapshot[],
    period: DateRange,
  ): AnalyticsImpedimentsSummary {
    const byCategory = new Map<string, number>();
    const bySeverity = new Map<string, number>([
      [IMPEDIMENT_SEVERITIES.LOW, 0],
      [IMPEDIMENT_SEVERITIES.MEDIUM, 0],
      [IMPEDIMENT_SEVERITIES.HIGH, 0],
      [IMPEDIMENT_SEVERITIES.CRITICAL, 0],
    ]);

    let totalInPeriod = 0;
    let openCount = 0;
    let resolvedInPeriod = 0;
    const resolutionDurations: number[] = [];

    for (const imp of visibleImpediments) {
      const isOpen = imp.status === 'OPEN' || imp.status === 'IN_RESOLUTION';
      if (isOpen) {
        openCount += 1;
      }

      const openedInPeriod = isTimestampWithinRange(imp.openedAt, period);
      if (openedInPeriod) {
        totalInPeriod += 1;
        byCategory.set(imp.category, (byCategory.get(imp.category) ?? 0) + 1);
        bySeverity.set(imp.severity, (bySeverity.get(imp.severity) ?? 0) + 1);
      }

      if (imp.resolvedAt !== undefined && isTimestampWithinRange(imp.resolvedAt, period)) {
        resolvedInPeriod += 1;
        const duration = parseIsoDateTimeMs(imp.resolvedAt) - parseIsoDateTimeMs(imp.openedAt);
        if (duration >= 0) {
          resolutionDurations.push(duration);
        }
      }
    }

    const averageResolutionMs: MetricValue<number> =
      resolutionDurations.length > 0
        ? availableMetric(
            Math.round(
              resolutionDurations.reduce((sum, val) => sum + val, 0) / resolutionDurations.length,
            ),
          )
        : unavailableMetric('INSUFFICIENT_DATA');

    return Object.freeze({
      totalInPeriod,
      openCount,
      resolvedInPeriod,
      averageResolutionMs,
      byCategory: toCountBuckets(byCategory),
      bySeverity: toCountBuckets(bySeverity),
    });
  }

  private buildWorkloadSummary(params: {
    readonly actorUserId: UserId;
    readonly scope: DashboardScope;
    readonly includesThirdPartyIndividualMetrics: boolean;
    readonly visibleTasks: readonly AnalyticsWorkTaskSnapshot[];
    readonly visibleSubtasks: readonly AnalyticsSubtaskSnapshot[];
    readonly targetProject: AnalyticsProjectSnapshot | null;
    readonly projects: readonly AnalyticsProjectSnapshot[];
    readonly calibratableWeights?: AnalyticsCalibratableWeightsSnapshot;
    readonly userDisplayNames: ReadonlyMap<UserId, string>;
    readonly now: IsoDateTime;
  }): AnalyticsWorkloadSummary {
    const options = params.calibratableWeights
      ? {
          weights: {
            priority: params.calibratableWeights.workloadPriorityWeight,
            delay: params.calibratableWeights.workloadDelayWeight,
            impediments: params.calibratableWeights.workloadImpedimentsWeight,
            operationalState: params.calibratableWeights.workloadOperationalStateWeight,
          },
          pausedFactor: params.calibratableWeights.workloadPausedFactor,
        }
      : undefined;

    const computeUserWorkload = (userId: UserId): AnalyticsMemberWorkloadItem => {
      const userTasks: AnalyticsWorkloadTaskInput[] = params.visibleTasks
        .filter((task) => isUserAssignedOrParticipatingInTask(task, userId))
        .map((task) => {
          const participants = new Set<UserId>(task.participantUserIds ?? task.assigneeUserIds);
          if (task.primaryAssigneeId !== undefined) {
            participants.add(task.primaryAssigneeId);
          }
          return {
            taskId: task.taskId,
            status: task.status,
            priority: task.priority,
            ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
            participantCount: Math.max(1, participants.size),
            ...(task.openImpedimentsMaxSeverity !== undefined
              ? { openImpedimentsMaxSeverity: task.openImpedimentsMaxSeverity }
              : {}),
          };
        });

      const userSubtasks: AnalyticsWorkloadSubtaskInput[] = params.visibleSubtasks
        .filter((subtask) => subtask.assigneeId === userId && subtask.status === 'OPEN')
        .map((subtask) => ({
          subtaskId: subtask.subtaskId,
          status: subtask.status,
          priority: subtask.priority,
          ...(subtask.dueDate !== undefined ? { dueDate: subtask.dueDate } : {}),
        }));

      const result = calculateAnalyticsWorkloadScore(userTasks, userSubtasks, params.now, options);
      return Object.freeze({
        userId,
        displayName: params.userDisplayNames.get(userId) ?? userId,
        score: result.score,
        level: result.level,
        activeTaskCount: result.activeTaskCount,
        activeSubtaskCount: result.activeSubtaskCount,
        representsHours: false,
      });
    };

    const myWorkload = computeUserWorkload(params.actorUserId);

    const candidateUserIds = new Set<UserId>();
    if (params.targetProject) {
      for (const uid of params.targetProject.memberUserIds) {
        candidateUserIds.add(uid);
      }
    } else if (params.scope === DASHBOARD_SCOPES.ORGANIZATION) {
      for (const project of params.projects) {
        if (!project.isDeleted) {
          for (const uid of project.memberUserIds) {
            candidateUserIds.add(uid);
          }
        }
      }
    }
    for (const task of params.visibleTasks) {
      for (const uid of task.assigneeUserIds) {
        candidateUserIds.add(uid);
      }
    }

    const allTeamWorkloads = [...candidateUserIds]
      .sort((a, b) => a.localeCompare(b))
      .map((uid) => computeUserWorkload(uid));

    const overloadedMemberCount = allTeamWorkloads.filter(
      (item) =>
        item.level === BOTTLENECK_SEVERITIES.HIGH || item.level === BOTTLENECK_SEVERITIES.CRITICAL,
    ).length;

    const exposedMemberWorkloads: readonly AnalyticsMemberWorkloadItem[] =
      params.includesThirdPartyIndividualMetrics
        ? allTeamWorkloads
        : params.scope === DASHBOARD_SCOPES.PERSONAL
          ? [myWorkload]
          : [];

    let averageTeamWorkloadScore: MetricValue<number>;
    if (params.scope === DASHBOARD_SCOPES.PERSONAL || allTeamWorkloads.length === 0) {
      averageTeamWorkloadScore = unavailableMetric(
        params.scope === DASHBOARD_SCOPES.PERSONAL ? 'UNAUTHORIZED' : 'INSUFFICIENT_DATA',
      );
    } else {
      const avg = Math.round(
        allTeamWorkloads.reduce((acc, item) => acc + item.score, 0) / allTeamWorkloads.length,
      );
      averageTeamWorkloadScore = availableMetric(avg);
    }

    return Object.freeze({
      myWorkload,
      memberWorkloads: Object.freeze(exposedMemberWorkloads),
      averageTeamWorkloadScore,
      overloadedMemberCount,
      representsHours: false,
    });
  }

  private buildBottlenecksSummary(params: {
    readonly actorUserId: UserId;
    readonly scope: DashboardScope;
    readonly projectId?: ProjectId;
    readonly includesThirdPartyIndividualMetrics: boolean;
    readonly alerts: readonly {
      readonly alertId: string;
      readonly projectId?: ProjectId;
      readonly indicator: string;
      readonly severity: AnalyticsBottleneckAlertItem['severity'];
      readonly status: string;
      readonly targetEntityType: string;
      readonly targetEntityId: string;
      readonly summary: string;
      readonly detectedAt: IsoDateTime;
      readonly lastSeenAt: IsoDateTime;
      readonly resolvedAt?: IsoDateTime;
    }[];
    readonly projectsById: ReadonlyMap<ProjectId, AnalyticsProjectSnapshot>;
    readonly visibleProjectOverloadedCount: number;
  }): AnalyticsBottlenecksSummary {
    const scopedAlerts = params.alerts.filter((alert) => {
      if (alert.projectId !== undefined) {
        const project = params.projectsById.get(alert.projectId);
        if (!project || project.isDeleted || project.deletedAt !== undefined) {
          return false;
        }
      }
      if (params.scope === DASHBOARD_SCOPES.PROJECT) {
        return alert.projectId === params.projectId;
      }
      if (params.scope === DASHBOARD_SCOPES.PERSONAL) {
        return alert.targetEntityType === 'USER' && alert.targetEntityId === params.actorUserId;
      }
      return true;
    });

    const sanitizedAlerts: AnalyticsBottleneckAlertItem[] = [];
    let alertOverloadedUsers = 0;
    const byIndicator = new Map<string, number>();
    const bySeverity = new Map<string, number>();

    for (const alert of scopedAlerts) {
      if (alert.status !== 'RESOLVED') {
        byIndicator.set(alert.indicator, (byIndicator.get(alert.indicator) ?? 0) + 1);
        bySeverity.set(alert.severity, (bySeverity.get(alert.severity) ?? 0) + 1);
        if (alert.indicator === 'OVERLOAD' && alert.targetEntityType === 'USER') {
          alertOverloadedUsers += 1;
        }
      }

      if (
        !params.includesThirdPartyIndividualMetrics &&
        isThirdPartyOverloadAlert(alert, params.actorUserId)
      ) {
        continue;
      }

      sanitizedAlerts.push(Object.freeze({ ...alert }));
    }

    const totalActiveAlerts = scopedAlerts.filter((alert) => alert.status !== 'RESOLVED').length;

    return Object.freeze({
      alerts: Object.freeze(sanitizedAlerts),
      totalActiveAlerts,
      overloadedMemberCount: Math.max(alertOverloadedUsers, params.visibleProjectOverloadedCount),
      byIndicator: toCountBuckets(byIndicator),
      bySeverity: toCountBuckets(bySeverity),
    });
  }

  private buildFeedbackSummary(params: {
    readonly actorUserId: UserId;
    readonly includesThirdPartyIndividualMetrics: boolean;
    readonly visibleFeedbacks: readonly AnalyticsFeedbackSnapshot[];
    readonly allFeedbackCycles: readonly AnalyticsFeedbackCycleSnapshot[];
    readonly allFeedbackContests: readonly AnalyticsFeedbackContestSnapshot[];
    readonly allFeedbackDecisions: readonly AnalyticsFeedbackContestDecisionSnapshot[];
    readonly categoryVersions: readonly AnalyticsCatalogVersionSnapshot[];
    readonly contestReasonVersions: readonly AnalyticsCatalogVersionSnapshot[];
    readonly userDisplayNames: ReadonlyMap<UserId, string>;
    readonly period: DateRange;
  }): AnalyticsFeedbackSummary {
    const visibleFeedbackIds = new Set(params.visibleFeedbacks.map((fb) => fb.feedbackId));
    const categoryVersionMap = new Map(
      params.categoryVersions.map((version) => [version.versionId, version]),
    );
    const contestReasonVersionMap = new Map(
      params.contestReasonVersions.map((version) => [version.versionId, version]),
    );

    const feedbacksInPeriod = params.visibleFeedbacks.filter((fb) =>
      isTimestampWithinRange(fb.createdAt, params.period),
    );

    const resolvedInPeriod = params.visibleFeedbacks.filter(
      (fb) =>
        isTimestampWithinRange(fb.resolvedAt, params.period) ||
        isTimestampWithinRange(fb.closedAt, params.period),
    ).length;

    const resolutionRate: MetricValue<number> =
      feedbacksInPeriod.length > 0
        ? availableMetric(
            Math.round(
              (feedbacksInPeriod.filter(
                (fb) =>
                  fb.resolvedAt !== undefined || fb.status === 'RESOLVED' || fb.status === 'CLOSED',
              ).length /
                feedbacksInPeriod.length) *
                10_000,
            ) / 10_000,
          )
        : unavailableMetric('ZERO_DENOMINATOR');

    // Category versioned distribution (preserves historical versionId!)
    const categoryCounts = new Map<string, number>();
    const firstResponseDurations: number[] = [];
    const resolutionDurations: number[] = [];

    for (const fb of feedbacksInPeriod) {
      categoryCounts.set(fb.categoryVersionId, (categoryCounts.get(fb.categoryVersionId) ?? 0) + 1);
      if (fb.firstResponseAt !== undefined) {
        const diff = parseIsoDateTimeMs(fb.firstResponseAt) - parseIsoDateTimeMs(fb.createdAt);
        if (diff >= 0) {
          firstResponseDurations.push(diff);
        }
      }
      if (fb.resolvedAt !== undefined) {
        const diff = parseIsoDateTimeMs(fb.resolvedAt) - parseIsoDateTimeMs(fb.createdAt);
        if (diff >= 0) {
          resolutionDurations.push(diff);
        }
      }
    }

    const byCategoryVersion: AnalyticsFeedbackVersionBucket[] = [...categoryCounts.entries()]
      .map(([versionId, count]) => {
        const version = categoryVersionMap.get(versionId);
        return Object.freeze({
          versionId,
          entryId: version?.entryId ?? versionId,
          code: version?.code ?? versionId,
          name: version?.name ?? versionId,
          versionNumber: version?.versionNumber ?? 1,
          count,
        });
      })
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

    // Cycles in period & SLA
    const visibleCycles = params.allFeedbackCycles.filter(
      (cycle) =>
        visibleFeedbackIds.has(cycle.feedbackId) &&
        isTimestampWithinRange(cycle.openedAt, params.period),
    );
    const cyclesByOriginMap = new Map<string, number>([
      ['INITIAL', 0],
      ['CONTESTATION_REOPEN', 0],
      ['EXCEPTIONAL_REOPEN', 0],
    ]);

    let onTrackCount = 0;
    let warningCount = 0;
    let breachedCount = 0;
    let reopeningsInPeriod = 0;

    for (const cycle of visibleCycles) {
      cyclesByOriginMap.set(cycle.origin, (cyclesByOriginMap.get(cycle.origin) ?? 0) + 1);
      if (cycle.origin === 'CONTESTATION_REOPEN' || cycle.origin === 'EXCEPTIONAL_REOPEN') {
        reopeningsInPeriod += 1;
      }

      const state =
        cycle.slaState ??
        (cycle.firstResponseBreachedAt !== undefined || cycle.resolutionBreachedAt !== undefined
          ? 'BREACHED'
          : cycle.firstResponseWarningAt !== undefined || cycle.resolutionWarningAt !== undefined
            ? 'WARNING'
            : 'ON_TRACK');

      if (state === 'BREACHED') {
        breachedCount += 1;
      } else if (state === 'WARNING') {
        warningCount += 1;
      } else {
        onTrackCount += 1;
      }
    }

    const totalSlaCycles = onTrackCount + warningCount + breachedCount;
    const complianceRate: MetricValue<number> =
      totalSlaCycles > 0
        ? availableMetric(
            Math.round(((onTrackCount + warningCount) / totalSlaCycles) * 10_000) / 10_000,
          )
        : unavailableMetric('ZERO_DENOMINATOR');

    // Contests & decisions
    const visibleContests = params.allFeedbackContests.filter(
      (contest) =>
        visibleFeedbackIds.has(contest.feedbackId) &&
        isTimestampWithinRange(contest.openedAt, params.period),
    );
    const contestReasonCounts = new Map<string, number>();
    for (const contest of visibleContests) {
      contestReasonCounts.set(
        contest.reasonVersionId,
        (contestReasonCounts.get(contest.reasonVersionId) ?? 0) + 1,
      );
    }

    const byContestReasonVersion: AnalyticsFeedbackVersionBucket[] = [
      ...contestReasonCounts.entries(),
    ]
      .map(([versionId, count]) => {
        const version = contestReasonVersionMap.get(versionId);
        return Object.freeze({
          versionId,
          entryId: version?.entryId ?? versionId,
          code: version?.code ?? versionId,
          name: version?.name ?? versionId,
          versionNumber: version?.versionNumber ?? 1,
          count,
        });
      })
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

    const decisionByContestId = new Map<string, AnalyticsFeedbackContestDecisionSnapshot>();
    for (const decision of params.allFeedbackDecisions) {
      decisionByContestId.set(decision.contestId, decision);
    }
    const outcomeCounts = new Map<string, number>();
    for (const contest of visibleContests) {
      const outcome = decisionByContestId.get(contest.contestId)?.decision ?? 'PENDING';
      outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
    }

    // Assignee performance (guarded by third-party individual metrics privacy)
    const breachedFeedbackIds = new Set(
      params.allFeedbackCycles
        .filter(
          (cycle) =>
            visibleFeedbackIds.has(cycle.feedbackId) &&
            (cycle.slaState === 'BREACHED' ||
              cycle.firstResponseBreachedAt !== undefined ||
              cycle.resolutionBreachedAt !== undefined),
        )
        .map((cycle) => cycle.feedbackId),
    );

    const assigneeStats = new Map<
      UserId,
      {
        assignedCount: number;
        resolvedCount: number;
        breachedCount: number;
        resolutionDurations: number[];
      }
    >();

    for (const fb of feedbacksInPeriod) {
      if (fb.assigneeUserId === undefined) {
        continue;
      }
      if (!params.includesThirdPartyIndividualMetrics && fb.assigneeUserId !== params.actorUserId) {
        continue;
      }
      const existing = assigneeStats.get(fb.assigneeUserId) ?? {
        assignedCount: 0,
        resolvedCount: 0,
        breachedCount: 0,
        resolutionDurations: [],
      };
      existing.assignedCount += 1;
      if (fb.resolvedAt !== undefined || fb.status === 'RESOLVED' || fb.status === 'CLOSED') {
        existing.resolvedCount += 1;
      }
      if (breachedFeedbackIds.has(fb.feedbackId)) {
        existing.breachedCount += 1;
      }
      if (fb.resolvedAt !== undefined) {
        const diff = parseIsoDateTimeMs(fb.resolvedAt) - parseIsoDateTimeMs(fb.createdAt);
        if (diff >= 0) {
          existing.resolutionDurations.push(diff);
        }
      }
      assigneeStats.set(fb.assigneeUserId, existing);
    }

    const assigneePerformance: AnalyticsFeedbackAssigneePerformance[] =
      params.includesThirdPartyIndividualMetrics
        ? [...assigneeStats.entries()]
            .map(([assigneeUserId, stats]) =>
              Object.freeze({
                assigneeUserId,
                displayName: params.userDisplayNames.get(assigneeUserId) ?? assigneeUserId,
                assignedCount: stats.assignedCount,
                resolvedCount: stats.resolvedCount,
                breachedCount: stats.breachedCount,
                averageResolutionMs:
                  stats.resolutionDurations.length > 0
                    ? availableMetric(
                        Math.round(
                          stats.resolutionDurations.reduce((sum, val) => sum + val, 0) /
                            stats.resolutionDurations.length,
                        ),
                      )
                    : unavailableMetric('INSUFFICIENT_DATA'),
              }),
            )
            .sort(
              (a, b) =>
                b.assignedCount - a.assignedCount || a.displayName.localeCompare(b.displayName),
            )
        : [];

    return Object.freeze({
      totalInPeriod: feedbacksInPeriod.length,
      resolvedInPeriod,
      resolutionRate,
      slaSummary: Object.freeze({
        onTrackCount,
        warningCount,
        breachedCount,
        complianceRate,
      }),
      contestsInPeriod: visibleContests.length,
      contestOutcomes: toCountBuckets(outcomeCounts),
      reopeningsInPeriod,
      cyclesByOrigin: toCountBuckets(cyclesByOriginMap),
      byCategoryVersion: Object.freeze(byCategoryVersion),
      byContestReasonVersion: Object.freeze(byContestReasonVersion),
      averageFirstResponseMs:
        firstResponseDurations.length > 0
          ? availableMetric(
              Math.round(
                firstResponseDurations.reduce((sum, val) => sum + val, 0) /
                  firstResponseDurations.length,
              ),
            )
          : unavailableMetric('INSUFFICIENT_DATA'),
      averageResolutionMs:
        resolutionDurations.length > 0
          ? availableMetric(
              Math.round(
                resolutionDurations.reduce((sum, val) => sum + val, 0) / resolutionDurations.length,
              ),
            )
          : unavailableMetric('INSUFFICIENT_DATA'),
      assigneePerformance: Object.freeze(assigneePerformance),
    });
  }

  async getDashboardPreference(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: GetDashboardPreferenceInput,
  ): Promise<DashboardPreferenceResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      getDashboardPreferenceSchema,
      input,
      'Invalid dashboard preference query.',
    );
    const projectId =
      parsed.projectId !== undefined ? asProjectId(parsed.projectId, 'projectId') : undefined;
    assertScopeProjectCoherence(parsed.scope, projectId);

    const now = this.now();
    const ctx = await this.resolveActorContext(validatedActorId, validatedOrgId, now);
    const targetProject =
      projectId !== undefined
        ? ((await this.deps.workContext.listProjects(validatedOrgId)).find(
            (project) => project.projectId === projectId,
          ) ?? null)
        : null;

    this.authorizeScopeAccess(ctx, validatedOrgId, parsed.scope, targetProject, projectId, now);

    const existing = await this.deps.dashboardPreferences.findByUserAndScope(
      validatedOrgId,
      validatedActorId,
      parsed.scope,
      projectId,
    );

    const isDemoIsolated = ctx.profile?.isDemoOrganization ?? false;
    if (existing !== null && existing.isDemoIsolated === isDemoIsolated) {
      return Object.freeze({
        preference: existing,
        isDefault: false,
      });
    }

    const defaultPreference: DashboardPreference = Object.freeze({
      id: existing?.id ?? asDashboardPreferenceId(this.nextUuid()),
      organizationId: validatedOrgId,
      userId: validatedActorId,
      scope: parsed.scope,
      ...(projectId !== undefined ? { projectId } : {}),
      widgets: DEFAULT_WIDGETS_BY_SCOPE[parsed.scope],
      isDemoIsolated,
      updatedAt: existing?.updatedAt ?? now,
    });

    return Object.freeze({
      preference: defaultPreference,
      isDefault: true,
    });
  }

  async saveDashboardPreference(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: SaveDashboardPreferenceInput,
  ): Promise<DashboardPreference> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      saveDashboardPreferenceSchema,
      input,
      'Invalid dashboard preference payload.',
    );
    const projectId =
      parsed.projectId !== undefined ? asProjectId(parsed.projectId, 'projectId') : undefined;
    assertScopeProjectCoherence(parsed.scope, projectId);

    const seenKeys = new Set<string>();
    for (const widget of parsed.widgets) {
      if (seenKeys.has(widget.widgetKey)) {
        throw new ValidationError(`Duplicate dashboard widgetKey "${widget.widgetKey}".`, {
          details: { field: 'widgets', widgetKey: widget.widgetKey },
        });
      }
      seenKeys.add(widget.widgetKey);
    }

    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);
    const ctx = await this.resolveActorContext(validatedActorId, validatedOrgId, now);
    const targetProject =
      projectId !== undefined
        ? ((await this.deps.workContext.listProjects(validatedOrgId)).find(
            (project) => project.projectId === projectId,
          ) ?? null)
        : null;

    this.authorizeScopeAccess(ctx, validatedOrgId, parsed.scope, targetProject, projectId, now);

    const existing = await this.deps.dashboardPreferences.findByUserAndScope(
      validatedOrgId,
      validatedActorId,
      parsed.scope,
      projectId,
    );

    const normalizedWidgets: readonly DashboardWidgetConfig[] = Object.freeze(
      [...parsed.widgets]
        .sort((a, b) => a.order - b.order || a.widgetKey.localeCompare(b.widgetKey))
        .map((widget, index) =>
          Object.freeze({
            widgetKey: widget.widgetKey,
            visible: widget.visible,
            order: index,
            ...(widget.filters !== undefined
              ? { filters: Object.freeze({ ...widget.filters }) }
              : {}),
          }),
        ),
    );

    const candidate: DashboardPreference = Object.freeze({
      id: existing?.id ?? asDashboardPreferenceId(this.nextUuid()),
      organizationId: validatedOrgId,
      userId: validatedActorId,
      scope: parsed.scope,
      ...(projectId !== undefined ? { projectId } : {}),
      widgets: normalizedWidgets,
      isDemoIsolated: ctx.profile?.isDemoOrganization ?? false,
      updatedAt: now,
    });

    return this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.DASHBOARD_PREFERENCES],
      async () => {
        const persisted = await this.deps.dashboardPreferences.save(candidate);
        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'analytics.dashboard_preference.saved',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'DashboardPreference',
            aggregateId: persisted.id,
            payload: {
              scope: persisted.scope,
              ...(persisted.projectId !== undefined ? { projectId: persisted.projectId } : {}),
              isDemoIsolated: persisted.isDemoIsolated,
              widgetCount: persisted.widgets.length,
            },
          }),
        );
        return persisted;
      },
    );
  }

  async resetDashboardPreference(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: ResetDashboardPreferenceInput,
  ): Promise<DashboardPreference> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      resetDashboardPreferenceSchema,
      input,
      'Invalid dashboard preference reset payload.',
    );
    const projectId =
      parsed.projectId !== undefined ? asProjectId(parsed.projectId, 'projectId') : undefined;
    assertScopeProjectCoherence(parsed.scope, projectId);

    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);
    const ctx = await this.resolveActorContext(validatedActorId, validatedOrgId, now);
    const targetProject =
      projectId !== undefined
        ? ((await this.deps.workContext.listProjects(validatedOrgId)).find(
            (project) => project.projectId === projectId,
          ) ?? null)
        : null;

    this.authorizeScopeAccess(ctx, validatedOrgId, parsed.scope, targetProject, projectId, now);

    const existing = await this.deps.dashboardPreferences.findByUserAndScope(
      validatedOrgId,
      validatedActorId,
      parsed.scope,
      projectId,
    );

    const candidate: DashboardPreference = Object.freeze({
      id: existing?.id ?? asDashboardPreferenceId(this.nextUuid()),
      organizationId: validatedOrgId,
      userId: validatedActorId,
      scope: parsed.scope,
      ...(projectId !== undefined ? { projectId } : {}),
      widgets: DEFAULT_WIDGETS_BY_SCOPE[parsed.scope],
      isDemoIsolated: ctx.profile?.isDemoOrganization ?? false,
      updatedAt: now,
    });

    return this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.DASHBOARD_PREFERENCES],
      async () => {
        const persisted = await this.deps.dashboardPreferences.save(candidate);
        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'analytics.dashboard_preference.reset',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'DashboardPreference',
            aggregateId: persisted.id,
            payload: {
              scope: persisted.scope,
              ...(persisted.projectId !== undefined ? { projectId: persisted.projectId } : {}),
              isDemoIsolated: persisted.isDemoIsolated,
            },
          }),
        );
        return persisted;
      },
    );
  }

  async getCalibrationSettings(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<AnalyticsCalibrationSettingsView> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const ctx = await this.resolveActorContext(validatedActorId, validatedOrgId, now);
    assertAuthorized({
      actor: ctx.actor,
      action: PERMISSION_CODES.ANALYTICS_RULES_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: ctx.settings?.organizationExists ?? false,
        organizationId: validatedOrgId,
      },
      context: { now, policyConfig: ctx.policyConfig },
    });

    if (!ctx.settings) {
      throw new NotFoundError(`Organization "${validatedOrgId}" settings were not found.`);
    }

    return Object.freeze({
      organizationId: validatedOrgId,
      calibratableWeights: ctx.settings.calibratableWeights,
      updatedAt: ctx.settings.updatedAt,
    });
  }

  async updateCalibrationSettings(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: UpdateCalibrationSettingsInput,
  ): Promise<AnalyticsCalibrationSettingsView> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(
      updateCalibrationSchema,
      input,
      'Invalid analytics calibration payload.',
    );

    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);
    const ctx = await this.resolveActorContext(validatedActorId, validatedOrgId, now);

    assertAuthorized({
      actor: ctx.actor,
      action: PERMISSION_CODES.ANALYTICS_RULES_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: ctx.settings?.organizationExists ?? false,
        organizationId: validatedOrgId,
      },
      context: { now, policyConfig: ctx.policyConfig },
    });

    if (!ctx.settings) {
      throw new NotFoundError(`Organization "${validatedOrgId}" settings were not found.`);
    }

    const beforeWeights = ctx.settings.calibratableWeights;
    const patch = parsed.calibratableWeights;

    const nextWeights: AnalyticsCalibratableWeightsSnapshot = Object.freeze({
      workloadPriorityWeight: roundWeight(
        patch.workloadPriorityWeight ?? beforeWeights.workloadPriorityWeight,
      ),
      workloadDelayWeight: roundWeight(
        patch.workloadDelayWeight ?? beforeWeights.workloadDelayWeight,
      ),
      workloadImpedimentsWeight: roundWeight(
        patch.workloadImpedimentsWeight ?? beforeWeights.workloadImpedimentsWeight,
      ),
      workloadOperationalStateWeight: roundWeight(
        patch.workloadOperationalStateWeight ?? beforeWeights.workloadOperationalStateWeight,
      ),
      workloadPausedFactor: roundWeight(
        patch.workloadPausedFactor ?? beforeWeights.workloadPausedFactor,
      ),
      focusPriorityWeight: roundWeight(
        patch.focusPriorityWeight ?? beforeWeights.focusPriorityWeight,
      ),
      focusDeadlineWeight: roundWeight(
        patch.focusDeadlineWeight ?? beforeWeights.focusDeadlineWeight,
      ),
      focusDependenciesWeight: roundWeight(
        patch.focusDependenciesWeight ?? beforeWeights.focusDependenciesWeight,
      ),
      focusInactivityWeight: roundWeight(
        patch.focusInactivityWeight ?? beforeWeights.focusInactivityWeight,
      ),
      focusWorkloadCompatibilityWeight: roundWeight(
        patch.focusWorkloadCompatibilityWeight ?? beforeWeights.focusWorkloadCompatibilityWeight,
      ),
      defaultProjectInactivityThresholdDays:
        patch.defaultProjectInactivityThresholdDays ??
        beforeWeights.defaultProjectInactivityThresholdDays,
    });

    const workloadSum =
      nextWeights.workloadPriorityWeight +
      nextWeights.workloadDelayWeight +
      nextWeights.workloadImpedimentsWeight +
      nextWeights.workloadOperationalStateWeight;
    if (Math.abs(workloadSum - 1) > 0.001) {
      throw new ValidationError('Workload calibration weights must sum to 1.0 (100%).', {
        details: { field: 'calibratableWeights', workloadSum },
      });
    }

    const focusSum =
      nextWeights.focusPriorityWeight +
      nextWeights.focusDeadlineWeight +
      nextWeights.focusDependenciesWeight +
      nextWeights.focusInactivityWeight +
      nextWeights.focusWorkloadCompatibilityWeight;
    if (Math.abs(focusSum - 1) > 0.001) {
      throw new ValidationError('Focus calibration weights must sum to 1.0 (100%).', {
        details: { field: 'calibratableWeights', focusSum },
      });
    }

    const saved = await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        const updatedSettings = await this.deps.governance.saveCalibratableWeights(
          validatedOrgId,
          nextWeights,
          now,
        );

        await this.deps.governance.appendAuditEvent({
          organizationId: validatedOrgId,
          actorUserId: validatedActorId,
          occurredAt: now,
          category: 'ORGANIZATION',
          eventType: 'analytics.calibration.updated',
          resourceType: 'OrganizationSettings',
          resourceId: validatedOrgId,
          before: { ...beforeWeights },
          after: { ...nextWeights },
          ...(parsed.justification !== undefined ? { justification: parsed.justification } : {}),
          correlationId,
        });

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'analytics.calibration.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'OrganizationSettings',
            aggregateId: validatedOrgId,
            payload: {
              calibratableWeights: nextWeights,
            },
          }),
        );

        return updatedSettings;
      },
    );

    return Object.freeze({
      organizationId: validatedOrgId,
      calibratableWeights: saved.calibratableWeights,
      updatedAt: saved.updatedAt,
    });
  }
}
