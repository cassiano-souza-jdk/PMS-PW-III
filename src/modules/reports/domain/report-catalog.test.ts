import { describe, expect, it } from 'vitest';
import { asIsoDateTime, asProjectId, createDateRange, EXPORT_FORMATS } from '@/shared/kernel';
import {
  REPORT_CATALOG,
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  assertValidReportFilters,
  isReportFormat,
  isReportKind,
} from './report-catalog';

const PERIOD = createDateRange(
  asIsoDateTime('2026-11-01T00:00:00.000Z'),
  asIsoDateTime('2026-11-28T00:00:00.000Z'),
);
const PROJECT_ID = asProjectId('8d1f5a52-6f7e-4b7a-9d55-2f1c3f8e6a01');

describe('reports catalog (ADR-0014 §6, DN-05)', () => {
  it('exposes exactly the 4 canonical reports and reuses EXPORT_FORMATS', () => {
    expect(Object.keys(REPORT_CATALOG).sort()).toEqual(Object.values(REPORT_KINDS).sort());
    expect(REPORT_FORMATS).toBe(EXPORT_FORMATS);
    expect(isReportFormat('XLSX')).toBe(true);
    expect(isReportFormat('DOCX')).toBe(false);
    expect(isReportKind(REPORT_KINDS.FEEDBACK_SLA_CONTESTS)).toBe(true);
    expect(isReportKind('CUSTOM')).toBe(false);
  });

  it('flags reports requiring individual-metrics and feedback guards', () => {
    expect(REPORT_CATALOG.PRODUCTIVITY_WORKLOAD.mayIncludeThirdPartyIndividualMetrics).toBe(true);
    expect(REPORT_CATALOG.FEEDBACK_SLA_CONTESTS.includesFeedbackData).toBe(true);
    expect(REPORT_CATALOG.PROJECT_DELIVERY_FLOW.mayIncludeThirdPartyIndividualMetrics).toBe(false);
  });

  it('validates scope/project coherence', () => {
    expect(() =>
      assertValidReportFilters({
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.PROJECT,
        projectId: PROJECT_ID,
        period: PERIOD,
        compareWithPreviousPeriod: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertValidReportFilters({
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.ORGANIZATION,
        period: PERIOD,
        compareWithPreviousPeriod: false,
      }),
    ).toThrow();
    expect(() =>
      assertValidReportFilters({
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        period: PERIOD,
        compareWithPreviousPeriod: false,
      }),
    ).toThrow();
    expect(() =>
      assertValidReportFilters({
        kind: REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
        scope: REPORT_SCOPES.ORGANIZATION,
        projectId: PROJECT_ID,
        period: PERIOD,
        compareWithPreviousPeriod: false,
      }),
    ).toThrow();
  });
});
