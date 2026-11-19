import { describe, expect, it } from 'vitest';
import { APP_ERROR_CODES, ValidationError } from '@/shared/errors';
import { APP_ENV_VALUES, LOG_LEVEL_VALUES, parseEnv } from './index';

describe('parseEnv', () => {
  it('returns frozen default configuration when called with an empty object', () => {
    const parsed = parseEnv({});

    expect(parsed).toEqual({
      VITE_APP_NAME: 'PMS — Project Management System',
      VITE_APP_ENV: 'development',
      VITE_APP_VERSION: '0.1.0',
      VITE_LOG_LEVEL: 'info',
      VITE_ENABLE_DEMO_MODE: true,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      (parsed as { VITE_APP_NAME: string }).VITE_APP_NAME = 'Mutated';
    }).toThrow(TypeError);
  });

  it('accepts valid overrides for enums, strings and boolean representations', () => {
    for (const appEnv of APP_ENV_VALUES) {
      expect(parseEnv({ VITE_APP_ENV: appEnv }).VITE_APP_ENV).toBe(appEnv);
    }

    for (const logLevel of LOG_LEVEL_VALUES) {
      expect(parseEnv({ VITE_LOG_LEVEL: logLevel }).VITE_LOG_LEVEL).toBe(logLevel);
    }

    expect(
      parseEnv({
        VITE_APP_NAME: '  PMS Staging  ',
        VITE_APP_ENV: 'staging',
        VITE_APP_VERSION: ' 0.2.0-rc.1 ',
        VITE_LOG_LEVEL: 'warn',
        VITE_ENABLE_DEMO_MODE: 'false',
      }),
    ).toEqual({
      VITE_APP_NAME: 'PMS Staging',
      VITE_APP_ENV: 'staging',
      VITE_APP_VERSION: '0.2.0-rc.1',
      VITE_LOG_LEVEL: 'warn',
      VITE_ENABLE_DEMO_MODE: false,
    });

    expect(parseEnv({ VITE_ENABLE_DEMO_MODE: ' TRUE ' }).VITE_ENABLE_DEMO_MODE).toBe(true);
    expect(parseEnv({ VITE_ENABLE_DEMO_MODE: false }).VITE_ENABLE_DEMO_MODE).toBe(false);
    expect(parseEnv({ VITE_ENABLE_DEMO_MODE: true }).VITE_ENABLE_DEMO_MODE).toBe(true);
  });

  it('ignores non-VITE_* server/runtime variables without exposing them', () => {
    const parsed = parseEnv({
      INTERNAL_SECRET_TOKEN: 'not-a-vite-key',
      NODE_ENV: 'test',
    });

    expect(parsed.VITE_APP_ENV).toBe('development');
    expect('INTERNAL_SECRET_TOKEN' in parsed).toBe(false);
  });

  it('rejects invalid enums, booleans and blank required strings with ValidationError', () => {
    const invalidInputs: readonly Record<string, unknown>[] = [
      { VITE_APP_ENV: 'qa' },
      { VITE_LOG_LEVEL: 'verbose' },
      { VITE_ENABLE_DEMO_MODE: 'yes' },
      { VITE_ENABLE_DEMO_MODE: '1' },
      { VITE_ENABLE_DEMO_MODE: 0 },
      { VITE_APP_NAME: '   ' },
      { VITE_APP_VERSION: '' },
    ];

    for (const rawInput of invalidInputs) {
      let caught: unknown;
      try {
        parseEnv(rawInput);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      const validationError = caught as ValidationError;
      expect(validationError.code).toBe(APP_ERROR_CODES.VALIDATION_ERROR);
      expect(Array.isArray(validationError.details?.issues)).toBe(true);
    }
  });

  it('rejects forbidden sensitive key patterns in VITE_* without leaking sensitive values', () => {
    const forbiddenCases = [
      { key: 'VITE_CLIENT_SECRET', value: 'sec-value-9911' },
      { key: 'VITE_DB_PASSWORD', value: 'pwd-value-9922' },
      { key: 'VITE_ADMIN_PASSWD', value: 'passwd-value-9933' },
      { key: 'VITE_AUTH_TOKEN', value: 'tok-value-9944' },
      { key: 'VITE_EXTERNAL_API_KEY', value: 'apikey-value-9955' },
      { key: 'VITE_SIGNING_PRIVATE_KEY', value: 'privkey-value-9966' },
      { key: 'VITE_SERVICE_CREDENTIAL', value: 'cred-value-9977' },
      { key: 'VITE_APP_AUTH_KEY', value: 'authkey-value-9988' },
      { key: 'VITE_STORAGE_ACCESS_KEY', value: 'accesskey-value-9999' },
      { key: 'vite_lowercase_secret', value: 'lower-sec-0000' },
    ] as const;

    for (const testCase of forbiddenCases) {
      let caught: unknown;
      try {
        parseEnv({ [testCase.key]: testCase.value });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      const validationError = caught as ValidationError;
      expect(validationError.code).toBe(APP_ERROR_CODES.VALIDATION_ERROR);
      expect(validationError.details).toEqual({
        forbiddenKeys: [testCase.key],
      });

      const serializedDetails = JSON.stringify(validationError.details);
      expect(validationError.message).not.toContain(testCase.value);
      expect(serializedDetails).not.toContain(testCase.value);
    }
  });
});
