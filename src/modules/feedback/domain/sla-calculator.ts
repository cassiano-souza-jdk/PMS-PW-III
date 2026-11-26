import { ValidationError } from '@/shared/errors';
import { parseIsoDateTimeMs, type IsoDate, type IsoDateTime } from '@/shared/kernel';
import type { FeedbackSlaSnapshot, SlaPauseInterval } from './feedback';

export type { SlaPauseInterval } from './feedback';

export type SlaCalculationTarget = 'FIRST_RESPONSE' | 'RESOLUTION';

export type SlaEvaluationStatus = 'ON_TRACK' | 'WARNING' | 'BREACHED';

export interface SlaElapsedInput {
  readonly target: SlaCalculationTarget;
  readonly snapshot: FeedbackSlaSnapshot;
  readonly startedAt: IsoDateTime;
  readonly evaluatedAt: IsoDateTime;
  /** Pauses recorded while in WAITING_INFO (applied ONLY to RESOLUTION, never to FIRST_RESPONSE). */
  readonly waitingInfoPauses?: readonly SlaPauseInterval[];
}

interface MsInterval {
  readonly startMs: number;
  readonly endMs: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function subtractIntervals(base: MsInterval, exclusions: readonly MsInterval[]): MsInterval[] {
  let remaining: MsInterval[] = [base];

  for (const exclusion of exclusions) {
    const next: MsInterval[] = [];
    for (const seg of remaining) {
      if (exclusion.endMs <= seg.startMs || exclusion.startMs >= seg.endMs) {
        next.push(seg);
        continue;
      }

      if (exclusion.startMs > seg.startMs) {
        next.push({ startMs: seg.startMs, endMs: exclusion.startMs });
      }
      if (exclusion.endMs < seg.endMs) {
        next.push({ startMs: exclusion.endMs, endMs: seg.endMs });
      }
    }
    remaining = next;
  }

  return remaining;
}

function intersectIntervals(a: readonly MsInterval[], b: readonly MsInterval[]): number {
  let total = 0;
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.startMs, right.startMs);
      const end = Math.min(left.endMs, right.endMs);
      if (end > start) {
        total += end - start;
      }
    }
  }
  return total;
}

function formatUtcIsoDate(utcDayStartMs: number): IsoDate {
  return new Date(utcDayStartMs).toISOString().slice(0, 10) as IsoDate;
}

function buildBusinessWindowsForRange(
  startMs: number,
  endMs: number,
  snapshot: FeedbackSlaSnapshot,
): MsInterval[] {
  const workDays = new Set<number>(snapshot.workDaysOfWeekUtc);
  const holidays = new Set<string>(snapshot.holidayDates);

  const startDate = new Date(startMs);
  let cursorDayMs = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );

  const windows: MsInterval[] = [];

  while (cursorDayMs < endMs) {
    const dayOfWeek = new Date(cursorDayMs).getUTCDay();
    const isoDate = formatUtcIsoDate(cursorDayMs);

    if (workDays.has(dayOfWeek) && !holidays.has(isoDate)) {
      const workStartMs = cursorDayMs + snapshot.workStartHourUtc * MS_PER_HOUR;
      const workEndMs = cursorDayMs + snapshot.workEndHourUtc * MS_PER_HOUR;

      if (workEndMs > workStartMs) {
        const breaks: MsInterval[] = snapshot.breakIntervalsUtc
          .map((brk) => ({
            startMs: cursorDayMs + brk.startHour * MS_PER_HOUR,
            endMs: cursorDayMs + brk.endHour * MS_PER_HOUR,
          }))
          .filter((brk) => brk.endMs > brk.startMs);

        const dayWindows = subtractIntervals({ startMs: workStartMs, endMs: workEndMs }, breaks);
        for (const win of dayWindows) {
          const clampedStart = Math.max(win.startMs, startMs);
          const clampedEnd = Math.min(win.endMs, endMs);
          if (clampedEnd > clampedStart) {
            windows.push({ startMs: clampedStart, endMs: clampedEnd });
          }
        }
      }
    }

    cursorDayMs += MS_PER_DAY;
  }

  return windows;
}

/**
 * Pure deterministic SLA elapsed calculator (PRD.md §15.5):
 * - Uses the immutable cycle SLA snapshot (priority changes mid-cycle never alter running SLAs);
 * - Supports CONTINUOUS and BUSINESS_HOURS calendars (work days, breaks, holidays);
 * - FIRST_RESPONSE NEVER pauses;
 * - RESOLUTION pauses during WAITING_INFO intervals and resumes when the author replies.
 */
export function calculateSlaElapsedMs(input: SlaElapsedInput): number {
  const startMs = parseIsoDateTimeMs(input.startedAt);
  const endMs = parseIsoDateTimeMs(input.evaluatedAt);

  if (endMs < startMs) {
    throw new ValidationError('SLA evaluation time cannot precede cycle start time.');
  }

  if (endMs === startMs) {
    return 0;
  }

  const pauseIntervals: MsInterval[] = [];
  if (input.target === 'RESOLUTION' && input.waitingInfoPauses !== undefined) {
    for (const pause of input.waitingInfoPauses) {
      const pauseStartMs = parseIsoDateTimeMs(pause.startedAt);
      const pauseEndMs = pause.endedAt !== undefined ? parseIsoDateTimeMs(pause.endedAt) : endMs;

      if (pauseEndMs < pauseStartMs) {
        throw new ValidationError('SLA WAITING_INFO pause end time cannot precede its start time.');
      }

      pauseIntervals.push({ startMs: pauseStartMs, endMs: pauseEndMs });
    }
  }

  const activeSegments = subtractIntervals({ startMs, endMs }, pauseIntervals);

  if (input.snapshot.calendarMode === 'CONTINUOUS') {
    return activeSegments.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
  }

  const businessWindows = buildBusinessWindowsForRange(startMs, endMs, input.snapshot);
  return intersectIntervals(activeSegments, businessWindows);
}

export function evaluateSlaStatus(
  elapsedMs: number,
  targetMs: number,
  warningThresholdRatio = 0.8,
): SlaEvaluationStatus {
  if (targetMs <= 0) {
    throw new ValidationError('SLA "targetMs" must be > 0.', {
      details: { targetMs },
    });
  }

  if (elapsedMs > targetMs) {
    return 'BREACHED';
  }

  if (elapsedMs >= targetMs * warningThresholdRatio) {
    return 'WARNING';
  }

  return 'ON_TRACK';
}
