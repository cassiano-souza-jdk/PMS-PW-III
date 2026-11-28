import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import {
  ANALYTICS_PERIOD_PRESETS,
  DASHBOARD_SCOPES,
  type AnalyticsCalibrationSettingsView,
  type AnalyticsOverview,
  type AnalyticsPanelFeedback,
  type AnalyticsPeriodPreset,
  type AnalyticsProjectOption,
  type DashboardPreferenceResult,
  type DashboardScope,
  type DashboardWidgetConfig,
  type UpdateCalibrationSettingsInput,
} from '@/modules/analytics';
import { AnalyticsPanel } from '@/modules/analytics/presentation';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { ProjectListItem } from '@/modules/projects';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type { MessageId } from '@/shared/i18n';
import {
  asEntityId,
  asIsoDateTime,
  asProjectId,
  isUuid,
  type DateRange,
  type ProjectId,
} from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedAnalyticsState {
  readonly contextKey: string | null;
  readonly accessibleProjects: readonly ProjectListItem[];
  readonly overview: AnalyticsOverview | null;
  readonly preferenceResult: DashboardPreferenceResult | null;
  readonly calibrationSettings: AnalyticsCalibrationSettingsView | null;
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_ANALYTICS_STATE: LoadedAnalyticsState = {
  contextKey: null,
  accessibleProjects: [],
  overview: null,
  preferenceResult: null,
  calibrationSettings: null,
  settings: null,
  errorMessageId: null,
};

function buildAnalyticsProjectResource(project: ProjectListItem) {
  return {
    kind: 'ANALYTICS' as const,
    id: asEntityId(project.id),
    exists: true,
    organizationId: project.organizationId,
    projectId: project.id,
    teamId: project.teamId,
    ownerUserId: project.ownerUserId,
    archivedAt: project.archivedAt,
    projectArchivedAt: project.archivedAt,
    deletedAt: project.deletedAt,
    includesThirdPartyIndividualMetrics: false,
  };
}

export function AnalyticsPage() {
  const intl = useIntl();
  const { projectId: routeProjectIdParam } = useParams<{ readonly projectId?: string }>();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const isProjectRoute = routeProjectIdParam !== undefined;
  const validRouteProjectId: ProjectId | null =
    routeProjectIdParam !== undefined && isUuid(routeProjectIdParam)
      ? asProjectId(routeProjectIdParam, 'projectId')
      : null;

  const [selectedScope, setSelectedScope] = useState<DashboardScope | null>(null);
  const [selectedOrgProjectId, setSelectedOrgProjectId] = useState<string>('');
  const [preset, setPreset] = useState<AnalyticsPeriodPreset>(
    ANALYTICS_PERIOD_PRESETS.LAST_30_DAYS,
  );
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [compareWithPreviousPeriod, setCompareWithPreviousPeriod] = useState<boolean>(true);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<AnalyticsPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedAnalyticsState>(INITIAL_ANALYTICS_STATE);

  const canPersonalInitial =
    user !== null &&
    activeOrganization !== null &&
    can(PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW, {
      kind: 'ANALYTICS',
      id: asEntityId(user.id),
      exists: true,
      organizationId: activeOrganization.id,
      ownerUserId: user.id,
    });

  const canOrgInitial =
    activeOrganization !== null &&
    can(PERMISSION_CODES.ANALYTICS_ORGANIZATION_VIEW, {
      kind: 'ANALYTICS',
      id: asEntityId(activeOrganization.id),
      exists: true,
      organizationId: activeOrganization.id,
    });

  const activeScope: DashboardScope = isProjectRoute
    ? DASHBOARD_SCOPES.PROJECT
    : (selectedScope ??
      (canPersonalInitial
        ? DASHBOARD_SCOPES.PERSONAL
        : canOrgInitial
          ? DASHBOARD_SCOPES.ORGANIZATION
          : DASHBOARD_SCOPES.PROJECT));

  const effectiveSelectedProjectId: ProjectId | null = isProjectRoute
    ? validRouteProjectId
    : selectedOrgProjectId !== '' && isUuid(selectedOrgProjectId)
      ? asProjectId(selectedOrgProjectId, 'projectId')
      : null;

  const customRangeKey =
    preset === ANALYTICS_PERIOD_PRESETS.CUSTOM && customRange !== undefined
      ? `${customRange.start}:${customRange.end}`
      : 'preset';

  const contextKey =
    user !== null &&
    activeOrganization !== null &&
    (!isProjectRoute || validRouteProjectId !== null)
      ? `${user.id}:${activeOrganization.id}:${activeScope}:${effectiveSelectedProjectId ?? 'none'}:${preset}:${customRangeKey}:${compareWithPreviousPeriod ? 'cmp' : 'nocmp'}`
      : null;

  const loadAnalyticsBundle = useCallback(async (): Promise<
    Omit<LoadedAnalyticsState, 'contextKey'>
  > => {
    if (user === null || activeOrganization === null) {
      return {
        accessibleProjects: [],
        overview: null,
        preferenceResult: null,
        calibrationSettings: null,
        settings: null,
        errorMessageId: null,
      };
    }

    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;

    const [projectsList, persistedSettings] = await Promise.all([
      services.projects
        .listProjects(actorUserId, targetOrgId, { includeArchived: true })
        .catch(() => []),
      repositories.settings.organizationSettings.findByOrganization(targetOrgId).catch(() => null),
    ]);

    const effectiveSettings =
      persistedSettings ??
      createDefaultOrganizationSettings(targetOrgId, asIsoDateTime(new Date().toISOString()));
    const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

    const canManageCalibration =
      activeOrganization.role === 'ADMIN' &&
      can(
        PERMISSION_CODES.ANALYTICS_RULES_MANAGE,
        {
          kind: 'ORGANIZATION',
          id: asEntityId(targetOrgId),
          exists: true,
          organizationId: targetOrgId,
        },
        policyConfig,
      );

    const resolvedProjectId: ProjectId | undefined =
      activeScope === DASHBOARD_SCOPES.PROJECT
        ? (effectiveSelectedProjectId ?? projectsList[0]?.id)
        : undefined;

    const shouldFetchScopeOverview =
      activeScope !== DASHBOARD_SCOPES.PROJECT || resolvedProjectId !== undefined;

    const [overviewResult, preferenceResult, calibrationResult] = await Promise.all([
      shouldFetchScopeOverview
        ? services.analytics.getAnalyticsOverview(actorUserId, targetOrgId, {
            scope: activeScope,
            ...(resolvedProjectId !== undefined ? { projectId: resolvedProjectId } : {}),
            preset,
            ...(preset === ANALYTICS_PERIOD_PRESETS.CUSTOM && customRange !== undefined
              ? { customRange }
              : {}),
            compareWithPreviousPeriod,
          })
        : Promise.resolve(null),
      shouldFetchScopeOverview
        ? services.analytics.getDashboardPreference(actorUserId, targetOrgId, {
            scope: activeScope,
            ...(resolvedProjectId !== undefined ? { projectId: resolvedProjectId } : {}),
          })
        : Promise.resolve(null),
      canManageCalibration
        ? services.analytics.getCalibrationSettings(actorUserId, targetOrgId).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      accessibleProjects: projectsList,
      overview: overviewResult,
      preferenceResult,
      calibrationSettings: calibrationResult,
      settings: effectiveSettings,
      errorMessageId: null,
    };
  }, [
    activeOrganization,
    activeScope,
    can,
    compareWithPreviousPeriod,
    customRange,
    effectiveSelectedProjectId,
    preset,
    repositories.settings.organizationSettings,
    services.analytics,
    services.projects,
    user,
  ]);

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const targetKey = contextKey;

    async function loadInitial() {
      try {
        const bundle = await loadAnalyticsBundle();
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          ...bundle,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          accessibleProjects: [],
          overview: null,
          preferenceResult: null,
          calibrationSettings: null,
          settings: null,
          errorMessageId: resolveTaskPageErrorMessageId(error),
        });
      }
    }

    void loadInitial();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, contextKey, loadAnalyticsBundle, user]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;
  const overview = isCurrentContext ? state.overview : null;

  const projectForTitle =
    isProjectRoute && validRouteProjectId !== null
      ? (state.accessibleProjects.find((project) => project.id === validRouteProjectId) ?? null)
      : null;

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (activeOrganization === null) {
      document.title = `${intl.formatMessage({ id: 'organizations.title' })} | ${shortName}`;
      return;
    }
    if (isProjectRoute && validRouteProjectId === null) {
      document.title = `${intl.formatMessage({ id: 'errors.NOT_FOUND' })} | ${shortName}`;
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
    if (isProjectRoute && projectForTitle !== null) {
      document.title = intl.formatMessage(
        { id: 'analytics.projectPage.pageTitle' },
        { name: projectForTitle.name },
      );
      return;
    }
    document.title = intl.formatMessage({ id: 'analytics.pageTitle' });
  }, [
    activeOrganization,
    intl,
    isProjectRoute,
    loadErrorMessageId,
    projectForTitle,
    validRouteProjectId,
  ]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="analytics-no-org-heading" headingText="" />;
  }

  if (isProjectRoute && validRouteProjectId === null) {
    return (
      <TaskPageStatusView
        kind="error"
        headingId="analytics-invalid-id-heading"
        headingText={intl.formatMessage({ id: 'errors.NOT_FOUND' })}
        descriptionText={intl.formatMessage({ id: 'validation.uuidInvalid' })}
        backToPath="/projects"
        backLabelId="analytics.backToProjects"
      />
    );
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="analytics-loading-heading"
        headingText={intl.formatMessage({ id: 'analytics.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || state.settings === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="analytics-error-heading"
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
  const projectOptions: readonly AnalyticsProjectOption[] = state.accessibleProjects
    .filter((project) =>
      can(
        PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
        buildAnalyticsProjectResource(project),
        policyConfig,
      ),
    )
    .map((project) => ({
      id: project.id,
      name: project.name,
      isArchived: project.status === 'ARCHIVED' || project.archivedAt !== undefined,
    }));

  const resolvedSelectedProjectId: ProjectId | null =
    activeScope === DASHBOARD_SCOPES.PROJECT
      ? (effectiveSelectedProjectId ?? projectOptions[0]?.id ?? null)
      : null;

  const canPersonal = can(
    PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW,
    {
      kind: 'ANALYTICS',
      id: asEntityId(user.id),
      exists: true,
      organizationId: activeOrganization.id,
      ownerUserId: user.id,
    },
    policyConfig,
  );
  const canProject = projectOptions.length > 0;
  const canOrg = can(
    PERMISSION_CODES.ANALYTICS_ORGANIZATION_VIEW,
    {
      kind: 'ANALYTICS',
      id: asEntityId(activeOrganization.id),
      exists: true,
      organizationId: activeOrganization.id,
    },
    policyConfig,
  );

  const allowedScopes: DashboardScope[] = [];
  if (canPersonal) {
    allowedScopes.push(DASHBOARD_SCOPES.PERSONAL);
  }
  if (canProject) {
    allowedScopes.push(DASHBOARD_SCOPES.PROJECT);
  }
  if (canOrg) {
    allowedScopes.push(DASHBOARD_SCOPES.ORGANIZATION);
  }

  const canManageCalibration =
    activeOrganization.role === 'ADMIN' &&
    can(
      PERMISSION_CODES.ANALYTICS_RULES_MANAGE,
      {
        kind: 'ORGANIZATION',
        id: asEntityId(activeOrganization.id),
        exists: true,
        organizationId: activeOrganization.id,
      },
      policyConfig,
    );

  const canViewReports =
    can(
      PERMISSION_CODES.REPORT_VIEW,
      {
        kind: 'REPORT',
        id: asEntityId(activeOrganization.id),
        exists: true,
        organizationId: activeOrganization.id,
      },
      policyConfig,
    ) ||
    state.accessibleProjects.some((project) =>
      can(
        PERMISSION_CODES.REPORT_VIEW,
        {
          ...buildAnalyticsProjectResource(project),
          kind: 'REPORT',
        },
        policyConfig,
      ),
    );

  const selectedProjectItem =
    resolvedSelectedProjectId !== null
      ? (state.accessibleProjects.find((project) => project.id === resolvedSelectedProjectId) ??
        null)
      : null;

  const canOpenBoard =
    selectedProjectItem !== null &&
    can(
      PERMISSION_CODES.BOARD_VIEW,
      {
        ...buildAnalyticsProjectResource(selectedProjectItem),
        kind: 'BOARD',
      },
      policyConfig,
    );

  const runMutation = async (mutate: () => Promise<string>) => {
    if (contextKey === null) {
      return;
    }
    setFeedback(null);
    setIsBusy(true);
    try {
      const successMessage = await mutate();
      const refreshed = await loadAnalyticsBundle();
      setState({
        contextKey,
        ...refreshed,
      });
      setAnnouncement(successMessage);
      setFeedback({ type: 'success', message: successMessage });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSavePreference = async (widgets: readonly DashboardWidgetConfig[]) => {
    const scopeProjectId =
      activeScope === DASHBOARD_SCOPES.PROJECT
        ? (resolvedSelectedProjectId ?? undefined)
        : undefined;
    await runMutation(async () => {
      await services.analytics.saveDashboardPreference(user.id, activeOrganization.id, {
        scope: activeScope,
        ...(scopeProjectId !== undefined ? { projectId: scopeProjectId } : {}),
        widgets,
      });
      return intl.formatMessage({ id: 'analytics.dashboard.saveSuccess' });
    });
  };

  const handleResetPreference = async () => {
    const scopeProjectId =
      activeScope === DASHBOARD_SCOPES.PROJECT
        ? (resolvedSelectedProjectId ?? undefined)
        : undefined;
    await runMutation(async () => {
      await services.analytics.resetDashboardPreference(user.id, activeOrganization.id, {
        scope: activeScope,
        ...(scopeProjectId !== undefined ? { projectId: scopeProjectId } : {}),
      });
      return intl.formatMessage({ id: 'analytics.dashboard.restoreSuccess' });
    });
  };

  const handleSaveCalibration = async (input: UpdateCalibrationSettingsInput) => {
    await runMutation(async () => {
      await services.analytics.updateCalibrationSettings(user.id, activeOrganization.id, input);
      return intl.formatMessage({ id: 'analytics.calibration.saveSuccess' });
    });
  };

  return (
    <AnalyticsPanel
      organizationName={activeOrganization.name}
      isDemoOrganization={activeOrganization.isDemo}
      isProjectRoute={isProjectRoute}
      allowedScopes={allowedScopes}
      activeScope={activeScope}
      accessibleProjects={projectOptions}
      selectedProjectId={resolvedSelectedProjectId}
      preset={preset}
      customRange={customRange}
      compareWithPreviousPeriod={compareWithPreviousPeriod}
      overview={overview}
      preferenceResult={isCurrentContext ? state.preferenceResult : null}
      calibrationSettings={isCurrentContext ? state.calibrationSettings : null}
      canManageCalibration={canManageCalibration}
      canViewReports={canViewReports}
      canOpenBoard={canOpenBoard}
      isBusy={isBusy}
      feedback={feedback}
      announcement={announcement}
      focusHeadingTrigger={`${user.id}:${activeOrganization.id}:${validRouteProjectId ?? 'global'}`}
      onChangeScope={(nextScope) => {
        setFeedback(null);
        setSelectedScope(nextScope);
      }}
      onSelectProject={(nextProjectId) => {
        setFeedback(null);
        setSelectedOrgProjectId(nextProjectId);
      }}
      onChangePreset={(nextPreset, nextCustomRange) => {
        setFeedback(null);
        setPreset(nextPreset);
        if (nextPreset === ANALYTICS_PERIOD_PRESETS.CUSTOM && nextCustomRange !== undefined) {
          setCustomRange(nextCustomRange);
        } else if (nextPreset !== ANALYTICS_PERIOD_PRESETS.CUSTOM) {
          setCustomRange(undefined);
        }
      }}
      onChangeCompare={(nextCompare) => {
        setFeedback(null);
        setCompareWithPreviousPeriod(nextCompare);
      }}
      onSaveDashboardPreference={handleSavePreference}
      onResetDashboardPreference={handleResetPreference}
      onSaveCalibrationSettings={handleSaveCalibration}
    />
  );
}

export default AnalyticsPage;
