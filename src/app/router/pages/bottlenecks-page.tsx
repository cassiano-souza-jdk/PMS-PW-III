import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  BottleneckAlert,
  BottleneckAlertId,
  BottleneckProjectSummary,
  MyWorkloadSummary,
  OrganizationBottleneckAlertsResult,
  ProjectBottlenecksOverview,
  UpdateProjectBottleneckRulesInput,
} from '@/modules/bottlenecks';
import { BottlenecksPanel, type BottleneckPanelFeedback } from '@/modules/bottlenecks/presentation';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type { MessageId } from '@/shared/i18n';
import { asEntityId, asIsoDateTime, asProjectId, isUuid, type ProjectId } from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedBottlenecksState {
  readonly contextKey: string | null;
  readonly accessibleProjects: readonly BottleneckProjectSummary[];
  readonly projectOverview: ProjectBottlenecksOverview | null;
  readonly organizationAlerts: OrganizationBottleneckAlertsResult | null;
  readonly myWorkload: MyWorkloadSummary | null;
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_BOTTLENECKS_STATE: LoadedBottlenecksState = {
  contextKey: null,
  accessibleProjects: [],
  projectOverview: null,
  organizationAlerts: null,
  myWorkload: null,
  settings: null,
  errorMessageId: null,
};

function buildBottleneckProjectResource(project: BottleneckProjectSummary) {
  return {
    kind: 'BOTTLENECK' as const,
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

export function BottlenecksPage() {
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

  const [selectedOrgProjectId, setSelectedOrgProjectId] = useState<string>('');
  const [indicatorFilter, setIndicatorFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [includeResolved, setIncludeResolved] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<BottleneckPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedBottlenecksState>(INITIAL_BOTTLENECKS_STATE);

  const effectiveSelectedProjectId: ProjectId | null = isProjectRoute
    ? validRouteProjectId
    : selectedOrgProjectId !== '' && isUuid(selectedOrgProjectId)
      ? asProjectId(selectedOrgProjectId, 'projectId')
      : null;

  const contextKey =
    user !== null &&
    activeOrganization !== null &&
    (!isProjectRoute || validRouteProjectId !== null)
      ? `${user.id}:${activeOrganization.id}:${effectiveSelectedProjectId ?? 'org'}:${includeResolved ? 'resolved' : 'active'}`
      : null;

  const fetchBottlenecksBundle = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;

    const [projectsList, persistedSettings, alertsResult, overviewResult, workloadResult] =
      await Promise.all([
        services.projects
          .listProjects(actorUserId, targetOrgId, { includeArchived: true })
          .catch(() => []),
        repositories.settings.organizationSettings
          .findByOrganization(targetOrgId)
          .catch(() => null),
        services.bottlenecks.listOrganizationAlerts(actorUserId, targetOrgId, {
          ...(effectiveSelectedProjectId !== null ? { projectId: effectiveSelectedProjectId } : {}),
          includeResolved,
        }),
        effectiveSelectedProjectId !== null
          ? services.bottlenecks.getProjectBottlenecksOverview(
              actorUserId,
              targetOrgId,
              effectiveSelectedProjectId,
            )
          : Promise.resolve(null),
        !isProjectRoute
          ? services.bottlenecks.getMyWorkloadSummary(actorUserId, targetOrgId).catch(() => null)
          : Promise.resolve(null),
      ]);

    const effectiveSettings =
      persistedSettings ??
      createDefaultOrganizationSettings(targetOrgId, asIsoDateTime(new Date().toISOString()));

    setState({
      contextKey,
      accessibleProjects: projectsList,
      projectOverview: overviewResult,
      organizationAlerts: alertsResult,
      myWorkload: workloadResult,
      settings: effectiveSettings,
      errorMessageId: null,
    });
  }, [
    activeOrganization,
    contextKey,
    effectiveSelectedProjectId,
    includeResolved,
    isProjectRoute,
    repositories.settings.organizationSettings,
    services.bottlenecks,
    services.projects,
    user,
  ]);

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
        const [projectsList, persistedSettings, alertsResult, overviewResult, workloadResult] =
          await Promise.all([
            services.projects
              .listProjects(actorUserId, targetOrgId, { includeArchived: true })
              .catch(() => []),
            repositories.settings.organizationSettings
              .findByOrganization(targetOrgId)
              .catch(() => null),
            services.bottlenecks.listOrganizationAlerts(actorUserId, targetOrgId, {
              ...(effectiveSelectedProjectId !== null
                ? { projectId: effectiveSelectedProjectId }
                : {}),
              includeResolved,
            }),
            effectiveSelectedProjectId !== null
              ? services.bottlenecks.getProjectBottlenecksOverview(
                  actorUserId,
                  targetOrgId,
                  effectiveSelectedProjectId,
                )
              : Promise.resolve(null),
            !isProjectRoute
              ? services.bottlenecks
                  .getMyWorkloadSummary(actorUserId, targetOrgId)
                  .catch(() => null)
              : Promise.resolve(null),
          ]);

        if (!isActive) {
          return;
        }

        const effectiveSettings =
          persistedSettings ??
          createDefaultOrganizationSettings(targetOrgId, asIsoDateTime(new Date().toISOString()));

        setState({
          contextKey: targetKey,
          accessibleProjects: projectsList,
          projectOverview: overviewResult,
          organizationAlerts: alertsResult,
          myWorkload: workloadResult,
          settings: effectiveSettings,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          accessibleProjects: [],
          projectOverview: null,
          organizationAlerts: null,
          myWorkload: null,
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
    contextKey,
    effectiveSelectedProjectId,
    includeResolved,
    isProjectRoute,
    repositories.settings.organizationSettings,
    services.bottlenecks,
    services.projects,
    user,
  ]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;
  const projectOverview = isCurrentContext ? state.projectOverview : null;

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
    if (isProjectRoute && projectOverview !== null) {
      document.title = intl.formatMessage(
        { id: 'bottlenecks.project.pageTitle' },
        { name: projectOverview.project.name },
      );
      return;
    }
    document.title = intl.formatMessage({ id: 'bottlenecks.org.pageTitle' });
  }, [
    activeOrganization,
    intl,
    isProjectRoute,
    loadErrorMessageId,
    projectOverview,
    validRouteProjectId,
  ]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return (
      <TaskPageStatusView kind="no-org" headingId="bottlenecks-no-org-heading" headingText="" />
    );
  }

  if (isProjectRoute && validRouteProjectId === null) {
    return (
      <TaskPageStatusView
        kind="error"
        headingId="bottlenecks-invalid-id-heading"
        headingText={intl.formatMessage({ id: 'errors.NOT_FOUND' })}
        descriptionText={intl.formatMessage({ id: 'validation.uuidInvalid' })}
        backToPath="/projects"
        backLabelId="bottlenecks.project.backToProjects"
      />
    );
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="bottlenecks-loading-heading"
        headingText={intl.formatMessage({ id: 'bottlenecks.org.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || state.settings === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="bottlenecks-error-heading"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
        backToPath="/projects"
        backLabelId="bottlenecks.project.backToProjects"
      />
    );
  }

  const policyConfig = toAuthorizationPolicyConfig(state.settings);
  const projectById = new Map<ProjectId, BottleneckProjectSummary>();
  for (const project of state.accessibleProjects) {
    projectById.set(project.id, project);
  }
  if (projectOverview !== null) {
    projectById.set(projectOverview.project.id, projectOverview.project);
  }

  const activeProject = projectOverview?.project ?? null;
  const activeProjectResource =
    activeProject !== null ? buildBottleneckProjectResource(activeProject) : undefined;

  const canManageRules =
    activeProjectResource !== undefined &&
    can(PERMISSION_CODES.BOTTLENECK_RULES_MANAGE, activeProjectResource, policyConfig);

  const canOpenBoard =
    activeProjectResource !== undefined &&
    can(PERMISSION_CODES.BOARD_VIEW, { ...activeProjectResource, kind: 'BOARD' }, policyConfig);

  const canViewMemberWorkloads =
    activeProjectResource !== undefined &&
    can(
      PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
      {
        ...activeProjectResource,
        kind: 'ANALYTICS',
        includesThirdPartyIndividualMetrics: true,
      },
      policyConfig,
    );

  const canManageProductivityVisibility = can(
    PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
    {
      kind: 'ORGANIZATION',
      id: asEntityId(activeOrganization.id),
      exists: true,
      organizationId: activeOrganization.id,
    },
    policyConfig,
  );

  const canManageAlert = (alert: BottleneckAlert): boolean => {
    if (alert.projectId === undefined) {
      return can(
        PERMISSION_CODES.BOTTLENECK_RULES_MANAGE,
        {
          kind: 'BOTTLENECK',
          id: asEntityId(alert.id),
          exists: true,
          organizationId: activeOrganization.id,
        },
        policyConfig,
      );
    }

    const alertProject = projectById.get(alert.projectId);
    if (alertProject === undefined) {
      return false;
    }
    if (alertProject.archivedAt !== undefined || alertProject.status === 'ARCHIVED') {
      return false;
    }

    return can(
      PERMISSION_CODES.BOTTLENECK_RULES_MANAGE,
      buildBottleneckProjectResource(alertProject),
      policyConfig,
    );
  };

  const runMutation = async (mutate: () => Promise<string>) => {
    setFeedback(null);
    setIsBusy(true);
    try {
      const successMessage = await mutate();
      await fetchBottlenecksBundle();
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

  const handleEvaluateProject = async (projectId: ProjectId) => {
    await runMutation(async () => {
      const result = await services.bottlenecks.evaluateProjectBottlenecks(
        user.id,
        activeOrganization.id,
        projectId,
      );
      return intl.formatMessage(
        { id: 'bottlenecks.actions.evaluateSuccess' },
        { count: result.alerts.length },
      );
    });
  };

  const handleAcknowledgeAlert = async (alertId: BottleneckAlertId) => {
    await runMutation(async () => {
      await services.bottlenecks.acknowledgeAlert(user.id, activeOrganization.id, alertId);
      return intl.formatMessage({ id: 'bottlenecks.actions.acknowledgeSuccess' });
    });
  };

  const handleResolveAlert = async (alertId: BottleneckAlertId) => {
    await runMutation(async () => {
      await services.bottlenecks.resolveAlert(user.id, activeOrganization.id, alertId);
      return intl.formatMessage({ id: 'bottlenecks.actions.resolveSuccess' });
    });
  };

  const handleSaveRules = async (
    projectId: ProjectId,
    input: UpdateProjectBottleneckRulesInput,
  ) => {
    await runMutation(async () => {
      await services.bottlenecks.updateProjectBottleneckRules(
        user.id,
        activeOrganization.id,
        projectId,
        input,
      );
      return intl.formatMessage({ id: 'bottlenecks.rules.saveSuccess' });
    });
  };

  return (
    <BottlenecksPanel
      organizationName={activeOrganization.name}
      isProjectRoute={isProjectRoute}
      accessibleProjects={state.accessibleProjects}
      selectedProjectId={effectiveSelectedProjectId}
      projectOverview={projectOverview}
      organizationAlerts={state.organizationAlerts}
      myWorkload={state.myWorkload}
      indicatorFilter={indicatorFilter}
      statusFilter={statusFilter}
      includeResolved={includeResolved}
      canManageRules={canManageRules}
      canOpenBoard={canOpenBoard}
      canViewMemberWorkloads={canViewMemberWorkloads}
      canManageProductivityVisibility={canManageProductivityVisibility}
      allowManagerViewIndividualProductivity={
        state.settings.pendingPermissionDefaults.allowManagerViewIndividualProductivity
      }
      canManageAlert={canManageAlert}
      isBusy={isBusy}
      focusHeadingTrigger={`${user.id}:${activeOrganization.id}:${validRouteProjectId ?? 'org'}`}
      feedback={feedback}
      announcement={announcement}
      onSelectProject={(nextProjectId) => {
        setFeedback(null);
        setSelectedOrgProjectId(nextProjectId);
      }}
      onChangeIndicatorFilter={setIndicatorFilter}
      onChangeStatusFilter={setStatusFilter}
      onChangeIncludeResolved={setIncludeResolved}
      onEvaluateProject={handleEvaluateProject}
      onAcknowledgeAlert={handleAcknowledgeAlert}
      onResolveAlert={handleResolveAlert}
      onSaveRules={handleSaveRules}
    />
  );
}

export default BottlenecksPage;
