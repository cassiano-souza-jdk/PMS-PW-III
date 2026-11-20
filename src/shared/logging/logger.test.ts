import { describe, expect, it } from 'vitest';
import { AuthorizationError } from '@/shared/errors';
import {
  CIRCULAR_REFERENCE_VALUE,
  MAX_DEPTH_VALUE,
  REDACTED_VALUE,
  SENSITIVE_KEYS,
  createLogger,
  createMemoryLogSink,
  isSensitiveKey,
  redactSensitiveData,
} from './index';

describe('redactSensitiveData and isSensitiveKey', () => {
  it('redacts every canonical sensitive key plus camelCase, snake_case and header variations', () => {
    const input: Record<string, unknown> = {};
    for (const key of SENSITIVE_KEYS) {
      input[key] = `sensitive-${key}`;
    }

    input.userPassword = 'pwd';
    input.db_secret = 'sec';
    input['X-Api-Key'] = 'key-123';
    input['Authorization'] = 'Bearer jwt';
    input['Set-Cookie'] = 'sid=abc';
    input.client_credentials = 'creds';
    input.session_id = 'sess-1';
    input.private_key = 'pem';
    input.access_token = 'at';
    input.refresh_token = 'rt';
    input.salt = 'random-salt-123';
    input.passwordSalt = 'pwd-salt-456';
    input.userCpf = '000.000.000-00';

    const redacted = redactSensitiveData(input) as Record<string, unknown>;

    for (const key of Object.keys(input)) {
      expect(redacted[key], `expected key "${key}" to be redacted`).toBe(REDACTED_VALUE);
    }
  });

  it('does not produce false positives for safe domain/UI keys like className and organizationId', () => {
    expect(isSensitiveKey('className')).toBe(false);
    expect(isSensitiveKey('organizationId')).toBe(false);
    expect(isSensitiveKey('projectId')).toBe(false);
    expect(isSensitiveKey('status')).toBe(false);

    const input = {
      className: 'bg-primary text-foreground',
      organizationId: 'org-alpha-01',
      nested: {
        organizationId: 'org-alpha-01',
        token: 'should-redact',
      },
    };

    const redacted = redactSensitiveData(input) as typeof input;
    expect(redacted.className).toBe('bg-primary text-foreground');
    expect(redacted.organizationId).toBe('org-alpha-01');
    expect(redacted.nested.organizationId).toBe('org-alpha-01');
    expect(redacted.nested.token).toBe(REDACTED_VALUE);
  });

  it('handles circular references with [Circular] while preserving shared non-circular references', () => {
    const shared = {
      organizationId: 'org-shared',
      secret: 'top-secret',
    };

    const container: Record<string, unknown> = {
      firstRef: shared,
      secondRef: shared,
    };
    container.self = container;

    const redacted = redactSensitiveData(container) as Record<string, unknown>;

    expect(redacted.self).toBe(CIRCULAR_REFERENCE_VALUE);
    expect(redacted.firstRef).toEqual({
      organizationId: 'org-shared',
      secret: REDACTED_VALUE,
    });
    expect(redacted.secondRef).toEqual({
      organizationId: 'org-shared',
      secret: REDACTED_VALUE,
    });
  });

  it('does not mutate the original payload and respects maxDepth', () => {
    const original = {
      user: {
        organizationId: 'org-1',
        password: 'keep-intact-on-original',
        deep: {
          level2: {
            level3: 'too-deep',
          },
        },
      },
    };

    const redacted = redactSensitiveData(original, 2) as {
      user: { organizationId: string; password: string; deep: unknown };
    };

    expect(original.user.password).toBe('keep-intact-on-original');
    expect(redacted.user.password).toBe(REDACTED_VALUE);
    expect(redacted.user.organizationId).toBe('org-1');
    expect(redacted.user.deep).toBe(MAX_DEPTH_VALUE);
  });

  it('serializes and redacts nested Map, Set and AppError instances safely', () => {
    const headers = new Map<string, string>([
      ['authorization', 'Bearer xyz'],
      ['x-request-id', 'req-42'],
    ]);
    const error = new AuthorizationError('Forbidden action', {
      correlationId: 'corr-err',
      details: {
        organizationId: 'org-1',
        apiKey: 'secret-api-key',
      },
    });

    const redacted = redactSensitiveData({
      headers,
      tags: new Set(['rbac', 'abac']),
      error,
    }) as Record<string, unknown>;

    expect(redacted.headers).toEqual({
      authorization: REDACTED_VALUE,
      'x-request-id': 'req-42',
    });
    expect(redacted.tags).toEqual(['rbac', 'abac']);
    expect(redacted.error).toEqual({
      name: 'AuthorizationError',
      message: 'Forbidden action',
      code: 'AUTHORIZATION_ERROR',
      correlationId: 'corr-err',
      details: {
        organizationId: 'org-1',
        apiKey: REDACTED_VALUE,
      },
    });
  });
});

describe('createLogger and createMemoryLogSink', () => {
  it('filters log entries according to minLevel and emits ISO 8601 timestamps', () => {
    const sink = createMemoryLogSink();
    const fixedDate = new Date('2026-11-19T12:30:45.123Z');
    const logger = createLogger({
      minLevel: 'warn',
      sink,
      clock: () => fixedDate,
    });

    logger.debug('debug ignored');
    logger.info('info ignored');
    logger.warn('warn emitted', { organizationId: 'org-1' });
    logger.error('error emitted', { password: 'hidden-password' });

    const entries = sink.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      level: 'warn',
      message: 'warn emitted',
      timestamp: '2026-11-19T12:30:45.123Z',
      context: { organizationId: 'org-1' },
    });
    expect(entries[1]).toEqual({
      level: 'error',
      message: 'error emitted',
      timestamp: '2026-11-19T12:30:45.123Z',
      context: { password: REDACTED_VALUE },
    });

    sink.clear();
    expect(sink.entries).toHaveLength(0);
  });

  it('propagates correlationId and context through child loggers without mutating parent', () => {
    const sink = createMemoryLogSink();
    const clock = () => new Date('2026-11-19T15:00:00.000Z');
    const rootLogger = createLogger({
      minLevel: 'debug',
      sink,
      correlationId: 'corr-root',
      defaultContext: { module: 'foundation' },
      clock,
    });

    const childLogger = rootLogger.child({
      correlationId: 'corr-child',
      context: { organizationId: 'org-2', accessToken: 'secret-token' },
    });

    rootLogger.info('root event');
    childLogger.info('child event');
    childLogger.warn('explicit override', { action: 'move-task' }, 'corr-explicit');

    expect(sink.entries).toEqual([
      {
        level: 'info',
        message: 'root event',
        timestamp: '2026-11-19T15:00:00.000Z',
        correlationId: 'corr-root',
        context: { module: 'foundation' },
      },
      {
        level: 'info',
        message: 'child event',
        timestamp: '2026-11-19T15:00:00.000Z',
        correlationId: 'corr-child',
        context: {
          module: 'foundation',
          organizationId: 'org-2',
          accessToken: REDACTED_VALUE,
        },
      },
      {
        level: 'warn',
        message: 'explicit override',
        timestamp: '2026-11-19T15:00:00.000Z',
        correlationId: 'corr-explicit',
        context: {
          module: 'foundation',
          organizationId: 'org-2',
          accessToken: REDACTED_VALUE,
          action: 'move-task',
        },
      },
    ]);
  });
});
