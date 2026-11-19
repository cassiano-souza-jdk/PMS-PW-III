import { NotFoundError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  parseIsoDateTimeMs,
  type IsoDateTime,
  type UserId,
} from '@/shared/kernel';
import { withPersistenceErrorHandling, type PmsDatabase } from '@/shared/persistence';
import type { UserSessionRepositoryPort } from '../../application/ports/user-session-repository.port';
import type { SessionId, UserSession } from '../../domain/user-session';

export class DexieUserSessionRepository implements UserSessionRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<UserSession, SessionId>(TRANSACTION_RESOURCES.USER_SESSIONS);
  }

  async findById(sessionId: SessionId): Promise<UserSession | null> {
    return withPersistenceErrorHandling('UserSession.findById', async () => {
      const record = await this.table.get(sessionId);
      return record ?? null;
    });
  }

  async listByUserId(userId: UserId): Promise<readonly UserSession[]> {
    return withPersistenceErrorHandling('UserSession.listByUserId', async () => {
      const records = await this.table.where('userId').equals(userId).toArray();
      return records.sort(
        (a, b) => parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt),
      );
    });
  }

  async save(session: UserSession): Promise<void> {
    await withPersistenceErrorHandling('UserSession.save', async () => {
      await this.table.put(session);
    });
  }

  async revokeById(sessionId: SessionId, revokedAt: IsoDateTime, reason?: string): Promise<void> {
    await withPersistenceErrorHandling('UserSession.revokeById', async () => {
      const existing = await this.table.get(sessionId);
      if (!existing) {
        throw new NotFoundError(`UserSession "${sessionId}" was not found.`, {
          details: { sessionId },
        });
      }

      if (existing.revokedAt !== undefined) {
        return;
      }

      const revoked: UserSession = {
        ...existing,
        revokedAt,
        ...(reason !== undefined ? { revokedReason: reason } : {}),
      };

      await this.table.put(revoked);
    });
  }

  async revokeAllByUserId(userId: UserId, revokedAt: IsoDateTime, reason?: string): Promise<void> {
    await withPersistenceErrorHandling('UserSession.revokeAllByUserId', async () => {
      const sessions = await this.table.where('userId').equals(userId).toArray();
      const activeSessions = sessions.filter((session) => session.revokedAt === undefined);

      if (activeSessions.length === 0) {
        return;
      }

      const revokedSessions: UserSession[] = activeSessions.map((session) => ({
        ...session,
        revokedAt,
        ...(reason !== undefined ? { revokedReason: reason } : {}),
      }));

      await this.table.bulkPut(revokedSessions);
    });
  }
}
