import {
  parseBrandedUuid,
  type Brand,
  type EventId,
  type IsoDateTime,
  type NotificationId,
  type OrganizationScoped,
  type Priority,
  type UserId,
} from '@/shared/kernel';

export type NotificationPreferenceId = Brand<string, 'NotificationPreferenceId'>;

export function asNotificationPreferenceId(
  value: string,
  fieldName = 'notificationPreferenceId',
): NotificationPreferenceId {
  return parseBrandedUuid<'NotificationPreferenceId'>(value, fieldName);
}

export const NOTIFICATION_CATEGORIES = {
  TASK: 'TASK',
  KANBAN: 'KANBAN',
  IMPEDIMENT: 'IMPEDIMENT',
  BOTTLENECK: 'BOTTLENECK',
  FEEDBACK: 'FEEDBACK',
  ORGANIZATION: 'ORGANIZATION',
  SYSTEM: 'SYSTEM',
} as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[keyof typeof NOTIFICATION_CATEGORIES];

/**
 * Internal notification entity (PRD.md §16):
 * deduplicated per (eventId, recipientUserId); must not reveal unauthorized resource content.
 */
export interface Notification extends OrganizationScoped {
  readonly id: NotificationId;
  readonly recipientUserId: UserId;
  readonly eventId: EventId;
  readonly deduplicationKey: string;
  readonly category: NotificationCategory;
  readonly priority: Priority;
  readonly titleKey: string;
  readonly summaryMetadata: Readonly<Record<string, string | number | boolean>>;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly readAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

export interface NotificationPreference extends OrganizationScoped {
  readonly id: NotificationPreferenceId;
  readonly userId: UserId;
  readonly enabledCategories: readonly NotificationCategory[];
  readonly inAppEnabled: boolean;
  readonly simulatedEmailEnabled: boolean;
  readonly updatedAt: IsoDateTime;
}

/** Deterministic deduplication key per event and recipient (PRD.md §16). */
export function buildNotificationDeduplicationKey(
  eventId: EventId,
  recipientUserId: UserId,
): string {
  return `${eventId}:${recipientUserId}`;
}
