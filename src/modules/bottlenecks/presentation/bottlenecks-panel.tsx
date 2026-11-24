import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconLayoutKanban,
  IconListCheck,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import type { BottleneckSeverity, ProjectId } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@/shared/ui';
import type {
  BottleneckAlert,
  BottleneckAlertId,
  BottleneckProjectSummary,
  MyWorkloadSummary,
  OrganizationBottleneckAlertsResult,
  ProjectBottlenecksOverview,
  UpdateProjectBottleneckRulesInput,
} from '../application/contracts';
import { BottleneckAlertsSection } from './bottleneck-alerts-section';
import { BottleneckIndicatorsSection } from './bottleneck-indicators-section';
import { BottleneckRulesPanel } from './bottleneck-rules-panel';

const WORKLOAD_BAND_LABEL_ID: Readonly<Record<BottleneckSeverity, MessageId>> = {
  LOW: 'workload.band.LOW',
  MODERATE: 'workload.band.MODERATE',
  HIGH: 'workload.band.HIGH',
  CRITICAL: 'workload.band.CRITICAL',
};

export interface BottleneckPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface BottlenecksPanelProps {
  readonly organizationName: string;
  readonly isProjectRoute: boolean;
  readonly accessibleProjects: readonly BottleneckProjectSummary[];
  readonly selectedProjectId: ProjectId | null;
  readonly projectOverview: ProjectBottlenecksOverview | null;
  readonly organizationAlerts: OrganizationBottleneckAlertsResult | null;
  readonly myWorkload: MyWorkloadSummary | null;
  readonly indicatorFilter: string;
  readonly statusFilter: string;
  readonly includeResolved: boolean;
  readonly canManageRules: boolean;
  readonly canOpenBoard: boolean;
  readonly canViewMemberWorkloads: boolean;
  readonly canManageProductivityVisibility?: boolean;
  readonly allowManagerViewIndividualProductivity?: boolean;
  readonly canManageAlert: (alert: BottleneckAlert) => boolean;
  readonly isBusy: boolean;
  readonly focusHeadingTrigger?: string;
  readonly feedback?: BottleneckPanelFeedback | null;
  readonly announcement?: string;
  readonly onSelectProject: (projectId: string) => void;
  readonly onChangeIndicatorFilter: (indicator: string) => void;
  readonly onChangeStatusFilter: (status: string) => void;
  readonly onChangeIncludeResolved: (includeResolved: boolean) => void;
  readonly onEvaluateProject: (projectId: ProjectId) => Promise<void>;
  readonly onAcknowledgeAlert: (alertId: BottleneckAlertId, note?: string) => Promise<void>;
  readonly onResolveAlert: (alertId: BottleneckAlertId, note?: string) => Promise<void>;
  readonly onSaveRules: (
    projectId: ProjectId,
    input: UpdateProjectBottleneckRulesInput,
  ) => Promise<void>;
}

export function BottlenecksPanel({
  organizationName,
  isProjectRoute,
  accessibleProjects,
  selectedProjectId,
  projectOverview,
  organizationAlerts,
  myWorkload,
  indicatorFilter,
  statusFilter,
  includeResolved,
  canManageRules,
  canOpenBoard,
  canViewMemberWorkloads,
  canManageProductivityVisibility = false,
  allowManagerViewIndividualProductivity = false,
  canManageAlert,
  isBusy,
  focusHeadingTrigger,
  feedback = null,
  announcement = '',
  onSelectProject,
  onChangeIndicatorFilter,
  onChangeStatusFilter,
  onChangeIncludeResolved,
  onEvaluateProject,
  onAcknowledgeAlert,
  onResolveAlert,
  onSaveRules,
}: BottlenecksPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  const projectNameById = new Map<ProjectId, string>();
  for (const project of accessibleProjects) {
    projectNameById.set(project.id, project.name);
  }
  if (projectOverview !== null) {
    projectNameById.set(projectOverview.project.id, projectOverview.project.name);
  }

  const activeProject = projectOverview?.project ?? null;
  const isProjectArchived =
    activeProject !== null &&
    (activeProject.archivedAt !== undefined || activeProject.status === 'ARCHIVED');

  const alertsToDisplay = organizationAlerts?.alerts ?? projectOverview?.activeAlerts ?? [];

  const titleText =
    isProjectRoute && activeProject !== null
      ? intl.formatMessage({ id: 'bottlenecks.project.title' }, { name: activeProject.name })
      : intl.formatMessage({ id: 'bottlenecks.org.title' });

  const subtitleText =
    isProjectRoute && activeProject !== null
      ? intl.formatMessage({ id: 'bottlenecks.project.subtitle' })
      : intl.formatMessage({ id: 'bottlenecks.org.subtitle' });

  return (
    <section aria-labelledby="bottlenecks-heading" className="mx-auto w-full max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'bottlenecks.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconAlertTriangle className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1
            ref={headingRef}
            id="bottlenecks-heading"
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight text-foreground focus:outline-none sm:text-4xl"
          >
            {titleText}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
        </div>
        <p className="text-base text-muted-foreground">{subtitleText}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to="/projects">
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'bottlenecks.project.backToProjects' })}</span>
            </Link>
          </Button>

          {activeProject !== null && canOpenBoard ? (
            <>
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${activeProject.id}/board`}>
                  <IconLayoutKanban className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'bottlenecks.project.openBoardAction' })}</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${activeProject.id}/tasks`}>
                  <IconListCheck className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'bottlenecks.project.openTasksAction' })}</span>
                </Link>
              </Button>
            </>
          ) : null}

          {activeProject !== null && canManageRules && !isProjectArchived ? (
            <Button
              type="button"
              variant="default"
              className="min-h-[44px]"
              disabled={isBusy}
              onClick={() => void onEvaluateProject(activeProject.id)}
            >
              <IconRefresh className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isBusy ? 'bottlenecks.actions.evaluating' : 'bottlenecks.actions.evaluateNow',
                })}
              </span>
            </Button>
          ) : null}
        </div>
      </div>

      {isProjectArchived ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'bottlenecks.archivedLockBanner' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {feedback !== null ? (
        <Alert variant={feedback.type} role={feedback.type === 'destructive' ? 'alert' : 'status'}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      {canManageProductivityVisibility ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <IconSettings className="h-5 w-5 text-primary" aria-hidden="true" />
                <CardTitle>
                  {intl.formatMessage({ id: 'settings.productivityVisibility.title' })}
                </CardTitle>
              </div>
              <CardDescription>
                {intl.formatMessage({ id: 'settings.productivityVisibility.description' })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={allowManagerViewIndividualProductivity ? 'default' : 'secondary'}>
                {intl.formatMessage({
                  id: allowManagerViewIndividualProductivity
                    ? 'settings.productivityVisibility.statusEnabled'
                    : 'settings.productivityVisibility.statusDisabled',
                })}
              </Badge>
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to="/settings">
                  <IconSettings className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'nav.settings' })}</span>
                </Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {!isProjectRoute ? (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="bottlenecks-project-selector">
                {intl.formatMessage({ id: 'bottlenecks.alerts.projectFilterLabel' })}
              </Label>
              <select
                id="bottlenecks-project-selector"
                value={selectedProjectId ?? ''}
                disabled={isBusy}
                onChange={(event) => onSelectProject(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">
                  {intl.formatMessage({ id: 'bottlenecks.alerts.allProjects' })}
                </option>
                {accessibleProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {myWorkload !== null ? (
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IconActivity className="h-5 w-5 text-primary" aria-hidden="true" />
                <CardTitle>{intl.formatMessage({ id: 'workload.title' })}</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={myWorkload.workload.level === 'CRITICAL' ? 'destructive' : 'secondary'}
                >
                  {intl.formatMessage(
                    { id: 'workload.levelLabel' },
                    {
                      band: intl.formatMessage({
                        id: WORKLOAD_BAND_LABEL_ID[myWorkload.workload.level],
                      }),
                    },
                  )}
                </Badge>
                <span className="text-sm font-semibold text-foreground">
                  {intl.formatMessage(
                    { id: 'workload.scoreLabel' },
                    { score: myWorkload.workload.score },
                  )}
                </span>
              </div>
            </div>
            <CardDescription>
              {intl.formatMessage({ id: 'bottlenecks.members.restrictedDescription' })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="info">
              <AlertDescription>
                {intl.formatMessage({ id: 'workload.notHoursNotice' })}
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <p>
                {intl.formatMessage(
                  { id: 'workload.activeTasksCount' },
                  { count: myWorkload.workload.activeTaskCount },
                )}
              </p>
              <p>
                {intl.formatMessage(
                  { id: 'workload.activeSubtasksCount' },
                  { count: myWorkload.workload.activeSubtaskCount },
                )}
              </p>
              <p>
                {intl.formatMessage(
                  { id: 'workload.sharedTasksCount' },
                  { count: myWorkload.breakdown.sharedTaskCount },
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {projectOverview !== null ? (
        <BottleneckIndicatorsSection
          overview={projectOverview}
          canViewMemberWorkloads={canViewMemberWorkloads}
        />
      ) : null}

      <BottleneckAlertsSection
        alerts={alertsToDisplay}
        projectNameById={projectNameById}
        indicatorFilter={indicatorFilter}
        statusFilter={statusFilter}
        includeResolved={includeResolved}
        isBusy={isBusy}
        canManageAlert={canManageAlert}
        onChangeIndicatorFilter={onChangeIndicatorFilter}
        onChangeStatusFilter={onChangeStatusFilter}
        onChangeIncludeResolved={onChangeIncludeResolved}
        onAcknowledgeAlert={onAcknowledgeAlert}
        onResolveAlert={onResolveAlert}
      />

      {projectOverview !== null ? (
        <BottleneckRulesPanel
          inactivityThresholdDays={projectOverview.project.inactivityThresholdDays}
          thresholds={projectOverview.thresholds}
          canManageRules={canManageRules}
          isProjectArchived={isProjectArchived}
          isBusy={isBusy}
          onSaveRules={(input) => onSaveRules(projectOverview.project.id, input)}
        />
      ) : null}
    </section>
  );
}
