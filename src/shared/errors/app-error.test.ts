import { describe, expect, it } from 'vitest';
import {
  APP_ERROR_CODES,
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
  isAppError,
  isAppErrorCode,
  normalizeError,
} from './index';

describe('APP_ERROR_CODES and isAppErrorCode', () => {
  it('exposes all 7 canonical error codes', () => {
    expect(Object.values(APP_ERROR_CODES)).toEqual([
      'AUTHENTICATION_ERROR',
      'AUTHORIZATION_ERROR',
      'NOT_FOUND',
      'CONFLICT',
      'VALIDATION_ERROR',
      'INFRASTRUCTURE_ERROR',
      'UNEXPECTED_ERROR',
    ]);
  });

  it('recognizes valid error codes and rejects unknown values', () => {
    for (const code of Object.values(APP_ERROR_CODES)) {
      expect(isAppErrorCode(code)).toBe(true);
    }

    expect(isAppErrorCode('UNKNOWN_ERROR')).toBe(false);
    expect(isAppErrorCode('')).toBe(false);
    expect(isAppErrorCode(null)).toBe(false);
    expect(isAppErrorCode(undefined)).toBe(false);
    expect(isAppErrorCode(404)).toBe(false);
    expect(isAppErrorCode({})).toBe(false);
  });
});

describe('AppError and subclasses', () => {
  it('constructs base AppError with optional metadata and prototype chain', () => {
    const rootCause = new Error('root');
    const error = new AppError(APP_ERROR_CODES.UNEXPECTED_ERROR, 'Technical failure', {
      details: { component: 'kernel' },
      correlationId: 'corr-001',
      cause: rootCause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe(APP_ERROR_CODES.UNEXPECTED_ERROR);
    expect(error.message).toBe('Technical failure');
    expect(error.details).toEqual({ component: 'kernel' });
    expect(error.correlationId).toBe('corr-001');
    expect(error.cause).toBe(rootCause);
    expect(isAppError(error)).toBe(true);
  });

  it('constructs every typed subclass with its canonical code and class name', () => {
    const cases = [
      {
        error: new AuthenticationError(),
        ctor: AuthenticationError,
        code: APP_ERROR_CODES.AUTHENTICATION_ERROR,
        name: 'AuthenticationError',
      },
      {
        error: new AuthorizationError(),
        ctor: AuthorizationError,
        code: APP_ERROR_CODES.AUTHORIZATION_ERROR,
        name: 'AuthorizationError',
      },
      {
        error: new NotFoundError(),
        ctor: NotFoundError,
        code: APP_ERROR_CODES.NOT_FOUND,
        name: 'NotFoundError',
      },
      {
        error: new ConflictError(),
        ctor: ConflictError,
        code: APP_ERROR_CODES.CONFLICT,
        name: 'ConflictError',
      },
      {
        error: new ValidationError(),
        ctor: ValidationError,
        code: APP_ERROR_CODES.VALIDATION_ERROR,
        name: 'ValidationError',
      },
      {
        error: new InfrastructureError(),
        ctor: InfrastructureError,
        code: APP_ERROR_CODES.INFRASTRUCTURE_ERROR,
        name: 'InfrastructureError',
      },
    ] as const;

    for (const item of cases) {
      expect(item.error).toBeInstanceOf(Error);
      expect(item.error).toBeInstanceOf(AppError);
      expect(item.error).toBeInstanceOf(item.ctor);
      expect(item.error.code).toBe(item.code);
      expect(item.error.name).toBe(item.name);
      expect(item.error.message.length).toBeGreaterThan(0);
      expect(isAppError(item.error)).toBe(true);
    }
  });

  it('returns false in isAppError for non-AppError values', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError({ code: APP_ERROR_CODES.NOT_FOUND, message: 'fake' })).toBe(false);
    expect(isAppError('NOT_FOUND')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe('normalizeError', () => {
  it('returns the same AppError instance when correlationId is absent or already present', () => {
    const withoutCorrelation = new NotFoundError('Item missing');
    expect(normalizeError(withoutCorrelation)).toBe(withoutCorrelation);

    const withCorrelation = new ConflictError('State conflict', { correlationId: 'existing-corr' });
    const normalized = normalizeError(withCorrelation, 'new-corr');
    expect(normalized).toBe(withCorrelation);
    expect(normalized.correlationId).toBe('existing-corr');
  });

  it('clones AppError subclasses immutably when attaching a missing correlationId', () => {
    const cause = new Error('underlying');
    const details = { resourceId: 'res-1' };

    const subclasses = [
      { original: new AuthenticationError('auth', { details, cause }), ctor: AuthenticationError },
      { original: new AuthorizationError('authz', { details, cause }), ctor: AuthorizationError },
      { original: new NotFoundError('missing', { details, cause }), ctor: NotFoundError },
      { original: new ConflictError('conflict', { details, cause }), ctor: ConflictError },
      { original: new ValidationError('invalid', { details, cause }), ctor: ValidationError },
      { original: new InfrastructureError('infra', { details, cause }), ctor: InfrastructureError },
      {
        original: new AppError(APP_ERROR_CODES.UNEXPECTED_ERROR, 'unexpected', { details, cause }),
        ctor: AppError,
      },
    ] as const;

    for (const { original, ctor } of subclasses) {
      const normalized = normalizeError(original, 'corr-injected');

      expect(normalized).not.toBe(original);
      expect(original.correlationId).toBeUndefined();
      expect(normalized).toBeInstanceOf(ctor);
      expect(normalized.code).toBe(original.code);
      expect(normalized.message).toBe(original.message);
      expect(normalized.details).toEqual(details);
      expect(normalized.cause).toBe(cause);
      expect(normalized.correlationId).toBe('corr-injected');
    }
  });

  it('wraps native Error instances into UNEXPECTED_ERROR while falling back on blank messages', () => {
    const nativeError = new TypeError('Cannot read property');
    const normalized = normalizeError(nativeError, 'corr-native');

    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized.code).toBe(APP_ERROR_CODES.UNEXPECTED_ERROR);
    expect(normalized.message).toBe('Cannot read property');
    expect(normalized.correlationId).toBe('corr-native');
    expect(normalized.cause).toBe(nativeError);

    const blankError = new Error('   ');
    const normalizedBlank = normalizeError(blankError);
    expect(normalizedBlank.code).toBe(APP_ERROR_CODES.UNEXPECTED_ERROR);
    expect(normalizedBlank.message).toBe('An unexpected error occurred.');
  });

  it('fails closed for unknown non-Error payloads without leaking payload into message or details', () => {
    const secretPayload = 'Bearer super-secret-jwt-token';
    const secretObject = { password: 'raw-password-123', token: 'raw-token' };

    for (const unknownValue of [secretPayload, secretObject, 500, null, undefined]) {
      const normalized = normalizeError(unknownValue, 'corr-unknown');

      expect(normalized).toBeInstanceOf(AppError);
      expect(normalized.code).toBe(APP_ERROR_CODES.UNEXPECTED_ERROR);
      expect(normalized.message).toBe('An unexpected error occurred.');
      expect(normalized.details).toBeUndefined();
      expect(normalized.correlationId).toBe('corr-unknown');
      expect(normalized.message).not.toContain('super-secret');
      expect(normalized.message).not.toContain('raw-password');
    }
  });
});
