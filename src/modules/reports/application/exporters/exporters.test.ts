import { describe, expect, it } from 'vitest';
import { asIsoDateTime, asOrganizationId, asProjectId, createDateRange } from '@/shared/kernel';
import { REPORT_KINDS, REPORT_SCOPES } from '../../domain/report-catalog';
import type { ReportSnapshot } from '../../domain/report-snapshot';
import {
  exportReportToCsv,
  exportReportToJson,
  exportReportToPdf,
  exportReportToXlsx,
} from './index';

const ORG_ID = asOrganizationId('11000000-0000-4000-8000-000000000001');
const PROJECT_ID = asProjectId('22000000-0000-4000-8000-000000000001');
const PERIOD = createDateRange(
  asIsoDateTime('2026-11-01T00:00:00.000Z'),
  asIsoDateTime('2026-11-28T23:59:59.000Z'),
);

function buildSampleSnapshot(rowCount = 3): ReportSnapshot {
  const rows = Array.from({ length: rowCount }, (_, idx) => ({
    dimension: idx === 0 ? '=HYPERLINK("http://evil.test","Pwn")' : `Dimensao ${idx + 1}`,
    metric: idx === 1 ? '  +1+1' : `Indicador (A/B) ${idx + 1}`,
    currentValue: idx * 10,
    notes: idx === 2 ? '@SUM(A1:A2); "quoted"' : 'Relatorio de entrega & fluxo',
  }));

  return {
    kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
    title: 'Entrega & Fluxo por Projeto',
    scope: REPORT_SCOPES.PROJECT,
    organizationId: ORG_ID,
    organizationName: 'Acme Corp',
    isDemoOrganization: false,
    projectId: PROJECT_ID,
    projectName: 'Projeto Alpha (Q4)',
    filters: {
      kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
      scope: REPORT_SCOPES.PROJECT,
      projectId: PROJECT_ID,
      period: PERIOD,
      compareWithPreviousPeriod: true,
    },
    snapshotGeneratedAt: asIsoDateTime('2026-11-28T18:00:00.000Z'),
    includesThirdPartyIndividualMetrics: false,
    kpis: [
      { key: 'leadTimeMs', label: 'Lead Time Medio', value: '12.5 h' },
      {
        key: 'effectiveCycleTimeMs',
        label: 'Cycle Time Efetivo',
        value: 'Indisponivel (NO_COMPLETED_CYCLES)',
        unavailableReason: 'NO_COMPLETED_CYCLES',
      },
    ],
    columns: [
      { key: 'dimension', label: 'Dimensao' },
      { key: 'metric', label: 'Indicador' },
      { key: 'currentValue', label: 'Valor' },
      { key: 'notes', label: 'Observacao' },
    ],
    rows,
  };
}

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

describe('Zero-dep Report Exporters (JSON, CSV, PDF 1.4, XLSX — ADR-0014 DN-02 & DN-08)', () => {
  it('exports JSON faithfully matching the ReportSnapshot', () => {
    const snapshot = buildSampleSnapshot();
    const bytes = exportReportToJson(snapshot);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ReportSnapshot;

    expect(parsed).toEqual(snapshot);
  });

  it('exports RFC 4180 CSV with shared Formula Injection neutralization', () => {
    const snapshot = buildSampleSnapshot();
    const text = new TextDecoder().decode(exportReportToCsv(snapshot));
    const lines = text.split('\r\n');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Dimensao,Indicador,Valor,Observacao');
    expect(lines[1]).toContain('"\'=HYPERLINK(""http://evil.test"",""Pwn"")"');
    expect(lines[2]).toContain("'  +1+1");
    expect(lines[3]).toContain('"\'@SUM(A1:A2); ""quoted"""');
  });

  it('exports valid deterministic PDF 1.4 with Helvetica, xref, %%EOF and multi-page pagination', () => {
    const snapshot = buildSampleSnapshot(60);
    const bytes = exportReportToPdf(snapshot);
    const text = new TextDecoder('latin1').decode(bytes);

    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/BaseFont /Helvetica-Bold');
    expect(text).toContain('xref\n');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // 60 rows should trigger at least 2 pages in A4 landscape
    expect(text).toContain('/Count 2');
    // Escaped parentheses in project name
    expect(text).toContain('Projeto Alpha \\(Q4\\)');
  });

  it('exports valid PKZIP Store XLSX with inlineStr, zero <f> formulas, and Formula Injection neutralization', () => {
    const snapshot = buildSampleSnapshot();
    const bytes = exportReportToXlsx(snapshot);

    // PK\x03\x04 local file header signature & PK\x05\x06 EOCD signature
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    expect(bytes[bytes.length - 22]).toBe(0x50);
    expect(bytes[bytes.length - 21]).toBe(0x4b);
    expect(bytes[bytes.length - 20]).toBe(0x05);
    expect(bytes[bytes.length - 19]).toBe(0x06);

    const entries = parseZipStoreEntries(bytes);
    expect([...entries.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]);

    const decoder = new TextDecoder();
    const sheetXml = decoder.decode(entries.get('xl/worksheets/sheet1.xml'));
    expect(sheetXml).toContain('t="inlineStr"');
    expect(sheetXml).not.toContain('<f');
    expect(sheetXml).toContain('&apos;=HYPERLINK(&quot;http://evil.test&quot;,&quot;Pwn&quot;)');
    expect(sheetXml).toContain('&apos;  +1+1');
    expect(sheetXml).toContain('&apos;@SUM(A1:A2); &quot;quoted&quot;');
  });
});
