import {
  IconActivity,
  IconAlertCircle,
  IconClockExclamation,
  IconColumns3,
  IconExternalLink,
  IconLock,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import type { BottleneckSeverity } from '@/shared/kernel';
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
} from '@/shared/ui';
import type {
  BottleneckTaskSummaryItem,
  ProjectBottlenecksOverview,
} from '../application/contracts';

const WORKLOAD_BAND_LABEL_ID: Readonly<Record<BottleneckSeverity, MessageId>> = {
  LOW: 'workload.band.LOW',
  MODERATE: 'workload.band.MODERATE',
  HIGH: 'workload.band.HIGH',
  CRITICAL: 'workload.band.CRITICAL',
};

function TaskSummaryList({ tasks }: { readonly tasks: readonly BottleneckTaskSummaryItem[] }) {
  const intl = useIntl();

  if (tasks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage({ id: 'bottlenecks.indicators.noTasksInIndicator' })}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li
          key={task.taskId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2.5 text-xs"
        >
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">{task.title}</p>
            <p className="text-muted-foreground">
              {intl.formatMessage(
                { id: 'tasks.lastMovedAtLabel' },
                { date: intl.formatDate(new Date(task.lastMovedAt), { dateStyle: 'short' }) },
              )}
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="min-h-[44px]">
            <Link to={`/projects/${task.projectId}/tasks/${task.taskId}`}>
              <IconExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'focus.actions.openTaskDetail' })}</span>
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}

export interface BottleneckIndicatorsSectionProps {
  readonly overview: ProjectBottlenecksOverview;
  readonly canViewMemberWorkloads: boolean;
}

export function BottleneckIndicatorsSection({
  overview,
  canViewMemberWorkloads,
}: BottleneckIndicatorsSectionProps) {
  const intl = useIntl();
  const { indicators, memberWorkloads } = overview;
  const allowThirdPartySection =
    canViewMemberWorkloads && overview.canViewThirdPartyIndividualMetrics;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <IconColumns3 className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>{intl.formatMessage({ id: 'bottlenecks.indicator.WIP' })}</CardTitle>
            </div>
            <CardDescription>
              {intl.formatMessage({ id: 'bottlenecks.indicators.wipTitle' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {indicators.wipColumns.map((col) => (
                <li
                  key={col.columnId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-xs"
                >
                  <span className="font-medium text-foreground">{col.columnName}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">
                      {col.wipLimit !== null
                        ? intl.formatMessage(
                            { id: 'bottlenecks.indicators.wipStatus' },
                            {
                              current: col.occupyingTaskCount,
                              limit: col.wipLimit,
                              percent: col.utilizationPercent ?? 0,
                            },
                          )
                        : intl.formatMessage(
                            { id: 'bottlenecks.indicators.wipUnlimited' },
                            { current: col.occupyingTaskCount },
                          )}
                    </span>
                    {col.isExceeded ? (
                      <Badge variant="destructive">
                        {intl.formatMessage({ id: 'bottlenecks.indicators.wipExceededBadge' })}
                      </Badge>
                    ) : col.isPreventiveWarning ? (
                      <Badge variant="outline">
                        {intl.formatMessage({ id: 'bottlenecks.indicators.wipWarningBadge' })}
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <IconClockExclamation className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>
                {intl.formatMessage({ id: 'bottlenecks.indicator.INACTIVITY' })}
              </CardTitle>
            </div>
            <CardDescription>
              {intl.formatMessage(
                { id: 'bottlenecks.indicators.inactiveTasksTitle' },
                { count: indicators.inactiveTaskCount },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: 'bottlenecks.indicator.inactivityHint' })}
            </p>
            <TaskSummaryList tasks={indicators.inactiveTasks} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <IconAlertCircle className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>{intl.formatMessage({ id: 'bottlenecks.indicator.OVERDUE' })}</CardTitle>
            </div>
            <CardDescription>
              {intl.formatMessage(
                { id: 'bottlenecks.indicators.overdueTasksTitle' },
                { count: indicators.overdueTaskCount },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TaskSummaryList tasks={indicators.overdueTasks} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <IconLock className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>
                {intl.formatMessage({ id: 'bottlenecks.indicator.IMPEDIMENTS' })}
              </CardTitle>
            </div>
            <CardDescription>
              {intl.formatMessage(
                { id: 'bottlenecks.indicators.blockedTasksTitle' },
                { count: indicators.blockedTaskCount },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant="outline">
              {intl.formatMessage(
                { id: 'bottlenecks.indicators.openImpedimentsCount' },
                { count: indicators.openBlockingImpedimentCount },
              )}
            </Badge>
            <TaskSummaryList tasks={indicators.blockedTasks} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconActivity className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>{intl.formatMessage({ id: 'bottlenecks.indicator.OVERLOAD' })}</CardTitle>
            </div>
            <Badge variant={indicators.overloadedMemberCount > 0 ? 'destructive' : 'secondary'}>
              {intl.formatMessage(
                { id: 'bottlenecks.privacy.overloadedSummaryLabel' },
                { count: indicators.overloadedMemberCount },
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!allowThirdPartySection ? (
            <Alert variant="info">
              <IconShieldLock className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                {intl.formatMessage({ id: 'bottlenecks.privacy.anonymizedNotice' })}
              </AlertDescription>
            </Alert>
          ) : null}

          <Alert variant="info">
            <AlertDescription>
              {intl.formatMessage({ id: 'workload.notHoursNotice' })}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {allowThirdPartySection ? (
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <IconUsers className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>{intl.formatMessage({ id: 'bottlenecks.members.title' })}</CardTitle>
            </div>
            <CardDescription>
              {intl.formatMessage({ id: 'bottlenecks.members.authorizedDescription' })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="info">
              <AlertDescription>
                {intl.formatMessage({ id: 'workload.notHoursNotice' })}
              </AlertDescription>
            </Alert>

            {memberWorkloads.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {intl.formatMessage({ id: 'bottlenecks.members.empty' })}
              </p>
            ) : (
              <ul className="space-y-2">
                {memberWorkloads.map((entry) => {
                  const bandLabel = intl.formatMessage({
                    id: WORKLOAD_BAND_LABEL_ID[entry.workload.level],
                  });
                  return (
                    <li
                      key={entry.userId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{entry.displayName}</p>
                        <p className="text-xs text-muted-foreground">
                          {intl.formatMessage(
                            { id: 'workload.activeTasksCount' },
                            { count: entry.workload.activeTaskCount },
                          )}{' '}
                          •{' '}
                          {intl.formatMessage(
                            { id: 'workload.activeSubtasksCount' },
                            { count: entry.workload.activeSubtaskCount },
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            entry.workload.level === 'CRITICAL' ? 'destructive' : 'secondary'
                          }
                        >
                          {intl.formatMessage({ id: 'workload.levelLabel' }, { band: bandLabel })}
                        </Badge>
                        <span className="text-xs font-semibold text-foreground">
                          {intl.formatMessage(
                            { id: 'workload.scoreLabel' },
                            { score: entry.workload.score },
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
