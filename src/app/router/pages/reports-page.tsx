import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { ProjectListItem } from '@/modules/projects';
import {
  REPORT_KINDS,
  REPORT_PERIOD_PRESETS,
  REPORT_PREVIEW_STATUSES,
  REPORT_SCOPES,
  type ExportReportInput,
  type PreviewReportInput,
  type ReportCatalogCapabilityView,
  type ReportCatalogEntryView,
  type ReportExportState,
  type ReportFilterFormState,
  type ReportPreviewState,
  type ReportProjectOption,
  type ReportsPanelFeedback,
} from '@/modules/reports';
import { ReportsPanel, triggerReportBlobDownload } from '@/modules/reports/presentation';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import { isAppError } from '@/shared/errors';
import type { MessageId } from '@/shared/i18n';
import { asEntityId, asIsoDateTime } from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedReportsState {
  readonly contextKey: string | null;
  readonly rawCatalog: readonly ReportCatalogEntryView[];
  readonly accessibleProjects: readonly ProjectListItem[];
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_REPORTS_STATE: LoadedReportsState = {
  contextKey: null,
  rawCatalog: [],
  accessibleProjects: [],
  settings: null,
  errorMessageId: null,
};

const INITIAL_PREVIEW_STATE: ReportPreviewState = {
  status: REPORT_PREVIEW_STATUSES.IDLE,
  snapshot: null,
};

const INITIAL_EXPORT_STATE: ReportExportState = {
  isExporting: false,
  activeFormat: null,
};

function buildReportProjectResource(project: ProjectListItem) {
  return {
    kind: 'REPORT' as const,
    id: asEntityId(project.id),
    exists: true,
    organizationId: project.organizationId,
    projectId: project.id,
    teamId: project.teamId,
    ownerUserId: project.ownerUserId,
    archivedAt: project.archivedAt,
    projectArchivedAt: project.archivedAt,
    deletedAt: project.deletedAt,
  };
}

export function ReportsPage() {
  const intl = useIntl();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const [filters, setFilters] = useState<ReportFilterFormState>({
    kind: REPORT_KINDS.PROJECT_DELIVERY_FLOW,
    scope: REPORT_SCOPES.PROJECT,
    preset: REPORT_PERIOD_PRESETS.LAST_30_DAYS,
    compareWithPreviousPeriod: true,
  });
  const [previewState, setPreviewState] = useState<ReportPreviewState>(INITIAL_PREVIEW_STATE);
  const [exportState, setExportState] = useState<ReportExportState>(INITIAL_EXPORT_STATE);
  const [feedback, setFeedback] = useState<ReportsPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedReportsState>(INITIAL_REPORTS_STATE);

  const contextKey =
    user !== null && activeOrganization !== null ? `${user.id}:${activeOrganization.id}` : null;

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetKey = contextKey;

    async function loadInitial() {
      try {
        const [catalog, projectsList, persistedSettings] = await Promise.all([
          services.reports.listReportCatalog(actorUserId, targetOrgId),
          services.projects
            .listProjects(actorUserId, targetOrgId, { includeArchived: true })
            .catch(() => []),
          repositories.settings.organizationSettings
            .findByOrganization(targetOrgId)
            .catch(() => null),
        ]);

        if (!isActive) {
          return;
        }

        const effectiveSettings =
          persistedSettings ??
          createDefaultOrganizationSettings(targetOrgId, asIsoDateTime(new Date().toISOString()));

        const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);
        const orgReportResource = {
          kind: 'REPORT' as const,
          id: asEntityId(targetOrgId),
          exists: true,
          organizationId: targetOrgId,
        };
        const canViewOrgReports = can(
          PERMISSION_CODES.REPORT_VIEW,
          orgReportResource,
          policyConfig,
        );
        const authorizedProjects = projectsList.filter((project) =>
          can(PERMISSION_CODES.REPORT_VIEW, buildReportProjectResource(project), policyConfig),
        );

        const preferredEntry =
          catalog.find(
            (entry) =>
              (entry.allowedScopes.includes(REPORT_SCOPES.ORGANIZATION) && canViewOrgReports) ||
              (entry.allowedScopes.includes(REPORT_SCOPES.PROJECT) &&
                authorizedProjects.length > 0),
          ) ?? catalog[0];

        if (preferredEntry !== undefined) {
          const canRunOrg =
            preferredEntry.allowedScopes.includes(REPORT_SCOPES.ORGANIZATION) && canViewOrgReports;
          const canRunProj =
            preferredEntry.allowedScopes.includes(REPORT_SCOPES.PROJECT) &&
            authorizedProjects.length > 0;
          const nextScope = canRunProj
            ? REPORT_SCOPES.PROJECT
            : canRunOrg
              ? REPORT_SCOPES.ORGANIZATION
              : (preferredEntry.allowedScopes[0] ?? REPORT_SCOPES.ORGANIZATION);

          setFilters({
            kind: preferredEntry.kind,
            scope: nextScope,
            ...(nextScope === REPORT_SCOPES.PROJECT && authorizedProjects[0] !== undefined
              ? { projectId: authorizedProjects[0].id }
              : {}),
            preset: REPORT_PERIOD_PRESETS.LAST_30_DAYS,
            compareWithPreviousPeriod: true,
          });
          setPreviewState(INITIAL_PREVIEW_STATE);
          setExportState(INITIAL_EXPORT_STATE);
        }

        setState({
          contextKey: targetKey,
          rawCatalog: catalog,
          accessibleProjects: projectsList,
          settings: effectiveSettings,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          rawCatalog: [],
          accessibleProjects: [],
          settings: null,
          errorMessageId: resolveTaskPageErrorMessageId(error),
        });
      }
    }

    void loadInitial();

    return () => {
      isActive = false;
    };
  }, [
    activeOrganization,
    can,
    contextKey,
    repositories.settings.organizationSettings,
    services.projects,
    services.reports,
    user,
  ]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (activeOrganization === null) {
      document.title = `${intl.formatMessage({ id: 'organizations.title' })} | ${shortName}`;
      return;
    }
    if (loadErrorMessageId !== null) {
      const errorTitleId: MessageId =
        loadErrorMessageId === 'errors.AUTHORIZATION_ERROR'
          ? 'feedback.unauthorizedTitle'
          : loadErrorMessageId;
      document.title = `${intl.formatMessage({ id: errorTitleId })} | ${shortName}`;
      return;
    }
    document.title = intl.formatMessage({ id: 'reports.pageTitle' });
  }, [activeOrganization, intl, loadErrorMessageId]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="reports-no-org-heading" headingText="" />;
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="reports-loading-heading"
        headingText={intl.formatMessage({ id: 'reports.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || state.settings === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="reports-error-heading"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
        backToPath="/projects"
        backLabelId="analytics.backToProjects"
      />
    );
  }

  const policyConfig = toAuthorizationPolicyConfig(state.settings);
  const orgReportResource = {
    kind: 'REPORT' as const,
    id: asEntityId(activeOrganization.id),
    exists: true,
    organizationId: activeOrganization.id,
  };

  const canViewOrgReports = can(PERMISSION_CODES.REPORT_VIEW, orgReportResource, policyConfig);
  const projectOptions: readonly ReportProjectOption[] = state.accessibleProjects
    .filter((project) =>
      can(PERMISSION_CODES.REPORT_VIEW, buildReportProjectResource(project), policyConfig),
    )
    .map((project) => ({
      id: project.id,
      name: project.name,
      isArchived: project.status === 'ARCHIVED' || project.archivedAt !== undefined,
    }));

  const checkExportCapability = (projectId?: ReportProjectOption['id']): boolean => {
    const projectItem =
      projectId !== undefined
        ? state.accessibleProjects.find((item) => item.id === projectId)
        : undefined;
    const reportResource =
      projectItem !== undefined ? buildReportProjectResource(projectItem) : orgReportResource;

    return (
      can(PERMISSION_CODES.REPORT_EXPORT, reportResource, policyConfig) &&
      can(
        PERMISSION_CODES.ANALYTICS_EXPORT,
        {
          ...reportResource,
          kind: 'ANALYTICS',
          includesThirdPartyIndividualMetrics: false,
        },
        policyConfig,
      )
    );
  };

  const catalogCapabilities: readonly ReportCatalogCapabilityView[] = state.rawCatalog.map(
    (entry) => {
      const canRunOrg =
        entry.allowedScopes.includes(REPORT_SCOPES.ORGANIZATION) && canViewOrgReports;
      const canRunProject =
        entry.allowedScopes.includes(REPORT_SCOPES.PROJECT) && projectOptions.length > 0;
      return {
        ...entry,
        canRunInOrganizationScope: canRunOrg,
        canRunInProjectScope: canRunProject,
        canExport:
          (canRunOrg && checkExportCapability(undefined)) ||
          (canRunProject && projectOptions.some((proj) => checkExportCapability(proj.id))),
        showsThirdPartyPrivacyNotice: entry.mayIncludeThirdPartyIndividualMetrics,
      };
    },
  );

  const activeScopeForExport = previewState.snapshot?.scope ?? filters.scope;
  const activeProjectIdForExport =
    activeScopeForExport === REPORT_SCOPES.PROJECT
      ? (previewState.snapshot?.projectId ?? filters.projectId)
      : undefined;

  const canExportSelectedReport =
    activeScopeForExport === REPORT_SCOPES.PROJECT
      ? activeProjectIdForExport !== undefined && checkExportCapability(activeProjectIdForExport)
      : checkExportCapability(undefined);

  const handlePreviewReport = async (input: PreviewReportInput) => {
    setFeedback(null);
    setExportState(INITIAL_EXPORT_STATE);
    setPreviewState((prev) => ({
      status: REPORT_PREVIEW_STATUSES.LOADING,
      snapshot: prev.snapshot,
    }));

    try {
      const snapshot = await services.reports.previewReport(user.id, activeOrganization.id, input);
      setPreviewState({
        status: REPORT_PREVIEW_STATUSES.READY,
        snapshot,
      });
      setAnnouncement(
        intl.formatMessage(
          { id: 'reports.preview.rowCountLabel' },
          { count: snapshot.rows.length },
        ),
      );
    } catch (error) {
      const errorMessage = intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) });
      setPreviewState({
        status: REPORT_PREVIEW_STATUSES.ERROR,
        snapshot: null,
        ...(isAppError(error) ? { errorCode: error.code } : {}),
        errorMessage,
      });
    }
  };

  const handleExportReport = async (input: ExportReportInput) => {
    setFeedback(null);
    setExportState({
      isExporting: true,
      activeFormat: input.format,
    });

    try {
      const result = await services.reports.exportReport(user.id, activeOrganization.id, input);
      triggerReportBlobDownload(result.bytes, result.mimeType, result.fileName);
      const successMessage = intl.formatMessage(
        { id: 'reports.export.success' },
        { fileName: result.fileName, format: result.format },
      );
      setExportState({
        isExporting: false,
        activeFormat: null,
        lastExportedFileName: result.fileName,
        lastExportedFormat: result.format,
        lastExportedAt: result.snapshot.snapshotGeneratedAt,
      });
      setAnnouncement(successMessage);
      setFeedback({ type: 'success', message: successMessage });
    } catch (error) {
      const errorMessage = intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) });
      setExportState({
        isExporting: false,
        activeFormat: null,
        ...(isAppError(error) ? { errorCode: error.code } : {}),
        errorMessage,
      });
      setFeedback({ type: 'destructive', message: errorMessage });
    }
  };

  return (
    <ReportsPanel
      organizationName={activeOrganization.name}
      isDemoOrganization={activeOrganization.isDemo}
      catalog={catalogCapabilities}
      accessibleProjects={projectOptions}
      filters={filters}
      previewState={previewState}
      exportState={exportState}
      canExportSelectedReport={canExportSelectedReport}
      isBusy={exportState.isExporting}
      feedback={feedback}
      announcement={announcement}
      focusHeadingTrigger={`${user.id}:${activeOrganization.id}`}
      onChangeFilters={(nextFilters) => {
        setFeedback(null);
        setFilters(nextFilters);
      }}
      onPreviewReport={handlePreviewReport}
      onExportReport={handleExportReport}
    />
  );
}

export default ReportsPage;
