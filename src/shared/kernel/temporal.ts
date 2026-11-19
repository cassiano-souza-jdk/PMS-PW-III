import { ValidationError } from '@/shared/errors';
import type { Brand, Uuid } from './identifiers';

export type IsoDateTime = Brand<string, 'IsoDateTime'>;
export type IsoDate = Brand<string, 'IsoDate'>;

export interface DateRange {
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
}

export interface ClockPort {
  now(): IsoDateTime;
}

export interface IdGeneratorPort {
  nextId(): Uuid;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return isValidCalendarDate(year, month, day);
}

export function asIsoDate(value: string, fieldName = 'date'): IsoDate {
  if (!isIsoDate(value)) {
    throw new ValidationError(`Invalid ISO 8601 date (YYYY-MM-DD) for "${fieldName}".`, {
      details: { field: fieldName },
    });
  }

  return value;
}

export function isIsoDateTime(value: unknown): value is IsoDateTime {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_DATETIME_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (!isValidCalendarDate(year, month, day)) {
    return false;
  }

  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

export function asIsoDateTime(value: string, fieldName = 'dateTime'): IsoDateTime {
  if (!isIsoDateTime(value)) {
    throw new ValidationError(`Invalid ISO 8601 date-time for "${fieldName}".`, {
      details: { field: fieldName },
    });
  }

  return value;
}

export function parseIsoDateTimeMs(value: IsoDateTime): number {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new ValidationError('Invalid ISO 8601 date-time value.');
  }

  return timestamp;
}

export function diffDurationMs(start: IsoDateTime, end: IsoDateTime): number {
  return parseIsoDateTimeMs(end) - parseIsoDateTimeMs(start);
}

export function assertValidDateRange(range: DateRange, fieldName = 'dateRange'): void {
  if (!isIsoDateTime(range.start)) {
    throw new ValidationError(`Invalid start date-time in "${fieldName}".`, {
      details: { field: `${fieldName}.start` },
    });
  }

  if (!isIsoDateTime(range.end)) {
    throw new ValidationError(`Invalid end date-time in "${fieldName}".`, {
      details: { field: `${fieldName}.end` },
    });
  }

  if (diffDurationMs(range.start, range.end) < 0) {
    throw new ValidationError(`Invalid date range for "${fieldName}": start must be <= end.`, {
      details: { field: fieldName },
    });
  }
}

export function createDateRange(start: IsoDateTime, end: IsoDateTime): DateRange {
  const range: DateRange = { start, end };
  assertValidDateRange(range);
  return Object.freeze(range);
}
