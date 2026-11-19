import type {
  IsoDateTime,
  NotificationId,
  OrganizationId,
  PaginatedResult,
  PaginationParams,
  UserId,
} from '@/shared/kernel';
import type { Notification, NotificationPreference } from '../../domain/notification';

export interface NotificationRepositoryPort {
  findByDeduplicationKey(
    organizationId: OrganizationId,
    deduplicationKey: string,
  ): Promise<Notification | null>;
  listByRecipient(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    pagination: PaginationParams,
    options?: { readonly unreadOnly?: boolean },
  ): Promise<PaginatedResult<Notification>>;
  save(notification: Notification): Promise<void>;
  markAsRead(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    notificationId: NotificationId,
    readAt: IsoDateTime,
  ): Promise<void>;
  markAllAsRead(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    readAt: IsoDateTime,
  ): Promise<void>;
}

export interface NotificationPreferenceRepositoryPort {
  findByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<NotificationPreference | null>;
  save(preference: NotificationPreference): Promise<void>;
}
