import { isUuid } from '@/shared/kernel';
import type { EphemeralSessionPointerPort } from '../../application/ports/ephemeral-session-pointer.port';
import { asSessionId, type SessionId } from '../../domain/user-session';

export const EPHEMERAL_SESSION_STORAGE_KEY = 'pms_ephemeral_session_id' as const;

/**
 * Browser adapter storing ONLY the opaque non-secret `sessionId` UUID in `window.sessionStorage`
 * (never `localStorage`, never tokens or secrets — ADR-0008 §3.3, PRD.md §6).
 */
export class BrowserEphemeralSessionPointer implements EphemeralSessionPointerPort {
  private readonly storageKey: string;

  constructor(storageKey: string = EPHEMERAL_SESSION_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  getSessionId(): SessionId | null {
    try {
      if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        return null;
      }

      const raw = window.sessionStorage.getItem(this.storageKey)?.trim();
      if (!raw || !isUuid(raw)) {
        return null;
      }

      return asSessionId(raw, 'ephemeralSessionId');
    } catch {
      return null;
    }
  }

  setSessionId(sessionId: SessionId): void {
    try {
      if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        return;
      }

      window.sessionStorage.setItem(this.storageKey, sessionId);
    } catch {
      // Ignore storage access restrictions (e.g. strict privacy modes)
    }
  }

  clear(): void {
    try {
      if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        return;
      }

      window.sessionStorage.removeItem(this.storageKey);
    } catch {
      // Ignore storage access restrictions
    }
  }
}

/**
 * In-memory adapter for Node/Vitest environments where `window.sessionStorage` is not used.
 */
export class InMemoryEphemeralSessionPointer implements EphemeralSessionPointerPort {
  private currentSessionId: SessionId | null = null;

  getSessionId(): SessionId | null {
    return this.currentSessionId;
  }

  setSessionId(sessionId: SessionId): void {
    this.currentSessionId = sessionId;
  }

  clear(): void {
    this.currentSessionId = null;
  }
}
