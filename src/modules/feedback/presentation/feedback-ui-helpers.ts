import type { IntlShape } from 'react-intl';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import type { MessageId } from '@/shared/i18n';
import type { IsoDateTime, Priority, UserId } from '@/shared/kernel';
import type {
  ContestRecommendation,
  ContestStatus,
  CycleOrigin,
  FeedbackActorProfile,
  FeedbackClosureReason,
  FeedbackModuleKey,
  FeedbackStatus,
  ReopenRequestStatus,
  SlaCalendarMode,
  SlaEvaluationStatus,
} from '../application/contracts';

export interface FeedbackPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export const FEEDBACK_STATUS_LABEL_IDS: Readonly<Record<FeedbackStatus, MessageId>> = {
  RECEIVED: 'feedbacks.status.RECEIVED',
  IN_ANALYSIS: 'feedbacks.status.IN_ANALYSIS',
  ASSIGNED: 'feedbacks.status.ASSIGNED',
  IN_PROGRESS: 'feedbacks.status.IN_PROGRESS',
  WAITING_INFO: 'feedbacks.status.WAITING_INFO',
  RESOLVED: 'feedbacks.status.RESOLVED',
  CLOSED: 'feedbacks.status.CLOSED',
};

export const FEEDBACK_STATUS_BADGE_VARIANTS: Readonly<
  Record<FeedbackStatus, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  RECEIVED: 'outline',
  IN_ANALYSIS: 'secondary',
  ASSIGNED: 'secondary',
  IN_PROGRESS: 'default',
  WAITING_INFO: 'outline',
  RESOLVED: 'secondary',
  CLOSED: 'outline',
};

export const FEEDBACK_PRIORITY_LABEL_IDS: Readonly<Record<Priority, MessageId>> = {
  CRITICAL: 'feedbacks.priority.CRITICAL',
  HIGH: 'feedbacks.priority.HIGH',
  MEDIUM: 'feedbacks.priority.MEDIUM',
  LOW: 'feedbacks.priority.LOW',
};

export const FEEDBACK_PRIORITY_BADGE_VARIANTS: Readonly<
  Record<Priority, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  CRITICAL: 'destructive',
  HIGH: 'default',
  MEDIUM: 'outline',
  LOW: 'secondary',
};

export const FEEDBACK_MODULE_LABEL_IDS: Readonly<Record<FeedbackModuleKey, MessageId>> = {
  general: 'feedbacks.module.general',
  authentication: 'feedbacks.module.authentication',
  users: 'feedbacks.module.users',
  organizations: 'feedbacks.module.organizations',
  invitations: 'feedbacks.module.invitations',
  teams: 'feedbacks.module.teams',
  projects: 'feedbacks.module.projects',
  kanban: 'feedbacks.module.kanban',
  tasks: 'feedbacks.module.tasks',
  dependencies: 'feedbacks.module.dependencies',
  impediments: 'feedbacks.module.impediments',
  focus: 'feedbacks.module.focus',
  analytics: 'feedbacks.module.analytics',
  bottlenecks: 'feedbacks.module.bottlenecks',
  feedback: 'feedbacks.module.feedback',
  notifications: 'feedbacks.module.notifications',
  audit: 'feedbacks.module.audit',
  reports: 'feedbacks.module.reports',
  search: 'feedbacks.module.search',
  trash: 'feedbacks.module.trash',
  backups: 'feedbacks.module.backups',
  settings: 'feedbacks.module.settings',
  onboarding: 'feedbacks.module.onboarding',
  help: 'feedbacks.module.help',
  monitoring: 'feedbacks.module.monitoring',
  demo: 'feedbacks.module.demo',
};

export const FEEDBACK_CLOSURE_REASON_LABEL_IDS: Readonly<Record<FeedbackClosureReason, MessageId>> =
  {
    CONFIRMED_BY_AUTHOR: 'feedbacks.closureReason.CONFIRMED_BY_AUTHOR',
    EXPIRED_WITHOUT_CONTEST: 'feedbacks.closureReason.EXPIRED_WITHOUT_CONTEST',
    CONTEST_REJECTED_EXPIRED: 'feedbacks.closureReason.CONTEST_REJECTED_EXPIRED',
    ADMIN_CLOSED: 'feedbacks.closureReason.ADMIN_CLOSED',
  };

export const SLA_EVALUATION_LABEL_IDS: Readonly<Record<SlaEvaluationStatus, MessageId>> = {
  ON_TRACK: 'feedbacks.sla.status.ON_TRACK',
  WARNING: 'feedbacks.sla.status.WARNING',
  BREACHED: 'feedbacks.sla.status.BREACHED',
};

export const SLA_CALENDAR_MODE_LABEL_IDS: Readonly<Record<SlaCalendarMode, MessageId>> = {
  CONTINUOUS: 'feedbacks.sla.calendarMode.CONTINUOUS',
  BUSINESS_HOURS: 'feedbacks.sla.calendarMode.BUSINESS_HOURS',
};

export const CYCLE_ORIGIN_LABEL_IDS: Readonly<Record<CycleOrigin, MessageId>> = {
  INITIAL: 'feedbacks.cycles.origin.INITIAL',
  CONTESTATION_REOPEN: 'feedbacks.cycles.origin.CONTESTATION_REOPEN',
  EXCEPTIONAL_REOPEN: 'feedbacks.cycles.origin.EXCEPTIONAL_REOPEN',
};

export const CONTEST_STATUS_LABEL_IDS: Readonly<Record<ContestStatus, MessageId>> = {
  OPEN: 'feedbacks.contests.status.OPEN',
  IN_ANALYSIS: 'feedbacks.contests.status.IN_ANALYSIS',
  DECIDED: 'feedbacks.contests.status.DECIDED',
  CLOSED: 'feedbacks.contests.status.CLOSED',
};

export const CONTEST_RECOMMENDATION_LABEL_IDS: Readonly<Record<ContestRecommendation, MessageId>> =
  {
    KEEP_RESOLUTION: 'feedbacks.contests.recommendation.KEEP_RESOLUTION',
    RESUME_SERVICE: 'feedbacks.contests.recommendation.RESUME_SERVICE',
  };

export const REOPEN_STATUS_LABEL_IDS: Readonly<Record<ReopenRequestStatus, MessageId>> = {
  PENDING: 'feedbacks.reopen.status.PENDING',
  APPROVED: 'feedbacks.reopen.status.APPROVED',
  REJECTED: 'feedbacks.reopen.status.REJECTED',
};

export const ALLOWED_FEEDBACK_STATUS_TRANSITIONS: Readonly<
  Record<FeedbackStatus, readonly FeedbackStatus[]>
> = {
  RECEIVED: ['IN_ANALYSIS', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_INFO', 'RESOLVED'],
  IN_ANALYSIS: ['ASSIGNED', 'IN_PROGRESS', 'WAITING_INFO', 'RESOLVED'],
  ASSIGNED: ['IN_ANALYSIS', 'IN_PROGRESS', 'WAITING_INFO', 'RESOLVED'],
  IN_PROGRESS: ['IN_ANALYSIS', 'WAITING_INFO', 'RESOLVED'],
  WAITING_INFO: ['IN_PROGRESS', 'IN_ANALYSIS', 'RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export const CONTROL_SELECT_CLASS_NAME =
  'flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const CONTROL_TEXTAREA_CLASS_NAME =
  'flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function resolveFeedbackModuleLabelId(moduleKey: string): MessageId {
  if (Object.prototype.hasOwnProperty.call(FEEDBACK_MODULE_LABEL_IDS, moduleKey)) {
    return FEEDBACK_MODULE_LABEL_IDS[moduleKey as FeedbackModuleKey];
  }
  return 'feedbacks.module.general';
}

export function resolveFeedbackActorDisplayName(
  userId: UserId | undefined,
  actorProfiles: Readonly<Record<string, FeedbackActorProfile>>,
  fallbackLabel: string,
): string {
  if (userId === undefined) {
    return fallbackLabel;
  }
  return actorProfiles[userId]?.displayName ?? fallbackLabel;
}

export function formatFeedbackDateTime(iso: IsoDateTime, intl: IntlShape): string {
  return intl.formatDate(iso, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function formatFeedbackByteSize(bytes: number, intl: IntlShape): string {
  if (bytes >= 1024 * 1024) {
    return `${intl.formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 2 })} MB`;
  }
  if (bytes >= 1024) {
    return `${intl.formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  }
  return `${intl.formatNumber(bytes)} B`;
}

export function formatFeedbackDurationMs(durationMs: number, intl: IntlShape): string {
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

export function isFeedbackStorageQuotaError(error: unknown): boolean {
  if (
    isAppError(error) &&
    error.code === APP_ERROR_CODES.INFRASTRUCTURE_ERROR &&
    error.details?.reason === 'STORAGE_QUOTA_EXCEEDED'
  ) {
    return true;
  }
  if (error instanceof Error) {
    const lowerName = error.name.toLowerCase();
    const lowerMessage = error.message.toLowerCase();
    return (
      lowerName.includes('quotaexceeded') ||
      lowerMessage.includes('quotaexceeded') ||
      lowerMessage.includes('storage_quota_exceeded')
    );
  }
  return false;
}

export function triggerFeedbackBlobDownload(
  payload: string | Uint8Array,
  mimeType: string,
  fileName: string,
): void {
  const blobPart: BlobPart = typeof payload === 'string' ? payload : new Uint8Array(payload).buffer;
  const blob = new Blob([blobPart], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
