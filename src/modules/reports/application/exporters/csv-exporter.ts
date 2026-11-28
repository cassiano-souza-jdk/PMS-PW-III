import { toCsvRow, type SpreadsheetCellValue } from '@/shared/kernel';
import type { ReportSnapshot } from '../../domain/report-snapshot';

const textEncoder = new TextEncoder();

/**
 * Serializes `ReportSnapshot` to RFC 4180 UTF-8 CSV bytes using `@/shared/kernel` Formula Injection
 * sanitization (`toCsvRow` -> `sanitizeSpreadsheetCell` + `escapeCsvCell`, DN-08).
 */
export function exportReportToCsv(snapshot: ReportSnapshot): Uint8Array {
  const lines: string[] = [];

  lines.push(toCsvRow(snapshot.columns.map((column) => column.label)));

  for (const row of snapshot.rows) {
    const cells: SpreadsheetCellValue[] = snapshot.columns.map((column) => row[column.key] ?? '');
    lines.push(toCsvRow(cells));
  }

  return textEncoder.encode(lines.join('\r\n'));
}
