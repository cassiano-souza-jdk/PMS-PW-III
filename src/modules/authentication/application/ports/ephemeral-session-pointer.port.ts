import type { SessionId } from '../../domain/user-session';

/**
 * Port encapsulating the opaque non-secret `sessionId` pointer for temporary (`persistent: false`)
 * sessions (ADR-0008 §3.3, PRD.md §6).
 *
 * Never stores secrets, passwords or access tokens, and never uses `localStorage`.
 */
export interface EphemeralSessionPointerPort {
  getSessionId(): SessionId | null;
  setSessionId(sessionId: SessionId): void;
  clear(): void;
}
