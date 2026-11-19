import { redactSensitiveData } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly context?: LogContext;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

export interface MemoryLogSink extends LogSink {
  readonly entries: readonly LogEntry[];
  getEntries(): readonly LogEntry[];
  clear(): void;
}

export interface LoggerChildBindings {
  readonly correlationId?: string;
  readonly context?: LogContext;
}

export interface Logger {
  debug(message: string, context?: LogContext, correlationId?: string): void;
  info(message: string, context?: LogContext, correlationId?: string): void;
  warn(message: string, context?: LogContext, correlationId?: string): void;
  error(message: string, context?: LogContext, correlationId?: string): void;
  child(bindings: LoggerChildBindings): Logger;
}

export interface CreateLoggerOptions {
  readonly minLevel?: LogLevel;
  readonly sink?: LogSink;
  readonly correlationId?: string;
  readonly defaultContext?: LogContext;
  readonly clock?: () => Date;
}

const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isPlainRecord(value: unknown): value is LogContext {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactContext(context: LogContext): LogContext {
  const redacted = redactSensitiveData(context);
  return isPlainRecord(redacted) ? redacted : {};
}

function resolveCorrelationId(
  explicitCorrelationId: string | undefined,
  context: LogContext | undefined,
  boundCorrelationId: string | undefined,
): string | undefined {
  if (explicitCorrelationId !== undefined && explicitCorrelationId.trim().length > 0) {
    return explicitCorrelationId;
  }

  if (
    context !== undefined &&
    typeof context.correlationId === 'string' &&
    context.correlationId.trim().length > 0
  ) {
    return context.correlationId;
  }

  if (boundCorrelationId !== undefined && boundCorrelationId.trim().length > 0) {
    return boundCorrelationId;
  }

  return undefined;
}

export function createConsoleLogSink(): LogSink {
  return {
    write(entry: LogEntry): void {
      switch (entry.level) {
        case 'debug':
          console.debug(entry);
          break;
        case 'info':
          console.info(entry);
          break;
        case 'warn':
          console.warn(entry);
          break;
        case 'error':
          console.error(entry);
          break;
      }
    },
  };
}

export function createMemoryLogSink(): MemoryLogSink {
  const buffer: LogEntry[] = [];

  return {
    get entries(): readonly LogEntry[] {
      return [...buffer];
    },
    write(entry: LogEntry): void {
      buffer.push(entry);
    },
    getEntries(): readonly LogEntry[] {
      return [...buffer];
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minLevel: LogLevel = options.minLevel ?? 'info';
  const sink: LogSink = options.sink ?? createConsoleLogSink();
  const boundCorrelationId = options.correlationId;
  const defaultContext = options.defaultContext;
  const clock: () => Date = options.clock ?? (() => new Date());

  const emit = (level: LogLevel, message: string, context?: LogContext, correlationId?: string) => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
      return;
    }

    const mergedContext: LogContext | undefined =
      defaultContext !== undefined || context !== undefined
        ? {
            ...(defaultContext ?? {}),
            ...(context ?? {}),
          }
        : undefined;

    const resolvedCorrelationId = resolveCorrelationId(
      correlationId,
      mergedContext,
      boundCorrelationId,
    );

    const entry: LogEntry = {
      level,
      message,
      timestamp: clock().toISOString(),
      ...(resolvedCorrelationId !== undefined ? { correlationId: resolvedCorrelationId } : {}),
      ...(mergedContext !== undefined ? { context: redactContext(mergedContext) } : {}),
    };

    sink.write(entry);
  };

  return {
    debug(message, context, correlationId) {
      emit('debug', message, context, correlationId);
    },
    info(message, context, correlationId) {
      emit('info', message, context, correlationId);
    },
    warn(message, context, correlationId) {
      emit('warn', message, context, correlationId);
    },
    error(message, context, correlationId) {
      emit('error', message, context, correlationId);
    },
    child(bindings) {
      const mergedDefaultContext: LogContext | undefined =
        defaultContext !== undefined || bindings.context !== undefined
          ? {
              ...(defaultContext ?? {}),
              ...(bindings.context ?? {}),
            }
          : undefined;

      return createLogger({
        minLevel,
        sink,
        correlationId: bindings.correlationId ?? boundCorrelationId,
        defaultContext: mergedDefaultContext,
        clock,
      });
    },
  };
}
