import { APP_ERROR_CODES, type AppErrorCode } from './error-codes';

export interface AppErrorOptions {
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;

    if (options.details !== undefined) {
      this.details = options.details;
    }

    if (options.correlationId !== undefined) {
      this.correlationId = options.correlationId;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends AppError {
  constructor(
    message = 'Authentication is required or the current session is invalid.',
    options: AppErrorOptions = {},
  ) {
    super(APP_ERROR_CODES.AUTHENTICATION_ERROR, message, options);
  }
}

export class AuthorizationError extends AppError {
  constructor(
    message = 'Actor is not authorized to perform this operation.',
    options: AppErrorOptions = {},
  ) {
    super(APP_ERROR_CODES.AUTHORIZATION_ERROR, message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource was not found.', options: AppErrorOptions = {}) {
    super(APP_ERROR_CODES.NOT_FOUND, message, options);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'Current resource state prevents this operation.',
    options: AppErrorOptions = {},
  ) {
    super(APP_ERROR_CODES.CONFLICT, message, options);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Input validation failed.', options: AppErrorOptions = {}) {
    super(APP_ERROR_CODES.VALIDATION_ERROR, message, options);
  }
}

export class InfrastructureError extends AppError {
  constructor(message = 'Infrastructure operation failed.', options: AppErrorOptions = {}) {
    super(APP_ERROR_CODES.INFRASTRUCTURE_ERROR, message, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function withCorrelationId(error: AppError, correlationId: string): AppError {
  const options: AppErrorOptions = {
    details: error.details,
    correlationId,
    cause: error.cause,
  };

  switch (error.code) {
    case APP_ERROR_CODES.AUTHENTICATION_ERROR:
      return new AuthenticationError(error.message, options);
    case APP_ERROR_CODES.AUTHORIZATION_ERROR:
      return new AuthorizationError(error.message, options);
    case APP_ERROR_CODES.NOT_FOUND:
      return new NotFoundError(error.message, options);
    case APP_ERROR_CODES.CONFLICT:
      return new ConflictError(error.message, options);
    case APP_ERROR_CODES.VALIDATION_ERROR:
      return new ValidationError(error.message, options);
    case APP_ERROR_CODES.INFRASTRUCTURE_ERROR:
      return new InfrastructureError(error.message, options);
    case APP_ERROR_CODES.UNEXPECTED_ERROR:
      return new AppError(APP_ERROR_CODES.UNEXPECTED_ERROR, error.message, options);
  }
}

export function normalizeError(error: unknown, correlationId?: string): AppError {
  if (isAppError(error)) {
    if (correlationId !== undefined && error.correlationId === undefined) {
      return withCorrelationId(error, correlationId);
    }

    return error;
  }

  if (error instanceof Error) {
    const technicalMessage =
      error.message.trim().length > 0 ? error.message : 'An unexpected error occurred.';

    return new AppError(APP_ERROR_CODES.UNEXPECTED_ERROR, technicalMessage, {
      correlationId,
      cause: error,
    });
  }

  return new AppError(APP_ERROR_CODES.UNEXPECTED_ERROR, 'An unexpected error occurred.', {
    correlationId,
    cause: error,
  });
}
