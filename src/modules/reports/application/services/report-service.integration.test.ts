import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { AUDIT_CATEGORIES } from '@/modules/audit';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import {
  FEEDBACK_STATUSES,
  INITIAL_CONTEST_REASONS,
  INITIAL_FEEDBACK_CATEGORIES,
  asFeedbackCategoryId,
  asFeedbackContestReasonId,
} from '@/modules/feedback';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { AuthorizationError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  asIsoDateTime,
  type DomainEventEnvelope,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import {
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_SCOPES,
  type ReportSnapshot,
} from '../../index';

const FORMULA_INJECTION_PAYLOADS = [
  "=CMD|' /C calc'!A0",
  '+1+1',
  '-2+3',
  '@SUM(A1:A2)',
  '\t=1+1',
  '\r=1+1',
  '   =HYPERLINK("http://evil.test","Click")',
] as const;

function parseZipStoreEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();

  let offset = 0;
  while (offset + 4 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break;
    }
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    expect(compressionMethod).toBe(0);
    expect(compressedSize).toBe(uncompressedSize);

    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLen + extraLen;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLen));
    const data = bytes.subarray(dataStart, dataStart + uncompressedSize);
    entries.set(name, data);

    offset = dataStart + uncompressedSize;
  }

  return entries;
}

describe('ReportService Integration (Dexie, 4 Canonical Reports, Preview<->Export Parity, reportAccessRule Mitigation, Internal Notes Segregation, Binary PDF/XLSX & DN-08 Formula Injection)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-10-15T12:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_report_service_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.db.isOpen()) {
      container.db.close();
    }
    await container.db.delete();
  });

  async function registerUser(email: string, displayName: string) {
    return container.services.auth.registerUser({
      email,
      password: 'PasswordForte!2026',
      displayName,
      acceptTerms: true,
      persistent: true,
    });
  }

  async function setupReportFixture() {
    currentNow = asIsoDateTime('2026-10-01T09:00:00.000Z');
    const admin = await registerUser('admin.reports@pms.local', 'Admin Relatorios');
    const managerA = await registerUser('managerA.reports@pms.local', 'Gestor Alpha');
    const managerB = await registerUser('managerB.reports@pms.local', 'Gestor Beta');
    const member = await registerUser('member.reports@pms.local', 'Membro Relatorios');
    const colleague = await registerUser('colleague.reports@pms.local', 'Colega Terceiro');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      {
        name: 'Reports Corp',
        slug: 'reports-corp',
      },
    );

    for (const [userId, role] of [
      [managerA.user.id, ORGANIZATION_ROLES.MANAGER],
      [managerB.user.id, ORGANIZATION_ROLES.MANAGER],
      [member.user.id, ORGANIZATION_ROLES.MEMBER],
      [colleague.user.id, ORGANIZATION_ROLES.MEMBER],
    ] as const) {
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId,
        role,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });
    }

    const projectA = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      {
        name: 'Projeto Entrega Alpha',
        ownerUserId: managerA.user.id,
      },
    );
    await container.services.projects.addProjectParticipant(
      managerA.user.id,
      organization.id,
      projectA.id,
      member.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );
    await container.services.projects.addProjectParticipant(
      managerA.user.id,
      organization.id,
      projectA.id,
      colleague.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    const projectB = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      {
        name: 'Projeto Secreto Beta',
        ownerUserId: managerB.user.id,
      },
    );

    // Operational task data in Project A
    currentNow = asIsoDateTime('2026-10-02T09:00:00.000Z');
    const task1 = await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Implementar API de Relatorios',
        priority: PRIORITIES.HIGH,
        assigneeId: colleague.user.id,
      },
    );
    currentNow = asIsoDateTime('2026-10-02T10:00:00.000Z');
    await container.services.tasks.startTask(managerA.user.id, organization.id, task1.id);
    currentNow = asIsoDateTime('2026-10-02T16:00:00.000Z');
    await container.services.tasks.completeTask(managerA.user.id, organization.id, task1.id);

    await container.services.tasks.createTask(
      managerA.user.id,
      organization.id,
      projectA.id,
      {
        title: 'Tarefa Ativa Membro',
        priority: PRIORITIES.MEDIUM,
        assigneeId: member.user.id,
      },
    );

    // Feedback + internal note + internal attachment
    currentNow = asIsoDateTime('2026-10-05T10:00:00.000Z');
    const bugCategory = await container.services.feedback.createFeedbackCategory(
      admin.user.id,
      organization.id,
      {
        code: INITIAL_FEEDBACK_CATEGORIES.BUG_ERROR,
        name: 'Erro ou defeito',
      },
    );
    const reason = await container.services.feedback.createFeedbackContestReason(
      admin.user.id,
      organization.id,
      {
        code: INITIAL_CONTEST_REASONS.PROBLEM_PERSISTS,
        name: 'Problema persiste',
      },
    );

    const fb = await container.services.feedback.createFeedback(member.user.id, organization.id, {
      title: 'Feedback Para Relatorio SLA',
      description: 'Descricao publica do chamado',
      moduleKey: 'reports',
      categoryId: asFeedbackCategoryId(bugCategory.category.id),
      priority: PRIORITIES.HIGH,
    });
    await container.services.feedback.transitionFeedbackStatus(admin.user.id, organization.id, fb.id, {
      targetStatus: FEEDBACK_STATUSES.IN_ANALYSIS,
    });
    await container.services.feedback.assignFeedback(admin.user.id, organization.id, fb.id, {
      assigneeId: managerA.user.id,
    });
    await container.services.feedback.transitionFeedbackStatus(
      managerA.user.id,
      organization.id,
      fb.id,
      { targetStatus: FEEDBACK_STATUSES.IN_PROGRESS },
    );

    const internalNote = await container.services.feedback.addFeedbackInternalNote(
      admin.user.id,
      organization.id,
      fb.id,
      {
        body: 'NOTA_INTERNA_SIGILOSA_RELATORIO',
      },
    );
    await container.services.feedback.uploadFeedbackAttachment(
      admin.user.id,
      organization.id,
      fb.id,
      {
        fileName: 'anexo_interno_sigiloso.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('segredo-anexo-interno'),
        internalNoteId: internalNote.id,
      },
    );

    currentNow = asIsoDateTime('2026-10-05T14:00:00.000Z');
    await container.services.feedback.transitionFeedbackStatus(
      managerA.user.id,
      organization.id,
      fb.id,
      {
        targetStatus: FEEDBACK_STATUSES.RESOLVED,
        resolutionDescription: 'Corrigido no sprint atual',
      },
    );

    await container.services.feedback.openFeedbackContest(member.user.id, organization.id, fb.id, {
      reasonId: asFeedbackContestReasonId(reason.reason.id),
      justification: 'Validando contestacao em relatorio',
    });

    currentNow = asIsoDateTime('2026-10-15T12:00:00.000Z');
    return {
      admin,
      managerA,
      managerB,
      member,
      colleague,
      organization,
      projectA,
      projectB,
      internalNote,
    };
  }

  it('supports all 4 canonical reports with strict Preview <-> Export parity across JSON, CSV, PDF 1.4 and XLSX, recording EXPORT AuditEvent only on export (never on preview)', async () => {
    const { admin, organization, projectA, internalNote } = await setupReportFixture();
    const period = {
      start: asIsoDateTime('2026-10-01T00:00:00.000Z'),
      end: asIsoDateTime('2026-10-15T23:59:59.000Z'),
    };

    const catalog = await container.services.reports.listReportCatalog(admin.user.id, organization.id);
    expect(catalog.map((c) => c.kind)).toEqual([
      REPORT_KINDS.PROJECT_DELIVERY_FLOW,
      REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
      REPORT_KINDS.FEEDBACK_SLA_CONTESTS,
      REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
    ]);

    // Invalid filter combinations fail with ValidationError
    await expect(
      container.services.reports.previewReport(admin.user.id, organization.id, {
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.ORGANIZATION,
        period,
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      container.services.reports.previewReport(admin.user.id, organization.id, {
        kind: REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      }),
    ).rejects.toThrow(ValidationError);

    const reportCases = [
      {
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
      },
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
      },
      {
        kind: REPORT_KINDS.FEEDBACK_SLA_CONTESTS,
        scope: REPORT_SCOPES.ORGANIZATION,
      },
      {
        kind: REPORT_KINDS.ORGANIZATION_EXECUTIVE_SUMMARY,
        scope: REPORT_SCOPES.ORGANIZATION,
      },
    ] as const;

    const exportEvents: DomainEventEnvelope[] = [];
    container.eventBus.subscribe((event) => {
      if (event.eventType === 'report.exported') {
        exportEvents.push(event);
      }
    });

    const initialAuditCount = (
      await container.repositories.audit.auditEvents.listByOrganization(organization.id, {
        page: 1,
        pageSize: 100,
      })
    ).items.length;

    let expectedExportAudits = 0;

    for (const reportInput of reportCases) {
      const preview = await container.services.reports.previewReport(
        admin.user.id,
        organization.id,
        {
          ...reportInput,
          period,
          compareWithPreviousPeriod: true,
        },
      );
      expect(preview.kind).toBe(reportInput.kind);
      expect(preview.kpis.length).toBeGreaterThan(0);
      expect(preview.columns.length).toBeGreaterThan(0);
      expect(preview.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(preview)).not.toContain('NOTA_INTERNA_SIGILOSA_RELATORIO');
      expect(JSON.stringify(preview)).not.toContain('anexo_interno_sigiloso.txt');
      expect(JSON.stringify(preview)).not.toContain(internalNote.id);

      // Zero new AuditEvents after preview
      const afterPreviewAudits = await container.repositories.audit.auditEvents.listByOrganization(
        organization.id,
        { page: 1, pageSize: 100 },
      );
      expect(afterPreviewAudits.items).toHaveLength(initialAuditCount + expectedExportAudits);

      // Export in all 4 formats and verify strict parity
      const jsonExport = await container.services.reports.exportReport(
        admin.user.id,
        organization.id,
        { ...reportInput, period, compareWithPreviousPeriod: true, format: REPORT_FORMATS.JSON },
      );
      const parsedJson = JSON.parse(new TextDecoder().decode(jsonExport.bytes)) as ReportSnapshot;
      expect(parsedJson).toEqual(preview);

      const csvExport = await container.services.reports.exportReport(
        admin.user.id,
        organization.id,
        { ...reportInput, period, compareWithPreviousPeriod: true, format: REPORT_FORMATS.CSV },
      );
      const csvText = new TextDecoder().decode(csvExport.bytes);
      const csvLines = csvText.split('\r\n');
      expect(csvLines).toHaveLength(preview.rows.length + 1);
      expect(csvLines[0]).toBe(preview.columns.map((c) => c.label).join(','));
      expect(csvText).not.toContain('NOTA_INTERNA_SIGILOSA_RELATORIO');
      expect(csvText).not.toContain('anexo_interno_sigiloso.txt');

      const pdfExport = await container.services.reports.exportReport(
        admin.user.id,
        organization.id,
        { ...reportInput, period, compareWithPreviousPeriod: true, format: REPORT_FORMATS.PDF },
      );
      const pdfText = new TextDecoder('latin1').decode(pdfExport.bytes);
      expect(pdfText.startsWith('%PDF-1.4\n')).toBe(true);
      expect(pdfText).toContain('/Type /Catalog');
      expect(pdfText).toContain('/BaseFont /Helvetica');
      expect(pdfText).toContain('xref\n');
      expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(pdfText).toContain(preview.snapshotGeneratedAt);
      expect(pdfText).toContain(preview.kpis[0]!.label);
      expect(pdfText).not.toContain('NOTA_INTERNA_SIGILOSA_RELATORIO');

      const xlsxExport = await container.services.reports.exportReport(
        admin.user.id,
        organization.id,
        { ...reportInput, period, compareWithPreviousPeriod: true, format: REPORT_FORMATS.XLSX },
      );
      const xlsxBytes = xlsxExport.bytes;
      expect(xlsxBytes[0]).toBe(0x50);
      expect(xlsxBytes[1]).toBe(0x4b);
      expect(xlsxBytes[2]).toBe(0x03);
      expect(xlsxBytes[3]).toBe(0x04);
      expect(xlsxBytes[xlsxBytes.length - 22]).toBe(0x50);
      expect(xlsxBytes[xlsxBytes.length - 21]).toBe(0x4b);
      expect(xlsxBytes[xlsxBytes.length - 20]).toBe(0x05);
      expect(xlsxBytes[xlsxBytes.length - 19]).toBe(0x06);

      const zipEntries = parseZipStoreEntries(xlsxBytes);
      const sheetXml = new TextDecoder().decode(zipEntries.get('xl/worksheets/sheet1.xml'));
      expect(sheetXml).toContain('t="inlineStr"');
      expect(sheetXml).not.toContain('<f');
      expect(sheetXml).toContain(preview.snapshotGeneratedAt);
      expect(sheetXml).toContain(preview.kpis[0]!.label);
      expect(sheetXml).toContain(preview.columns[0]!.label);
      expect(sheetXml).not.toContain('NOTA_INTERNA_SIGILOSA_RELATORIO');

      expectedExportAudits += 4;
    }

    const finalAudits = await container.repositories.audit.auditEvents.listByOrganization(
      organization.id,
      { page: 1, pageSize: 100 },
    );
    const reportExportAudits = finalAudits.items.filter(
      (e) => e.category === AUDIT_CATEGORIES.EXPORT && e.eventType === 'report.exported',
    );
    expect(reportExportAudits).toHaveLength(expectedExportAudits);
    expect(exportEvents).toHaveLength(expectedExportAudits);
  });

  it('enforces critical reportAccessRule mitigation: MEMBER never receives third-party nominal productivity rows and MANAGER only receives them when allowManagerViewIndividualProductivity === true on managed project', async () => {
    const { admin, managerA, member, colleague, organization, projectA, projectB } =
      await setupReportFixture();
    const period = {
      start: asIsoDateTime('2026-10-01T00:00:00.000Z'),
      end: asIsoDateTime('2026-10-15T23:59:59.000Z'),
    };

    // 1. MEMBER requesting PRODUCTIVITY_WORKLOAD on participated project -> NEVER gets third-party nominal rows
    const memberWorkloadPreview = await container.services.reports.previewReport(
      member.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      },
    );
    expect(memberWorkloadPreview.includesThirdPartyIndividualMetrics).toBe(false);
    expect(JSON.stringify(memberWorkloadPreview.rows)).not.toContain(colleague.user.displayName);
    expect(JSON.stringify(memberWorkloadPreview.rows)).not.toContain(managerA.user.displayName);

    const memberWorkloadCsv = await container.services.reports.exportReport(
      member.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
        format: REPORT_FORMATS.CSV,
      },
    );
    expect(new TextDecoder().decode(memberWorkloadCsv.bytes)).not.toContain(
      colleague.user.displayName,
    );

    // 2. MANAGER with Default Deny (allowManagerViewIndividualProductivity === false)
    const managerDefaultPreview = await container.services.reports.previewReport(
      managerA.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      },
    );
    expect(managerDefaultPreview.includesThirdPartyIndividualMetrics).toBe(false);
    expect(JSON.stringify(managerDefaultPreview.rows)).not.toContain(colleague.user.displayName);

    const managerFeedbackDefault = await container.services.reports.previewReport(
      managerA.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.FEEDBACK_SLA_CONTESTS,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      },
    );
    expect(managerFeedbackDefault.includesThirdPartyIndividualMetrics).toBe(false);
    expect(JSON.stringify(managerFeedbackDefault.rows)).not.toContain('Desempenho por Responsavel');

    // 3. Enable allowManagerViewIndividualProductivity = true -> MANAGER sees third-party rows in managed Project A, MEMBER STILL denied!
    await container.services.bottlenecks.updateIndividualProductivityVisibility(
      admin.user.id,
      organization.id,
      {
        allowManagerViewIndividualProductivity: true,
        justification: 'Liberacao controlada para gestor do projeto',
      },
    );

    const managerAllowedPreview = await container.services.reports.previewReport(
      managerA.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      },
    );
    expect(managerAllowedPreview.includesThirdPartyIndividualMetrics).toBe(true);
    expect(JSON.stringify(managerAllowedPreview.rows)).toContain(colleague.user.displayName);

    // MEMBER still blocked from third-party nominal rows even after toggle
    const memberStillBlocked = await container.services.reports.previewReport(
      member.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      },
    );
    expect(memberStillBlocked.includesThirdPartyIndividualMetrics).toBe(false);
    expect(JSON.stringify(memberStillBlocked.rows)).not.toContain(colleague.user.displayName);

    // MANAGER denied on unmanaged Project B and ORGANIZATION scope
    await expect(
      container.services.reports.previewReport(managerA.user.id, organization.id, {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectB.id,
        period,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      container.services.reports.previewReport(managerA.user.id, organization.id, {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.ORGANIZATION,
        period,
      }),
    ).rejects.toThrow(AuthorizationError);

    // ExplicitDenyRule for REPORT_EXPORT allows preview but denies export without recording EXPORT AuditEvent
    await container.services.authorization.createExplicitDenyRule(admin.user.id, organization.id, {
      targetUserId: managerA.user.id,
      permission: PERMISSION_CODES.REPORT_EXPORT,
      scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
      reason: 'Bloqueio temporario de exportacao',
    });

    const canStillPreview = await container.services.reports.previewReport(
      managerA.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
      },
    );
    expect(canStillPreview.kind).toBe(REPORT_KINDS.PROJECT_DELIVERY_FLOW);

    await expect(
      container.services.reports.exportReport(managerA.user.id, organization.id, {
        kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
        format: REPORT_FORMATS.CSV,
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it('neutralizes all DN-08 Formula Injection payloads (=CMD, +1+1, -2+3, @SUM, \\t=1+1, \\r=1+1, leading-space =HYPERLINK) in BOTH ReportService (CSV & XLSX) and FeedbackService.exportFeedbacks (CSV)', async () => {
    const { admin, organization, projectA } = await setupReportFixture();
    const period = {
      start: asIsoDateTime('2026-10-01T00:00:00.000Z'),
      end: asIsoDateTime('2026-10-15T23:59:59.000Z'),
    };

    // Seed one user + one active task per malicious payload so PRODUCTIVITY_WORKLOAD exposes all 7 payloads as memberName
    for (let index = 0; index < FORMULA_INJECTION_PAYLOADS.length; index += 1) {
      const payload = FORMULA_INJECTION_PAYLOADS[index]!;
      const injectedUser = await registerUser(
        `fi.user${index}@pms.local`,
        `Safe Initial ${index}`,
      );
      const persistedUser = await container.repositories.users.users.findById(injectedUser.user.id);
      expect(persistedUser).not.toBeNull();
      if (persistedUser) {
        await container.repositories.users.users.save({
          ...persistedUser,
          displayName: payload,
        });
      }

      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId: injectedUser.user.id,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });

      await container.services.projects.addProjectParticipant(
        admin.user.id,
        organization.id,
        projectA.id,
        injectedUser.user.id,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );

      // Also seed a feedback with the exact raw formula-injection payload as title (bypassing input trim) for FeedbackService.exportFeedbacks CSV test
      const categories = await container.services.feedback.listFeedbackCategories(
        admin.user.id,
        organization.id,
      );
      const createdFb = await container.services.feedback.createFeedback(
        injectedUser.user.id,
        organization.id,
        {
          title: `Payload seed ${index}`,
          description: `Payload test ${index}`,
          moduleKey: 'reports',
          categoryId: asFeedbackCategoryId(categories[0]!.category.id),
          priority: PRIORITIES.MEDIUM,
        },
      );
      await container.repositories.feedback.feedbacks.save({
        ...createdFb,
        title: payload,
      });
    }

    // 1. ReportService CSV neutralization
    const reportCsv = await container.services.reports.exportReport(
      admin.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
        format: REPORT_FORMATS.CSV,
      },
    );
    const reportCsvText = new TextDecoder().decode(reportCsv.bytes);
    expect(reportCsvText).toContain("'=CMD|' /C calc'!A0");
    expect(reportCsvText).toContain("'+1+1");
    expect(reportCsvText).toContain("'-2+3");
    expect(reportCsvText).toContain("'@SUM(A1:A2)");
    expect(reportCsvText).toContain("'\t=1+1");
    expect(reportCsvText).toContain('"\'\r=1+1"');
    expect(reportCsvText).toContain('"\'   =HYPERLINK(""http://evil.test"",""Click"")"');

    // 2. ReportService XLSX neutralization (inlineStr, zero <f>)
    const reportXlsx = await container.services.reports.exportReport(
      admin.user.id,
      organization.id,
      {
        kind: REPORT_KINDS.PRODUCTIVITY_WORKLOAD,
        scope: REPORT_SCOPES.PROJECT,
        projectId: projectA.id,
        period,
        format: REPORT_FORMATS.XLSX,
      },
    );
    const zipEntries = parseZipStoreEntries(reportXlsx.bytes);
    const sheetXml = new TextDecoder().decode(zipEntries.get('xl/worksheets/sheet1.xml'));
    expect(sheetXml).toContain('t="inlineStr"');
    expect(sheetXml).not.toContain('<f');
    expect(sheetXml).toContain('&apos;=CMD|&apos; /C calc&apos;!A0');
    expect(sheetXml).toContain('&apos;+1+1');
    expect(sheetXml).toContain('&apos;-2+3');
    expect(sheetXml).toContain('&apos;@SUM(A1:A2)');
    expect(sheetXml).toContain('&apos;\t=1+1');
    expect(sheetXml).toContain('&apos;\r=1+1');
    expect(sheetXml).toContain('&apos;   =HYPERLINK(&quot;http://evil.test&quot;,&quot;Click&quot;)');

    // 3. FeedbackService.exportFeedbacks CSV neutralization (DN-08)
    const feedbackCsv = await container.services.feedback.exportFeedbacks(
      admin.user.id,
      organization.id,
      { format: 'CSV' },
    );
    expect(feedbackCsv.mimeType).toBe('text/csv');
    expect(feedbackCsv.content).toContain("'=CMD|' /C calc'!A0");
    expect(feedbackCsv.content).toContain("'+1+1");
    expect(feedbackCsv.content).toContain("'-2+3");
    expect(feedbackCsv.content).toContain("'@SUM(A1:A2)");
    expect(feedbackCsv.content).toContain("'\t=1+1");
    expect(feedbackCsv.content).toContain('"\'\r=1+1"');
    expect(feedbackCsv.content).toContain('"\'   =HYPERLINK(""http://evil.test"",""Click"")"');
  });
});
