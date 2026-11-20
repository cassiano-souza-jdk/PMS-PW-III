import { isAppError } from '@/shared/errors';

export const REDACTED_VALUE = '[REDACTED]' as const;
export const CIRCULAR_REFERENCE_VALUE = '[Circular]' as const;
export const MAX_DEPTH_VALUE = '[MaxDepth]' as const;

export const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'apiKey',
  'privateKey',
  'credential',
  'sessionId',
  'cpf',
  'ssn',
] as const;

const SENSITIVE_SINGLE_TOKENS: ReadonlySet<string> = new Set([
  'password',
  'passwords',
  'passwd',
  'secret',
  'secrets',
  'token',
  'tokens',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'salt',
  'cpf',
  'ssn',
]);

const SENSITIVE_COMPOUND_PATTERNS: readonly string[] = [
  'apikey',
  'privatekey',
  'sessionid',
  'accesstoken',
  'refreshtoken',
];

const DEFAULT_MAX_DEPTH = 20;

function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment.length > 0);
}

export function isSensitiveKey(key: string): boolean {
  const tokens = tokenizeKey(key);
  if (tokens.some((token) => SENSITIVE_SINGLE_TOKENS.has(token))) {
    return true;
  }

  const compactKey = tokens.join('');
  return SENSITIVE_COMPOUND_PATTERNS.some((pattern) => compactKey.includes(pattern));
}

function redactError(
  error: Error,
  ancestors: WeakSet<object>,
  depth: number,
  maxDepth: number,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (isAppError(error)) {
    serialized.code = error.code;

    if (error.correlationId !== undefined) {
      serialized.correlationId = error.correlationId;
    }

    if (error.details !== undefined) {
      serialized.details = redactNode(error.details, ancestors, depth + 1, maxDepth);
    }
  }

  if (error.cause !== undefined) {
    serialized.cause = redactNode(error.cause, ancestors, depth + 1, maxDepth);
  }

  return serialized;
}

function redactNode(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (ancestors.has(value)) {
    return CIRCULAR_REFERENCE_VALUE;
  }

  if (depth >= maxDepth) {
    return MAX_DEPTH_VALUE;
  }

  ancestors.add(value);

  try {
    if (value instanceof Error) {
      return redactError(value, ancestors, depth, maxDepth);
    }

    if (Array.isArray(value)) {
      return value.map((item) => redactNode(item, ancestors, depth + 1, maxDepth));
    }

    if (value instanceof Set) {
      const items: unknown[] = [];
      for (const item of value) {
        items.push(redactNode(item, ancestors, depth + 1, maxDepth));
      }
      return items;
    }

    if (value instanceof Map) {
      const mapped: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of value.entries()) {
        const stringKey = String(entryKey);
        mapped[stringKey] = isSensitiveKey(stringKey)
          ? REDACTED_VALUE
          : redactNode(entryValue, ancestors, depth + 1, maxDepth);
      }
      return mapped;
    }

    const redactedObject: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redactedObject[entryKey] = isSensitiveKey(entryKey)
        ? REDACTED_VALUE
        : redactNode(entryValue, ancestors, depth + 1, maxDepth);
    }

    return redactedObject;
  } finally {
    ancestors.delete(value);
  }
}

export function redactSensitiveData(value: unknown, maxDepth = DEFAULT_MAX_DEPTH): unknown {
  const safeMaxDepth = Number.isInteger(maxDepth) && maxDepth > 0 ? maxDepth : DEFAULT_MAX_DEPTH;
  return redactNode(value, new WeakSet<object>(), 0, safeMaxDepth);
}
