import type { ReportSnapshot } from '../../domain/report-snapshot';

const asciiEncoder = new TextEncoder();

const WINANSI_SPECIAL_MAP: ReadonlyMap<number, number> = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

function encodePdfWinAnsiLiteral(text: string): Uint8Array {
  const bytes: number[] = [0x28]; // '('
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      bytes.push(0x20);
      continue;
    }

    let byteVal: number;
    if (code >= 0x20 && code <= 0x7e) {
      byteVal = code;
    } else if (code >= 0xa0 && code <= 0xff) {
      byteVal = code;
    } else {
      byteVal = WINANSI_SPECIAL_MAP.get(code) ?? 0x3f; // '?'
    }

    if (byteVal === 0x28 || byteVal === 0x29 || byteVal === 0x5c) {
      bytes.push(0x5c); // '\'
    }
    bytes.push(byteVal);
  }
  bytes.push(0x29); // ')'
  return new Uint8Array(bytes);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

function formatCellValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

interface PdfPageBuilder {
  readonly commands: Uint8Array[];
}

function appendTextCommand(
  page: PdfPageBuilder,
  font: '/F1' | '/F2',
  fontSize: number,
  x: number,
  y: number,
  text: string,
): void {
  page.commands.push(asciiEncoder.encode(`BT ${font} ${fontSize} Tf 1 0 0 1 ${x} ${y} Tm `));
  page.commands.push(encodePdfWinAnsiLiteral(text));
  page.commands.push(asciiEncoder.encode(' Tj ET\n'));
}

function appendRuleCommand(
  page: PdfPageBuilder,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  page.commands.push(asciiEncoder.encode(`0.5 w ${x1} ${y1} m ${x2} ${y2} l S\n`));
}

/**
 * Zero-dependency deterministic PDF 1.4 tabular report generator (ADR-0014 DN-02).
 * Produces valid `%PDF-1.4\n ... xref ... %%EOF` bytes using standard Type1 Helvetica fonts.
 */
export function exportReportToPdf(snapshot: ReportSnapshot): Uint8Array {
  // A4 Landscape (842 x 595 pt)
  const pageWidth = 842;
  const pageHeight = 595;
  const marginX = 36;
  const usableWidth = pageWidth - marginX * 2;
  const bottomMargin = 42;

  const pages: PdfPageBuilder[] = [];
  const createPage = (): PdfPageBuilder => {
    const p: PdfPageBuilder = { commands: [] };
    pages.push(p);
    return p;
  };

  let currentPage = createPage();
  let y = pageHeight - 40;

  // Header
  appendTextCommand(currentPage, '/F2', 14, marginX, y, snapshot.title);
  y -= 18;
  appendTextCommand(
    currentPage,
    '/F1',
    9,
    marginX,
    y,
    `Organizacao: ${snapshot.organizationName}${snapshot.projectName ? ` | Projeto: ${snapshot.projectName}` : ''} | Escopo: ${snapshot.scope}`,
  );
  y -= 13;
  appendTextCommand(
    currentPage,
    '/F1',
    9,
    marginX,
    y,
    `Periodo: ${snapshot.filters.period.start} ate ${snapshot.filters.period.end} | Gerado em: ${snapshot.snapshotGeneratedAt}`,
  );
  y -= 13;
  appendTextCommand(
    currentPage,
    '/F1',
    8,
    marginX,
    y,
    `Metricas nominais de terceiros: ${snapshot.includesThirdPartyIndividualMetrics ? 'Sim' : 'Nao (oculto por politica)'}`,
  );
  y -= 10;
  appendRuleCommand(currentPage, marginX, y, pageWidth - marginX, y);
  y -= 16;

  // KPIs
  if (snapshot.kpis.length > 0) {
    appendTextCommand(currentPage, '/F2', 10, marginX, y, 'Indicadores (KPIs)');
    y -= 14;
    for (const kpi of snapshot.kpis) {
      if (y < bottomMargin + 30) {
        currentPage = createPage();
        y = pageHeight - 40;
      }
      const line = `${kpi.label}: ${kpi.value}${kpi.unavailableReason ? ` (${kpi.unavailableReason})` : ''}`;
      appendTextCommand(currentPage, '/F1', 9, marginX + 6, y, truncateText(line, 130));
      y -= 12;
    }
    y -= 6;
    appendRuleCommand(currentPage, marginX, y, pageWidth - marginX, y);
    y -= 16;
  }

  // Table
  const columns = snapshot.columns;
  if (columns.length > 0) {
    const colWidth = Math.floor(usableWidth / columns.length);
    const maxCharsPerCell = Math.max(8, Math.floor(colWidth / 5.2));

    const drawTableHeader = (): void => {
      if (y < bottomMargin + 24) {
        currentPage = createPage();
        y = pageHeight - 40;
      }
      columns.forEach((col, idx) => {
        const cellX = marginX + idx * colWidth;
        appendTextCommand(
          currentPage,
          '/F2',
          8,
          cellX,
          y,
          truncateText(col.label, maxCharsPerCell),
        );
      });
      y -= 6;
      appendRuleCommand(currentPage, marginX, y, pageWidth - marginX, y);
      y -= 12;
    };

    drawTableHeader();

    if (snapshot.rows.length === 0) {
      appendTextCommand(currentPage, '/F1', 9, marginX, y, 'Sem registros para os filtros selecionados.');
    } else {
      for (const row of snapshot.rows) {
        if (y < bottomMargin) {
          currentPage = createPage();
          y = pageHeight - 40;
          drawTableHeader();
        }
        columns.forEach((col, idx) => {
          const cellX = marginX + idx * colWidth;
          const text = truncateText(formatCellValue(row[col.key]), maxCharsPerCell);
          appendTextCommand(currentPage, '/F1', 8, cellX, y, text);
        });
        y -= 13;
      }
    }
  }

  // Build PDF 1.4 objects
  // 1: Catalog, 2: Pages, 3: F1 Helvetica, 4: F2 Helvetica-Bold, then pairs (Page, Contents)
  const objects: Uint8Array[] = [];
  const pageObjectIds: number[] = [];

  for (let i = 0; i < pages.length; i += 1) {
    pageObjectIds.push(5 + i * 2);
  }

  objects.push(asciiEncoder.encode('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(
    asciiEncoder.encode(
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`,
    ),
  );
  objects.push(
    asciiEncoder.encode(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ),
  );
  objects.push(
    asciiEncoder.encode(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ),
  );

  for (let i = 0; i < pages.length; i += 1) {
    const pageObjId = 5 + i * 2;
    const contentObjId = pageObjId + 1;
    const pageData = pages[i];
    const streamBytes = concatBytes(pageData ? pageData.commands : []);

    objects.push(
      asciiEncoder.encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
      ),
    );
    objects.push(
      concatBytes([
        asciiEncoder.encode(`<< /Length ${streamBytes.byteLength} >>\nstream\n`),
        streamBytes,
        asciiEncoder.encode('endstream'),
      ]),
    );
  }

  const outputChunks: Uint8Array[] = [asciiEncoder.encode('%PDF-1.4\n')];
  let byteOffset = outputChunks[0]!.byteLength;
  const offsets: number[] = [0]; // object 0

  for (let i = 0; i < objects.length; i += 1) {
    const objId = i + 1;
    offsets.push(byteOffset);
    const header = asciiEncoder.encode(`${objId} 0 obj\n`);
    const body = objects[i]!;
    const footer = asciiEncoder.encode('\nendobj\n');
    outputChunks.push(header, body, footer);
    byteOffset += header.byteLength + body.byteLength + footer.byteLength;
  }

  const xrefOffset = byteOffset;
  const xrefLines: string[] = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i <= objects.length; i += 1) {
    const off = String(offsets[i]!).padStart(10, '0');
    xrefLines.push(`${off} 00000 n \n`);
  }
  xrefLines.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  outputChunks.push(asciiEncoder.encode(xrefLines.join('')));

  return concatBytes(outputChunks);
}
