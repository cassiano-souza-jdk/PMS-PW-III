import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { setupServer, type SetupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ANALYTICS_PERIOD_PRESETS,
  DASHBOARD_SCOPES,
  type AnalyticsCalibrationSettingsView,
  type AnalyticsOverview,
  type DashboardPreference,
  type DashboardPreferenceResult,
} from '@/modules/analytics';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import {
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  asBottleneckAlertId,
} from '@/modules/bottlenecks';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { FEEDBACK_STATUSES, type FeedbackInternalNote } from '@/modules/feedback';
import { asFeedbackInternalNoteId } from '@/modules/feedback/domain/feedback';
import {
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  type ReportCatalogEntryView,
  type ReportSnapshot,
} from '@/modules/reports';
import { AuthorizationError, ValidationError } from '@/shared/errors';
import { HTTP_HEADERS, type ApiSuccessEnvelope } from '@/shared/http';
import {
  BOTTLENECK_SEVERITIES,
  METRIC_AVAILABILITY_STATUSES,
  PRIORITIES,
  TASK_STATUSES,
  asFeedbackCycleId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTaskId,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_BOARD_ID,
  DEMO_COLUMN_IDS,
  DEMO_FEEDBACK_IDS,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  createAppContainer,
  createMswHandlers,
  type AppCompositionContainer,
} from './index';

const FIXED_NOW = asIsoDateTime('2026-04-20T12:00:00.000Z');
const OTHER_ORG_ID = asOrganizationId('99999999-9999-4999-8999-999999999901');
const PRIVATE_PROJECT_ID = asProjectId('88888888-8888-4888-8888-888888888802');
const PRIVATE_TASK_ID = asTaskId('77777777-7777-4777-8777-777777777703');

function authHeaders(actorUserId: string): Record<string, string> {
  return {
    [HTTP_HEADERS.ACTOR_USER_ID]: actorUserId,
    [HTTP_HEADERS.CORRELATION_ID]: crypto.randomUUID(),
    'content-type': 'application/json',
  };
}

describe('Phase 10 — AnalyticsService, ReportService, Dexie Ports Adapter, DN-08 & MSW §13', () => {
  let server: SetupServer;
  let container: AppCompositionContainer;

  beforeAll(() => {
    server = setupServer();
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    container = createAppContainer({
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_f10_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
      now: () => FIXED_NOW,
    });
    await ensureDatabaseOpen(container.db);
    await container.seedDemoOrganization(FIXED_NOW);

    server.use(
      ...createMswHandlers({
        repositories: container.repositories,
        transactionPort: container.transactionPort,
        eventBus: container.eventBus,
        simulationController: container.simulationController,
        now: () => FIXED_NOW,
      }),
    );
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('computes official flow metrics, isolates tasks via TASK_VIEW, excludes internal notes, and enforces third-party privacy guards', async () => {
    // Seed an isolated project where MEMBER does NOT participate, so TASK_VIEW must exclude PRIVATE_TASK_ID
    await container.repositories.projects.projects.save({
      id: PRIVATE_PROJECT_ID,
      organizationId: DEMO_ORG_ID,
      name: 'Projeto Confidencial Admin',
      status: 'ACTIVE',
      ownerUserId: DEMO_ADMIN_USER_ID,
      inactivityThresholdDays: 7,
      createdByUserId: DEMO_ADMIN_USER_ID,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await container.repositories.tasks.tasks.save({
      id: PRIVATE_TASK_ID,
      organizationId: DEMO_ORG_ID,
      projectId: PRIVATE_PROJECT_ID,
      boardId: DEMO_BOARD_ID,
      columnId: DEMO_COLUMN_IDS.DONE,
      title: 'Tarefa Secreta Admin',
      status: TASK_STATUSES.DONE,
      priority: PRIORITIES.CRITICAL,
      assigneeId: DEMO_ADMIN_USER_ID,
      order: 99,
      tagIds: [],
      lastMovedAt: FIXED_NOW,
      lastActivityAt: FIXED_NOW,
      startedAt: asIsoDateTime('2026-04-10T10:00:00.000Z'),
      completedAt: asIsoDateTime('2026-04-10T18:00:00.000Z'),
      createdByUserId: DEMO_ADMIN_USER_ID,
      createdAt: asIsoDateTime('2026-04-10T08:00:00.000Z'),
      updatedAt: FIXED_NOW,
    });

    // Seed a third-party OVERLOAD alert in DEMO_PROJECT_ID
    await container.repositories.bottlenecks.bottleneckAlerts.save({
      id: asBottleneckAlertId('66000000-0000-4000-8000-000000000001'),
      organizationId: DEMO_ORG_ID,
      projectId: DEMO_PROJECT_ID,
      indicator: BOTTLENECK_INDICATORS.OVERLOAD,
      severity: BOTTLENECK_SEVERITIES.HIGH,
      status: BOTTLENECK_ALERT_STATUSES.OPEN,
      deduplicationKey: `${DEMO_ORG_ID}:OVERLOAD:USER:${DEMO_ADMIN_USER_ID}`,
      targetEntityType: 'USER',
      targetEntityId: DEMO_ADMIN_USER_ID,
      summary: 'Sobrecarga individual do Admin',
      detectedAt: FIXED_NOW,
      lastSeenAt: FIXED_NOW,
      occurrenceCount: 1,
    });

    // Seed a secret internal note on feedback that must NEVER appear in analytics
    const secretNote: FeedbackInternalNote = {
      id: asFeedbackInternalNoteId('67000000-0000-4000-8000-000000000001'),
      organizationId: DEMO_ORG_ID,
      feedbackId: DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG,
      cycleId: asFeedbackCycleId('67000000-0000-4000-8000-000000000002'),
      authorUserId: DEMO_ADMIN_USER_ID,
      body: 'CONFIDENTIAL_INTERNAL_NOTE_SECRET',
      mentionedUserIds: [],
      createdAt: FIXED_NOW,
    };
    await container.repositories.feedback.feedbackInternalNotes.append(secretNote);

    // 1. MEMBER accessing project analytics via MSW: allowed, NO third-party individual metrics, NO third-party OVERLOAD alert
    const memberRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/analytics?preset=LAST_30_DAYS`,
      { headers: authHeaders(DEMO_MEMBER_USER_ID) },
    );
    expect(memberRes.status).toBe(200);
    const memberBody = (await memberRes.json()) as ApiSuccessEnvelope<AnalyticsOverview>;
    expect(memberBody.data.includesThirdPartyIndividualMetrics).toBe(false);
    expect(memberBody.data.workload.memberWorkloads).toEqual([]);
    expect(memberBody.data.bottlenecks.alerts.some((a) => a.indicator === 'OVERLOAD')).toBe(false);
    expect(memberBody.data.feedback.assigneePerformance).toEqual([]);
    expect(JSON.stringify(memberBody.data)).not.toContain('CONFIDENTIAL_INTERNAL_NOTE_SECRET');
    expect(JSON.stringify(memberBody.data)).not.toContain(PRIVATE_TASK_ID);

    // 2. MANAGER with Default Deny (allowManagerViewIndividualProductivity === false) sees NO third-party breakdown
    const managerRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=PROJECT&projectId=${DEMO_PROJECT_ID}`,
      { headers: authHeaders(DEMO_MANAGER_USER_ID) },
    );
    expect(managerRes.status).toBe(200);
    const managerBody = (await managerRes.json()) as ApiSuccessEnvelope<AnalyticsOverview>;
    expect(managerBody.data.includesThirdPartyIndividualMetrics).toBe(false);
    expect(managerBody.data.workload.memberWorkloads).toEqual([]);

    // 3. MEMBER/MANAGER cannot view ORGANIZATION analytics (403 Forbidden)
    const memberOrgRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=ORGANIZATION`,
      { headers: authHeaders(DEMO_MEMBER_USER_ID) },
    );
    expect(memberOrgRes.status).toBe(403);

    // 4. ADMIN accessing ORGANIZATION analytics sees full metrics + third-party individual breakdown + cross-project tasks
    const adminOrgRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=ORGANIZATION&preset=LAST_30_DAYS`,
      { headers: authHeaders(DEMO_ADMIN_USER_ID) },
    );
    expect(adminOrgRes.status).toBe(200);
    const adminOrgBody = (await adminOrgRes.json()) as ApiSuccessEnvelope<AnalyticsOverview>;
    expect(adminOrgBody.data.includesThirdPartyIndividualMetrics).toBe(true);
    expect(adminOrgBody.data.workload.memberWorkloads.length).toBeGreaterThan(0);
    expect(adminOrgBody.data.flow.effectiveCycleTimeMs).toBeDefined();
    expect(adminOrgBody.data.flow.totalCycleTimeMs).toBeDefined();
    expect(adminOrgBody.data.feedback.byCategoryVersion.length).toBeGreaterThan(0);

    // 5. Insufficient data returns UNAVAILABLE (never implicit zero)
    const emptyFutureRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=ORGANIZATION&preset=CUSTOM&start=2030-01-01T00:00:00.000Z&end=2030-01-31T00:00:00.000Z`,
      { headers: authHeaders(DEMO_ADMIN_USER_ID) },
    );
    expect(emptyFutureRes.status).toBe(200);
    const emptyFutureBody = (await emptyFutureRes.json()) as ApiSuccessEnvelope<AnalyticsOverview>;
    expect(emptyFutureBody.data.flow.leadTimeMs.status).toBe(
      METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
    );
    expect(emptyFutureBody.data.flow.effectiveCycleTimeMs.status).toBe(
      METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
    );
    expect(emptyFutureBody.data.flow.cohortCompletionRate.status).toBe(
      METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
    );
  });

  it('persists and resets DashboardPreference preserving existing.id and isDemoIsolated (DN-04)', async () => {
    const getInitialRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/dashboard-preferences?scope=PERSONAL`,
      { headers: authHeaders(DEMO_MEMBER_USER_ID) },
    );
    expect(getInitialRes.status).toBe(200);
    const initialBody =
      (await getInitialRes.json()) as ApiSuccessEnvelope<DashboardPreferenceResult>;
    expect(initialBody.data.isDefault).toBe(true);
    expect(initialBody.data.preference.isDemoIsolated).toBe(true);

    const saveRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/dashboard-preferences`,
      {
        method: 'PUT',
        headers: authHeaders(DEMO_MEMBER_USER_ID),
        body: JSON.stringify({
          scope: DASHBOARD_SCOPES.PERSONAL,
          widgets: [
            { widgetKey: 'my-workload', visible: true, order: 0 },
            { widgetKey: 'flow-kpis', visible: false, order: 1 },
          ],
        }),
      },
    );
    expect(saveRes.status).toBe(200);
    const savedBody = (await saveRes.json()) as ApiSuccessEnvelope<DashboardPreference>;
    const savedId = savedBody.data.id;
    expect(savedBody.data.isDemoIsolated).toBe(true);
    expect(savedBody.data.widgets).toHaveLength(2);

    const resetRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/dashboard-preferences/reset`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_MEMBER_USER_ID),
        body: JSON.stringify({ scope: DASHBOARD_SCOPES.PERSONAL }),
      },
    );
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as ApiSuccessEnvelope<DashboardPreference>;
    expect(resetBody.data.id).toBe(savedId);
    expect(resetBody.data.widgets.length).toBeGreaterThan(2);
  });

  it('enforces ADMIN-only calibration (ANALYTICS_RULES_MANAGE), weight sum = 1.0, and writes AuditEvent (DN-06)', async () => {
    const deniedRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/analytics-rules`,
      { headers: authHeaders(DEMO_MANAGER_USER_ID) },
    );
    expect(deniedRes.status).toBe(403);

    const invalidSumRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/analytics-rules`,
      {
        method: 'PATCH',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          calibratableWeights: {
            workloadPriorityWeight: 0.9,
            workloadDelayWeight: 0.9,
          },
        }),
      },
    );
    expect(invalidSumRes.status).toBe(422);

    const validRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/analytics-rules`,
      {
        method: 'PATCH',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          calibratableWeights: {
            workloadPriorityWeight: 0.4,
            workloadDelayWeight: 0.3,
            workloadImpedimentsWeight: 0.2,
            workloadOperationalStateWeight: 0.1,
            defaultProjectInactivityThresholdDays: 10,
          },
          justification: 'Calibracao trimestral',
        }),
      },
    );
    expect(validRes.status).toBe(200);
    const validBody =
      (await validRes.json()) as ApiSuccessEnvelope<AnalyticsCalibrationSettingsView>;
    expect(validBody.data.calibratableWeights.workloadPriorityWeight).toBe(0.4);
    expect(validBody.data.calibratableWeights.defaultProjectInactivityThresholdDays).toBe(10);

    const auditPage = await container.repositories.audit.auditEvents.listByOrganization(
      DEMO_ORG_ID,
      {
        page: 1,
        pageSize: 50,
      },
    );
    expect(auditPage.items.some((e) => e.eventType === 'analytics.calibration.updated')).toBe(true);
  });

  it('enforces reportAccessRule mitigation, preview <-> export parity, binary PDF/XLSX/CSV/JSON HTTP responses, and EXPORT AuditEvent', async () => {
    const catalogRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/catalog`,
      { headers: authHeaders(DEMO_MEMBER_USER_ID) },
    );
    expect(catalogRes.status).toBe(200);
    const catalogBody = (await catalogRes.json()) as ApiSuccessEnvelope<
      readonly ReportCatalogEntryView[]
    >;
    expect(catalogBody.data).toHaveLength(4);

    // 1. Mitigação de reportAccessRule: MEMBER no projeto participante solicita PRODUCTIVITY_WORKLOAD
    //    -> permitido mas SEM linhas nominais de terceiros!
    const memberPreviewRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/preview`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_MEMBER_USER_ID),
        body: JSON.stringify({
          kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
          scope: REPORT_SCOPES.PROJECT,
          projectId: DEMO_PROJECT_ID,
          period: {
            start: '2026-03-20T00:00:00.000Z',
            end: '2026-04-20T23:59:59.000Z',
          },
          compareWithPreviousPeriod: true,
        }),
      },
    );
    expect(memberPreviewRes.status).toBe(200);
    const memberPreviewBody = (await memberPreviewRes.json()) as ApiSuccessEnvelope<ReportSnapshot>;
    expect(memberPreviewBody.data.includesThirdPartyIndividualMetrics).toBe(false);
    expect(JSON.stringify(memberPreviewBody.data.rows)).not.toContain('Demo Admin');

    // 2. ADMIN solicita preview e export do mesmo relatório e verifica paridade estrita
    const adminPreviewRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/preview`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
          scope: REPORT_SCOPES.PROJECT,
          projectId: DEMO_PROJECT_ID,
          period: {
            start: '2026-03-20T00:00:00.000Z',
            end: '2026-04-20T23:59:59.000Z',
          },
          compareWithPreviousPeriod: true,
        }),
      },
    );
    expect(adminPreviewRes.status).toBe(200);
    const adminPreview = (await adminPreviewRes.json()) as ApiSuccessEnvelope<ReportSnapshot>;
    expect(adminPreview.data.includesThirdPartyIndividualMetrics).toBe(true);
    expect(adminPreview.data.rows.length).toBeGreaterThan(1);

    const exportJsonRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/export`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
          scope: REPORT_SCOPES.PROJECT,
          projectId: DEMO_PROJECT_ID,
          period: {
            start: '2026-03-20T00:00:00.000Z',
            end: '2026-04-20T23:59:59.000Z',
          },
          compareWithPreviousPeriod: true,
          format: REPORT_FORMATS.JSON,
        }),
      },
    );
    expect(exportJsonRes.status).toBe(200);
    expect(exportJsonRes.headers.get('content-type')).toBe('application/json');
    const exportedSnapshot = JSON.parse(
      new TextDecoder().decode(await exportJsonRes.arrayBuffer()),
    ) as ReportSnapshot;
    expect(exportedSnapshot).toEqual(adminPreview.data);

    // 3. Binary PDF export
    const exportPdfRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/export`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          kind: REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
          scope: REPORT_SCOPES.ORGANIZATION,
          period: {
            start: '2026-03-20T00:00:00.000Z',
            end: '2026-04-20T23:59:59.000Z',
          },
          format: REPORT_FORMATS.PDF,
        }),
      },
    );
    expect(exportPdfRes.status).toBe(200);
    expect(exportPdfRes.headers.get('content-type')).toBe('application/pdf');
    const pdfText = new TextDecoder('latin1').decode(await exportPdfRes.arrayBuffer());
    expect(pdfText.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdfText).toContain('xref\n');
    expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(exportPdfRes.headers.get('content-disposition')).toContain(
      `organization-executive-summary-${DEMO_ORG_ID}.pdf`,
    );

    // 4. Binary XLSX export
    const exportXlsxRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/export`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          kind: REPORT_KINDS.FEEDBACK_SLA_CONTESTS,
          scope: REPORT_SCOPES.ORGANIZATION,
          period: {
            start: '2026-03-20T00:00:00.000Z',
            end: '2026-04-20T23:59:59.000Z',
          },
          format: REPORT_FORMATS.XLSX,
        }),
      },
    );
    expect(exportXlsxRes.status).toBe(200);
    expect(exportXlsxRes.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(exportXlsxRes.headers.get('content-disposition')).toContain(
      `feedback-sla-contests-${DEMO_ORG_ID}.xlsx`,
    );
    const xlsxBytes = new Uint8Array(await exportXlsxRes.arrayBuffer());
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);
    expect(xlsxBytes[2]).toBe(0x03);
    expect(xlsxBytes[3]).toBe(0x04);
    expect(xlsxBytes[xlsxBytes.length - 22]).toBe(0x50);
    expect(xlsxBytes[xlsxBytes.length - 21]).toBe(0x4b);
    expect(xlsxBytes[xlsxBytes.length - 20]).toBe(0x05);
    expect(xlsxBytes[xlsxBytes.length - 19]).toBe(0x06);
    const rawXlsxAscii = new TextDecoder('latin1').decode(xlsxBytes);
    expect(rawXlsxAscii).toContain('t="inlineStr"');
    expect(rawXlsxAscii).not.toContain('<f');

    // 5. CSV export
    const exportCsvRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/export`,
      {
        method: 'POST',
        headers: authHeaders(DEMO_ADMIN_USER_ID),
        body: JSON.stringify({
          kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
          scope: REPORT_SCOPES.PROJECT,
          projectId: DEMO_PROJECT_ID,
          period: {
            start: '2026-03-20T00:00:00.000Z',
            end: '2026-04-20T23:59:59.000Z',
          },
          format: REPORT_FORMATS.CSV,
        }),
      },
    );
    expect(exportCsvRes.status).toBe(200);
    expect(exportCsvRes.headers.get('content-type')).toBe('text/csv');
    expect(exportCsvRes.headers.get('content-disposition')).toContain(
      `project-delivery-flow-${DEMO_ORG_ID}.csv`,
    );

    // Verify AUDIT_CATEGORIES.EXPORT events were recorded
    const exportAudits = await container.repositories.audit.auditEvents.listByOrganization(
      DEMO_ORG_ID,
      {
        page: 1,
        pageSize: 50,
      },
    );
    expect(
      exportAudits.items.filter(
        (e) => e.category === AUDIT_CATEGORIES.EXPORT && e.eventType === 'report.exported',
      ).length,
    ).toBe(4);
  });

  it('neutralizes Formula Injection in FeedbackService.exportFeedbacks CSV via shared kernel (DN-08)', async () => {
    const feedback = await container.repositories.feedback.feedbacks.findById(
      DEMO_ORG_ID,
      DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG,
    );
    expect(feedback).not.toBeNull();
    if (!feedback) {
      return;
    }

    await container.repositories.feedback.feedbacks.save({
      ...feedback,
      title: '=HYPERLINK("http://evil.example","Click")',
      status: FEEDBACK_STATUSES.IN_PROGRESS,
    });

    const exported = await container.services.feedback.exportFeedbacks(
      DEMO_ADMIN_USER_ID,
      DEMO_ORG_ID,
      { format: 'CSV' },
    );

    expect(exported.content).toContain('"\'=HYPERLINK(""http://evil.example"",""Click"")"');
  });

  it('prevents cross-organization data leakage in DexieAnalyticsPortsAdapter & services', async () => {
    await expect(
      container.services.analytics.getAnalyticsOverview(DEMO_ADMIN_USER_ID, OTHER_ORG_ID, {
        scope: DASHBOARD_SCOPES.ORGANIZATION,
        preset: ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
      }),
    ).rejects.toThrow();

    await expect(
      container.services.analytics.updateCalibrationSettings(DEMO_MEMBER_USER_ID, DEMO_ORG_ID, {
        calibratableWeights: { workloadPausedFactor: 0.5 },
      }),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      container.services.reports.previewReport(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.ORGANIZATION,
        period: {
          start: asIsoDateTime('2026-04-01T00:00:00.000Z'),
          end: asIsoDateTime('2026-04-20T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('returns 401 when unauthenticated and 403/422 for RBAC, ExplicitDeny, cross-org and malformed payloads across all §13 MSW endpoints', async () => {
    const unauthHeaders = { 'content-type': 'application/json' };

    // 401 across all §13 endpoints without actor header
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=PERSONAL`,
          { headers: unauthHeaders },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/projects/${DEMO_PROJECT_ID}/analytics`,
          { headers: unauthHeaders },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/dashboard-preferences?scope=PERSONAL`,
          { headers: unauthHeaders },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/analytics-rules`,
          { headers: unauthHeaders },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/catalog`, {
          headers: unauthHeaders,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/preview`, {
          method: 'POST',
          headers: unauthHeaders,
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/export`, {
          method: 'POST',
          headers: unauthHeaders,
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(401);

    // 200 PERSONAL analytics with compareWithPreviousPeriod=false
    const personalRes = await fetch(
      `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=PERSONAL&compareWithPreviousPeriod=false`,
      { headers: authHeaders(DEMO_MEMBER_USER_ID) },
    );
    expect(personalRes.status).toBe(200);
    const personalBody = (await personalRes.json()) as ApiSuccessEnvelope<AnalyticsOverview>;
    expect(personalBody.data.scope).toBe(DASHBOARD_SCOPES.PERSONAL);
    expect(personalBody.data.previousPeriod).toBeUndefined();

    // 403 RBAC on ORGANIZATION dashboard preference, PATCH analytics-rules, and ORGANIZATION report preview for MEMBER
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/dashboard-preferences?scope=ORGANIZATION`,
          { headers: authHeaders(DEMO_MEMBER_USER_ID) },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/settings/analytics-rules`,
          {
            method: 'PATCH',
            headers: authHeaders(DEMO_MEMBER_USER_ID),
            body: JSON.stringify({ calibratableWeights: { workloadPausedFactor: 0.25 } }),
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/preview`, {
          method: 'POST',
          headers: authHeaders(DEMO_MEMBER_USER_ID),
          body: JSON.stringify({
            kind: REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
            scope: REPORT_SCOPES.ORGANIZATION,
            period: {
              start: '2026-03-20T00:00:00.000Z',
              end: '2026-04-20T23:59:59.000Z',
            },
          }),
        })
      ).status,
    ).toBe(403);

    // 403 cross-org over HTTP (seed OTHER_ORG_ID owned by another user so org exists but DEMO_ADMIN has no membership)
    const outsider = await container.services.auth.registerUser({
      email: 'outsider.msw@pms.local',
      password: 'PasswordForte!2026',
      displayName: 'Outsider Org',
      acceptTerms: true,
      persistent: true,
    });
    const { organization: otherOrg } = await container.services.organizations.createOrganization(
      outsider.user.id,
      {
        name: 'Other Org MSW',
        slug: 'other-org-msw',
      },
    );
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${otherOrg.id}/analytics?scope=PERSONAL`,
          {
            headers: authHeaders(DEMO_ADMIN_USER_ID),
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${OTHER_ORG_ID}/analytics?scope=PERSONAL`,
          {
            headers: authHeaders(DEMO_ADMIN_USER_ID),
          },
        )
      ).status,
    ).toBe(404);

    // 403 ExplicitDenyRule on REPORT_EXPORT
    await container.services.authorization.createExplicitDenyRule(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
      targetUserId: DEMO_MEMBER_USER_ID,
      permission: PERMISSION_CODES.REPORT_EXPORT,
      scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
      reason: 'Deny export in MSW test',
    });
    expect(
      (
        await fetch(`http://localhost/api/v1/organizations/${DEMO_ORG_ID}/reports/export`, {
          method: 'POST',
          headers: authHeaders(DEMO_MEMBER_USER_ID),
          body: JSON.stringify({
            kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
            scope: REPORT_SCOPES.PROJECT,
            projectId: DEMO_PROJECT_ID,
            period: {
              start: '2026-03-20T00:00:00.000Z',
              end: '2026-04-20T23:59:59.000Z',
            },
            format: REPORT_FORMATS.JSON,
          }),
        })
      ).status,
    ).toBe(403);

    // 422 validation errors on partial custom range and invalid reset body
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/analytics?scope=ORGANIZATION&preset=CUSTOM&start=2026-04-01T00:00:00.000Z`,
          { headers: authHeaders(DEMO_ADMIN_USER_ID) },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await fetch(
          `http://localhost/api/v1/organizations/${DEMO_ORG_ID}/dashboard-preferences/reset`,
          {
            method: 'POST',
            headers: authHeaders(DEMO_ADMIN_USER_ID),
            body: JSON.stringify({}),
          },
        )
      ).status,
    ).toBe(422);
  });
});
