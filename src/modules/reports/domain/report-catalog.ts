import { ValidationError } from '@/shared/errors';
import {
  EXPORT_FORMATS,
  isExportFormat,
  type DateRange,
  type ExportFormat,
  type ProjectId,
} from '@/shared/kernel';

/**
 * Closed catalog of pre-built canonical reports (ADR-0014 §6, DN-05).
 * Preview and exported file MUST be produced from the very same snapshot, filters and permissions.
 */
export const REPORT_KINDS = {
  PROJECT_DELIVERY_FLOW: 'PROJECT_DELIVERY_FLOW',
  PRODUCTIVITY_WORKLOAD: 'PRODUCTIVITY_WORKLOAD',
  FEEDBACK_SLA_CONTESTS: 'FEEDBACK_SLA_CONTESTS',
  ORGANIZATION_EXECUTIVE_SUMMARY: 'ORGANIZATION_EXECUTIVE_SUMMARY',
} as const;

export type ReportKind = (typeof REPORT_KINDS)[keyof typeof REPORT_KINDS];

/** Report export formats reuse the shared `EXPORT_FORMATS` (`JSON` | `CSV` | `PDF` | `XLSX`). */
export const REPORT_FORMATS = EXPORT_FORMATS;

export type ReportFormat = ExportFormat;

export const REPORT_SCOPES = {
  PROJECT: 'PROJECT',
  ORGANIZATION: 'ORGANIZATION',
} as const;

export type ReportScope = (typeof REPORT_SCOPES)[keyof typeof REPORT_SCOPES];

export interface ReportDefinition {
  readonly kind: ReportKind;
  readonly allowedScopes: readonly ReportScope[];
  /** Requires the application-level guard (`ANALYTICS_PROJECT_VIEW` + `includesThirdPartyIndividualMetrics`). */
  readonly mayIncludeThirdPartyIndividualMetrics: boolean;
  /** Requires item-by-item `FEEDBACK_VIEW` filtering and internal-note segregation. */
  readonly includesFeedbackData: boolean;
}

export const REPORT_CATALOG: Readonly<Record<ReportKind, ReportDefinition>> = Object.freeze({
  [REPORT_KINDS.PROJECT_DELIVERY_FLOW]: Object.freeze({
    kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
    allowedScopes: Object.freeze([REPORT_SCOPES.PROJECT]),
    mayIncludeThirdPartyIndividualMetrics: false,
    includesFeedbackData: false,
  }),
  [REPORT_KINDS.PRODUCTIVITY_WORKLOAD]: Object.freeze({
    kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
    allowedScopes: Object.freeze([REPORT_SCOPES.PROJECT, REPORT_SCOPES.ORGANIZATION]),
    mayIncludeThirdPartyIndividualMetrics: true,
    includesFeedbackData: false,
  }),
  [REPORT_KINDS.FEEDBACK_SLA_CONTESTS]: Object.freeze({
    kind: REPORT_KINDS.FEEDBACK_SLA_CONTESTS,
    allowedScopes: Object.freeze([REPORT_SCOPES.PROJECT, REPORT_SCOPES.ORGANIZATION]),
    mayIncludeThirdPartyIndividualMetrics: true,
    includesFeedbackData: true,
  }),
  [REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY]: Object.freeze({
    kind: REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
    allowedScopes: Object.freeze([REPORT_SCOPES.ORGANIZATION]),
    mayIncludeThirdPartyIndividualMetrics: false,
    includesFeedbackData: true,
  }),
});

export interface ReportFilters {
  readonly kind: ReportKind;
  readonly scope: ReportScope;
  readonly projectId?: ProjectId;
  readonly period: DateRange;
  readonly compareWithPreviousPeriod: boolean;
}

const REPORT_KIND_SET: ReadonlySet<string> = new Set(Object.values(REPORT_KINDS));

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === 'string' && REPORT_KIND_SET.has(value);
}

export function isReportFormat(value: unknown): value is ReportFormat {
  return isExportFormat(value);
}

/** Validates scope/project coherence against the closed catalog (pure, no authorization). */
export function assertValidReportFilters(filters: ReportFilters): void {
  const definition = REPORT_CATALOG[filters.kind];
  if (!definition.allowedScopes.includes(filters.scope)) {
    throw new ValidationError(
      `Report "${filters.kind}" does not support scope "${filters.scope}".`,
      { details: { kind: filters.kind, scope: filters.scope } },
    );
  }

  if (filters.scope === REPORT_SCOPES.PROJECT && filters.projectId === undefined) {
    throw new ValidationError('Project-scoped reports require "projectId".', {
      details: { kind: filters.kind },
    });
  }

  if (filters.scope === REPORT_SCOPES.ORGANIZATION && filters.projectId !== undefined) {
    throw new ValidationError('Organization-scoped reports must not define "projectId".', {
      details: { kind: filters.kind },
    });
  }
}
