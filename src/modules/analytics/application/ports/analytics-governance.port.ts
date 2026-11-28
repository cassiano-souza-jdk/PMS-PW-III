import type { AuthorizationPolicyConfig } from '@/modules/authorization';
import type {
  AuditEventId,
  BottleneckSeverity,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  Priority,
  ProjectId,
  TaskId,
  UserId,
} from '@/shared/kernel';

/**
 * Anti-corruption governance/settings/audit/labels port for Analytics (ADR-0014 §4–§5).
 *
 * Keeps `src/modules/analytics/**` strictly decoupled from `settings`, `audit`, `organizations`,
 * `bottlenecks`, `tasks` and `users` while allowing `AnalyticsService` to evaluate ABAC rules,
 * manage `calibratableWeights` with post-commit `AuditEvent`, and consolidate historical workload
 * and bottleneck snapshots.
 */
export interface AnalyticsCalibratableWeightsSnapshot {
  readonly workloadPriorityWeight: number;
  readonly workloadDelayWeight: number;
  readonly workloadImpedimentsWeight: number;
  readonly workloadOperationalStateWeight: number;
  readonly workloadPausedFactor: number;
  readonly focusPriorityWeight: number;
  readonly focusDeadlineWeight: number;
  readonly focusDependenciesWeight: number;
  readonly focusInactivityWeight: number;
  readonly focusWorkloadCompatibilityWeight: number;
  readonly defaultProjectInactivityThresholdDays: number;
}

export interface AnalyticsOrganizationSettingsSnapshot {
  readonly organizationId: OrganizationId;
  readonly organizationExists: boolean;
  readonly isDemoOrganization: boolean;
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly policyConfig: AuthorizationPolicyConfig;
  readonly calibratableWeights: AnalyticsCalibratableWeightsSnapshot;
  readonly updatedAt: IsoDateTime;
}

export interface AnalyticsBottleneckAlertSnapshot {
  readonly alertId: string;
  readonly projectId?: ProjectId;
  readonly indicator: string;
  readonly severity: BottleneckSeverity;
  readonly status: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly summary: string;
  readonly detectedAt: IsoDateTime;
  readonly lastSeenAt: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
}

export interface AnalyticsSubtaskSnapshot {
  readonly subtaskId: string;
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly status: 'OPEN' | 'DONE' | 'CANCELLED';
  readonly assigneeId?: UserId;
  readonly priority: Priority;
  readonly dueDate?: IsoDateTime;
  readonly parentTaskDeletedAt?: IsoDateTime;
}

export interface AnalyticsAuditRecordInput {
  readonly organizationId: OrganizationId;
  readonly actorUserId: UserId;
  readonly projectId?: ProjectId;
  readonly occurredAt: IsoDateTime;
  readonly category: 'ORGANIZATION' | 'PROJECT' | 'EXPORT';
  readonly eventType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly justification?: string;
  readonly correlationId: CorrelationId;
}

export interface AnalyticsGovernancePort {
  getOrganizationSettings(
    organizationId: OrganizationId,
  ): Promise<AnalyticsOrganizationSettingsSnapshot | null>;
  saveCalibratableWeights(
    organizationId: OrganizationId,
    weights: AnalyticsCalibratableWeightsSnapshot,
    updatedAt: IsoDateTime,
  ): Promise<AnalyticsOrganizationSettingsSnapshot>;
  appendAuditEvent(input: AnalyticsAuditRecordInput): Promise<AuditEventId>;
  listBottleneckAlerts(
    organizationId: OrganizationId,
  ): Promise<readonly AnalyticsBottleneckAlertSnapshot[]>;
  listSubtasks(organizationId: OrganizationId): Promise<readonly AnalyticsSubtaskSnapshot[]>;
  listUserDisplayNames(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>>;
}
