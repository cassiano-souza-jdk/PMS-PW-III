import { z } from 'zod';
import {
  ANALYTICS_PERIOD_PRESETS,
  type AnalyticsGovernancePort,
  type AnalyticsOverview,
  type AnalyticsProjectSnapshot,
  type AnalyticsService,
  type AnalyticsWorkContextPort,
} from '@/modules/analytics';
import {
  PERMISSION_CODES,
  assertAuthorized,
  evaluateAuthorization,
  type AuthorizationActor,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import { NotFoundError, ValidationError } from '@/shared/errors';
import {
  EXPORT_FORMATS,
  MEMBERSHIP_STATUSES,
  METRIC_AVAILABILITY_STATUSES,
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
  assertValidDateRange,
  createDomainEvent,
  isMetricAvailable,
  isUuid,
  type CorrelationId,
  type DomainEventPublisherPort,
  type ExportFormat,
  type IsoDateTime,
  type MetricValue,
  type OrganizationId,
  type ProjectId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  REPORT_CATALOG,
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  assertValidReportFilters,
  type ReportFilters,
  type ReportKind,
  type ReportScope,
} from '../../domain/report-catalog';
import type {
  ReportCatalogEntryView,
  ReportColumn,
  ReportExportResult,
  ReportKpiItem,
  ReportRow,
  ReportSnapshot,
} from '../../domain/report-snapshot';
import {
  exportReportToCsv,
  exportReportToJson,
  exportReportToPdf,
  exportReportToXlsx,
} from '../exporters';
import type { ReportsContextPort } from '../ports/reports-context.port';

export const REPORT_TITLES: Readonly<Record<ReportKind, string>> = Object.freeze({
  [REPORT_KINDS.PROJECT_DELIVERY_FLOW]: 'Entrega & Fluxo por Projeto',
  [REPORT_KINDS.PRODUCTIVITY_WORKLOAD]: 'Produtividade e Carga',
  [REPORT_KINDS.FEEDBACK_SLA_CONTESTS]: 'Feedbacks, SLA & Contestações',
  [REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY]: 'Resumo Executivo Organizacional',
});

const reportKindSchema = z.enum([
  REPORT_KINDS.PROJECT_DELIVERY_FLOW,
  REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
  REPORT_KINDS.FEEDBACK_SLA_CONTESTS,
  REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
]);

const reportScopeSchema = z.enum([REPORT_SCOPES.PROJECT, REPORT_SCOPES.ORGANIZATION]);

const reportFormatSchema = z.enum([
  REPORT_FORMATS.JSON,
  REPORT_FORMATS.CSV,
  REPORT_FORMATS.PDF,
  REPORT_FORMATS.XLSX,
]);

const previewReportSchema = z
  .object({
    kind: reportKindSchema,
    scope: reportScopeSchema,
    projectId: z.string().uuid().optional(),
    period: z
      .object({
        start: z.string().min(1),
        end: z.string().min(1),
      })
      .strict(),
    compareWithPreviousPeriod: z.boolean().optional(),
  })
  .strict();

const exportReportSchema = previewReportSchema.extend({
  format: reportFormatSchema,
  correlationId: z.string().uuid().optional(),
});

export interface PreviewReportInput {
  readonly kind: ReportKind;
  readonly scope: ReportScope;
  readonly projectId?: ProjectId;
  readonly period: {
    readonly start: IsoDateTime;
    readonly end: IsoDateTime;
  };
  readonly compareWithPreviousPeriod?: boolean;
}

export interface ExportReportInput extends PreviewReportInput {
  readonly format: ExportFormat;
  readonly correlationId?: CorrelationId;
}

export interface ReportServiceDependencies {
  readonly reportsContext: ReportsContextPort;
  readonly analyticsService: AnalyticsService;
  readonly analyticsWorkContext: AnalyticsWorkContextPort;
  readonly analyticsGovernance: AnalyticsGovernancePort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
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

function formatDurationMetric(metric: MetricValue<number>): ReportKpiItem['value'] {
  if (!isMetricAvailable(metric)) {
    return `Indisponivel (${metric.reason})`;
  }
  const hours = Math.round((metric.value / (60 * 60 * 1000)) * 10) / 10;
  return `${hours} h`;
}

function formatCountMetric(metric: MetricValue<number>): string {
  if (!isMetricAvailable(metric)) {
    return `Indisponivel (${metric.reason})`;
  }
  return String(metric.value);
}

function formatPercentMetric(metric: MetricValue<number>): string {
  if (!isMetricAvailable(metric)) {
    return `Indisponivel (${metric.reason})`;
  }
  const pct = Math.round(metric.value * 1000) / 10;
  return `${pct}%`;
}

function makeMetricKpi(
  key: string,
  label: string,
  metric: MetricValue<number>,
  formatter: (m: MetricValue<number>) => string,
): ReportKpiItem {
  return Object.freeze({
    key,
    label,
    value: formatter(metric),
    ...(metric.status === METRIC_AVAILABILITY_STATUSES.UNAVAILABLE
      ? { unavailableReason: metric.reason }
      : {}),
  });
}

function getExportMetadata(
  format: ExportFormat,
  kind: ReportKind,
  organizationId: OrganizationId,
): { readonly mimeType: string; readonly extension: string; readonly slug: string } {
  const slug = kind.toLowerCase().replaceAll('_', '-');
  switch (format) {
    case EXPORT_FORMATS.JSON:
      return {
        mimeType: 'application/json',
        extension: 'json',
        slug: `${slug}-${organizationId}`,
      };
    case EXPORT_FORMATS.CSV:
      return {
        mimeType: 'text/csv',
        extension: 'csv',
        slug: `${slug}-${organizationId}`,
      };
    case EXPORT_FORMATS.PDF:
      return {
        mimeType: 'application/pdf',
        extension: 'pdf',
        slug: `${slug}-${organizationId}`,
      };
    case EXPORT_FORMATS.XLSX:
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
        slug: `${slug}-${organizationId}`,
      };
  }
}

export class ReportService {
  private readonly deps: ReportServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: ReportServiceDependencies) {
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

  async listReportCatalog(
    actorUserId: UserId,
    organizationId: OrganizationId,
  ): Promise<readonly ReportCatalogEntryView[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const [profile, settings] = await Promise.all([
      this.deps.analyticsWorkContext.getActorProfile(validatedOrgId, validatedActorId),
      this.deps.analyticsGovernance.getOrganizationSettings(validatedOrgId),
    ]);

    if (!settings?.organizationExists) {
      throw new NotFoundError(`Organization "${validatedOrgId}" was not found.`);
    }

    if (!profile || (profile.membershipStatus ?? MEMBERSHIP_STATUSES.ACTIVE) !== MEMBERSHIP_STATUSES.ACTIVE) {
      assertAuthorized({
        actor: { isAuthenticated: true, userId: validatedActorId },
        action: PERMISSION_CODES.REPORT_VIEW,
        resource: { kind: 'REPORT', exists: true, organizationId: validatedOrgId },
        context: { now, policyConfig: settings.policyConfig },
      });
    }

    return Object.freeze(
      Object.values(REPORT_CATALOG).map((entry) =>
        Object.freeze({
          kind: entry.kind,
          title: REPORT_TITLES[entry.kind],
          allowedScopes: entry.allowedScopes,
          mayIncludeThirdPartyIndividualMetrics: entry.mayIncludeThirdPartyIndividualMetrics,
          includesFeedbackData: entry.includesFeedbackData,
        }),
      ),
    );
  }

  async previewReport(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: PreviewReportInput,
  ): Promise<ReportSnapshot> {
    const parsed = parseWithZod(previewReportSchema, input, 'Invalid report preview payload.');
    return this.buildReportSnapshot(actorUserId, organizationId, parsed, 'PREVIEW');
  }

  async exportReport(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: ExportReportInput,
  ): Promise<ReportExportResult> {
    const parsed = parseWithZod(exportReportSchema, input, 'Invalid report export payload.');
    const snapshot = await this.buildReportSnapshot(actorUserId, organizationId, parsed, 'EXPORT');

    let bytes: Uint8Array;
    switch (parsed.format) {
      case EXPORT_FORMATS.JSON:
        bytes = exportReportToJson(snapshot);
        break;
      case EXPORT_FORMATS.CSV:
        bytes = exportReportToCsv(snapshot);
        break;
      case EXPORT_FORMATS.PDF:
        bytes = exportReportToPdf(snapshot);
        break;
      case EXPORT_FORMATS.XLSX:
        bytes = exportReportToXlsx(snapshot);
        break;
    }

    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const correlationId = this.resolveCorrelationId(parsed.correlationId);
    const meta = getExportMetadata(parsed.format, snapshot.kind, validatedOrgId);
    const fileName = `${meta.slug}.${meta.extension}`;

    await this.deps.transactionPort.run([TRANSACTION_RESOURCES.AUDIT_EVENTS], async () => {
      await this.deps.reportsContext.recordExportAuditEvent({
        organizationId: validatedOrgId,
        actorUserId: validatedActorId,
        kind: snapshot.kind,
        scope: snapshot.scope,
        ...(snapshot.projectId !== undefined ? { projectId: snapshot.projectId } : {}),
        format: parsed.format,
        rowCount: snapshot.rows.length,
        snapshotGeneratedAt: snapshot.snapshotGeneratedAt,
        includesThirdPartyIndividualMetrics: snapshot.includesThirdPartyIndividualMetrics,
      });

      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'report.exported',
          occurredAt: snapshot.snapshotGeneratedAt,
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          correlationId,
          aggregateType: snapshot.projectId !== undefined ? 'Project' : 'Organization',
          aggregateId: snapshot.projectId ?? validatedOrgId,
          payload: {
            kind: snapshot.kind,
            scope: snapshot.scope,
            format: parsed.format,
            rowCount: snapshot.rows.length,
            includesThirdPartyIndividualMetrics: snapshot.includesThirdPartyIndividualMetrics,
          },
        }),
      );
    });

    return Object.freeze({
      snapshot,
      format: parsed.format,
      mimeType: meta.mimeType,
      fileName,
      bytes,
    });
  }

  private async buildReportSnapshot(
    actorUserId: UserId,
    organizationId: OrganizationId,
    rawInput: z.infer<typeof previewReportSchema>,
    mode: 'PREVIEW' | 'EXPORT',
  ): Promise<ReportSnapshot> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const projectId =
      rawInput.projectId !== undefined ? asProjectId(rawInput.projectId, 'projectId') : undefined;
    const period = {
      start: asIsoDateTime(rawInput.period.start, 'period.start'),
      end: asIsoDateTime(rawInput.period.end, 'period.end'),
    };
    assertValidDateRange(period, 'period');

    const filters: ReportFilters = Object.freeze({
      kind: rawInput.kind,
      scope: rawInput.scope,
      ...(projectId !== undefined ? { projectId } : {}),
      period,
      compareWithPreviousPeriod: rawInput.compareWithPreviousPeriod ?? true,
    });
    assertValidReportFilters(filters);

    const now = this.now();
    const [profile, settings, grants, explicitDenies, subjectLabels, projects] = await Promise.all([
      this.deps.analyticsWorkContext.getActorProfile(validatedOrgId, validatedActorId),
      this.deps.analyticsGovernance.getOrganizationSettings(validatedOrgId),
      this.deps.permissionGrants.listActiveByGrantee(validatedOrgId, validatedActorId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(validatedOrgId, validatedActorId, now),
      this.deps.reportsContext.getSubjectLabels(validatedOrgId, projectId),
      projectId !== undefined
        ? this.deps.analyticsWorkContext.listProjects(validatedOrgId)
        : Promise.resolve<readonly AnalyticsProjectSnapshot[]>([]),
    ]);

    const actor: AuthorizationActor = {
      isAuthenticated: true,
      userId: validatedActorId,
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

    const project =
      projectId !== undefined
        ? (projects.find((item) => item.projectId === projectId) ?? null)
        : null;
    const orgExists = settings?.organizationExists ?? false;
    const resourceExists =
      filters.scope === REPORT_SCOPES.PROJECT
        ? orgExists && project !== null && !project.isDeleted
        : orgExists;

    const reportResource = {
      kind: 'REPORT' as const,
      id: asEntityId(projectId ?? validatedOrgId),
      exists: resourceExists,
      organizationId: validatedOrgId,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(project?.teamId !== undefined ? { teamId: project.teamId } : {}),
      ...(project?.ownerUserId !== undefined ? { ownerUserId: project.ownerUserId } : {}),
      ...(project?.archivedAt !== undefined
        ? { archivedAt: project.archivedAt, projectArchivedAt: project.archivedAt }
        : {}),
      ...(project?.deletedAt !== undefined ? { deletedAt: project.deletedAt } : {}),
    };

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.REPORT_VIEW,
      resource: reportResource,
      context: { now, policyConfig: settings?.policyConfig },
    });

    if (mode === 'EXPORT') {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.REPORT_EXPORT,
        resource: reportResource,
        context: { now, policyConfig: settings?.policyConfig },
      });

      assertAuthorized({
        actor,
        action: PERMISSION_CODES.ANALYTICS_EXPORT,
        resource: {
          ...reportResource,
          kind: 'ANALYTICS',
          includesThirdPartyIndividualMetrics: false,
        },
        context: { now, policyConfig: settings?.policyConfig },
      });
    }

    // Explicit mitigation for `reportAccessRule` (policy-engine.ts L671-711, ADR-0014 §3):
    // Third-party individual productivity metrics require explicit ANALYTICS_PROJECT_VIEW(includesThirdPartyIndividualMetrics: true)
    // AND allowManagerViewIndividualProductivity === true (or ADMIN). MEMBER is ALWAYS denied.
    const definition = REPORT_CATALOG[filters.kind];
    let thirdPartyAllowed = false;
    if (definition.mayIncludeThirdPartyIndividualMetrics && profile !== null && settings !== null) {
      if (filters.scope === REPORT_SCOPES.ORGANIZATION) {
        thirdPartyAllowed = profile.role === ORGANIZATION_ROLES.ADMIN;
      } else if (projectId !== undefined && project !== null) {
        const analyticsThirdPartyDecision = evaluateAuthorization({
          actor,
          action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
          resource: {
            ...reportResource,
            kind: 'ANALYTICS',
            includesThirdPartyIndividualMetrics: true,
          },
          context: { now, policyConfig: settings.policyConfig },
        });
        const roleAndPolicyOk =
          profile.role === ORGANIZATION_ROLES.ADMIN ||
          (profile.role === ORGANIZATION_ROLES.MANAGER &&
            profile.managedProjectIds.includes(projectId) &&
            settings.allowManagerViewIndividualProductivity === true);
        thirdPartyAllowed = analyticsThirdPartyDecision.allowed && roleAndPolicyOk;
      }
    }

    const overview = await this.deps.analyticsService.getAnalyticsOverview(
      validatedActorId,
      validatedOrgId,
      {
        scope: filters.scope,
        ...(projectId !== undefined ? { projectId } : {}),
        preset: ANALYTICS_PERIOD_PRESETS.CUSTOM,
        customRange: period,
        compareWithPreviousPeriod: filters.compareWithPreviousPeriod,
      },
    );

    const includesThirdPartyIndividualMetrics =
      definition.mayIncludeThirdPartyIndividualMetrics &&
      thirdPartyAllowed &&
      overview.includesThirdPartyIndividualMetrics;

    const tabular = this.buildTabularData(
      filters.kind,
      overview,
      includesThirdPartyIndividualMetrics,
    );

    return Object.freeze({
      kind: filters.kind,
      title: REPORT_TITLES[filters.kind],
      scope: filters.scope,
      organizationId: validatedOrgId,
      organizationName: subjectLabels?.organizationName ?? validatedOrgId,
      isDemoOrganization: subjectLabels?.isDemoOrganization ?? overview.isDemoOrganization,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(subjectLabels?.projectName !== undefined
        ? { projectName: subjectLabels.projectName }
        : project?.name !== undefined
          ? { projectName: project.name }
          : {}),
      filters,
      snapshotGeneratedAt: overview.generatedAt,
      includesThirdPartyIndividualMetrics,
      kpis: tabular.kpis,
      columns: tabular.columns,
      rows: tabular.rows,
    });
  }

  private buildTabularData(
    kind: ReportKind,
    overview: AnalyticsOverview,
    includesThirdPartyIndividualMetrics: boolean,
  ): {
    readonly kpis: readonly ReportKpiItem[];
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly ReportRow[];
  } {
    switch (kind) {
      case REPORT_KINDS.PROJECT_DELIVERY_FLOW:
        return this.buildProjectDeliveryFlowTable(overview);
      case REPORT_KINDS.PRODUCTIVITY_WORKLOAD:
        return this.buildProductivityWorkloadTable(overview, includesThirdPartyIndividualMetrics);
      case REPORT_KINDS.FEEDBACK_SLA_CONTESTS:
        return this.buildFeedbackSlaContestsTable(overview, includesThirdPartyIndividualMetrics);
      case REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY:
        return this.buildExecutiveSummaryTable(overview);
    }
  }

  private buildProjectDeliveryFlowTable(overview: AnalyticsOverview): {
    readonly kpis: readonly ReportKpiItem[];
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly ReportRow[];
  } {
    const { flow, impediments } = overview;
    const kpis: ReportKpiItem[] = [
      makeMetricKpi('leadTimeMs', 'Lead Time Medio', flow.leadTimeMs, formatDurationMetric),
      makeMetricKpi(
        'effectiveCycleTimeMs',
        'Cycle Time Efetivo',
        flow.effectiveCycleTimeMs,
        formatDurationMetric,
      ),
      makeMetricKpi(
        'totalCycleTimeMs',
        'Cycle Time Total',
        flow.totalCycleTimeMs,
        formatDurationMetric,
      ),
      makeMetricKpi('throughput', 'Throughput (Ciclos)', flow.throughput, formatCountMetric),
      makeMetricKpi(
        'uniqueCompletedTasks',
        'Tarefas Unicas Concluidas',
        flow.uniqueCompletedTasks,
        formatCountMetric,
      ),
      makeMetricKpi(
        'cohortCompletionRate',
        'Taxa de Conclusao por Coorte',
        flow.cohortCompletionRate,
        formatPercentMetric,
      ),
      Object.freeze({
        key: 'openImpediments',
        label: 'Impedimentos Abertos',
        value: String(impediments.openCount),
      }),
    ];

    const columns: ReportColumn[] = [
      { key: 'dimension', label: 'Dimensao' },
      { key: 'metric', label: 'Indicador' },
      { key: 'currentValue', label: 'Periodo Atual' },
      { key: 'previousValue', label: 'Periodo Anterior' },
      { key: 'notes', label: 'Observacao' },
    ];

    const prev = flow.previousPeriod;
    const rows: ReportRow[] = [
      {
        dimension: 'Fluxo',
        metric: 'Lead Time Medio',
        currentValue: formatDurationMetric(flow.leadTimeMs),
        previousValue: prev ? formatDurationMetric(prev.leadTimeMs) : 'N/A',
        notes: 'Criacao ate conclusao',
      },
      {
        dimension: 'Fluxo',
        metric: 'Cycle Time Efetivo',
        currentValue: formatDurationMetric(flow.effectiveCycleTimeMs),
        previousValue: prev ? formatDurationMetric(prev.effectiveCycleTimeMs) : 'N/A',
        notes: 'Descontando pausas validas',
      },
      {
        dimension: 'Fluxo',
        metric: 'Cycle Time Total',
        currentValue: formatDurationMetric(flow.totalCycleTimeMs),
        previousValue: prev ? formatDurationMetric(prev.totalCycleTimeMs) : 'N/A',
        notes: 'Tempo decorrido bruto',
      },
      {
        dimension: 'Fluxo',
        metric: 'Throughput (Ciclos Concluidos)',
        currentValue: formatCountMetric(flow.throughput),
        previousValue: prev ? formatCountMetric(prev.throughput) : 'N/A',
        notes: 'Inclui ciclos de tarefas reabertas',
      },
      {
        dimension: 'Fluxo',
        metric: 'Tarefas Unicas Concluidas',
        currentValue: formatCountMetric(flow.uniqueCompletedTasks),
        previousValue: prev ? formatCountMetric(prev.uniqueCompletedTasks) : 'N/A',
        notes: 'IDs distintos de tarefas',
      },
      {
        dimension: 'Fluxo',
        metric: 'Taxa de Conclusao por Coorte',
        currentValue: formatPercentMetric(flow.cohortCompletionRate),
        previousValue: prev ? formatPercentMetric(prev.cohortCompletionRate) : 'N/A',
        notes: 'Criadas no periodo e concluidas ate o fim',
      },
      ...Object.values(TASK_STATUSES).map((status) => ({
        dimension: 'Status Atual',
        metric: status,
        currentValue: flow.countsByStatus[status],
        previousValue: 'N/A',
        notes: 'Tarefas visiveis',
      })),
    ];

    return { kpis, columns, rows };
  }

  private buildProductivityWorkloadTable(
    overview: AnalyticsOverview,
    includesThirdPartyIndividualMetrics: boolean,
  ): {
    readonly kpis: readonly ReportKpiItem[];
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly ReportRow[];
  } {
    const { workload, flow, impediments } = overview;
    const kpis: ReportKpiItem[] = [
      Object.freeze({
        key: 'totalVisibleTasks',
        label: 'Tarefas Visiveis',
        value: String(flow.totalVisibleTasks),
      }),
      makeMetricKpi('throughput', 'Throughput (Ciclos)', flow.throughput, formatCountMetric),
      makeMetricKpi(
        'averageTeamWorkloadScore',
        'Carga Media da Equipe (0-100)',
        workload.averageTeamWorkloadScore,
        formatCountMetric,
      ),
      Object.freeze({
        key: 'overloadedMemberCount',
        label: 'Membros Sobrecarregados (Contagem Anonima)',
        value: String(workload.overloadedMemberCount),
      }),
      Object.freeze({
        key: 'openImpediments',
        label: 'Impedimentos Abertos',
        value: String(impediments.openCount),
      }),
    ];

    if (includesThirdPartyIndividualMetrics) {
      const columns: ReportColumn[] = [
        { key: 'memberName', label: 'Colaborador' },
        { key: 'workloadScore', label: 'Score Carga (0-100)' },
        { key: 'workloadLevel', label: 'Faixa' },
        { key: 'activeTaskCount', label: 'Tarefas Ativas' },
        { key: 'activeSubtaskCount', label: 'Subtarefas Abertas' },
        { key: 'representsHours', label: 'Representa Horas' },
      ];

      const rows: ReportRow[] = workload.memberWorkloads.map((member) => ({
        memberName: member.displayName,
        workloadScore: member.score,
        workloadLevel: member.level,
        activeTaskCount: member.activeTaskCount,
        activeSubtaskCount: member.activeSubtaskCount,
        representsHours: false,
      }));

      return { kpis, columns, rows };
    }

    // Privacy-safe view: NO third-party nominal rows exposed!
    const columns: ReportColumn[] = [
      { key: 'scope', label: 'Escopo' },
      { key: 'workloadScore', label: 'Score Carga (0-100)' },
      { key: 'workloadLevel', label: 'Faixa' },
      { key: 'activeTaskCount', label: 'Tarefas Ativas' },
      { key: 'activeSubtaskCount', label: 'Subtarefas Abertas' },
      { key: 'privacyNotice', label: 'Politica de Privacidade' },
    ];

    const rows: ReportRow[] = workload.myWorkload
      ? [
          {
            scope: 'Minha Carga Individual',
            workloadScore: workload.myWorkload.score,
            workloadLevel: workload.myWorkload.level,
            activeTaskCount: workload.myWorkload.activeTaskCount,
            activeSubtaskCount: workload.myWorkload.activeSubtaskCount,
            privacyNotice: 'Metricas nominais de terceiros ocultas por politica de privacidade',
          },
        ]
      : [];

    return { kpis, columns, rows };
  }

  private buildFeedbackSlaContestsTable(
    overview: AnalyticsOverview,
    includesThirdPartyIndividualMetrics: boolean,
  ): {
    readonly kpis: readonly ReportKpiItem[];
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly ReportRow[];
  } {
    const { feedback } = overview;
    const kpis: ReportKpiItem[] = [
      Object.freeze({
        key: 'totalInPeriod',
        label: 'Feedbacks no Periodo',
        value: String(feedback.totalInPeriod),
      }),
      makeMetricKpi('resolutionRate', 'Taxa de Resolucao', feedback.resolutionRate, formatPercentMetric),
      makeMetricKpi(
        'slaComplianceRate',
        'Conformidade SLA',
        feedback.slaSummary.complianceRate,
        formatPercentMetric,
      ),
      Object.freeze({
        key: 'slaBreached',
        label: 'Ciclos SLA Violados',
        value: String(feedback.slaSummary.breachedCount),
      }),
      Object.freeze({
        key: 'contestsInPeriod',
        label: 'Contestacoes no Periodo',
        value: String(feedback.contestsInPeriod),
      }),
      Object.freeze({
        key: 'reopeningsInPeriod',
        label: 'Reaberturas no Periodo',
        value: String(feedback.reopeningsInPeriod),
      }),
      makeMetricKpi(
        'averageFirstResponseMs',
        'Tempo Medio 1a Resposta',
        feedback.averageFirstResponseMs,
        formatDurationMetric,
      ),
      makeMetricKpi(
        'averageResolutionMs',
        'Tempo Medio Resolucao',
        feedback.averageResolutionMs,
        formatDurationMetric,
      ),
    ];

    const columns: ReportColumn[] = [
      { key: 'section', label: 'Agrupamento' },
      { key: 'code', label: 'Codigo' },
      { key: 'label', label: 'Descricao / Versao' },
      { key: 'versionNumber', label: 'Versao' },
      { key: 'count', label: 'Quantidade' },
      { key: 'extra', label: 'Detalhes' },
    ];

    const rows: ReportRow[] = [
      ...feedback.byCategoryVersion.map((bucket) => ({
        section: 'Categoria (Historica)',
        code: bucket.code,
        label: bucket.name,
        versionNumber: bucket.versionNumber,
        count: bucket.count,
        extra: `versionId=${bucket.versionId}`,
      })),
      ...feedback.byContestReasonVersion.map((bucket) => ({
        section: 'Motivo Contestacao (Historico)',
        code: bucket.code,
        label: bucket.name,
        versionNumber: bucket.versionNumber,
        count: bucket.count,
        extra: `versionId=${bucket.versionId}`,
      })),
      ...feedback.cyclesByOrigin.map((bucket) => ({
        section: 'Origem do Ciclo',
        code: bucket.key,
        label: bucket.key,
        versionNumber: '-',
        count: bucket.count,
        extra: 'Ciclos abertos no periodo',
      })),
      ...feedback.contestOutcomes.map((bucket) => ({
        section: 'Decisao de Contestacao',
        code: bucket.key,
        label: bucket.key,
        versionNumber: '-',
        count: bucket.count,
        extra: 'Contestacoes no periodo',
      })),
    ];

    if (includesThirdPartyIndividualMetrics) {
      for (const perf of feedback.assigneePerformance) {
        rows.push({
          section: 'Desempenho por Responsavel',
          code: perf.assigneeUserId,
          label: perf.displayName,
          versionNumber: '-',
          count: perf.assignedCount,
          extra: `Resolvidos=${perf.resolvedCount}; SLA Violado=${perf.breachedCount}; Medio=${formatDurationMetric(perf.averageResolutionMs)}`,
        });
      }
    }

    return { kpis, columns, rows };
  }

  private buildExecutiveSummaryTable(overview: AnalyticsOverview): {
    readonly kpis: readonly ReportKpiItem[];
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly ReportRow[];
  } {
    const { flow, impediments, bottlenecks, feedback } = overview;
    const kpis: ReportKpiItem[] = [
      Object.freeze({
        key: 'totalVisibleTasks',
        label: 'Total de Tarefas Visiveis',
        value: String(flow.totalVisibleTasks),
      }),
      makeMetricKpi('leadTimeMs', 'Lead Time Medio', flow.leadTimeMs, formatDurationMetric),
      makeMetricKpi(
        'effectiveCycleTimeMs',
        'Cycle Time Efetivo',
        flow.effectiveCycleTimeMs,
        formatDurationMetric,
      ),
      makeMetricKpi('throughput', 'Throughput (Ciclos)', flow.throughput, formatCountMetric),
      makeMetricKpi(
        'cohortCompletionRate',
        'Taxa Conclusao Coorte',
        flow.cohortCompletionRate,
        formatPercentMetric,
      ),
      Object.freeze({
        key: 'totalActiveAlerts',
        label: 'Alertas de Gargalo Ativos',
        value: String(bottlenecks.totalActiveAlerts),
      }),
      Object.freeze({
        key: 'openImpediments',
        label: 'Impedimentos Abertos',
        value: String(impediments.openCount),
      }),
      Object.freeze({
        key: 'feedbacksInPeriod',
        label: 'Feedbacks no Periodo',
        value: String(feedback.totalInPeriod),
      }),
      makeMetricKpi(
        'feedbackSlaCompliance',
        'Conformidade SLA Feedback',
        feedback.slaSummary.complianceRate,
        formatPercentMetric,
      ),
    ];

    const columns: ReportColumn[] = [
      { key: 'area', label: 'Area' },
      { key: 'indicator', label: 'Indicador' },
      { key: 'value', label: 'Valor' },
      { key: 'previousValue', label: 'Periodo Anterior' },
    ];

    const prev = flow.previousPeriod;
    const rows: ReportRow[] = [
      {
        area: 'Entrega',
        indicator: 'Lead Time Medio',
        value: formatDurationMetric(flow.leadTimeMs),
        previousValue: prev ? formatDurationMetric(prev.leadTimeMs) : 'N/A',
      },
      {
        area: 'Entrega',
        indicator: 'Cycle Time Efetivo',
        value: formatDurationMetric(flow.effectiveCycleTimeMs),
        previousValue: prev ? formatDurationMetric(prev.effectiveCycleTimeMs) : 'N/A',
      },
      {
        area: 'Entrega',
        indicator: 'Cycle Time Total',
        value: formatDurationMetric(flow.totalCycleTimeMs),
        previousValue: prev ? formatDurationMetric(prev.totalCycleTimeMs) : 'N/A',
      },
      {
        area: 'Entrega',
        indicator: 'Throughput',
        value: formatCountMetric(flow.throughput),
        previousValue: prev ? formatCountMetric(prev.throughput) : 'N/A',
      },
      {
        area: 'Entrega',
        indicator: 'Taxa de Conclusao por Coorte',
        value: formatPercentMetric(flow.cohortCompletionRate),
        previousValue: prev ? formatPercentMetric(prev.cohortCompletionRate) : 'N/A',
      },
      {
        area: 'Gargalos & Impedimentos',
        indicator: 'Alertas Ativos',
        value: bottlenecks.totalActiveAlerts,
        previousValue: 'N/A',
      },
      {
        area: 'Gargalos & Impedimentos',
        indicator: 'Impedimentos Abertos',
        value: impediments.openCount,
        previousValue: 'N/A',
      },
      {
        area: 'Feedbacks',
        indicator: 'Total no Periodo',
        value: feedback.totalInPeriod,
        previousValue: 'N/A',
      },
      {
        area: 'Feedbacks',
        indicator: 'Conformidade SLA',
        value: formatPercentMetric(feedback.slaSummary.complianceRate),
        previousValue: 'N/A',
      },
      {
        area: 'Feedbacks',
        indicator: 'Contestacoes / Reaberturas',
        value: `${feedback.contestsInPeriod} / ${feedback.reopeningsInPeriod}`,
        previousValue: 'N/A',
      },
    ];

    return { kpis, columns, rows };
  }
}
