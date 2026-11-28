/**
 * Shared, pure tabular sanitization against CSV/XLSX Formula Injection (ADR-0014 §8, DN-08).
 *
 * Spreadsheet applications interpret cells whose first meaningful character is `=`, `+`, `-`, `@`,
 * TAB or CR as formulas. Every tabular exporter (`reports` CSV/XLSX and `feedback` CSV) must route
 * user-controlled values through these helpers before serialization.
 */
export const SPREADSHEET_FORMULA_TRIGGER_CHARACTERS = ['=', '+', '-', '@', '\t', '\r'] as const;

export type SpreadsheetCellValue = string | number | boolean | null | undefined;

const FORMULA_TRIGGER_SET: ReadonlySet<string> = new Set(SPREADSHEET_FORMULA_TRIGGER_CHARACTERS);
const NEUTRALIZING_PREFIX = "'";
const LEADING_SPACES_PATTERN = /^[ \u00A0]*/u;
const CSV_QUOTING_REQUIRED_PATTERN = /[",\r\n;]/u;

function toCellText(value: SpreadsheetCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

/**
 * Returns `true` when the first non-space character of `text` is a formula trigger.
 * TAB and CR are triggers themselves, so only regular/non-breaking spaces are skipped.
 */
export function isSpreadsheetFormulaLike(text: string): boolean {
  const leadingSpaces = LEADING_SPACES_PATTERN.exec(text)?.[0].length ?? 0;
  const firstMeaningful = text.charAt(leadingSpaces);
  return firstMeaningful !== '' && FORMULA_TRIGGER_SET.has(firstMeaningful);
}

/**
 * Neutralizes a spreadsheet cell value by prefixing a single quote (`'`) when it could be
 * interpreted as a formula. Finite numbers and booleans are emitted verbatim (they are data, not
 * user-controlled text); every other value is converted to text and checked.
 */
export function sanitizeSpreadsheetCell(value: SpreadsheetCellValue): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  const text = toCellText(value);
  return isSpreadsheetFormulaLike(text) ? `${NEUTRALIZING_PREFIX}${text}` : text;
}

/**
 * Escapes an already-sanitized text for RFC 4180 CSV: wraps in double quotes when it contains
 * quotes, delimiters (`,`/`;`) or line breaks, doubling inner double quotes.
 */
export function escapeCsvCell(text: string): string {
  if (!CSV_QUOTING_REQUIRED_PATTERN.test(text)) {
    return text;
  }

  return `"${text.replace(/"/gu, '""')}"`;
}

/** Safe CSV cell: Formula Injection neutralization followed by RFC 4180 escaping. */
export function toCsvCell(value: SpreadsheetCellValue): string {
  return escapeCsvCell(sanitizeSpreadsheetCell(value));
}

/** Safe CSV row joined by `delimiter` (default `,`). */
export function toCsvRow(values: readonly SpreadsheetCellValue[], delimiter = ','): string {
  return values.map((value) => toCsvCell(value)).join(delimiter);
}
