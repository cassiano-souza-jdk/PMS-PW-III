import { Dexie } from 'dexie';
import { ConflictError, InfrastructureError, isAppError, type AppError } from '@/shared/errors';

export interface StorageDiagnosticEstimate {
  readonly usageBytes?: number;
  readonly quotaBytes?: number;
}

const QUOTA_ERROR_NAMES: ReadonlySet<string> = new Set<string>([
  'QuotaExceededError',
  Dexie.errnames.QuotaExceeded,
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

const CONSTRAINT_ERROR_NAMES: ReadonlySet<string> = new Set<string>([
  'ConstraintError',
  Dexie.errnames.Constraint,
]);

function extractErrorField(value: unknown, field: 'name' | 'message' | 'inner' | 'cause'): unknown {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[field];
}

function matchesErrorNameRecursively(
  error: unknown,
  candidateNames: ReadonlySet<string>,
  visited: Set<unknown> = new Set<unknown>(),
): boolean {
  if (typeof error !== 'object' || error === null || visited.has(error)) {
    return false;
  }
  visited.add(error);

  const name = extractErrorField(error, 'name');
  if (typeof name === 'string' && candidateNames.has(name)) {
    return true;
  }

  const inner = extractErrorField(error, 'inner');
  if (inner !== undefined && matchesErrorNameRecursively(inner, candidateNames, visited)) {
    return true;
  }

  const cause = extractErrorField(error, 'cause');
  if (cause !== undefined && matchesErrorNameRecursively(cause, candidateNames, visited)) {
    return true;
  }

  return false;
}

/**
 * Detects IndexedDB / DOM / Dexie quota exceeded errors (DATA-PERSISTENCE.md, ADR-0007 §4.4).
 * Inspects the outer error as well as nested `inner` and `cause` chains.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (matchesErrorNameRecursively(error, QUOTA_ERROR_NAMES)) {
    return true;
  }

  const message = extractErrorField(error, 'message');
  if (typeof message === 'string') {
    const normalized = message.toLowerCase();
    if (
      normalized.includes('quotaexceedederror') ||
      normalized.includes('ns_error_dom_quota_reached') ||
      normalized.includes('quota has been exceeded')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Detects IndexedDB / Dexie ConstraintError (duplicate primary key on `add` or unique `&` index collision).
 */
export function isConstraintError(error: unknown): boolean {
  return matchesErrorNameRecursively(error, CONSTRAINT_ERROR_NAMES);
}

/**
 * Non-destructive storage diagnostic helper using standard StorageManager API when available.
 */
export async function estimateStorageDiagnostic(): Promise<StorageDiagnosticEstimate> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage !== undefined &&
      typeof navigator.storage.estimate === 'function'
    ) {
      const estimate = await navigator.storage.estimate();
      return Object.freeze({
        ...(typeof estimate.usage === 'number' ? { usageBytes: estimate.usage } : {}),
        ...(typeof estimate.quota === 'number' ? { quotaBytes: estimate.quota } : {}),
      });
    }
  } catch {
    // Diagnostic estimation is best-effort and must never mask the original persistence error.
  }

  return Object.freeze({});
}

/**
 * Translates a raw Dexie/IndexedDB error into a canonical `AppError` without ever deleting business data
 * automatically (DATA-PERSISTENCE.md, ADR-0007 §4).
 */
export function translateDexieError(
  error: unknown,
  operationName: string,
  diagnostic: StorageDiagnosticEstimate = {},
): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (isQuotaExceededError(error)) {
    return new InfrastructureError(
      `Local IndexedDB storage quota was exceeded during "${operationName}". Export a backup or remove unused attachments manually; business data is never deleted automatically.`,
      {
        cause: error,
        details: {
          reason: 'STORAGE_QUOTA_EXCEEDED',
          operationName,
          ...(diagnostic.usageBytes !== undefined ? { usageBytes: diagnostic.usageBytes } : {}),
          ...(diagnostic.quotaBytes !== undefined ? { quotaBytes: diagnostic.quotaBytes } : {}),
        },
      },
    );
  }

  if (isConstraintError(error)) {
    const rawMessage = extractErrorField(error, 'message');
    const detailMessage =
      typeof rawMessage === 'string' && rawMessage.trim().length > 0
        ? rawMessage
        : 'Unique or primary key constraint violation.';

    return new ConflictError(
      `Persistence constraint conflict during "${operationName}": ${detailMessage}`,
      {
        cause: error,
        details: {
          reason: 'CONSTRAINT_ERROR',
          operationName,
        },
      },
    );
  }

  const rawMessage = extractErrorField(error, 'message');
  const technicalDetail =
    typeof rawMessage === 'string' && rawMessage.trim().length > 0
      ? rawMessage
      : 'IndexedDB operation failed.';

  return new InfrastructureError(
    `IndexedDB persistence failure during "${operationName}": ${technicalDetail}`,
    {
      cause: error,
      details: {
        reason: 'INDEXEDDB_FAILURE',
        operationName,
      },
    },
  );
}

/**
 * Wraps an asynchronous Dexie persistence operation with canonical error translation:
 * - Preserves `AppError` subclasses (`AuthorizationError`, `ConflictError`, `NotFoundError`, `ValidationError`);
 * - Translates `QuotaExceededError` into a diagnostic `InfrastructureError` without deleting business data;
 * - Translates `ConstraintError` into `ConflictError`;
 * - Translates any other IndexedDB failure into `InfrastructureError`.
 */
export async function withPersistenceErrorHandling<T>(
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (isAppError(error)) {
      throw error;
    }

    if (isQuotaExceededError(error)) {
      const diagnostic = await estimateStorageDiagnostic();
      throw translateDexieError(error, operationName, diagnostic);
    }

    throw translateDexieError(error, operationName);
  }
}
