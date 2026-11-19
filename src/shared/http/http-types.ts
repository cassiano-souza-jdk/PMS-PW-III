import {
  APP_ERROR_CODES,
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
  isAppErrorCode,
  type AppErrorCode,
  type AppErrorOptions,
} from '@/shared/errors';
import type { CorrelationId, IsoDateTime, OrganizationId, UserId } from '@/shared/kernel';

export const DEFAULT_API_BASE_URL = '/api/v1' as const;

export const HTTP_HEADERS = {
  CORRELATION_ID: 'x-correlation-id',
  ORGANIZATION_ID: 'x-organization-id',
  ACTOR_USER_ID: 'x-actor-user-id',
} as const;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiResponseMeta {
  readonly correlationId: string;
  readonly timestamp: IsoDateTime;
}

export interface ApiSuccessEnvelope<TData> {
  readonly data: TData;
  readonly meta: ApiResponseMeta;
}

export interface ApiErrorPayload {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly correlationId: string;
  readonly details?: Record<string, unknown>;
}

export interface ApiErrorEnvelope {
  readonly error: ApiErrorPayload;
}

export interface HttpRequestOptions<TBody = unknown> {
  readonly method?: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: TBody;
  readonly correlationId?: CorrelationId | string;
  readonly organizationId?: OrganizationId | string;
  readonly actorUserId?: UserId | string;
  readonly signal?: AbortSignal;
}

/**
 * Canonical mapping from `AppErrorCode` to HTTP status code (ADR-0007 §5.1, API-SIMULATION.md).
 */
export function appErrorCodeToHttpStatus(code: AppErrorCode): number {
  switch (code) {
    case APP_ERROR_CODES.AUTHENTICATION_ERROR:
      return 401;
    case APP_ERROR_CODES.AUTHORIZATION_ERROR:
      return 403;
    case APP_ERROR_CODES.NOT_FOUND:
      return 404;
    case APP_ERROR_CODES.CONFLICT:
      return 409;
    case APP_ERROR_CODES.VALIDATION_ERROR:
      return 422;
    case APP_ERROR_CODES.INFRASTRUCTURE_ERROR:
    case APP_ERROR_CODES.UNEXPECTED_ERROR:
      return 500;
  }
}

/**
 * Canonical mapping from HTTP status code to `AppErrorCode` (ADR-0007 §5.1).
 */
export function httpStatusToAppErrorCode(status: number): AppErrorCode {
  switch (status) {
    case 401:
      return APP_ERROR_CODES.AUTHENTICATION_ERROR;
    case 403:
      return APP_ERROR_CODES.AUTHORIZATION_ERROR;
    case 404:
      return APP_ERROR_CODES.NOT_FOUND;
    case 409:
      return APP_ERROR_CODES.CONFLICT;
    case 400:
    case 422:
      return APP_ERROR_CODES.VALIDATION_ERROR;
    case 500:
    case 502:
    case 503:
    case 504:
      return APP_ERROR_CODES.INFRASTRUCTURE_ERROR;
    default:
      return status >= 500
        ? APP_ERROR_CODES.INFRASTRUCTURE_ERROR
        : APP_ERROR_CODES.UNEXPECTED_ERROR;
  }
}

/**
 * Instantiates the specific `AppError` subclass matching `code` while preserving `correlationId` and `details`.
 */
export function createAppErrorFromCode(
  code: AppErrorCode,
  message: string,
  options: AppErrorOptions = {},
): AppError {
  switch (code) {
    case APP_ERROR_CODES.AUTHENTICATION_ERROR:
      return new AuthenticationError(message, options);
    case APP_ERROR_CODES.AUTHORIZATION_ERROR:
      return new AuthorizationError(message, options);
    case APP_ERROR_CODES.NOT_FOUND:
      return new NotFoundError(message, options);
    case APP_ERROR_CODES.CONFLICT:
      return new ConflictError(message, options);
    case APP_ERROR_CODES.VALIDATION_ERROR:
      return new ValidationError(message, options);
    case APP_ERROR_CODES.INFRASTRUCTURE_ERROR:
      return new InfrastructureError(message, options);
    case APP_ERROR_CODES.UNEXPECTED_ERROR:
      return new AppError(APP_ERROR_CODES.UNEXPECTED_ERROR, message, options);
  }
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }

  const errorObj = (value as { readonly error: unknown }).error;
  if (typeof errorObj !== 'object' || errorObj === null) {
    return false;
  }

  const candidate = errorObj as Record<string, unknown>;
  return (
    isAppErrorCode(candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.correlationId === 'string'
  );
}

export function isApiSuccessEnvelope<TData = unknown>(
  value: unknown,
): value is ApiSuccessEnvelope<TData> {
  if (typeof value !== 'object' || value === null || !('data' in value) || !('meta' in value)) {
    return false;
  }

  const meta = (value as { readonly meta: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) {
    return false;
  }

  const metaRecord = meta as Record<string, unknown>;
  return typeof metaRecord.correlationId === 'string' && typeof metaRecord.timestamp === 'string';
}
