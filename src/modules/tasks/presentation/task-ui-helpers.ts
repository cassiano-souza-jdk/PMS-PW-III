import type { IntlShape } from 'react-intl';
import type { MessageId } from '@/shared/i18n';
import {
  asIsoDateTime,
  isIsoDate,
  type IsoDateTime,
  type Priority,
  type TaskStatus,
  type UserId,
} from '@/shared/kernel';
import type { SubtaskStatus } from '../application/contracts';

export interface TaskPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface TaskUserOption {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email?: string;
}

export const TASK_STATUS_LABEL_IDS: Readonly<Record<TaskStatus, MessageId>> = {
  TODO: 'tasks.status.TODO',
  IN_PROGRESS: 'tasks.status.IN_PROGRESS',
  PAUSED: 'tasks.status.PAUSED',
  BLOCKED: 'tasks.status.BLOCKED',
  DONE: 'tasks.status.DONE',
  CANCELLED: 'tasks.status.CANCELLED',
};

export const TASK_STATUS_BADGE_VARIANTS: Readonly<
  Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  TODO: 'outline',
  IN_PROGRESS: 'default',
  PAUSED: 'secondary',
  BLOCKED: 'destructive',
  DONE: 'secondary',
  CANCELLED: 'outline',
};

export const TASK_PRIORITY_LABEL_IDS: Readonly<Record<Priority, MessageId>> = {
  LOW: 'tasks.priority.LOW',
  MEDIUM: 'tasks.priority.MEDIUM',
  HIGH: 'tasks.priority.HIGH',
  CRITICAL: 'tasks.priority.CRITICAL',
};

export const TASK_PRIORITY_BADGE_VARIANTS: Readonly<
  Record<Priority, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'default',
  CRITICAL: 'destructive',
};

export const TASK_PRIORITY_RANK: Readonly<Record<Priority, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const SUBTASK_STATUS_LABEL_IDS: Readonly<Record<SubtaskStatus, MessageId>> = {
  OPEN: 'subtasks.status.OPEN',
  DONE: 'subtasks.status.DONE',
  CANCELLED: 'subtasks.status.CANCELLED',
};

export const SUBTASK_STATUS_BADGE_VARIANTS: Readonly<
  Record<SubtaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  OPEN: 'outline',
  DONE: 'default',
  CANCELLED: 'secondary',
};

const TAG_COLOR_CLASS_MAP: Readonly<Record<string, string>> = {
  sky: 'border-sky-700/40 bg-sky-100 text-sky-950 dark:border-sky-400/50 dark:bg-sky-950 dark:text-sky-50',
  amber:
    'border-amber-800/40 bg-amber-100 text-amber-950 dark:border-amber-400/50 dark:bg-amber-950 dark:text-amber-50',
  emerald:
    'border-emerald-700/40 bg-emerald-100 text-emerald-950 dark:border-emerald-400/50 dark:bg-emerald-950 dark:text-emerald-50',
  rose: 'border-rose-700/40 bg-rose-100 text-rose-950 dark:border-rose-400/50 dark:bg-rose-950 dark:text-rose-50',
  violet:
    'border-violet-700/40 bg-violet-100 text-violet-950 dark:border-violet-400/50 dark:bg-violet-950 dark:text-violet-50',
  slate:
    'border-slate-700/40 bg-slate-100 text-slate-950 dark:border-slate-400/50 dark:bg-slate-900 dark:text-slate-50',
};

export function resolveTagBadgeClassName(colorToken?: string): string {
  if (colorToken === undefined) {
    return '';
  }
  const normalized = colorToken.trim().toLowerCase();
  return TAG_COLOR_CLASS_MAP[normalized] ?? '';
}

export function resolveUserDisplayName(
  userId: UserId | undefined,
  usersById: ReadonlyMap<UserId, TaskUserOption>,
  fallbackUnknownLabel: string,
): string {
  if (userId === undefined) {
    return fallbackUnknownLabel;
  }
  return usersById.get(userId)?.displayName ?? fallbackUnknownLabel;
}

export function formatIsoDateTimeShort(iso: IsoDateTime, intl: IntlShape): string {
  return intl.formatDate(iso, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function formatByteSize(bytes: number, intl: IntlShape): string {
  if (bytes >= 1024 * 1024) {
    return `${intl.formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 2 })} MB`;
  }
  if (bytes >= 1024) {
    return `${intl.formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  }
  return `${intl.formatNumber(bytes)} B`;
}

export function formatDurationMs(durationMs: number, intl: IntlShape): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${intl.formatNumber(hours)}h ${intl.formatNumber(minutes)}min`;
  }
  if (minutes > 0) {
    return `${intl.formatNumber(minutes)}min ${intl.formatNumber(seconds)}s`;
  }
  return `${intl.formatNumber(seconds)}s`;
}

export function toIsoDateInputValue(iso?: IsoDateTime): string {
  if (iso === undefined) {
    return '';
  }
  return iso.slice(0, 10);
}

export function dateInputToEndOfDayIso(dateValue: string): IsoDateTime | null {
  const trimmed = dateValue.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!isIsoDate(trimmed)) {
    return null;
  }
  return asIsoDateTime(`${trimmed}T23:59:59.000Z`, 'dueDate');
}
