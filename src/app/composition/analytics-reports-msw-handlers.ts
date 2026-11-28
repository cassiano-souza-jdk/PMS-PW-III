import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  AnalyticsPeriodPreset,
  DashboardScope,
  SaveDashboardPreferenceInput,
  UpdateCalibrationSettingsInput,
} from '@/modules/analytics';
import type { ExportReportInput, PreviewReportInput } from '@/modules/reports';
import { ValidationError } from '@/shared/errors';
import { HTTP_HEADERS } from '@/shared/http';
import {
  asCorrelationId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  isUuid,
  type IsoDateTime,
  type UserId,
} from '@/shared/kernel';
import type { AppServicesRegistry } from './container';

export interface AnalyticsReportsMswHandlerContext {
  readonly services: AppServicesRegistry;
  readonly withSimulatedEndpoint: (
    handler: (context: {
      readonly request: Request;
      readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
      readonly correlationId: string;
      readonly now: IsoDateTime;
      readonly nextUuid: () => string;
    }) => Promise<Response>,
  ) => ({
    request,
    params,
  }: {
    readonly request: Request;
    readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
  }) => Promise<Response>;
  readonly requireActorUserId: (request: Request) => UserId;
  readonly buildSuccessResponse: <TData>(
    data: TData,
    correlationId: string,
    timestamp: IsoDateTime,
    status?: number,
  ) => Response;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseAnalyticsQueryParams(
  url: URL,
  explicitProjectId?: string,
): {
  readonly scope: DashboardScope;
  readonly projectId?: ReturnType<typeof asProjectId>;
  readonly preset?: AnalyticsPeriodPreset;
  readonly customRange?: { readonly start: IsoDateTime; readonly end: IsoDateTime };
  readonly compareWithPreviousPeriod?: boolean;
} {
  const rawProjectId = explicitProjectId ?? url.searchParams.get('projectId')?.trim();
  const rawScope = url.searchParams.get('scope')?.trim();
  const rawPreset = url.searchParams.get('preset')?.trim();
  const rawStart = url.searchParams.get('start')?.trim();
  const rawEnd = url.searchParams.get('end')?.trim();
  const rawCompare = url.searchParams.get('compareWithPreviousPeriod')?.trim();

  const scope = (
    explicitProjectId !== undefined
      ? 'PROJECT'
      : (rawScope ?? (rawProjectId ? 'PROJECT' : 'PERSONAL'))
  ) as DashboardScope;

  if (
    (rawStart !== undefined && rawEnd === undefined) ||
    (rawStart === undefined && rawEnd !== undefined)
  ) {
    throw new ValidationError(
      'Both "start" and "end" query parameters are required for custom range.',
    );
  }

  return {
    scope,
    ...(rawProjectId ? { projectId: asProjectId(rawProjectId, 'projectId') } : {}),
    ...(rawPreset ? { preset: rawPreset as AnalyticsPeriodPreset } : {}),
    ...(rawStart !== undefined && rawEnd !== undefined
      ? {
          customRange: {
            start: asIsoDateTime(rawStart, 'start'),
            end: asIsoDateTime(rawEnd, 'end'),
          },
        }
      : {}),
    ...(rawCompare === 'true'
      ? { compareWithPreviousPeriod: true }
      : rawCompare === 'false'
        ? { compareWithPreviousPeriod: false }
        : {}),
  };
}

export function createAnalyticsAndReportsMswHandlers(
  ctx: AnalyticsReportsMswHandlerContext,
): readonly HttpHandler[] {
  const { services, withSimulatedEndpoint, requireActorUserId, buildSuccessResponse } = ctx;

  return [
    // -------------------------------------------------------------------------
    // Phase 10 — Analytics, Dashboard Preferences, Calibration & Reports
    // -------------------------------------------------------------------------
    http.get(
      '*/api/v1/organizations/:organizationId/analytics',
      withSimulatedEndpoint(async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const query = parseAnalyticsQueryParams(new URL(request.url));

        const overview = await services.analytics.getAnalyticsOverview(
          actorUserId,
          organizationId,
          query,
        );
        return buildSuccessResponse(overview, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/projects/:projectId/analytics',
      withSimulatedEndpoint(async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const query = parseAnalyticsQueryParams(
          new URL(request.url),
          String(params.projectId ?? ''),
        );

        const overview = await services.analytics.getAnalyticsOverview(
          actorUserId,
          organizationId,
          query,
        );
        return buildSuccessResponse(overview, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/dashboard-preferences',
      withSimulatedEndpoint(async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const url = new URL(request.url);
        const rawProjectId = url.searchParams.get('projectId')?.trim();
        const rawScope = url.searchParams.get('scope')?.trim();
        const scope = (rawScope ?? (rawProjectId ? 'PROJECT' : 'PERSONAL')) as DashboardScope;

        const preference = await services.analytics.getDashboardPreference(
          actorUserId,
          organizationId,
          {
            scope,
            ...(rawProjectId ? { projectId: asProjectId(rawProjectId, 'projectId') } : {}),
          },
        );
        return buildSuccessResponse(preference, correlationId, now, 200);
      }),
    ),

    http.put(
      '*/api/v1/organizations/:organizationId/dashboard-preferences',
      withSimulatedEndpoint(async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as SaveDashboardPreferenceInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for dashboard preference save.');
        }

        const saved = await services.analytics.saveDashboardPreference(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(saved, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/dashboard-preferences/reset',
      withSimulatedEndpoint(async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as {
          readonly scope?: DashboardScope;
          readonly projectId?: string;
        } | null;
        if (!rawBody || typeof rawBody !== 'object' || rawBody.scope === undefined) {
          throw new ValidationError('Invalid JSON body for dashboard preference reset.');
        }

        const reset = await services.analytics.resetDashboardPreference(
          actorUserId,
          organizationId,
          {
            scope: rawBody.scope,
            ...(rawBody.projectId !== undefined
              ? { projectId: asProjectId(rawBody.projectId, 'projectId') }
              : {}),
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(reset, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/settings/analytics-rules',
      withSimulatedEndpoint(async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const settings = await services.analytics.getCalibrationSettings(
          actorUserId,
          organizationId,
        );
        return buildSuccessResponse(settings, correlationId, now, 200);
      }),
    ),

    http.patch(
      '*/api/v1/organizations/:organizationId/settings/analytics-rules',
      withSimulatedEndpoint(async ({ request, params, correlationId, now, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request
          .json()
          .catch(() => null)) as UpdateCalibrationSettingsInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for analytics calibration update.');
        }

        const updated = await services.analytics.updateCalibrationSettings(
          actorUserId,
          organizationId,
          {
            ...rawBody,
            correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
          },
        );
        return buildSuccessResponse(updated, correlationId, now, 200);
      }),
    ),

    http.get(
      '*/api/v1/organizations/:organizationId/reports/catalog',
      withSimulatedEndpoint(async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );

        const catalog = await services.reports.listReportCatalog(actorUserId, organizationId);
        return buildSuccessResponse(catalog, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/reports/preview',
      withSimulatedEndpoint(async ({ request, params, correlationId, now }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as PreviewReportInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for report preview.');
        }

        const snapshot = await services.reports.previewReport(actorUserId, organizationId, rawBody);
        return buildSuccessResponse(snapshot, correlationId, now, 200);
      }),
    ),

    http.post(
      '*/api/v1/organizations/:organizationId/reports/export',
      withSimulatedEndpoint(async ({ request, params, correlationId, nextUuid }) => {
        const actorUserId = requireActorUserId(request);
        const organizationId = asOrganizationId(
          String(params.organizationId ?? ''),
          'organizationId',
        );
        const rawBody = (await request.json().catch(() => null)) as ExportReportInput | null;
        if (!rawBody || typeof rawBody !== 'object') {
          throw new ValidationError('Invalid JSON body for report export.');
        }

        const exported = await services.reports.exportReport(actorUserId, organizationId, {
          ...rawBody,
          correlationId: asCorrelationId(isUuid(correlationId) ? correlationId : nextUuid()),
        });

        return HttpResponse.arrayBuffer(toExactArrayBuffer(exported.bytes), {
          status: 200,
          headers: {
            'content-type': exported.mimeType,
            'content-disposition': `attachment; filename="${exported.fileName}"`,
            [HTTP_HEADERS.CORRELATION_ID]: correlationId,
          },
        });
      }),
    ),
  ];
}
