import type { IsoDateTime, UserId } from '@/shared/kernel';
import type { SessionId, UserSession } from '../../domain/user-session';

export interface UserSessionRepositoryPort {
  findById(sessionId: SessionId): Promise<UserSession | null>;
  listByUserId(userId: UserId): Promise<readonly UserSession[]>;
  findLatestActivePersistent(now: IsoDateTime): Promise<UserSession | null>;
  save(session: UserSession): Promise<void>;
  revokeById(sessionId: SessionId, revokedAt: IsoDateTime, reason?: string): Promise<void>;
  revokeAllByUserId(userId: UserId, revokedAt: IsoDateTime, reason?: string): Promise<void>;
}
