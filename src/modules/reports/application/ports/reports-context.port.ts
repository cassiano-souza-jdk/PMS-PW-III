import type { AuditEventId, IsoDateTime, OrganizationId, ProjectId, UserId } from '@/shared/kernel';
import type { ReportFormat, ReportKind, ReportScope } from '../../domain/report-catalog';

/**
 * Anti-corruption context port for Reports (ADR-0014 §5–§8, DN-03/DN-05).
 *
 * `reports` depends unidirectionally on `@/modules/analytics` and `@/modules/authorization` only.
 * Labels for the report header and export auditing (`AUDIT_CATEGORIES.EXPORT`) are reached through
 * this port, implemented in `src/app/composition/analytics-ports-adapter.ts` (F10-T02), so that
 * `reports` never imports `projects`, `organizations`, `audit` or other operational modules.
 */
export interface ReportSubjectLabelsSnapshot {
  readonly organizationId: OrganizationId;
  readonly organizationName: string;
  readonly isDemoOrganization: boolean;
  readonly projectId?: ProjectId;
  readonly projectName?: string;
}

export interface ReportExportAuditInput {
  readonly organizationId: OrganizationId;
  readonly actorUserId: UserId;
  readonly kind: ReportKind;
  readonly scope: ReportScope;
  readonly projectId?: ProjectId;
  readonly format: ReportFormat;
  readonly rowCount: number;
  readonly snapshotGeneratedAt: IsoDateTime;
  readonly includesThirdPartyIndividualMetrics: boolean;
}

export interface ReportsContextPort {
  getSubjectLabels(
    organizationId: OrganizationId,
    projectId?: ProjectId,
  ): Promise<ReportSubjectLabelsSnapshot | null>;
  recordExportAuditEvent(input: ReportExportAuditInput): Promise<AuditEventId>;
}
