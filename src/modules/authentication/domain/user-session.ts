import { AuthenticationError, ValidationError } from '@/shared/errors';
import {
  parseBrandedUuid,
  parseIsoDateTimeMs,
  type Brand,
  type IsoDateTime,
  type UserId,
} from '@/shared/kernel';

export type SessionId = Brand<string, 'SessionId'>;

export function asSessionId(value: string, fieldName = 'sessionId'): SessionId {
  return parseBrandedUuid<'SessionId'>(value, fieldName);
}

/**
 * Simulated browser/device session representation (PRD.md §6, SECURITY.md).
 * Never stores plaintext passwords or real backend secrets.
 */
export interface UserSession {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly deviceLabel: string;
  readonly persistent: boolean;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly lastActivityAt: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
  readonly revokedReason?: string;
}

export function isSessionActiveAt(session: UserSession, now: IsoDateTime): boolean {
  if (session.revokedAt !== undefined) {
    return false;
  }

  return parseIsoDateTimeMs(now) < parseIsoDateTimeMs(session.expiresAt);
}

export function assertSessionValid(
  session: UserSession | null | undefined,
  now: IsoDateTime,
): void {
  if (!session) {
    throw new AuthenticationError('No active session was found.');
  }

  if (session.deviceLabel.trim().length === 0) {
    throw new ValidationError('Session "deviceLabel" must be a non-empty string.', {
      details: { field: 'deviceLabel' },
    });
  }

  if (session.revokedAt !== undefined) {
    throw new AuthenticationError('The current session has been revoked.', {
      details: { sessionId: session.id },
    });
  }

  if (parseIsoDateTimeMs(now) >= parseIsoDateTimeMs(session.expiresAt)) {
    throw new AuthenticationError('The current session has expired.', {
      details: { sessionId: session.id },
    });
  }
}
