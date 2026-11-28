import type { IntlShape } from 'react-intl';
import type { MessageId } from '@/shared/i18n';
import type { DateRange, IsoDateTime, MetricUnavailableReason } from '@/shared/kernel';
import {
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  type ReportCellValue,
  type ReportFormat,
  type ReportKind,
  type ReportPeriodPreset,
  type ReportScope,
} from '../application/contracts';

export const CONTROL_SELECT_CLASS_NAME =
  'flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const REPORT_PRESET_OPTIONS: readonly ReportPeriodPreset[] = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'CURRENT_YEAR',
  'CUSTOM',
];

export const REPORT_FORMAT_OPTIONS: readonly ReportFormat[] = [
  REPORT_FORMATS.JSON,
  REPORT_FORMATS.CSV,
  REPORT_FORMATS.PDF,
  REPORT_FORMATS.XLSX,
];

export const REPORT_KIND_TITLE_IDS: Readonly<Record<ReportKind, MessageId>> = {
  [REPORT_KINDS.PROJECT_DELIVERY_FLOW]: 'reports.kind.PROJECT_DELIVERY_FLOW.title',
  [REPORT_KINDS.PRODUCTIVITY_WORKLOAD]: 'reports.kind.PRODUCTIVITY_WORKLOAD.title',
  [REPORT_KINDS.FEEDBACK_SLA_CONTESTS]: 'reports.kind.FEEDBACK_SLA_CONTESTS.title',
  [REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY]:
    'reports.kind.ORGANIZATION_EXECUTIVE_SUMMARY.title',
};

export const REPORT_KIND_DESCRIPTION_IDS: Readonly<Record<ReportKind, MessageId>> = {
  [REPORT_KINDS.PROJECT_DELIVERY_FLOW]: 'reports.kind.PROJECT_DELIVERY_FLOW.description',
  [REPORT_KINDS.PRODUCTIVITY_WORKLOAD]: 'reports.kind.PRODUCTIVITY_WORKLOAD.description',
  [REPORT_KINDS.FEEDBACK_SLA_CONTESTS]: 'reports.kind.FEEDBACK_SLA_CONTESTS.description',
  [REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY]:
    'reports.kind.ORGANIZATION_EXECUTIVE_SUMMARY.description',
};

export const REPORT_SCOPE_LABEL_IDS: Readonly<Record<ReportScope, MessageId>> = {
  [REPORT_SCOPES.PROJECT]: 'reports.scope.PROJECT',
  [REPORT_SCOPES.ORGANIZATION]: 'reports.scope.ORGANIZATION',
};

export const REPORT_PRESET_LABEL_IDS: Readonly<Record<ReportPeriodPreset, MessageId>> = {
  LAST_7_DAYS: 'analytics.period.preset.LAST_7_DAYS',
  LAST_30_DAYS: 'analytics.period.preset.LAST_30_DAYS',
  LAST_90_DAYS: 'analytics.period.preset.LAST_90_DAYS',
  CURRENT_YEAR: 'analytics.period.preset.CURRENT_YEAR',
  CUSTOM: 'analytics.period.preset.CUSTOM',
};

export const REPORT_EXPORT_BUTTON_IDS: Readonly<Record<ReportFormat, MessageId>> = {
  [REPORT_FORMATS.JSON]: 'reports.export.format.JSON',
  [REPORT_FORMATS.CSV]: 'reports.export.format.CSV',
  [REPORT_FORMATS.PDF]: 'reports.export.format.PDF',
  [REPORT_FORMATS.XLSX]: 'reports.export.format.XLSX',
};

export const METRIC_UNAVAILABLE_REASON_IDS: Readonly<Record<MetricUnavailableReason, MessageId>> = {
  INSUFFICIENT_DATA: 'analytics.metric.reason.INSUFFICIENT_DATA',
  NO_COMPLETED_CYCLES: 'analytics.metric.reason.NO_COMPLETED_CYCLES',
  ZERO_DENOMINATOR: 'analytics.metric.reason.ZERO_DENOMINATOR',
  UNAUTHORIZED: 'analytics.metric.reason.UNAUTHORIZED',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildDefaultReportCustomDateInputs(): {
  readonly start: string;
  readonly end: string;
} {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * MS_PER_DAY);
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
}

export function parseReportCustomDateRange(startDate: string, endDate: string): DateRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return null;
  }
  const startIso = `${startDate}T00:00:00.000Z` as IsoDateTime;
  const endIso = `${endDate}T23:59:59.999Z` as IsoDateTime;
  if (Date.parse(startIso) > Date.parse(endIso)) {
    return null;
  }
  return { start: startIso, end: endIso };
}

export function resolveReportPeriodFromPreset(
  preset: ReportPeriodPreset,
  customRange?: DateRange,
): DateRange | null {
  const now = new Date();
  const nowIso = now.toISOString() as IsoDateTime;
  const nowMs = now.getTime();

  switch (preset) {
    case 'LAST_7_DAYS':
      return {
        start: new Date(nowMs - 7 * MS_PER_DAY).toISOString() as IsoDateTime,
        end: nowIso,
      };
    case 'LAST_30_DAYS':
      return {
        start: new Date(nowMs - 30 * MS_PER_DAY).toISOString() as IsoDateTime,
        end: nowIso,
      };
    case 'LAST_90_DAYS':
      return {
        start: new Date(nowMs - 90 * MS_PER_DAY).toISOString() as IsoDateTime,
        end: nowIso,
      };
    case 'CURRENT_YEAR': {
      const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      return {
        start: startOfYear.toISOString() as IsoDateTime,
        end: nowIso,
      };
    }
    case 'CUSTOM':
      return customRange ?? null;
  }
}

export function formatReportDateTime(iso: IsoDateTime, intl: IntlShape): string {
  return intl.formatDate(iso, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function formatReportCellValue(value: ReportCellValue, intl: IntlShape): string {
  if (value === null) {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não';
  }
  if (typeof value === 'number') {
    return intl.formatNumber(value);
  }
  return value;
}

export function triggerReportBlobDownload(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): void {
  const blobPart: BlobPart = new Uint8Array(bytes).buffer;
  const blob = new Blob([blobPart], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
