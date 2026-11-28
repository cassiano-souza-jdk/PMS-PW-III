import type {
  AnalyticsActorProfileSnapshot,
  AnalyticsAuditRecordInput,
  AnalyticsBottleneckAlertSnapshot,
  AnalyticsCalibratableWeightsSnapshot,
  AnalyticsCatalogVersionSnapshot,
  AnalyticsExecutionCycleSnapshot,
  AnalyticsFeedbackContestDecisionSnapshot,
  AnalyticsFeedbackContestSnapshot,
  AnalyticsFeedbackCycleSnapshot,
  AnalyticsFeedbackSnapshot,
  AnalyticsGovernancePort,
  AnalyticsImpedimentSnapshot,
  AnalyticsOrganizationSettingsSnapshot,
  AnalyticsProjectSnapshot,
  AnalyticsSubtaskSnapshot,
  AnalyticsTaskPauseSnapshot,
  AnalyticsWorkContextPort,
  AnalyticsWorkTaskSnapshot,
} from '@/modules/analytics';
import { AUDIT_CATEGORIES, AUDIT_RESULTS } from '@/modules/audit';
import {
  calculateSlaElapsedMs,
  evaluateSlaStatus,
  type FeedbackCycle,
  type FeedbackSlaSnapshot,
} from '@/modules/feedback';
import { isImpedimentBlocking, type Impediment } from '@/modules/impediments';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import type {
  ReportExportAuditInput,
  ReportSubjectLabelsSnapshot,
  ReportsContextPort,
} from '@/modules/reports';
import { createDefaultOrganizationSettings, toAuthorizationPolicyConfig } from '@/modules/settings';
import {
  IMPEDIMENT_SEVERITIES,
  MEMBERSHIP_STATUSES,
  asAuditEventId,
  asCorrelationId,
  asIsoDateTime,
  isSoftDeleted,
  type AuditEventId,
  type ImpedimentSeverity,
  type IsoDateTime,
  type OrganizationId,
  type ProjectId,
  type TaskId,
  type UserId,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';
import { resolveActorProjectScopes } from './task-ports-adapter';

export interface AnalyticsPortsAdapterOptions {
  readonly repositories: AppRepositoriesRegistry;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

const IMPEDIMENT_SEVERITY_RANK: Readonly<Record<ImpedimentSeverity, number>> = {
  [IMPEDIMENT_SEVERITIES.LOW]: 1,
  [IMPEDIMENT_SEVERITIES.MEDIUM]: 2,
  [IMPEDIMENT_SEVERITIES.HIGH]: 3,
  [IMPEDIMENT_SEVERITIES.CRITICAL]: 4,
};

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

function resolveMaxImpedimentSeverity(
  impediments: readonly Impediment[],
): ImpedimentSeverity | undefined {
  let maxSeverity: ImpedimentSeverity | undefined;
  let maxRank = 0;

  for (const impediment of impediments) {
    if (!isImpedimentBlocking(impediment)) {
      continue;
    }
    const rank = IMPEDIMENT_SEVERITY_RANK[impediment.severity];
    if (rank > maxRank) {
      maxRank = rank;
      maxSeverity = impediment.severity;
    }
  }

  return maxSeverity;
}

function computeCycleSlaState(
  cycle: FeedbackCycle,
  slaSnapshot: FeedbackSlaSnapshot | undefined,
  evaluatedAt: IsoDateTime,
): 'ON_TRACK' | 'WARNING' | 'BREACHED' {
  if (cycle.firstResponseBreachedAt !== undefined || cycle.resolutionBreachedAt !== undefined) {
    return 'BREACHED';
  }
  if (!slaSnapshot) {
    if (cycle.firstResponseWarningAt !== undefined || cycle.resolutionWarningAt !== undefined) {
      return 'WARNING';
    }
    return 'ON_TRACK';
  }

  const firstResponseEnd =
    cycle.firstRespondedAt ?? cycle.resolvedAt ?? cycle.closedAt ?? evaluatedAt;
  let firstResponseStatus: 'ON_TRACK' | 'WARNING' | 'BREACHED' = 'ON_TRACK';
  if (firstResponseEnd >= cycle.startedAt) {
    const firstElapsed = calculateSlaElapsedMs({
      target: 'FIRST_RESPONSE',
      snapshot: slaSnapshot,
      startedAt: cycle.startedAt,
      evaluatedAt: firstResponseEnd,
    });
    firstResponseStatus = evaluateSlaStatus(firstElapsed, slaSnapshot.firstResponseTargetMs);
  }

  const resolutionEnd = cycle.resolvedAt ?? cycle.closedAt ?? evaluatedAt;
  let resolutionStatus: 'ON_TRACK' | 'WARNING' | 'BREACHED' = 'ON_TRACK';
  if (resolutionEnd >= cycle.startedAt) {
    const resElapsed = calculateSlaElapsedMs({
      target: 'RESOLUTION',
      snapshot: slaSnapshot,
      startedAt: cycle.startedAt,
      evaluatedAt: resolutionEnd,
      ...(cycle.waitingInfoPauses !== undefined
        ? { waitingInfoPauses: cycle.waitingInfoPauses }
        : {}),
    });
    resolutionStatus = evaluateSlaStatus(resElapsed, slaSnapshot.resolutionTargetMs);
  }

  if (firstResponseStatus === 'BREACHED' || resolutionStatus === 'BREACHED') {
    return 'BREACHED';
  }
  if (
    firstResponseStatus === 'WARNING' ||
    resolutionStatus === 'WARNING' ||
    cycle.firstResponseWarningAt !== undefined ||
    cycle.resolutionWarningAt !== undefined
  ) {
    return 'WARNING';
  }
  return 'ON_TRACK';
}

/**
 * Anti-cycle composition adapter implementing `AnalyticsWorkContextPort`,
 * `AnalyticsGovernancePort` and `ReportsContextPort` over the Dexie v2 repositories
 * without leaking cross-module imports into `analytics` or `reports` (ADR-0014 §4–§5).
 */
export class DexieAnalyticsPortsAdapter
  implements AnalyticsWorkContextPort, AnalyticsGovernancePort, ReportsContextPort
{
  private readonly repositories: AppRepositoriesRegistry;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(options: AnalyticsPortsAdapterOptions) {
    this.repositories = options.repositories;
    this.now = options.now ?? defaultNowIso;
    this.nextUuid = options.generateUuid ?? defaultUuidGenerator;
  }

  async getActorProfile(
    organizationId: OrganizationId,
    actorUserId: UserId,
  ): Promise<AnalyticsActorProfileSnapshot | null> {
    const [org, membership, settings, scopes] = await Promise.all([
      this.repositories.organizations.organizations.findById(organizationId),
      this.repositories.organizations.organizationMembers.findByOrganizationAndUser(
        organizationId,
        actorUserId,
      ),
      this.repositories.settings.organizationSettings.findByOrganization(organizationId),
      resolveActorProjectScopes(this.repositories, organizationId, actorUserId),
    ]);

    if (
      !org ||
      isSoftDeleted(org) ||
      !membership ||
      membership.status !== MEMBERSHIP_STATUSES.ACTIVE
    ) {
      return null;
    }

    return Object.freeze({
      organizationId,
      userId: actorUserId,
      role: membership.role,
      membershipStatus: membership.status,
      managedProjectIds: Object.freeze([...scopes.managedProjectIds]),
      participatedProjectIds: Object.freeze([...scopes.participatedProjectIds]),
      allowManagerViewIndividualProductivity:
        settings?.pendingPermissionDefaults.allowManagerViewIndividualProductivity ?? false,
      isDemoOrganization: org.isDemo,
    });
  }

  async listProjects(organizationId: OrganizationId): Promise<readonly AnalyticsProjectSnapshot[]> {
    const projects = await this.repositories.projects.projects.listByOrganization(organizationId, {
      includeArchived: true,
      includeDeleted: true,
    });

    const membersPerProject = await Promise.all(
      projects.map((project) =>
        this.repositories.projects.projectMembers.listByProject(organizationId, project.id),
      ),
    );

    return projects.map((project, index) => {
      const members = (membersPerProject[index] ?? []).filter(
        (member) => member.removedAt === undefined,
      );
      const managerUserIds = members
        .filter((member) => member.projectRole === PROJECT_MEMBER_ROLES.MANAGER)
        .map((member) => member.userId);
      const memberUserIds = members.map((member) => member.userId);

      return Object.freeze({
        projectId: project.id,
        name: project.name,
        status: project.status,
        ...(project.teamId !== undefined ? { teamId: project.teamId } : {}),
        ownerUserId: project.ownerUserId,
        ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
        ...(project.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
        inactivityThresholdDays: project.inactivityThresholdDays,
        managerUserIds: Object.freeze(managerUserIds),
        memberUserIds: Object.freeze(memberUserIds),
        isDeleted: isSoftDeleted(project),
      });
    });
  }

  async listTasks(organizationId: OrganizationId): Promise<readonly AnalyticsWorkTaskSnapshot[]> {
    const [tasks, participants, openImpediments] = await Promise.all([
      this.repositories.tasks.tasks.listByOrganization(organizationId, { includeDeleted: true }),
      this.repositories.tasks.taskParticipants.listByOrganization(organizationId),
      this.repositories.impediments.impediments.listOpenByOrganization(organizationId),
    ]);

    const participantsByTaskId = new Map<TaskId, UserId[]>();
    for (const participant of participants) {
      if (participant.removedAt !== undefined) {
        continue;
      }
      const list = participantsByTaskId.get(participant.taskId);
      if (list) {
        list.push(participant.userId);
      } else {
        participantsByTaskId.set(participant.taskId, [participant.userId]);
      }
    }

    const blockingImpedimentsByTaskId = new Map<TaskId, Impediment[]>();
    for (const imp of openImpediments) {
      if (!isImpedimentBlocking(imp)) {
        continue;
      }
      const list = blockingImpedimentsByTaskId.get(imp.taskId);
      if (list) {
        list.push(imp);
      } else {
        blockingImpedimentsByTaskId.set(imp.taskId, [imp]);
      }
    }

    return tasks.map((task) => {
      const taskParticipants = participantsByTaskId.get(task.id) ?? [];
      const assigneeSet = new Set<UserId>(taskParticipants);
      if (task.assigneeId !== undefined) {
        assigneeSet.add(task.assigneeId);
      }
      const maxSeverity = resolveMaxImpedimentSeverity(
        blockingImpedimentsByTaskId.get(task.id) ?? [],
      );

      return Object.freeze({
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        createdByUserId: task.createdByUserId,
        ...(task.assigneeId !== undefined ? { primaryAssigneeId: task.assigneeId } : {}),
        participantUserIds: Object.freeze([...taskParticipants]),
        assigneeUserIds: Object.freeze([...assigneeSet]),
        createdAt: task.createdAt,
        lastMovedAt: task.lastMovedAt,
        ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
        ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt } : {}),
        ...(maxSeverity !== undefined ? { openImpedimentsMaxSeverity: maxSeverity } : {}),
        isDeleted: isSoftDeleted(task),
      });
    });
  }

  async listExecutionCycles(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsExecutionCycleSnapshot[]> {
    const cycles =
      await this.repositories.tasks.taskExecutionCycles.listByOrganization(organizationId);
    return cycles.map((cycle) =>
      Object.freeze({
        cycleId: cycle.id,
        taskId: cycle.taskId,
        projectId: cycle.projectId,
        cycleNumber: cycle.cycleNumber,
        startedAt: cycle.startedAt,
        ...(cycle.effectiveStartedAt !== undefined
          ? { effectiveStartedAt: cycle.effectiveStartedAt }
          : {}),
        ...(cycle.completedAt !== undefined ? { completedAt: cycle.completedAt } : {}),
      }),
    );
  }

  async listTaskPauses(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsTaskPauseSnapshot[]> {
    const pauses = await this.repositories.tasks.taskPauses.listByOrganization(organizationId);
    return pauses.map((pause) =>
      Object.freeze({
        pauseId: pause.id,
        taskId: pause.taskId,
        cycleId: pause.cycleId,
        startedAt: pause.startedAt,
        ...(pause.endedAt !== undefined ? { endedAt: pause.endedAt } : {}),
      }),
    );
  }

  async listImpediments(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsImpedimentSnapshot[]> {
    const projects = await this.repositories.projects.projects.listByOrganization(organizationId, {
      includeArchived: true,
      includeDeleted: true,
    });
    const impedimentsByProject = await Promise.all(
      projects.map((project) =>
        this.repositories.impediments.impediments.listByProject(organizationId, project.id),
      ),
    );

    return impedimentsByProject.flat().map((imp) =>
      Object.freeze({
        impedimentId: imp.id,
        taskId: imp.taskId,
        projectId: imp.projectId,
        category: imp.category,
        severity: imp.severity,
        status: imp.status,
        openedAt: imp.openedAt,
        ...(imp.resolvedAt !== undefined ? { resolvedAt: imp.resolvedAt } : {}),
      }),
    );
  }

  async listFeedbacks(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackSnapshot[]> {
    const [feedbacks, cycles] = await Promise.all([
      this.repositories.feedback.feedbacks.listByOrganization(organizationId),
      this.repositories.feedback.feedbackCycles.listByOrganization(organizationId),
    ]);

    const cyclesByFeedbackId = new Map<string, FeedbackCycle[]>();
    for (const cycle of cycles) {
      const list = cyclesByFeedbackId.get(cycle.feedbackId);
      if (list) {
        list.push(cycle);
      } else {
        cyclesByFeedbackId.set(cycle.feedbackId, [cycle]);
      }
    }

    return feedbacks.map((fb) => {
      const fbCycles = (cyclesByFeedbackId.get(fb.id) ?? []).sort(
        (a, b) => a.cycleNumber - b.cycleNumber,
      );
      const firstResponseAt = fbCycles.find(
        (c) => c.firstRespondedAt !== undefined,
      )?.firstRespondedAt;
      const latestCycle = fbCycles[fbCycles.length - 1];
      const resolvedAt =
        latestCycle?.resolvedAt ??
        [...fbCycles].reverse().find((c) => c.resolvedAt !== undefined)?.resolvedAt;

      return Object.freeze({
        feedbackId: fb.id,
        authorUserId: fb.authorUserId,
        ...(fb.assigneeId !== undefined ? { assigneeUserId: fb.assigneeId } : {}),
        moduleKey: fb.moduleKey,
        priority: fb.priority,
        status: fb.status,
        currentCycleId: fb.currentCycleId,
        categoryId: fb.categoryId,
        categoryVersionId: fb.categoryVersionId,
        createdAt: fb.createdAt,
        ...(firstResponseAt !== undefined ? { firstResponseAt } : {}),
        ...(resolvedAt !== undefined ? { resolvedAt } : {}),
        ...(fb.closedAt !== undefined ? { closedAt: fb.closedAt } : {}),
        ...(fb.closureReason !== undefined ? { closureReason: fb.closureReason } : {}),
      });
    });
  }

  async listFeedbackCycles(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackCycleSnapshot[]> {
    const now = this.now();
    const [cycles, slaSnapshots] = await Promise.all([
      this.repositories.feedback.feedbackCycles.listByOrganization(organizationId),
      this.repositories.feedback.feedbackSlaSnapshots.listByOrganization(organizationId),
    ]);

    const snapshotByCycleId = new Map<string, FeedbackSlaSnapshot>(
      slaSnapshots.map((snapshot) => [snapshot.cycleId, snapshot]),
    );

    return cycles.map((cycle) => {
      const slaSnapshot = snapshotByCycleId.get(cycle.id);
      const slaState = computeCycleSlaState(cycle, slaSnapshot, now);

      return Object.freeze({
        cycleId: cycle.id,
        feedbackId: cycle.feedbackId,
        cycleNumber: cycle.cycleNumber,
        origin: cycle.origin,
        status: cycle.status,
        ...(cycle.assigneeId !== undefined ? { assigneeUserId: cycle.assigneeId } : {}),
        openedAt: cycle.startedAt,
        ...(cycle.firstRespondedAt !== undefined
          ? { firstRespondedAt: cycle.firstRespondedAt }
          : {}),
        ...(cycle.resolvedAt !== undefined ? { resolvedAt: cycle.resolvedAt } : {}),
        ...(cycle.closedAt !== undefined ? { closedAt: cycle.closedAt } : {}),
        slaState,
        ...(cycle.firstResponseWarningAt !== undefined
          ? { firstResponseWarningAt: cycle.firstResponseWarningAt }
          : {}),
        ...(cycle.firstResponseBreachedAt !== undefined
          ? { firstResponseBreachedAt: cycle.firstResponseBreachedAt }
          : {}),
        ...(cycle.resolutionWarningAt !== undefined
          ? { resolutionWarningAt: cycle.resolutionWarningAt }
          : {}),
        ...(cycle.resolutionBreachedAt !== undefined
          ? { resolutionBreachedAt: cycle.resolutionBreachedAt }
          : {}),
      });
    });
  }

  async listFeedbackContests(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackContestSnapshot[]> {
    const contests =
      await this.repositories.feedback.feedbackContests.listByOrganization(organizationId);
    return contests.map((contest) =>
      Object.freeze({
        contestId: contest.id,
        feedbackId: contest.feedbackId,
        cycleId: contest.cycleId,
        status: contest.status,
        reasonId: contest.reasonId,
        reasonVersionId: contest.reasonVersionId,
        openedAt: contest.openedAt,
      }),
    );
  }

  async listFeedbackContestDecisions(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsFeedbackContestDecisionSnapshot[]> {
    const decisions =
      await this.repositories.feedback.feedbackContests.listDecisionsByOrganization(organizationId);
    return decisions.map((decision) =>
      Object.freeze({
        decisionId: decision.id,
        contestId: decision.contestId,
        decision: decision.outcome,
        decidedAt: decision.decidedAt,
      }),
    );
  }

  async listFeedbackCategoryVersions(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsCatalogVersionSnapshot[]> {
    const [categories, versions] = await Promise.all([
      this.repositories.feedback.feedbackCategories.listByOrganization(organizationId, {
        includeInactive: true,
        includeDeleted: true,
      }),
      this.repositories.feedback.feedbackCategories.listAllVersionsByOrganization(organizationId),
    ]);

    const categoryCodeById = new Map(categories.map((cat) => [cat.id, cat.code]));
    return versions.map((version) =>
      Object.freeze({
        versionId: version.id,
        entryId: version.categoryId,
        code: categoryCodeById.get(version.categoryId) ?? version.categoryId,
        name: version.name,
        versionNumber: version.versionNumber,
      }),
    );
  }

  async listFeedbackContestReasonVersions(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsCatalogVersionSnapshot[]> {
    const [reasons, versions] = await Promise.all([
      this.repositories.feedback.feedbackContestReasons.listByOrganization(organizationId, {
        includeInactive: true,
        includeDeleted: true,
      }),
      this.repositories.feedback.feedbackContestReasons.listAllVersionsByOrganization(
        organizationId,
      ),
    ]);

    const reasonCodeById = new Map(reasons.map((reason) => [reason.id, reason.code]));
    return versions.map((version) =>
      Object.freeze({
        versionId: version.id,
        entryId: version.reasonId,
        code: reasonCodeById.get(version.reasonId) ?? version.reasonId,
        name: version.name,
        versionNumber: version.versionNumber,
      }),
    );
  }

  async getOrganizationSettings(
    organizationId: OrganizationId,
  ): Promise<AnalyticsOrganizationSettingsSnapshot | null> {
    const [org, settings] = await Promise.all([
      this.repositories.organizations.organizations.findById(organizationId),
      this.repositories.settings.organizationSettings.findByOrganization(organizationId),
    ]);

    if (!org || isSoftDeleted(org)) {
      return null;
    }

    const resolved = settings ?? createDefaultOrganizationSettings(organizationId, org.createdAt);
    return Object.freeze({
      organizationId,
      organizationExists: true,
      isDemoOrganization: org.isDemo,
      allowManagerViewIndividualProductivity:
        resolved.pendingPermissionDefaults.allowManagerViewIndividualProductivity,
      policyConfig: toAuthorizationPolicyConfig(resolved),
      calibratableWeights: resolved.calibratableWeights,
      updatedAt: resolved.updatedAt,
    });
  }

  async saveCalibratableWeights(
    organizationId: OrganizationId,
    weights: AnalyticsCalibratableWeightsSnapshot,
    updatedAt: IsoDateTime,
  ): Promise<AnalyticsOrganizationSettingsSnapshot> {
    const existingSettings =
      await this.repositories.settings.organizationSettings.findByOrganization(organizationId);

    const baseSettings =
      existingSettings ?? createDefaultOrganizationSettings(organizationId, updatedAt);

    const updated = Object.freeze({
      ...baseSettings,
      calibratableWeights: Object.freeze({ ...weights }),
      updatedAt,
    });

    await this.repositories.settings.organizationSettings.save(updated);

    return Object.freeze({
      organizationId,
      organizationExists: true,
      isDemoOrganization: false,
      allowManagerViewIndividualProductivity:
        updated.pendingPermissionDefaults.allowManagerViewIndividualProductivity,
      policyConfig: toAuthorizationPolicyConfig(updated),
      calibratableWeights: updated.calibratableWeights,
      updatedAt: updated.updatedAt,
    });
  }

  async appendAuditEvent(input: AnalyticsAuditRecordInput): Promise<AuditEventId> {
    const id = asAuditEventId(this.nextUuid());
    await this.repositories.audit.auditEvents.append({
      id,
      organizationId: input.organizationId,
      actorId: input.actorUserId,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      occurredAt: input.occurredAt,
      category:
        input.category === 'EXPORT'
          ? AUDIT_CATEGORIES.EXPORT
          : input.category === 'PROJECT'
            ? AUDIT_CATEGORIES.PROJECT
            : AUDIT_CATEGORIES.ORGANIZATION,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {}),
      result: AUDIT_RESULTS.SUCCESS,
      ...(input.justification !== undefined ? { justification: input.justification } : {}),
      correlationId: input.correlationId,
    });
    return id;
  }

  async listBottleneckAlerts(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsBottleneckAlertSnapshot[]> {
    const alerts =
      await this.repositories.bottlenecks.bottleneckAlerts.listByOrganization(organizationId);
    return alerts.map((alert) =>
      Object.freeze({
        alertId: alert.id,
        ...(alert.projectId !== undefined ? { projectId: alert.projectId } : {}),
        indicator: alert.indicator,
        severity: alert.severity,
        status: alert.status,
        targetEntityType: alert.targetEntityType,
        targetEntityId: alert.targetEntityId,
        summary: alert.summary,
        detectedAt: alert.detectedAt,
        lastSeenAt: alert.lastSeenAt,
        ...(alert.resolvedAt !== undefined ? { resolvedAt: alert.resolvedAt } : {}),
      }),
    );
  }

  async listSubtasks(organizationId: OrganizationId): Promise<readonly AnalyticsSubtaskSnapshot[]> {
    const [subtasks, tasks] = await Promise.all([
      this.repositories.tasks.subtasks.listByOrganization(organizationId),
      this.repositories.tasks.tasks.listByOrganization(organizationId, { includeDeleted: true }),
    ]);

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const snapshots: AnalyticsSubtaskSnapshot[] = [];

    for (const subtask of subtasks) {
      const parentTask = tasksById.get(subtask.taskId);
      if (!parentTask) {
        continue;
      }
      snapshots.push(
        Object.freeze({
          subtaskId: subtask.id,
          taskId: subtask.taskId,
          projectId: parentTask.projectId,
          status: subtask.status,
          ...(subtask.assigneeId !== undefined ? { assigneeId: subtask.assigneeId } : {}),
          priority: parentTask.priority,
          ...(parentTask.dueDate !== undefined ? { dueDate: parentTask.dueDate } : {}),
          ...(parentTask.deletedAt !== undefined
            ? { parentTaskDeletedAt: parentTask.deletedAt }
            : {}),
        }),
      );
    }

    return snapshots;
  }

  async listUserDisplayNames(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const [members, users] = await Promise.all([
      this.repositories.organizations.organizationMembers.listByOrganization(organizationId),
      this.repositories.users.users.findByIds(uniqueIds),
    ]);

    const orgMemberUserIds = new Set(members.map((member) => member.userId));
    const displayNames = new Map<UserId, string>();
    for (const user of users) {
      if (orgMemberUserIds.has(user.id)) {
        displayNames.set(user.id, user.displayName);
      }
    }
    return displayNames;
  }

  async getSubjectLabels(
    organizationId: OrganizationId,
    projectId?: ProjectId,
  ): Promise<ReportSubjectLabelsSnapshot | null> {
    const org = await this.repositories.organizations.organizations.findById(organizationId);
    if (!org || isSoftDeleted(org)) {
      return null;
    }

    const project =
      projectId !== undefined
        ? await this.repositories.projects.projects.findById(organizationId, projectId)
        : null;

    return Object.freeze({
      organizationId,
      organizationName: org.name,
      isDemoOrganization: org.isDemo,
      ...(project !== null && !isSoftDeleted(project)
        ? { projectId: project.id, projectName: project.name }
        : {}),
    });
  }

  async recordExportAuditEvent(input: ReportExportAuditInput): Promise<AuditEventId> {
    const id = asAuditEventId(this.nextUuid());
    await this.repositories.audit.auditEvents.append({
      id,
      organizationId: input.organizationId,
      actorId: input.actorUserId,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      occurredAt: this.now(),
      category: AUDIT_CATEGORIES.EXPORT,
      eventType: 'report.exported',
      resourceType: input.projectId !== undefined ? 'Project' : 'Organization',
      resourceId: input.projectId ?? input.organizationId,
      after: {
        kind: input.kind,
        scope: input.scope,
        format: input.format,
        rowCount: input.rowCount,
        snapshotGeneratedAt: input.snapshotGeneratedAt,
        includesThirdPartyIndividualMetrics: input.includesThirdPartyIndividualMetrics,
      },
      result: AUDIT_RESULTS.SUCCESS,
      correlationId: asCorrelationId(this.nextUuid()),
    });
    return id;
  }
}

export function createAnalyticsPortsAdapter(
  options: AnalyticsPortsAdapterOptions,
): DexieAnalyticsPortsAdapter {
  return new DexieAnalyticsPortsAdapter(options);
}
