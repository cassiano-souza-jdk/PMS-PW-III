import { sanitizeSpreadsheetCell, type SpreadsheetCellValue } from '@/shared/kernel';
import type { ReportSnapshot } from '../../domain/report-snapshot';

const textEncoder = new TextEncoder();

// IEEE 802.3 CRC-32 lookup table
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput {
  readonly name: string;
  readonly data: Uint8Array;
}

function writeUint16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function buildZipStoreArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const crc = computeCrc32(entry.data);
    const size = entry.data.byteLength;

    // Local File Header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const lv = new DataView(localHeader.buffer);
    writeUint32LE(lv, 0, 0x04034b50); // Signature
    writeUint16LE(lv, 4, 20); // Version needed
    writeUint16LE(lv, 6, 0x0800); // UTF-8 filename flag
    writeUint16LE(lv, 8, 0); // Store (no compression)
    writeUint16LE(lv, 10, 0); // Mod time
    writeUint16LE(lv, 12, 0x5421); // Mod date
    writeUint32LE(lv, 14, crc);
    writeUint32LE(lv, 18, size);
    writeUint32LE(lv, 22, size);
    writeUint16LE(lv, 26, nameBytes.byteLength);
    writeUint16LE(lv, 28, 0);
    localHeader.set(nameBytes, 30);

    // Central Directory Header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(centralHeader.buffer);
    writeUint32LE(cv, 0, 0x02014b50); // Signature
    writeUint16LE(cv, 4, 20); // Version made by
    writeUint16LE(cv, 6, 20); // Version needed
    writeUint16LE(cv, 8, 0x0800); // UTF-8 filename flag
    writeUint16LE(cv, 10, 0); // Store
    writeUint16LE(cv, 12, 0); // Mod time
    writeUint16LE(cv, 14, 0x5421); // Mod date
    writeUint32LE(cv, 16, crc);
    writeUint32LE(cv, 20, size);
    writeUint32LE(cv, 24, size);
    writeUint16LE(cv, 28, nameBytes.byteLength);
    writeUint16LE(cv, 30, 0);
    writeUint16LE(cv, 32, 0);
    writeUint16LE(cv, 34, 0);
    writeUint16LE(cv, 36, 0);
    writeUint32LE(cv, 38, 0);
    writeUint32LE(cv, 42, localOffset);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, entry.data);
    centralChunks.push(centralHeader);
    localOffset += localHeader.byteLength + size;
  }

  const centralDirSize = centralChunks.reduce((sum, c) => sum + c.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  writeUint32LE(ev, 0, 0x06054b50); // EOCD signature
  writeUint16LE(ev, 4, 0);
  writeUint16LE(ev, 6, 0);
  writeUint16LE(ev, 8, entries.length);
  writeUint16LE(ev, 10, entries.length);
  writeUint32LE(ev, 12, centralDirSize);
  writeUint32LE(ev, 16, localOffset);
  writeUint16LE(ev, 20, 0);

  const totalSize = localOffset + centralDirSize + eocd.byteLength;
  const archive = new Uint8Array(totalSize);
  let cursor = 0;
  for (const chunk of localChunks) {
    archive.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  for (const chunk of centralChunks) {
    archive.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  archive.set(eocd, cursor);

  return archive;
}

function escapeXmlText(text: string): string {
  let cleaned = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    // Strip invalid XML 1.0 control characters (keep \t, \n, \r)
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd)
    ) {
      cleaned += text[i]!;
    }
  }
  return cleaned
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnIndexToLetters(indexZeroBased: number): string {
  let n = indexZeroBased + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function buildCellXml(rowIndexOneBased: number, colIndexZeroBased: number, value: SpreadsheetCellValue): string {
  const ref = `${columnIndexToLetters(colIndexZeroBased)}${rowIndexOneBased}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" t="n"><v>${value}</v></c>`;
  }

  // Strictly inlineStr (`t="inlineStr"`), zero `<f>` elements, and Formula Injection sanitized (DN-02, DN-08)
  const sanitized = sanitizeSpreadsheetCell(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(sanitized)}</t></is></c>`;
}

function buildRowXml(rowIndexOneBased: number, values: readonly SpreadsheetCellValue[]): string {
  const cells = values.map((val, colIdx) => buildCellXml(rowIndexOneBased, colIdx, val)).join('');
  return `<row r="${rowIndexOneBased}">${cells}</row>`;
}

function buildWorksheetXml(snapshot: ReportSnapshot): string {
  const rowsXml: string[] = [];
  let rowNum = 1;

  // Metadata header rows
  rowsXml.push(buildRowXml(rowNum++, [snapshot.title]));
  rowsXml.push(
    buildRowXml(rowNum++, [
      'Organizacao',
      snapshot.organizationName,
      ...(snapshot.projectName !== undefined ? ['Projeto', snapshot.projectName] : []),
      'Escopo',
      snapshot.scope,
    ]),
  );
  rowsXml.push(
    buildRowXml(rowNum++, [
      'Periodo Inicio',
      snapshot.filters.period.start,
      'Periodo Fim',
      snapshot.filters.period.end,
      'Gerado em',
      snapshot.snapshotGeneratedAt,
    ]),
  );

  // KPI rows
  if (snapshot.kpis.length > 0) {
    rowNum += 1; // blank separator row
    rowsXml.push(buildRowXml(rowNum++, ['Indicador', 'Valor', 'Disponibilidade']));
    for (const kpi of snapshot.kpis) {
      rowsXml.push(
        buildRowXml(rowNum++, [kpi.label, kpi.value, kpi.unavailableReason ?? 'AVAILABLE']),
      );
    }
  }

  // Data table
  rowNum += 1; // blank separator row
  rowsXml.push(buildRowXml(rowNum++, snapshot.columns.map((column) => column.label)));

  for (const row of snapshot.rows) {
    rowsXml.push(
      buildRowXml(
        rowNum++,
        snapshot.columns.map((column) => row[column.key] ?? ''),
      ),
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetData>${rowsXml.join('')}</sheetData>`,
    '</worksheet>',
  ].join('');
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="Relatorio" sheetId="1" r:id="rId1"/></sheets>' +
  '</workbook>';

const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>';

/**
 * Zero-dependency deterministic XLSX (PKZIP Store + OOXML `inlineStr` without `<f>` formulas)
 * generator with Formula Injection sanitization (ADR-0014 DN-02 & DN-08).
 */
export function exportReportToXlsx(snapshot: ReportSnapshot): Uint8Array {
  const sheetXml = buildWorksheetXml(snapshot);

  return buildZipStoreArchive([
    { name: '[Content_Types].xml', data: textEncoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: textEncoder.encode(ROOT_RELS_XML) },
    { name: 'xl/workbook.xml', data: textEncoder.encode(WORKBOOK_XML) },
    { name: 'xl/_rels/workbook.xml.rels', data: textEncoder.encode(WORKBOOK_RELS_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: textEncoder.encode(sheetXml) },
  ]);
}
