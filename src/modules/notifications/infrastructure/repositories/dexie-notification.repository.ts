import { AuthorizationError, ConflictError, NotFoundError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  assertValidPaginationParams,
  createPaginatedResult,
  parseIsoDateTimeMs,
  type IsoDateTime,
  type NotificationId,
  type OrganizationId,
  type PaginatedResult,
  type PaginationParams,
  type UserId,
} from '@/shared/kernel';
import {
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  NotificationPreferenceRepositoryPort,
  NotificationRepositoryPort,
} from '../../application/ports/notification-repository.port';
import type {
  Notification,
  NotificationPreference,
  NotificationPreferenceId,
} from '../../domain/notification';

export class DexieNotificationRepository implements NotificationRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Notification, NotificationId>(TRANSACTION_RESOURCES.NOTIFICATIONS);
  }

  async findByDeduplicationKey(
    organizationId: OrganizationId,
    deduplicationKey: string,
  ): Promise<Notification | null> {
    return withPersistenceErrorHandling('Notification.findByDeduplicationKey', async () => {
      const record = await this.table
        .where('[organizationId+deduplicationKey]')
        .equals([organizationId, deduplicationKey])
        .first();
      return record ?? null;
    });
  }

  async listByRecipient(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    pagination: PaginationParams,
    options?: { readonly unreadOnly?: boolean },
  ): Promise<PaginatedResult<Notification>> {
    assertValidPaginationParams(pagination);

    return withPersistenceErrorHandling('Notification.listByRecipient', async () => {
      const records = await this.table
        .where('[organizationId+recipientUserId]')
        .equals([organizationId, recipientUserId])
        .toArray();

      const filtered =
        options?.unreadOnly === true
          ? records.filter((item) => item.readAt === undefined)
          : records;

      filtered.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt) ||
          a.id.localeCompare(b.id),
      );

      const offset = (pagination.page - 1) * pagination.pageSize;
      const pageItems = filtered.slice(offset, offset + pagination.pageSize);
      return createPaginatedResult(pageItems, filtered.length, pagination);
    });
  }

  async save(notification: Notification): Promise<void> {
    await withPersistenceErrorHandling('Notification.save', async () => {
      const existingByDedup = await this.table
        .where('[organizationId+deduplicationKey]')
        .equals([notification.organizationId, notification.deduplicationKey])
        .first();
      if (existingByDedup !== undefined && existingByDedup.id !== notification.id) {
        throw new ConflictError(
          `Notification with deduplicationKey "${notification.deduplicationKey}" already exists.`,
          {
            details: {
              organizationId: notification.organizationId,
              deduplicationKey: notification.deduplicationKey,
            },
          },
        );
      }
    });

    await saveOrganizationScopedEntity(this.table, notification, 'Notification');
  }

  async markAsRead(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    notificationId: NotificationId,
    readAt: IsoDateTime,
  ): Promise<void> {
    await withPersistenceErrorHandling('Notification.markAsRead', async () => {
      const existing = await findOrganizationScopedById(
        this.table,
        organizationId,
        notificationId,
        'Notification',
      );
      if (!existing) {
        throw new NotFoundError(`Notification "${notificationId}" was not found.`, {
          details: { notificationId, organizationId },
        });
      }

      if (existing.recipientUserId !== recipientUserId) {
        throw new AuthorizationError(
          'Actor cannot mark another recipient’s notification as read.',
          {
            details: { notificationId, recipientUserId },
          },
        );
      }

      if (existing.readAt !== undefined) {
        return;
      }

      await this.table.put({
        ...existing,
        readAt,
      });
    });
  }

  async markAllAsRead(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    readAt: IsoDateTime,
  ): Promise<void> {
    await withPersistenceErrorHandling('Notification.markAllAsRead', async () => {
      const records = await this.table
        .where('[organizationId+recipientUserId]')
        .equals([organizationId, recipientUserId])
        .toArray();

      const unread = records.filter((item) => item.readAt === undefined);
      if (unread.length === 0) {
        return;
      }

      const updated: Notification[] = unread.map((item) => ({
        ...item,
        readAt,
      }));

      await this.table.bulkPut(updated);
    });
  }
}

export class DexieNotificationPreferenceRepository implements NotificationPreferenceRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<NotificationPreference, NotificationPreferenceId>(
      TRANSACTION_RESOURCES.NOTIFICATION_PREFERENCES,
    );
  }

  async findByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<NotificationPreference | null> {
    return withPersistenceErrorHandling('NotificationPreference.findByUser', async () => {
      const record = await this.table
        .where('[organizationId+userId]')
        .equals([organizationId, userId])
        .first();
      return record ?? null;
    });
  }

  async save(preference: NotificationPreference): Promise<void> {
    await withPersistenceErrorHandling('NotificationPreference.save', async () => {
      const existingByUser = await this.table
        .where('[organizationId+userId]')
        .equals([preference.organizationId, preference.userId])
        .first();
      if (existingByUser !== undefined && existingByUser.id !== preference.id) {
        throw new ConflictError(
          `NotificationPreference already exists for user "${preference.userId}" in organization "${preference.organizationId}".`,
          {
            details: {
              organizationId: preference.organizationId,
              userId: preference.userId,
            },
          },
        );
      }
    });

    await saveOrganizationScopedEntity(this.table, preference, 'NotificationPreference');
  }
}
