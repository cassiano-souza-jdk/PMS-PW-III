import { z } from 'zod';
import { ValidationError } from '@/shared/errors';

export const FORBIDDEN_ENV_KEY_PATTERNS = [
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'TOKEN',
  'PRIVATE_KEY',
  'API_KEY',
  'CREDENTIAL',
  'AUTH_KEY',
  'ACCESS_KEY',
] as const;

export const APP_ENV_VALUES = ['development', 'test', 'staging', 'production'] as const;
export const LOG_LEVEL_VALUES = ['debug', 'info', 'warn', 'error'] as const;

export type AppEnvironment = (typeof APP_ENV_VALUES)[number];
export type EnvLogLevel = (typeof LOG_LEVEL_VALUES)[number];

const envBooleanSchema = z.preprocess((value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean().default(true));

export const envSchema = z.object({
  VITE_APP_NAME: z.string().trim().min(1).default('PMS — Project Management System'),
  VITE_APP_ENV: z.enum(APP_ENV_VALUES).default('development'),
  VITE_APP_VERSION: z.string().trim().min(1).default('0.1.0'),
  VITE_LOG_LEVEL: z.enum(LOG_LEVEL_VALUES).default('info'),
  VITE_ENABLE_DEMO_MODE: envBooleanSchema,
});

export type AppEnv = Readonly<z.infer<typeof envSchema>>;

function findForbiddenViteEnvKeys(rawEnv: Record<string, unknown>): string[] {
  const forbiddenKeys: string[] = [];

  for (const key of Object.keys(rawEnv)) {
    const upperKey = key.toUpperCase();
    if (!upperKey.startsWith('VITE_')) {
      continue;
    }

    const hasForbiddenPattern = FORBIDDEN_ENV_KEY_PATTERNS.some((pattern) =>
      upperKey.includes(pattern),
    );

    if (hasForbiddenPattern) {
      forbiddenKeys.push(key);
    }
  }

  return forbiddenKeys;
}

export function parseEnv(rawEnv: Record<string, unknown>): AppEnv {
  const forbiddenKeys = findForbiddenViteEnvKeys(rawEnv);

  if (forbiddenKeys.length > 0) {
    throw new ValidationError(
      'Forbidden sensitive key pattern detected in public VITE_* environment variables.',
      {
        details: {
          forbiddenKeys,
        },
      },
    );
  }

  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    throw new ValidationError('Invalid public VITE_* environment configuration.', {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
    });
  }

  return Object.freeze(parsed.data);
}

const runtimeImportMetaEnv: Record<string, unknown> =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env === 'object' &&
  import.meta.env !== null
    ? (import.meta.env as Record<string, unknown>)
    : {};

export const env: AppEnv = parseEnv(runtimeImportMetaEnv);
