import { describe, expect, it } from 'vitest';
import {
  SPREADSHEET_FORMULA_TRIGGER_CHARACTERS,
  escapeCsvCell,
  isSpreadsheetFormulaLike,
  sanitizeSpreadsheetCell,
  toCsvCell,
  toCsvRow,
} from './index';

describe('spreadsheet sanitization against Formula Injection (ADR-0014 §8, DN-08)', () => {
  it.each(SPREADSHEET_FORMULA_TRIGGER_CHARACTERS.map((trigger) => [trigger]))(
    'neutralizes values starting with trigger %j',
    (trigger) => {
      const payload = `${trigger}HYPERLINK("http://evil.example","x")`;
      expect(isSpreadsheetFormulaLike(payload)).toBe(true);
      expect(sanitizeSpreadsheetCell(payload)).toBe(`'${payload}`);
    },
  );

  it('neutralizes triggers preceded by leading spaces (regular and non-breaking)', () => {
    expect(sanitizeSpreadsheetCell('   =1+1')).toBe("'   =1+1");
    expect(sanitizeSpreadsheetCell('\u00A0@SUM(A1:A2)')).toBe("'\u00A0@SUM(A1:A2)");
    expect(sanitizeSpreadsheetCell('  \t=cmd')).toBe("'  \t=cmd");
    expect(sanitizeSpreadsheetCell(' -2+3')).toBe("' -2+3");
  });

  it('keeps benign values untouched', () => {
    expect(sanitizeSpreadsheetCell('Relatório mensal')).toBe('Relatório mensal');
    expect(sanitizeSpreadsheetCell('a=b')).toBe('a=b');
    expect(sanitizeSpreadsheetCell('email@example.com')).toBe('email@example.com');
    expect(sanitizeSpreadsheetCell('')).toBe('');
    expect(sanitizeSpreadsheetCell('   ')).toBe('   ');
    expect(sanitizeSpreadsheetCell(null)).toBe('');
    expect(sanitizeSpreadsheetCell(undefined)).toBe('');
  });

  it('emits finite numbers and booleans verbatim while sanitizing numeric-looking strings', () => {
    expect(sanitizeSpreadsheetCell(42)).toBe('42');
    expect(sanitizeSpreadsheetCell(-3.5)).toBe('-3.5');
    expect(sanitizeSpreadsheetCell(true)).toBe('true');
    expect(sanitizeSpreadsheetCell(false)).toBe('false');
    expect(sanitizeSpreadsheetCell(Number.NaN)).toBe('NaN');
    expect(sanitizeSpreadsheetCell('-3.5')).toBe("'-3.5");
  });

  it('escapes CSV cells with quotes, delimiters and line breaks (RFC 4180)', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a;b')).toBe('"a;b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('combines sanitization and escaping in toCsvCell/toCsvRow', () => {
    expect(toCsvCell('=1+1,2')).toBe('"\'=1+1,2"');
    expect(toCsvCell('\rfoo')).toBe('"\'\rfoo"');
    expect(toCsvRow(['Nome', '@cmd', 7, null, 'x"y'])).toBe('Nome,\'@cmd,7,,"x""y"');
    expect(toCsvRow(['a', '+b'], ';')).toBe("a;'+b");
  });
});
