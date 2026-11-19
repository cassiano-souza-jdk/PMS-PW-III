import { env as defaultEnv, type AppEnv } from '@/shared/config';
import { createLogger, type Logger } from '@/shared/logging';

export interface AppCompositionContainer {
  readonly env: AppEnv;
  readonly logger: Logger;
}

export interface CreateAppContainerOptions {
  readonly env?: AppEnv;
  readonly logger?: Logger;
}

export function createAppContainer(
  options: CreateAppContainerOptions = {},
): AppCompositionContainer {
  const resolvedEnv = options.env ?? defaultEnv;
  const resolvedLogger =
    options.logger ??
    createLogger({
      minLevel: resolvedEnv.VITE_LOG_LEVEL,
    });

  return Object.freeze({
    env: resolvedEnv,
    logger: resolvedLogger,
  });
}
