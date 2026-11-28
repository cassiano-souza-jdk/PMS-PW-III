import type { ReportSnapshot } from '../../domain/report-snapshot';

const textEncoder = new TextEncoder();

/**
 * Serializes `ReportSnapshot` to UTF-8 JSON bytes preserving strict parity with preview (DN-05).
 */
export function exportReportToJson(snapshot: ReportSnapshot): Uint8Array {
  return textEncoder.encode(JSON.stringify(snapshot, null, 2));
}
