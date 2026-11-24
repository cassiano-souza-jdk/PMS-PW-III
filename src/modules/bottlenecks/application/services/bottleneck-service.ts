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
  type AuthorizationPolicyConfig,
  type AuthorizationResource,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
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
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  BOTTLENECK_SEVERITIES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  parseIsoDateTimeMs,
  type BoardColumnId,
  type BottleneckSeverity,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type Priority,
  type ProjectBottleneckThresholds,
  type ProjectId,
  type TaskId,
  type TaskStatus,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  asBottleneckAlertId,
  assertValidProjectBottleneckThresholds,
  calculateWorkloadScore,
  detectInactiveTasks,
  isBottleneckAlertResolved,
  normalizeProjectBottleneckThresholds,
  upsertBottleneckAlert,
  type BottleneckAlert,
  type BottleneckAlertCandidate,
  type BottleneckAlertId,
  type BottleneckAlertStatus,
  type BottleneckIndicator,
  type InactivityTaskSnapshot,
  type ResolvedProjectBottleneckThresholds,
  type WorkloadCalculationOptions,
  type WorkloadScoreResult,
  type WorkloadSubtaskSnapshot,
  type WorkloadTaskSnapshot,
} from '../../domain/bottleneck';
import type { BottleneckAlertRepositoryPort } from '../ports/bottleneck-repository.port';
import type {
  BottleneckProjectSummary,
  BottleneckProjectWorkData,
  BottleneckSubtaskSnapshot,
  BottleneckTaskSnapshot,
  BottleneckWorkContextPort,
} from '../ports/bottleneck-work-context.port';

const indicatorSchema = z.enum([
  BOTTLENECK_INDICATORS.WIP,
  BOTTLENECK_INDICATORS.INACTIVITY,
  BOTTLENECK_INDICATORS.OVERDUE,
  BOTTLENECK_INDICATORS.IMPEDIMENTS,
  BOTTLENECK_INDICATORS.OVERLOAD,
]);

const alertStatusSchema = z.enum([
  BOTTLENECK_ALERT_STATUSES.OPEN,
  BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED,
  BOTTLENECK_ALERT_STATUSES.RESOLVED,
]);

const listOrganizationAlertsFiltersSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    indicator: indicatorSchema.optional(),
    status: alertStatusSchema.optional(),
    includeResolved: z.boolean().optional(),
  })
  .strict();

const thresholdsPatchSchema = z
  .object({
    wipUtilizationPercent: z.number().optional(),
    inactivityWarningCount: z.number().optional(),
    inactivityCriticalCount: z.number().optional(),
    overdueWarningCount: z.number().optional(),
    overdueCriticalCount: z.number().optional(),
    blockedWarningCount: z.number().optional(),
    blockedCriticalCount: z.number().optional(),
    overloadHighScore: z.number().optional(),
    overloadCriticalScore: z.number().optional(),
  })
  .strict();

const updateProjectBottleneckRulesSchema = z
  .object({
    inactivityThresholdDays: z.number().int().min(1).max(365).optional(),
    thresholds: thresholdsPatchSchema.optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => data.inactivityThresholdDays !== undefined || data.thresholds !== undefined,
    'At least one field ("inactivityThresholdDays" or "thresholds") must be provided.',
  );

const updateIndividualProductivityVisibilitySchema = z
  .object({
    allowManagerViewIndividualProductivity: z.boolean(),
    justification: z.string().trim().max(500).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict();

export interface BottleneckServiceDependencies {
  readonly bottleneckAlerts: BottleneckAlertRepositoryPort;
  readonly workContext: BottleneckWorkContextPort;
  readonly organizations: OrganizationRepositoryPort;
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

export interface BottleneckOperationOptions {
  readonly correlationId?: CorrelationId;
}

export interface ListOrganizationAlertsFilters {
  readonly projectId?: ProjectId;
  readonly indicator?: BottleneckIndicator;
  readonly status?: BottleneckAlertStatus;
  readonly includeResolved?: boolean;
}

export interface UpdateProjectBottleneckRulesInput {
  readonly inactivityThresholdDays?: number;
  readonly thresholds?: ProjectBottleneckThresholds;
  readonly correlationId?: CorrelationId;
}

export interface UpdateIndividualProductivityVisibilityInput {
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly justification?: string;
  readonly correlationId?: CorrelationId;
}

export interface MyWorkloadOperationalBreakdown {
  readonly todoCount: number;
  readonly inProgressCount: number;
  readonly pausedCount: number;
  readonly blockedCount: number;
  readonly overdueCount: number;
  readonly sharedTaskCount: number;
  readonly openSubtaskCount: number;
}

export interface MyWorkloadSummary {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly workload: WorkloadScoreResult;
  readonly breakdown: MyWorkloadOperationalBreakdown;
  readonly generatedAt: IsoDateTime;
}

export interface BottleneckTaskSummaryItem {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly lastMovedAt: IsoDateTime;
  readonly assigneeId?: UserId;
}

export interface WipColumnBottleneckStatus {
  readonly columnId: BoardColumnId;
  readonly columnName: string;
  readonly occupyingTaskCount: number;
  readonly wipLimit: number | null;
  readonly utilizationPercent: number | null;
  readonly isExceeded: boolean;
  readonly isPreventiveWarning: boolean;
  readonly severity: BottleneckSeverity | null;
}

export interface ProjectMemberWorkloadEntry {
  readonly userId: UserId;
  readonly displayName: string;
  readonly workload: WorkloadScoreResult;
}

export interface ProjectBottlenecksIndicators {
  readonly wipColumns: readonly WipColumnBottleneckStatus[];
  readonly wipExceededColumnsCount: number;
  readonly inactiveTaskCount: number;
  readonly inactiveTasks: readonly BottleneckTaskSummaryItem[];
  readonly overdueTaskCount: number;
  readonly overdueTasks: readonly BottleneckTaskSummaryItem[];
  readonly blockedTaskCount: number;
  readonly openBlockingImpedimentCount: number;
  readonly blockedTasks: readonly BottleneckTaskSummaryItem[];
  readonly overloadedMemberCount: number;
}

export interface ProjectBottlenecksOverview {
  readonly organizationId: OrganizationId;
  readonly project: BottleneckProjectSummary;
  readonly thresholds: ResolvedProjectBottleneckThresholds;
  readonly canViewThirdPartyIndividualMetrics: boolean;
  readonly indicators: ProjectBottlenecksIndicators;
  readonly memberWorkloads: readonly ProjectMemberWorkloadEntry[];
  readonly activeAlerts: readonly BottleneckAlert[];
  readonly generatedAt: IsoDateTime;
}

export interface OrganizationBottleneckAlertsResult {
  readonly organizationId: OrganizationId;
  readonly alerts: readonly BottleneckAlert[];
  readonly overloadedMemberCount: number;
  readonly totalCount: number;
  readonly summaryByIndicator: Readonly<Record<BottleneckIndicator, number>>;
  readonly summaryBySeverity: Readonly<Record<BottleneckSeverity, number>>;
}

export interface EvaluateProjectBottlenecksResult {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly evaluatedAt: IsoDateTime;
  readonly thresholdsUsed: ResolvedProjectBottleneckThresholds;
  readonly alerts: readonly BottleneckAlert[];
  readonly overloadedMemberCount: number;
  readonly detectedCandidateCount: number;
}

export interface ProjectBottleneckRulesResult {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly inactivityThresholdDays: number;
  readonly thresholds: ResolvedProjectBottleneckThresholds;
  readonly updatedAt: IsoDateTime;
}

export interface IndividualProductivityVisibilityResult {
  readonly organizationId: OrganizationId;
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly updatedAt: IsoDateTime;
}

interface ComputedProjectEvaluation {
  readonly thresholds: ResolvedProjectBottleneckThresholds;
  readonly wipColumns: readonly WipColumnBottleneckStatus[];
  readonly inactiveTaskList: readonly BottleneckTaskSnapshot[];
  readonly overdueTaskList: readonly BottleneckTaskSnapshot[];
  readonly blockedTaskList: readonly BottleneckTaskSnapshot[];
  readonly memberWorkloads: readonly ProjectMemberWorkloadEntry[];
  readonly overloadedUserIds: ReadonlySet<UserId>;
  readonly candidates: readonly BottleneckAlertCandidate[];
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
    throw new ValidationError('Invalid bottleneck input payload.', {
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

function countDistinctTaskAssignees(task: BottleneckTaskSnapshot): number {
  const participants = new Set<UserId>(task.participantIds);
  if (task.assigneeId !== undefined) {
    participants.add(task.assigneeId);
  }
  return Math.max(1, participants.size);
}

function isUserAssignedOrParticipating(task: BottleneckTaskSnapshot, userId: UserId): boolean {
  return task.assigneeId === userId || task.participantIds.includes(userId);
}

function classifyCountSeverity(
  count: number,
  warningThreshold: number,
  criticalThreshold: number,
): BottleneckSeverity | null {
  if (count >= criticalThreshold) {
    return BOTTLENECK_SEVERITIES.CRITICAL;
  }
  if (count < warningThreshold) {
    return null;
  }
  const midpoint = Math.ceil((warningThreshold + criticalThreshold) / 2);
  if (criticalThreshold > warningThreshold && count >= midpoint) {
    return BOTTLENECK_SEVERITIES.HIGH;
  }
  return BOTTLENECK_SEVERITIES.MODERATE;
}

function classifyWipSeverity(
  occupyingTaskCount: number,
  wipLimit: number | null,
  wipUtilizationPercent: number,
): {
  readonly utilizationPercent: number | null;
  readonly isExceeded: boolean;
  readonly isPreventiveWarning: boolean;
  readonly severity: BottleneckSeverity | null;
} {
  if (wipLimit === null || wipLimit <= 0) {
    return {
      utilizationPercent: null,
      isExceeded: false,
      isPreventiveWarning: false,
      severity: null,
    };
  }

  const utilizationPercent = Math.round((occupyingTaskCount / wipLimit) * 100);
  if (occupyingTaskCount > wipLimit) {
    return {
      utilizationPercent,
      isExceeded: true,
      isPreventiveWarning: false,
      severity: BOTTLENECK_SEVERITIES.CRITICAL,
    };
  }
  if (occupyingTaskCount === wipLimit) {
    return {
      utilizationPercent,
      isExceeded: false,
      isPreventiveWarning: true,
      severity: BOTTLENECK_SEVERITIES.HIGH,
    };
  }
  if (utilizationPercent >= wipUtilizationPercent) {
    return {
      utilizationPercent,
      isExceeded: false,
      isPreventiveWarning: true,
      severity: BOTTLENECK_SEVERITIES.MODERATE,
    };
  }

  return {
    utilizationPercent,
    isExceeded: false,
    isPreventiveWarning: false,
    severity: null,
  };
}

function buildProjectResource(
  kind: 'BOTTLENECK' | 'ANALYTICS',
  organizationId: OrganizationId,
  projectId: ProjectId,
  project: BottleneckProjectSummary | null,
  includesThirdPartyIndividualMetrics?: boolean,
): AuthorizationResource {
  return {
    kind,
    id: asEntityId(projectId),
    exists: project !== null,
    organizationId,
    projectId,
    ...(project?.teamId !== undefined ? { teamId: project.teamId } : {}),
    ...(project?.ownerUserId !== undefined ? { ownerUserId: project.ownerUserId } : {}),
    ...(project?.archivedAt !== undefined
      ? { archivedAt: project.archivedAt, projectArchivedAt: project.archivedAt }
      : {}),
    ...(project?.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
    ...(includesThirdPartyIndividualMetrics !== undefined
      ? { includesThirdPartyIndividualMetrics }
      : {}),
  };
}

function toTaskSummaryItem(task: BottleneckTaskSnapshot): BottleneckTaskSummaryItem {
  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
    lastMovedAt: task.lastMovedAt,
    ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
  };
}

function isThirdPartyOverloadAlert(alert: BottleneckAlert, actorUserId: UserId): boolean {
  return (
    alert.indicator === BOTTLENECK_INDICATORS.OVERLOAD &&
    alert.targetEntityType === 'USER' &&
    alert.targetEntityId !== actorUserId
  );
}

function createEmptyIndicatorSummary(): Record<BottleneckIndicator, number> {
  return {
    [BOTTLENECK_INDICATORS.WIP]: 0,
    [BOTTLENECK_INDICATORS.INACTIVITY]: 0,
    [BOTTLENECK_INDICATORS.OVERDUE]: 0,
    [BOTTLENECK_INDICATORS.IMPEDIMENTS]: 0,
    [BOTTLENECK_INDICATORS.OVERLOAD]: 0,
  };
}

function createEmptySeveritySummary(): Record<BottleneckSeverity, number> {
  return {
    [BOTTLENECK_SEVERITIES.LOW]: 0,
    [BOTTLENECK_SEVERITIES.MODERATE]: 0,
    [BOTTLENECK_SEVERITIES.HIGH]: 0,
    [BOTTLENECK_SEVERITIES.CRITICAL]: 0,
  };
}

export class BottleneckService {
  private readonly deps: BottleneckServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: BottleneckServiceDependencies) {
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

  private canViewThirdPartyMetricsInProject(
    actor: AuthorizationActor,
    organizationId: OrganizationId,
    project: BottleneckProjectSummary,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
  ): boolean {
    const decision = evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
      resource: buildProjectResource('ANALYTICS', organizationId, project.id, project, true),
      context: { now, policyConfig },
    });
    return decision.allowed;
  }

  private canViewTaskInProject(
    actor: AuthorizationActor,
    organizationId: OrganizationId,
    task: BottleneckTaskSnapshot,
    project: BottleneckProjectSummary,
    now: IsoDateTime,
    policyConfig: AuthorizationPolicyConfig,
  ): boolean {
    const decision = evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.TASK_VIEW,
      resource: {
        kind: 'TASK',
        id: asEntityId(task.id),
        exists: true,
        organizationId,
        projectId: task.projectId,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        ownerUserId: project.ownerUserId,
        ...(project.archivedAt !== undefined ? { projectArchivedAt: project.archivedAt } : {}),
        ...(task.deletedAt !== undefined || project.deletedAt !== undefined
          ? { deletedAt: task.deletedAt ?? project.deletedAt }
          : {}),
        taskId: task.id,
        createdBy: task.createdByUserId,
        ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
        participantIds: task.participantIds,
      },
      context: { now, policyConfig },
    });
    return decision.allowed;
  }

  private evaluateProjectIndicators(
    workData: BottleneckProjectWorkData,
    calibratableWeights: CalibratableWeightsConfig,
    now: IsoDateTime,
  ): ComputedProjectEvaluation {
    const { project } = workData;
    const thresholds = normalizeProjectBottleneckThresholds(project.bottleneckThresholds);
    const nowMs = parseIsoDateTimeMs(now);

    const activeTasks = workData.tasks.filter((task) => !isSoftDeleted(task));
    const nonTerminalTasks = activeTasks.filter(
      (task) => task.status !== TASK_STATUSES.DONE && task.status !== TASK_STATUSES.CANCELLED,
    );
    const nonTerminalTaskIdSet = new Set<TaskId>(nonTerminalTasks.map((task) => task.id));

    const candidates: BottleneckAlertCandidate[] = [];

    // 1. WIP indicator per active column
    const wipColumns: WipColumnBottleneckStatus[] = workData.columns.map((column) => {
      const wip = classifyWipSeverity(
        column.occupyingTaskCount,
        column.wipLimit,
        thresholds.wipUtilizationPercent,
      );

      if (wip.severity !== null && column.wipLimit !== null) {
        candidates.push({
          id: asBottleneckAlertId(this.nextUuid()),
          organizationId: project.organizationId,
          projectId: project.id,
          indicator: BOTTLENECK_INDICATORS.WIP,
          severity: wip.severity,
          targetEntityType: 'BOARD_COLUMN',
          targetEntityId: column.id,
          summary:
            column.occupyingTaskCount > column.wipLimit
              ? `Coluna "${column.name}" excedeu o limite WIP (${column.occupyingTaskCount}/${column.wipLimit}).`
              : `Coluna "${column.name}" atingiu ${wip.utilizationPercent}% da capacidade WIP (${column.occupyingTaskCount}/${column.wipLimit}).`,
        });
      }

      return Object.freeze({
        columnId: column.id,
        columnName: column.name,
        occupyingTaskCount: column.occupyingTaskCount,
        wipLimit: column.wipLimit,
        utilizationPercent: wip.utilizationPercent,
        isExceeded: wip.isExceeded,
        isPreventiveWarning: wip.isPreventiveWarning,
        severity: wip.severity,
      });
    });

    // 2. INACTIVITY indicator (strictly based on lastMovedAt, never lastActivityAt; BLOCKED separated)
    const inactivitySnapshots: InactivityTaskSnapshot[] = nonTerminalTasks.map((task) => ({
      taskId: task.id,
      status: task.status,
      lastMovedAt: task.lastMovedAt,
      lastActivityAt: task.lastActivityAt,
      inactivityThresholdDays: project.inactivityThresholdDays,
    }));
    const inactivityDetection = detectInactiveTasks(inactivitySnapshots, now);
    const inactiveTaskIdSet = new Set<TaskId>(inactivityDetection.inactiveTaskIds);
    const blockedTaskIdSet = new Set<TaskId>(inactivityDetection.blockedTaskIds);

    const inactiveTaskList = nonTerminalTasks.filter((task) => inactiveTaskIdSet.has(task.id));
    const inactivitySeverity = classifyCountSeverity(
      inactiveTaskList.length,
      thresholds.inactivityWarningCount,
      thresholds.inactivityCriticalCount,
    );
    if (inactivitySeverity !== null) {
      candidates.push({
        id: asBottleneckAlertId(this.nextUuid()),
        organizationId: project.organizationId,
        projectId: project.id,
        indicator: BOTTLENECK_INDICATORS.INACTIVITY,
        severity: inactivitySeverity,
        targetEntityType: 'PROJECT',
        targetEntityId: project.id,
        summary: `${inactiveTaskList.length} tarefa(s) sem movimentação há ${project.inactivityThresholdDays}+ dias no projeto "${project.name}".`,
      });
    }

    // 3. OVERDUE indicator
    const overdueTaskList = nonTerminalTasks.filter(
      (task) => task.dueDate !== undefined && parseIsoDateTimeMs(task.dueDate) < nowMs,
    );
    const overdueSeverity = classifyCountSeverity(
      overdueTaskList.length,
      thresholds.overdueWarningCount,
      thresholds.overdueCriticalCount,
    );
    if (overdueSeverity !== null) {
      candidates.push({
        id: asBottleneckAlertId(this.nextUuid()),
        organizationId: project.organizationId,
        projectId: project.id,
        indicator: BOTTLENECK_INDICATORS.OVERDUE,
        severity: overdueSeverity,
        targetEntityType: 'PROJECT',
        targetEntityId: project.id,
        summary: `${overdueTaskList.length} tarefa(s) ativa(s) com prazo vencido no projeto "${project.name}".`,
      });
    }

    // 4. IMPEDIMENTS indicator (blocked tasks and open blocking impediments)
    const blockedTaskList = nonTerminalTasks.filter((task) => blockedTaskIdSet.has(task.id));
    const effectiveBlockedCount = Math.max(
      blockedTaskList.length,
      workData.openBlockingImpedimentCount,
    );
    const impedimentsSeverity = classifyCountSeverity(
      effectiveBlockedCount,
      thresholds.blockedWarningCount,
      thresholds.blockedCriticalCount,
    );
    if (impedimentsSeverity !== null) {
      candidates.push({
        id: asBottleneckAlertId(this.nextUuid()),
        organizationId: project.organizationId,
        projectId: project.id,
        indicator: BOTTLENECK_INDICATORS.IMPEDIMENTS,
        severity: impedimentsSeverity,
        targetEntityType: 'PROJECT',
        targetEntityId: project.id,
        summary: `${blockedTaskList.length} tarefa(s) bloqueada(s) e ${workData.openBlockingImpedimentCount} impedimento(s) ativo(s) no projeto "${project.name}".`,
      });
    }

    // 5. OVERLOAD indicator per member/contributor in the project
    const candidateUserIds = new Set<UserId>();
    for (const member of workData.members) {
      candidateUserIds.add(member.userId);
    }
    for (const task of nonTerminalTasks) {
      if (task.assigneeId !== undefined) {
        candidateUserIds.add(task.assigneeId);
      }
      for (const participantId of task.participantIds) {
        candidateUserIds.add(participantId);
      }
    }
    for (const subtask of workData.subtasks) {
      if (
        subtask.status === 'OPEN' &&
        subtask.assigneeId !== undefined &&
        nonTerminalTaskIdSet.has(subtask.taskId)
      ) {
        candidateUserIds.add(subtask.assigneeId);
      }
    }

    const sortedUserIds = [...candidateUserIds].sort((a, b) => a.localeCompare(b));
    const workloadOptions = toWorkloadOptions(calibratableWeights);
    const memberWorkloads: ProjectMemberWorkloadEntry[] = [];
    const overloadedUserIds = new Set<UserId>();

    for (const userId of sortedUserIds) {
      const userTaskSnapshots: WorkloadTaskSnapshot[] = nonTerminalTasks
        .filter((task) => isUserAssignedOrParticipating(task, userId))
        .map((task) => ({
          taskId: task.id,
          status: task.status,
          priority: task.priority,
          ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
          participantCount: countDistinctTaskAssignees(task),
          ...(task.openImpedimentsMaxSeverity !== undefined
            ? { openImpedimentsMaxSeverity: task.openImpedimentsMaxSeverity }
            : {}),
        }));

      const userSubtaskSnapshots: WorkloadSubtaskSnapshot[] = workData.subtasks
        .filter(
          (subtask) =>
            subtask.assigneeId === userId &&
            subtask.status === 'OPEN' &&
            subtask.parentTaskDeletedAt === undefined &&
            nonTerminalTaskIdSet.has(subtask.taskId),
        )
        .map((subtask) => ({
          subtaskId: subtask.id,
          status: subtask.status,
          priority: subtask.priority,
          ...(subtask.dueDate !== undefined ? { dueDate: subtask.dueDate } : {}),
        }));

      const workload = calculateWorkloadScore(
        userTaskSnapshots,
        userSubtaskSnapshots,
        now,
        workloadOptions,
      );
      const displayName = workData.userDisplayNames.get(userId) ?? userId;

      memberWorkloads.push(
        Object.freeze({
          userId,
          displayName,
          workload,
        }),
      );

      let overloadSeverity: BottleneckSeverity | null = null;
      if (workload.score >= thresholds.overloadCriticalScore) {
        overloadSeverity = BOTTLENECK_SEVERITIES.CRITICAL;
      } else if (workload.score >= thresholds.overloadHighScore) {
        overloadSeverity = BOTTLENECK_SEVERITIES.HIGH;
      }

      if (overloadSeverity !== null) {
        overloadedUserIds.add(userId);
        candidates.push({
          id: asBottleneckAlertId(this.nextUuid()),
          organizationId: project.organizationId,
          projectId: project.id,
          indicator: BOTTLENECK_INDICATORS.OVERLOAD,
          severity: overloadSeverity,
          targetEntityType: 'USER',
          targetEntityId: userId,
          summary: `Sobrecarga operacional detectada para ${displayName} (pontuação ${workload.score}/100).`,
        });
      }
    }

    return {
      thresholds,
      wipColumns,
      inactiveTaskList,
      overdueTaskList,
      blockedTaskList,
      memberWorkloads,
      overloadedUserIds,
      candidates,
    };
  }

  async getMyWorkloadSummary(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<MyWorkloadSummary> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const [org, actor, settings, userWorkData] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.workContext.loadOrganizationUserWorkData(validatedOrgId, validatedActorId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW,
      resource: {
        kind: 'ANALYTICS',
        id: asEntityId(validatedActorId),
        exists: org !== null,
        organizationId: validatedOrgId,
        ownerUserId: validatedActorId,
        ...(org?.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
      },
      context: { now, policyConfig },
    });

    const nowMs = parseIsoDateTimeMs(now);
    const activeTasks: BottleneckTaskSnapshot[] = [];

    for (const task of userWorkData.tasks) {
      if (
        isSoftDeleted(task) ||
        task.status === TASK_STATUSES.DONE ||
        task.status === TASK_STATUSES.CANCELLED
      ) {
        continue;
      }

      const project = userWorkData.projectsById.get(task.projectId);
      if (
        !project ||
        isSoftDeleted(project) ||
        project.status === 'ARCHIVED' ||
        project.archivedAt !== undefined
      ) {
        continue;
      }

      if (!isUserAssignedOrParticipating(task, validatedActorId)) {
        continue;
      }

      activeTasks.push(task);
    }

    const workloadTasks: WorkloadTaskSnapshot[] = activeTasks.map((task) => ({
      taskId: task.id,
      status: task.status,
      priority: task.priority,
      ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
      participantCount: countDistinctTaskAssignees(task),
      ...(task.openImpedimentsMaxSeverity !== undefined
        ? { openImpedimentsMaxSeverity: task.openImpedimentsMaxSeverity }
        : {}),
    }));

    const activeSubtasks: BottleneckSubtaskSnapshot[] = userWorkData.subtasks.filter((subtask) => {
      if (subtask.assigneeId !== validatedActorId || subtask.status !== 'OPEN') {
        return false;
      }
      if (
        subtask.parentTaskDeletedAt !== undefined ||
        subtask.parentTaskStatus === TASK_STATUSES.DONE ||
        subtask.parentTaskStatus === TASK_STATUSES.CANCELLED
      ) {
        return false;
      }
      const project = userWorkData.projectsById.get(subtask.projectId);
      return (
        project !== undefined &&
        !isSoftDeleted(project) &&
        project.status === 'ACTIVE' &&
        project.archivedAt === undefined
      );
    });

    const workloadSubtasks: WorkloadSubtaskSnapshot[] = activeSubtasks.map((subtask) => ({
      subtaskId: subtask.id,
      status: subtask.status,
      priority: subtask.priority,
      ...(subtask.dueDate !== undefined ? { dueDate: subtask.dueDate } : {}),
    }));

    const workload = calculateWorkloadScore(
      workloadTasks,
      workloadSubtasks,
      now,
      toWorkloadOptions(effectiveSettings.calibratableWeights),
    );

    const breakdown: MyWorkloadOperationalBreakdown = Object.freeze({
      todoCount: activeTasks.filter((t) => t.status === TASK_STATUSES.TODO).length,
      inProgressCount: activeTasks.filter((t) => t.status === TASK_STATUSES.IN_PROGRESS).length,
      pausedCount: activeTasks.filter((t) => t.status === TASK_STATUSES.PAUSED).length,
      blockedCount: activeTasks.filter((t) => t.status === TASK_STATUSES.BLOCKED).length,
      overdueCount: activeTasks.filter(
        (t) => t.dueDate !== undefined && parseIsoDateTimeMs(t.dueDate) < nowMs,
      ).length,
      sharedTaskCount: activeTasks.filter((t) => countDistinctTaskAssignees(t) > 1).length,
      openSubtaskCount: workload.activeSubtaskCount,
    });

    return Object.freeze({
      organizationId: validatedOrgId,
      userId: validatedActorId,
      workload,
      breakdown,
      generatedAt: now,
    });
  }

  async getProjectBottlenecksOverview(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ProjectBottlenecksOverview> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();

    const [actor, settings, workData, persistedActiveAlerts] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.workContext.loadProjectWorkData(validatedOrgId, validatedProjectId),
      this.deps.bottleneckAlerts.listActiveByOrganization(validatedOrgId, {
        projectId: validatedProjectId,
      }),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);
    const project = workData?.project ?? null;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOTTLENECK_VIEW,
      resource: buildProjectResource('BOTTLENECK', validatedOrgId, validatedProjectId, project),
      context: { now, policyConfig },
    });

    if (!workData || !project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    const canViewThirdPartyIndividualMetrics = this.canViewThirdPartyMetricsInProject(
      actor,
      validatedOrgId,
      project,
      now,
      policyConfig,
    );

    const evaluation = this.evaluateProjectIndicators(
      workData,
      effectiveSettings.calibratableWeights,
      now,
    );

    const tasksById = new Map<TaskId, BottleneckTaskSnapshot>();
    for (const task of workData.tasks) {
      tasksById.set(task.id, task);
    }

    const filterVisibleTaskItems = (
      tasks: readonly BottleneckTaskSnapshot[],
    ): readonly BottleneckTaskSummaryItem[] =>
      Object.freeze(
        tasks
          .filter((task) =>
            this.canViewTaskInProject(actor, validatedOrgId, task, project, now, policyConfig),
          )
          .map(toTaskSummaryItem),
      );

    // DN-02: hide third-party OVERLOAD alerts when unauthorized, keep anonymized count
    const overloadedMemberIds = new Set<string>(evaluation.overloadedUserIds);
    for (const alert of persistedActiveAlerts) {
      if (alert.indicator === BOTTLENECK_INDICATORS.OVERLOAD && alert.targetEntityType === 'USER') {
        overloadedMemberIds.add(alert.targetEntityId);
      }
    }

    const visibleAlerts = persistedActiveAlerts.filter((alert) => {
      if (isThirdPartyOverloadAlert(alert, validatedActorId)) {
        return canViewThirdPartyIndividualMetrics;
      }
      if (alert.targetEntityType === 'TASK') {
        const task = tasksById.get(alert.targetEntityId as TaskId);
        return (
          task !== undefined &&
          this.canViewTaskInProject(actor, validatedOrgId, task, project, now, policyConfig)
        );
      }
      return true;
    });

    const visibleMemberWorkloads = canViewThirdPartyIndividualMetrics
      ? evaluation.memberWorkloads
      : evaluation.memberWorkloads.filter((entry) => entry.userId === validatedActorId);

    return Object.freeze({
      organizationId: validatedOrgId,
      project,
      thresholds: evaluation.thresholds,
      canViewThirdPartyIndividualMetrics,
      indicators: Object.freeze({
        wipColumns: Object.freeze(evaluation.wipColumns),
        wipExceededColumnsCount: evaluation.wipColumns.filter((col) => col.isExceeded).length,
        inactiveTaskCount: evaluation.inactiveTaskList.length,
        inactiveTasks: filterVisibleTaskItems(evaluation.inactiveTaskList),
        overdueTaskCount: evaluation.overdueTaskList.length,
        overdueTasks: filterVisibleTaskItems(evaluation.overdueTaskList),
        blockedTaskCount: evaluation.blockedTaskList.length,
        openBlockingImpedimentCount: workData.openBlockingImpedimentCount,
        blockedTasks: filterVisibleTaskItems(evaluation.blockedTaskList),
        overloadedMemberCount: overloadedMemberIds.size,
      }),
      memberWorkloads: Object.freeze(visibleMemberWorkloads),
      activeAlerts: Object.freeze(visibleAlerts),
      generatedAt: now,
    });
  }

  async listOrganizationAlerts(
    actorUserId: UserId,
    organizationId: OrganizationId,
    filters?: ListOrganizationAlertsFilters,
  ): Promise<OrganizationBottleneckAlertsResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsedFilters = filters ? parseWithZod(listOrganizationAlertsFiltersSchema, filters) : {};
    const filterProjectId =
      parsedFilters.projectId !== undefined
        ? asProjectId(parsedFilters.projectId, 'projectId')
        : undefined;
    const now = this.now();

    const [org, actor, settings, projects] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.workContext.listProjectsByOrganization(validatedOrgId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    // Ensure organization exists and is not deleted, and actor is an active member
    if (!org) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`, {
        details: { organizationId: validatedOrgId },
      });
    }

    const membership = actor.organizationMembership;
    if (
      !membership ||
      membership.organizationId !== validatedOrgId ||
      membership.status !== MEMBERSHIP_STATUSES.ACTIVE
    ) {
      // Delegate to assertAuthorized for canonical authorization error shape
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW,
        resource: {
          kind: 'BOTTLENECK',
          id: asEntityId(validatedOrgId),
          exists: true,
          organizationId: validatedOrgId,
          ownerUserId: validatedActorId,
          ...(org.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
        },
        context: { now, policyConfig },
      });
    }

    if (isSoftDeleted(org)) {
      throw new ConflictError('Cannot inspect bottleneck alerts on a deleted organization.', {
        details: { organizationId: validatedOrgId },
      });
    }

    const projectsById = new Map<ProjectId, BottleneckProjectSummary>();
    for (const project of projects) {
      projectsById.set(project.id, project);
    }

    if (filterProjectId !== undefined) {
      const targetProject = projectsById.get(filterProjectId) ?? null;
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.BOTTLENECK_VIEW,
        resource: buildProjectResource(
          'BOTTLENECK',
          validatedOrgId,
          filterProjectId,
          targetProject,
        ),
        context: { now, policyConfig },
      });
    }

    const rawAlerts = parsedFilters.includeResolved
      ? await this.deps.bottleneckAlerts.listByOrganization(
          validatedOrgId,
          filterProjectId !== undefined ? { projectId: filterProjectId } : undefined,
        )
      : await this.deps.bottleneckAlerts.listActiveByOrganization(
          validatedOrgId,
          filterProjectId !== undefined ? { projectId: filterProjectId } : undefined,
        );

    const authorizedProjectIds = new Set<ProjectId>();
    const canViewThirdPartyByProjectId = new Map<ProjectId, boolean>();

    for (const project of projects) {
      if (isSoftDeleted(project)) {
        continue;
      }

      const viewDecision = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.BOTTLENECK_VIEW,
        resource: buildProjectResource('BOTTLENECK', validatedOrgId, project.id, project),
        context: { now, policyConfig },
      });

      if (viewDecision.allowed) {
        authorizedProjectIds.add(project.id);
        canViewThirdPartyByProjectId.set(
          project.id,
          this.canViewThirdPartyMetricsInProject(actor, validatedOrgId, project, now, policyConfig),
        );
      }
    }

    const isOrgAdmin = membership?.role === ORGANIZATION_ROLES.ADMIN;
    const overloadedUserIds = new Set<string>();
    const authorizedAlerts: BottleneckAlert[] = [];

    for (const alert of rawAlerts) {
      if (alert.projectId === undefined) {
        if (!isOrgAdmin) {
          continue;
        }
      } else if (!authorizedProjectIds.has(alert.projectId)) {
        continue;
      }

      if (
        alert.indicator === BOTTLENECK_INDICATORS.OVERLOAD &&
        alert.targetEntityType === 'USER' &&
        !isBottleneckAlertResolved(alert)
      ) {
        overloadedUserIds.add(alert.targetEntityId);
      }

      if (isThirdPartyOverloadAlert(alert, validatedActorId)) {
        const canViewThirdParty =
          alert.projectId !== undefined
            ? (canViewThirdPartyByProjectId.get(alert.projectId) ?? false)
            : isOrgAdmin;

        if (!canViewThirdParty) {
          continue;
        }
      }

      authorizedAlerts.push(alert);
    }

    const filteredAlerts = authorizedAlerts.filter((alert) => {
      if (parsedFilters.indicator !== undefined && alert.indicator !== parsedFilters.indicator) {
        return false;
      }
      if (parsedFilters.status !== undefined && alert.status !== parsedFilters.status) {
        return false;
      }
      return true;
    });

    const summaryByIndicator = createEmptyIndicatorSummary();
    const summaryBySeverity = createEmptySeveritySummary();
    for (const alert of filteredAlerts) {
      summaryByIndicator[alert.indicator] += 1;
      summaryBySeverity[alert.severity] += 1;
    }

    return Object.freeze({
      organizationId: validatedOrgId,
      alerts: Object.freeze(filteredAlerts),
      overloadedMemberCount: overloadedUserIds.size,
      totalCount: filteredAlerts.length,
      summaryByIndicator: Object.freeze(summaryByIndicator),
      summaryBySeverity: Object.freeze(summaryBySeverity),
    });
  }

  async evaluateProjectBottlenecks(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options?: BottleneckOperationOptions,
  ): Promise<EvaluateProjectBottlenecksResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options?.correlationId);

    const [actor, settings, workData] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.workContext.loadProjectWorkData(validatedOrgId, validatedProjectId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);
    const project = workData?.project ?? null;

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOTTLENECK_RULES_MANAGE,
      resource: buildProjectResource('BOTTLENECK', validatedOrgId, validatedProjectId, project),
      context: { now, policyConfig },
    });

    if (!workData || !project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    const evaluation = this.evaluateProjectIndicators(
      workData,
      effectiveSettings.calibratableWeights,
      now,
    );

    const persistedAlerts = await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOTTLENECK_ALERTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        const existingActive = await this.deps.bottleneckAlerts.listActiveByOrganization(
          validatedOrgId,
          { projectId: validatedProjectId },
        );

        const upserted: BottleneckAlert[] = evaluation.candidates.map((candidate) =>
          upsertBottleneckAlert(existingActive, candidate, now),
        );

        await this.deps.bottleneckAlerts.saveMany(validatedOrgId, upserted);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'bottleneck.project.evaluated',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          after: {
            candidateCount: evaluation.candidates.length,
            upsertedAlertIds: upserted.map((alert) => alert.id),
            indicatorsDetected: [...new Set(upserted.map((alert) => alert.indicator))],
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        return upserted;
      },
    );

    await this.deps.eventBus.publish(
      createDomainEvent({
        eventId: asEventId(this.nextUuid()),
        eventType: 'bottleneck.project.evaluated',
        occurredAt: now,
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        correlationId,
        aggregateType: 'Project',
        aggregateId: validatedProjectId,
        payload: {
          projectId: validatedProjectId,
          detectedCandidateCount: evaluation.candidates.length,
          upsertedAlertCount: persistedAlerts.length,
        },
      }),
    );

    const canViewThirdParty = this.canViewThirdPartyMetricsInProject(
      actor,
      validatedOrgId,
      project,
      now,
      policyConfig,
    );

    const visibleAlerts = persistedAlerts.filter((alert) =>
      isThirdPartyOverloadAlert(alert, validatedActorId) ? canViewThirdParty : true,
    );

    this.deps.logger?.info('Project bottlenecks evaluated', {
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      detectedCandidateCount: evaluation.candidates.length,
      correlationId,
    });

    return Object.freeze({
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      evaluatedAt: now,
      thresholdsUsed: evaluation.thresholds,
      alerts: Object.freeze(visibleAlerts),
      overloadedMemberCount: evaluation.overloadedUserIds.size,
      detectedCandidateCount: evaluation.candidates.length,
    });
  }

  private async transitionAlertStatus(
    actorUserId: UserId,
    organizationId: OrganizationId,
    alertId: BottleneckAlertId,
    targetStatus:
      typeof BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED | typeof BOTTLENECK_ALERT_STATUSES.RESOLVED,
    options?: BottleneckOperationOptions,
  ): Promise<BottleneckAlert> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedAlertId = asBottleneckAlertId(alertId, 'alertId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options?.correlationId);

    const [actor, settings, alert] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.bottleneckAlerts.findById(validatedOrgId, validatedAlertId),
    ]);

    const project =
      alert?.projectId !== undefined
        ? await this.deps.workContext.findProjectById(validatedOrgId, alert.projectId)
        : null;

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOTTLENECK_RULES_MANAGE,
      resource: {
        kind: 'BOTTLENECK',
        id: asEntityId(validatedAlertId),
        exists: alert !== null && (alert.projectId === undefined || project !== null),
        organizationId: validatedOrgId,
        ...(alert?.projectId !== undefined ? { projectId: alert.projectId } : {}),
        ...(project?.teamId !== undefined ? { teamId: project.teamId } : {}),
        ...(project?.ownerUserId !== undefined ? { ownerUserId: project.ownerUserId } : {}),
        ...(project?.archivedAt !== undefined
          ? { archivedAt: project.archivedAt, projectArchivedAt: project.archivedAt }
          : {}),
        ...(project?.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
      },
      context: { now, policyConfig },
    });

    if (!alert) {
      throw new NotFoundError(`Bottleneck alert "${validatedAlertId}" was not found.`, {
        details: { organizationId: validatedOrgId, alertId: validatedAlertId },
      });
    }

    if (isThirdPartyOverloadAlert(alert, validatedActorId)) {
      const canViewThirdParty =
        project !== null
          ? this.canViewThirdPartyMetricsInProject(
              actor,
              validatedOrgId,
              project,
              now,
              policyConfig,
            )
          : actor.organizationMembership?.role === ORGANIZATION_ROLES.ADMIN;

      if (!canViewThirdParty) {
        assertAuthorized({
          actor,
          action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
          resource: buildProjectResource(
            'ANALYTICS',
            validatedOrgId,
            project?.id ?? asProjectId(alert.targetEntityId),
            project,
            true,
          ),
          context: { now, policyConfig },
        });
      }
    }

    if (targetStatus === BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED) {
      if (alert.status === BOTTLENECK_ALERT_STATUSES.RESOLVED) {
        throw new ConflictError('Cannot acknowledge a bottleneck alert that is already resolved.', {
          details: { alertId: validatedAlertId, status: alert.status },
        });
      }
      if (alert.status === BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED) {
        throw new ConflictError('Bottleneck alert is already acknowledged.', {
          details: { alertId: validatedAlertId, status: alert.status },
        });
      }
    } else if (alert.status === BOTTLENECK_ALERT_STATUSES.RESOLVED) {
      throw new ConflictError('Bottleneck alert is already resolved.', {
        details: { alertId: validatedAlertId, status: alert.status },
      });
    }

    const updatedAlert: BottleneckAlert =
      targetStatus === BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED
        ? Object.freeze({
            ...alert,
            status: BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED,
            acknowledgedAt: now,
            acknowledgedByUserId: validatedActorId,
          })
        : Object.freeze({
            ...alert,
            status: BOTTLENECK_ALERT_STATUSES.RESOLVED,
            resolvedAt: now,
            resolvedByUserId: validatedActorId,
          });

    const eventType =
      targetStatus === BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED
        ? 'bottleneck.alert.acknowledged'
        : 'bottleneck.alert.resolved';

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.BOTTLENECK_ALERTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.bottleneckAlerts.save(updatedAlert);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          ...(alert.projectId !== undefined ? { projectId: alert.projectId } : {}),
          occurredAt: now,
          category:
            alert.projectId !== undefined
              ? AUDIT_CATEGORIES.PROJECT
              : AUDIT_CATEGORIES.ORGANIZATION,
          eventType,
          resourceType: 'BottleneckAlert',
          resourceId: alert.id,
          before: { status: alert.status },
          after: { status: updatedAlert.status },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);
      },
    );

    await this.deps.eventBus.publish(
      createDomainEvent({
        eventId: asEventId(this.nextUuid()),
        eventType,
        occurredAt: now,
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        correlationId,
        aggregateType: 'BottleneckAlert',
        aggregateId: updatedAlert.id,
        payload: {
          alertId: updatedAlert.id,
          ...(updatedAlert.projectId !== undefined ? { projectId: updatedAlert.projectId } : {}),
          indicator: updatedAlert.indicator,
          previousStatus: alert.status,
          newStatus: updatedAlert.status,
        },
      }),
    );

    return updatedAlert;
  }

  async acknowledgeAlert(
    actorUserId: UserId,
    organizationId: OrganizationId,
    alertId: BottleneckAlertId,
    options?: BottleneckOperationOptions,
  ): Promise<BottleneckAlert> {
    return this.transitionAlertStatus(
      actorUserId,
      organizationId,
      alertId,
      BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED,
      options,
    );
  }

  async resolveAlert(
    actorUserId: UserId,
    organizationId: OrganizationId,
    alertId: BottleneckAlertId,
    options?: BottleneckOperationOptions,
  ): Promise<BottleneckAlert> {
    return this.transitionAlertStatus(
      actorUserId,
      organizationId,
      alertId,
      BOTTLENECK_ALERT_STATUSES.RESOLVED,
      options,
    );
  }

  async updateProjectBottleneckRules(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    input: UpdateProjectBottleneckRulesInput,
  ): Promise<ProjectBottleneckRulesResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const parsed = parseWithZod(updateProjectBottleneckRulesSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, settings, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
      this.deps.workContext.findProjectById(validatedOrgId, validatedProjectId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.BOTTLENECK_RULES_MANAGE,
      resource: buildProjectResource('BOTTLENECK', validatedOrgId, validatedProjectId, project),
      context: { now, policyConfig },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    if (parsed.thresholds !== undefined) {
      assertValidProjectBottleneckThresholds(parsed.thresholds);
    }

    const mergedThresholds: ProjectBottleneckThresholds = {
      ...project.bottleneckThresholds,
      ...parsed.thresholds,
    };
    const resolvedThresholds = normalizeProjectBottleneckThresholds(mergedThresholds);
    const nextInactivityDays = parsed.inactivityThresholdDays ?? project.inactivityThresholdDays;

    const updatedProject = await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PROJECTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        const saved = await this.deps.workContext.updateProjectBottleneckRules({
          organizationId: validatedOrgId,
          projectId: validatedProjectId,
          inactivityThresholdDays: nextInactivityDays,
          bottleneckThresholds: resolvedThresholds,
          now,
        });

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'bottleneck.rules.updated',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          before: {
            inactivityThresholdDays: project.inactivityThresholdDays,
            bottleneckThresholds: project.bottleneckThresholds ?? null,
          },
          after: {
            inactivityThresholdDays: saved.inactivityThresholdDays,
            bottleneckThresholds: resolvedThresholds,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        return saved;
      },
    );

    await this.deps.eventBus.publish(
      createDomainEvent({
        eventId: asEventId(this.nextUuid()),
        eventType: 'bottleneck.rules.updated',
        occurredAt: now,
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        correlationId,
        aggregateType: 'Project',
        aggregateId: validatedProjectId,
        payload: {
          projectId: validatedProjectId,
          inactivityThresholdDays: updatedProject.inactivityThresholdDays,
          thresholds: resolvedThresholds,
        },
      }),
    );

    return Object.freeze({
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      inactivityThresholdDays: updatedProject.inactivityThresholdDays,
      thresholds: resolvedThresholds,
      updatedAt: now,
    });
  }

  async getIndividualProductivityVisibility(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<IndividualProductivityVisibilityResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const [org, actor, settings] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const effectiveSettings = settings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: org !== null,
        organizationId: validatedOrgId,
        ...(org?.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
      },
      context: { now, policyConfig },
    });

    return Object.freeze({
      organizationId: validatedOrgId,
      allowManagerViewIndividualProductivity:
        effectiveSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity,
      updatedAt: effectiveSettings.updatedAt,
    });
  }

  async updateIndividualProductivityVisibility(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: UpdateIndividualProductivityVisibilityInput,
  ): Promise<IndividualProductivityVisibilityResult> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(updateIndividualProductivityVisibilitySchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [org, actor, existingSettings] = await Promise.all([
      this.deps.organizations.findById(validatedOrgId),
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.organizationSettings.findByOrganization(validatedOrgId),
    ]);

    const effectiveSettings =
      existingSettings ?? createDefaultOrganizationSettings(validatedOrgId, now);
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
      resource: {
        kind: 'ORGANIZATION',
        id: asEntityId(validatedOrgId),
        exists: org !== null,
        organizationId: validatedOrgId,
        ...(org?.deletedAt !== undefined ? { deletedAt: org.deletedAt } : {}),
      },
      context: { now, policyConfig },
    });

    const previousValue =
      effectiveSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity;

    const updatedSettings = await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.ORGANIZATION_SETTINGS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        const current =
          (await this.deps.organizationSettings.findByOrganization(validatedOrgId)) ??
          createDefaultOrganizationSettings(validatedOrgId, now);

        const nextSettings = Object.freeze({
          ...current,
          pendingPermissionDefaults: Object.freeze({
            ...current.pendingPermissionDefaults,
            allowManagerViewIndividualProductivity: parsed.allowManagerViewIndividualProductivity,
          }),
          updatedAt: now,
        });

        await this.deps.organizationSettings.save(nextSettings);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'organization.productivity_visibility.updated',
          resourceType: 'OrganizationSettings',
          resourceId: validatedOrgId,
          before: { allowManagerViewIndividualProductivity: previousValue },
          after: {
            allowManagerViewIndividualProductivity: parsed.allowManagerViewIndividualProductivity,
          },
          ...(parsed.justification !== undefined && parsed.justification.length > 0
            ? { justification: parsed.justification }
            : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        return nextSettings;
      },
    );

    await this.deps.eventBus.publish(
      createDomainEvent({
        eventId: asEventId(this.nextUuid()),
        eventType: 'organization.productivity_visibility.updated',
        occurredAt: now,
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        correlationId,
        aggregateType: 'OrganizationSettings',
        aggregateId: validatedOrgId,
        payload: {
          allowManagerViewIndividualProductivity:
            updatedSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity,
        },
      }),
    );

    return Object.freeze({
      organizationId: validatedOrgId,
      allowManagerViewIndividualProductivity:
        updatedSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity,
      updatedAt: updatedSettings.updatedAt,
    });
  }
}
