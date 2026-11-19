import { InfrastructureError, isAppError } from '@/shared/errors';
import {
  DEFAULT_API_BASE_URL,
  HTTP_HEADERS,
  createAppErrorFromCode,
  httpStatusToAppErrorCode,
  isApiErrorEnvelope,
  isApiSuccessEnvelope,
  type ApiSuccessEnvelope,
  type HttpRequestOptions,
} from './http-types';

export interface HttpClientContextDefaults {
  readonly organizationId?: string;
  readonly actorUserId?: string;
}

export interface CreateHttpClientOptions {
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly generateCorrelationId?: () => string;
  readonly getDefaultContext?: () => HttpClientContextDefaults;
}

function defaultCorrelationIdGenerator(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000000';
}

function buildRequestUrl(
  baseUrl: string,
  path: string,
  query?: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullPath =
    path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${normalizedBase}${normalizedPath}`;

  if (!query) {
    return fullPath;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  if (queryString.length === 0) {
    return fullPath;
  }

  return fullPath.includes('?') ? `${fullPath}&${queryString}` : `${fullPath}?${queryString}`;
}

/**
 * Typed HTTP client operating over `fetch` (API-SIMULATION.md, ADR-0007 §5.1).
 *
 * Responsibilities:
 * - Injects and propagates `x-correlation-id`, `x-organization-id`, and `x-actor-user-id`;
 * - Unwraps `ApiSuccessEnvelope<TData>`;
 * - Translates `ApiErrorEnvelope`, non-2xx HTTP statuses, and network failures into canonical `AppError` instances.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchFn?: typeof fetch;
  private readonly generateCorrelationId: () => string;
  private readonly getDefaultContext?: () => HttpClientContextDefaults;

  constructor(options: CreateHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_API_BASE_URL;
    this.fetchFn = options.fetchFn;
    this.generateCorrelationId = options.generateCorrelationId ?? defaultCorrelationIdGenerator;
    this.getDefaultContext = options.getDefaultContext;
  }

  async requestEnvelope<TData, TBody = unknown>(
    path: string,
    options: HttpRequestOptions<TBody> = {},
  ): Promise<ApiSuccessEnvelope<TData>> {
    const method = options.method ?? 'GET';
    const url = buildRequestUrl(this.baseUrl, path, options.query);
    const defaultContext = this.getDefaultContext?.() ?? {};

    const correlationId =
      options.correlationId ??
      options.headers?.[HTTP_HEADERS.CORRELATION_ID] ??
      this.generateCorrelationId();

    const organizationId =
      options.organizationId ??
      options.headers?.[HTTP_HEADERS.ORGANIZATION_ID] ??
      defaultContext.organizationId;

    const actorUserId =
      options.actorUserId ??
      options.headers?.[HTTP_HEADERS.ACTOR_USER_ID] ??
      defaultContext.actorUserId;

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.headers,
      [HTTP_HEADERS.CORRELATION_ID]: correlationId,
    };

    if (organizationId !== undefined) {
      headers[HTTP_HEADERS.ORGANIZATION_ID] = organizationId;
    }

    if (actorUserId !== undefined) {
      headers[HTTP_HEADERS.ACTOR_USER_ID] = actorUserId;
    }

    let serializedBody: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      serializedBody = JSON.stringify(options.body);
    }

    const activeFetch = this.fetchFn ?? globalThis.fetch;
    let response: Response;

    try {
      response = await activeFetch(url, {
        method,
        headers,
        ...(serializedBody !== undefined ? { body: serializedBody } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (networkFailure: unknown) {
      if (isAppError(networkFailure)) {
        throw networkFailure;
      }

      const rawMessage =
        networkFailure instanceof Error && networkFailure.message.trim().length > 0
          ? networkFailure.message
          : 'Network request failed.';

      throw new InfrastructureError(`HTTP network failure on ${method} ${url}: ${rawMessage}`, {
        correlationId,
        cause: networkFailure,
        details: {
          reason: 'NETWORK_ERROR',
          method,
          url,
        },
      });
    }

    const responseCorrelationId =
      response.headers.get(HTTP_HEADERS.CORRELATION_ID) ?? correlationId;

    let parsedPayload: unknown = null;
    const rawText = await response.text();
    if (rawText.trim().length > 0) {
      try {
        parsedPayload = JSON.parse(rawText) as unknown;
      } catch {
        parsedPayload = null;
      }
    }

    if (!response.ok) {
      if (isApiErrorEnvelope(parsedPayload)) {
        throw createAppErrorFromCode(parsedPayload.error.code, parsedPayload.error.message, {
          correlationId: parsedPayload.error.correlationId || responseCorrelationId,
          details: {
            httpStatus: response.status,
            ...parsedPayload.error.details,
          },
        });
      }

      const mappedCode = httpStatusToAppErrorCode(response.status);
      throw createAppErrorFromCode(
        mappedCode,
        `HTTP ${response.status} error on ${method} ${url}.`,
        {
          correlationId: responseCorrelationId,
          details: {
            httpStatus: response.status,
            method,
            url,
          },
        },
      );
    }

    if (isApiSuccessEnvelope<TData>(parsedPayload)) {
      return parsedPayload;
    }

    throw new InfrastructureError(`Invalid API response envelope received from ${method} ${url}.`, {
      correlationId: responseCorrelationId,
      details: {
        reason: 'INVALID_RESPONSE_ENVELOPE',
        httpStatus: response.status,
        method,
        url,
      },
    });
  }

  async request<TData, TBody = unknown>(
    path: string,
    options: HttpRequestOptions<TBody> = {},
  ): Promise<TData> {
    const envelope = await this.requestEnvelope<TData, TBody>(path, options);
    return envelope.data;
  }

  async get<TData>(
    path: string,
    options: Omit<HttpRequestOptions<never>, 'method' | 'body'> = {},
  ): Promise<TData> {
    return this.request<TData>(path, { ...options, method: 'GET' });
  }

  async post<TData, TBody = unknown>(
    path: string,
    body?: TBody,
    options: Omit<HttpRequestOptions<TBody>, 'method' | 'body'> = {},
  ): Promise<TData> {
    return this.request<TData, TBody>(path, {
      ...options,
      method: 'POST',
      ...(body !== undefined ? { body } : {}),
    });
  }

  async put<TData, TBody = unknown>(
    path: string,
    body?: TBody,
    options: Omit<HttpRequestOptions<TBody>, 'method' | 'body'> = {},
  ): Promise<TData> {
    return this.request<TData, TBody>(path, {
      ...options,
      method: 'PUT',
      ...(body !== undefined ? { body } : {}),
    });
  }

  async patch<TData, TBody = unknown>(
    path: string,
    body?: TBody,
    options: Omit<HttpRequestOptions<TBody>, 'method' | 'body'> = {},
  ): Promise<TData> {
    return this.request<TData, TBody>(path, {
      ...options,
      method: 'PATCH',
      ...(body !== undefined ? { body } : {}),
    });
  }

  async delete<TData>(
    path: string,
    options: Omit<HttpRequestOptions<never>, 'method' | 'body'> = {},
  ): Promise<TData> {
    return this.request<TData>(path, { ...options, method: 'DELETE' });
  }
}

export function createHttpClient(options: CreateHttpClientOptions = {}): HttpClient {
  return new HttpClient(options);
}
