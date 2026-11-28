export {
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
} from './domain/report-catalog';
export type {
  ReportCatalogEntryView,
  ReportCellValue,
  ReportColumn,
  ReportExportResult,
  ReportKpiItem,
  ReportRow,
  ReportSnapshot,
} from './domain/report-snapshot';
export type {
  ReportExportAuditInput,
  ReportSubjectLabelsSnapshot,
  ReportsContextPort,
} from './application/ports/reports-context.port';
export {
  exportReportToCsv,
  exportReportToJson,
  exportReportToPdf,
  exportReportToXlsx,
} from './application/exporters';
export {
  REPORT_TITLES,
  ReportService,
  type ExportReportInput,
  type PreviewReportInput,
  type ReportServiceDependencies,
} from './application/services/report-service';
