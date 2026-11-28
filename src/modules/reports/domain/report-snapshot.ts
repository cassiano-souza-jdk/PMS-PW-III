import type {
  ExportFormat,
  IsoDateTime,
  MetricUnavailableReason,
  OrganizationId,
  ProjectId,
} from '@/shared/kernel';
import type { ReportFilters, ReportKind, ReportScope } from './report-catalog';

export interface ReportKpiItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unavailableReason?: MetricUnavailableReason;
}

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
}

export type ReportCellValue = string | number | boolean | null;

export type ReportRow = Readonly<Record<string, ReportCellValue>>;

/**
 * Canonical report snapshot shared identically between `previewReport` and `exportReport` (DN-05).
 */
export interface ReportSnapshot {
  readonly kind: ReportKind;
  readonly title: string;
  readonly scope: ReportScope;
  readonly organizationId: OrganizationId;
  readonly organizationName: string;
  readonly isDemoOrganization: boolean;
  readonly projectId?: ProjectId;
  readonly projectName?: string;
  readonly filters: ReportFilters;
  readonly snapshotGeneratedAt: IsoDateTime;
  readonly includesThirdPartyIndividualMetrics: boolean;
  readonly kpis: readonly ReportKpiItem[];
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
}

export interface ReportCatalogEntryView {
  readonly kind: ReportKind;
  readonly title: string;
  readonly allowedScopes: readonly ReportScope[];
  readonly mayIncludeThirdPartyIndividualMetrics: boolean;
  readonly includesFeedbackData: boolean;
}

export interface ReportExportResult {
  readonly snapshot: ReportSnapshot;
  readonly format: ExportFormat;
  readonly mimeType: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
}
