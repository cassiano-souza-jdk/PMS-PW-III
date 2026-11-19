export {
  NOTIFICATION_CATEGORIES,
  asNotificationPreferenceId,
  buildNotificationDeduplicationKey,
  type Notification,
  type NotificationCategory,
  type NotificationPreference,
  type NotificationPreferenceId,
} from './domain/notification';
export type {
  NotificationPreferenceRepositoryPort,
  NotificationRepositoryPort,
} from './application/ports/notification-repository.port';
