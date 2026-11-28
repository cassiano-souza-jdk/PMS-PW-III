import { ANALYTICS_PERIOD_PRESETS, type AnalyticsPeriodPreset } from '@/modules/analytics';
import type { AppErrorCode } from '@/shared/errors';
import type { DateRange, IsoDateTime, ProjectId } from '@/shared/kernel';
import {
  REPORT_CATALOG,
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  assertValidReportFilters,
  isReportFormat,
  isReportKind,
  type ReportDefinition,
  type ReportFilters,
  type ReportFormat,
  type ReportKind,
  type ReportScope,
} from '../domain/report-catalog';
import type {
  ReportCatalogEntryView,
  ReportCellValue,
  ReportColumn,
  ReportExportResult,
  ReportKpiItem,
  ReportRow,
  ReportSnapshot,
} from '../domain/report-snapshot';
import {
  REPORT_TITLES,
  type ExportReportInput,
  type PreviewReportInput,
} from './services/report-service';

export {
  REPORT_CATALOG,
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  REPORT_TITLES,
  assertValidReportFilters,
  isReportFormat,
  isReportKind,
  type ExportReportInput,
  type PreviewReportInput,
  type ReportCatalogEntryView,
  type ReportCellValue,
  type ReportColumn,
  type ReportDefinition,
  type ReportExportResult,
  type ReportFilters,
  type ReportFormat,
  type ReportKind,
  type ReportKpiItem,
  type ReportRow,
  type ReportScope,
  type ReportSnapshot,
};

export const REPORT_PERIOD_PRESETS = ANALYTICS_PERIOD_PRESETS;

export type ReportPeriodPreset = AnalyticsPeriodPreset;

export interface ReportsPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface ReportProjectOption {
  readonly id: ProjectId;
  readonly name: string;
  readonly isArchived: boolean;
}

export interface ReportFilterFormState {
  readonly kind: ReportKind;
  readonly scope: ReportScope;
  readonly projectId?: ProjectId;
  readonly preset: ReportPeriodPreset;
  readonly customRange?: DateRange;
  readonly compareWithPreviousPeriod: boolean;
}

export const REPORT_PREVIEW_STATUSES = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  READY: 'READY',
  ERROR: 'ERROR',
} as const;

export type ReportPreviewStatus =
  (typeof REPORT_PREVIEW_STATUSES)[keyof typeof REPORT_PREVIEW_STATUSES];

export interface ReportPreviewState {
  readonly status: ReportPreviewStatus;
  readonly snapshot: ReportSnapshot | null;
  readonly errorCode?: AppErrorCode;
  readonly errorMessage?: string;
}

export interface ReportExportState {
  readonly isExporting: boolean;
  readonly activeFormat: ReportFormat | null;
  readonly lastExportedFileName?: string;
  readonly lastExportedFormat?: ReportFormat;
  readonly lastExportedAt?: IsoDateTime;
  readonly errorCode?: AppErrorCode;
  readonly errorMessage?: string;
}

export interface ReportCatalogCapabilityView extends ReportCatalogEntryView {
  readonly canRunInOrganizationScope: boolean;
  readonly canRunInProjectScope: boolean;
  readonly canExport: boolean;
  readonly showsThirdPartyPrivacyNotice: boolean;
}
