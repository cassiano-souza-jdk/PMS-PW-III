import { useIntl } from 'react-intl';
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui';
import type { AnalyticsOverview } from '../application/contracts';
import {
  BottlenecksDistributionCharts,
  FeedbackAnalyticsCharts,
  FlowCycleComparisonChart,
  ImpedimentsDistributionCharts,
  TaskStatusBreakdownChart,
  TeamWorkloadChart,
} from './analytics-charts';
import { AnalyticsMetricCard } from './analytics-metric-card';
import {
  WORKLOAD_BAND_LABEL_IDS,
  formatAnalyticsDateTime,
  formatAnalyticsMetricValue,
  resolveBottleneckIndicatorLabel,
  resolveBottleneckSeverityLabel,
  resolveSeverityBadgeVariant,
} from './analytics-ui-helpers';

export function FlowKpiCardsGrid({
  overview,
  compareWithPreviousPeriod,
}: {
  readonly overview: AnalyticsOverview;
  readonly compareWithPreviousPeriod: boolean;
}) {
  const intl = useIntl();
  const { flow } = overview;
  const previous = flow.previousPeriod;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.leadTime.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.leadTime.hint' })}
        metric={flow.leadTimeMs}
        kind="duration"
        previousMetric={previous?.leadTimeMs}
        showComparison={compareWithPreviousPeriod}
      />
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.effectiveCycleTime.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.effectiveCycleTime.hint' })}
        metric={flow.effectiveCycleTimeMs}
        kind="duration"
        previousMetric={previous?.effectiveCycleTimeMs}
        showComparison={compareWithPreviousPeriod}
      />
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.totalCycleTime.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.totalCycleTime.hint' })}
        metric={flow.totalCycleTimeMs}
        kind="duration"
        previousMetric={previous?.totalCycleTimeMs}
        showComparison={compareWithPreviousPeriod}
      />
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.throughput.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.throughput.hint' })}
        metric={flow.throughput}
        kind="count"
        previousMetric={previous?.throughput}
        showComparison={compareWithPreviousPeriod}
      />
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.uniqueCompletedTasks.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.uniqueCompletedTasks.hint' })}
        metric={flow.uniqueCompletedTasks}
        kind="count"
        previousMetric={previous?.uniqueCompletedTasks}
        showComparison={compareWithPreviousPeriod}
      />
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.periodCompletions.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.periodCompletions.hint' })}
        metric={flow.periodCompletions}
        kind="count"
        previousMetric={previous?.periodCompletions}
        showComparison={compareWithPreviousPeriod}
      />
      <AnalyticsMetricCard
        label={intl.formatMessage({ id: 'analytics.flow.cohortCompletionRate.label' })}
        hint={intl.formatMessage({ id: 'analytics.flow.cohortCompletionRate.hint' })}
        metric={flow.cohortCompletionRate}
        kind="percent"
        previousMetric={previous?.cohortCompletionRate}
        showComparison={compareWithPreviousPeriod}
      />
    </div>
  );
}

export function FlowAnalyticsSection({
  overview,
  compareWithPreviousPeriod,
}: {
  readonly overview: AnalyticsOverview;
  readonly compareWithPreviousPeriod: boolean;
}) {
  const intl = useIntl();

  return (
    <section aria-labelledby="analytics-flow-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 id="analytics-flow-heading" className="text-xl font-semibold text-foreground">
            {intl.formatMessage({ id: 'analytics.flow.title' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'analytics.flow.description' })}
          </p>
        </div>
        <Badge variant="secondary">
          {`${intl.formatMessage({ id: 'analytics.flow.totalVisibleTasks.label' })}: ${intl.formatNumber(
            overview.flow.totalVisibleTasks,
          )}`}
        </Badge>
      </div>

      <FlowKpiCardsGrid overview={overview} compareWithPreviousPeriod={compareWithPreviousPeriod} />

      <div className="grid gap-4 lg:grid-cols-2">
        <FlowCycleComparisonChart flow={overview.flow} />
        <TaskStatusBreakdownChart flow={overview.flow} />
      </div>
    </section>
  );
}

export function MyWorkloadWidgetSection({ overview }: { readonly overview: AnalyticsOverview }) {
  const intl = useIntl();
  const { myWorkload } = overview.workload;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{intl.formatMessage({ id: 'analytics.workload.myWorkloadTitle' })}</CardTitle>
          <Badge variant="secondary">
            {intl.formatMessage({ id: 'analytics.workload.notHoursBadge' })}
          </Badge>
        </div>
        <CardDescription>
          {intl.formatMessage({ id: 'analytics.workload.description' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <AlertDescription>
            {intl.formatMessage({ id: 'analytics.workload.notHoursNotice' })}
          </AlertDescription>
        </Alert>

        {myWorkload === null ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'analytics.workload.empty' })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">{myWorkload.displayName}</p>
              <p className="text-2xl font-bold text-foreground">
                {`${intl.formatNumber(myWorkload.score, { maximumFractionDigits: 1 })}/100`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={resolveSeverityBadgeVariant(myWorkload.level)}>
                {intl.formatMessage({ id: WORKLOAD_BAND_LABEL_IDS[myWorkload.level] })}
              </Badge>
              <Badge variant="outline">
                {intl.formatMessage(
                  { id: 'analytics.workload.activeTasksLabel' },
                  { count: myWorkload.activeTaskCount },
                )}
              </Badge>
              <Badge variant="outline">
                {intl.formatMessage(
                  { id: 'analytics.workload.activeSubtasksLabel' },
                  { count: myWorkload.activeSubtaskCount },
                )}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamWorkloadWidgetSection({ overview }: { readonly overview: AnalyticsOverview }) {
  const intl = useIntl();
  const { workload } = overview;

  return (
    <section aria-labelledby="analytics-team-workload-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2
            id="analytics-team-workload-heading"
            className="text-xl font-semibold text-foreground"
          >
            {intl.formatMessage({ id: 'analytics.workload.title' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'analytics.workload.description' })}
          </p>
        </div>
        <Badge variant="secondary">
          {intl.formatMessage({ id: 'analytics.workload.notHoursBadge' })}
        </Badge>
      </div>

      <Alert>
        <AlertDescription>
          {intl.formatMessage({ id: 'analytics.workload.notHoursNotice' })}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <AnalyticsMetricCard
          label={intl.formatMessage({ id: 'analytics.workload.averageTeamScoreLabel' })}
          metric={workload.averageTeamWorkloadScore}
          kind="score"
        />
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.workload.overloadedMembersLabel' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(workload.overloadedMemberCount)}
            </p>
          </CardContent>
        </Card>
      </div>

      {!overview.includesThirdPartyIndividualMetrics ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'analytics.workload.privacyNotice' })}
          </AlertDescription>
        </Alert>
      ) : (
        <TeamWorkloadChart memberWorkloads={workload.memberWorkloads} />
      )}
    </section>
  );
}

export function ImpedimentsAnalyticsSection({
  overview,
}: {
  readonly overview: AnalyticsOverview;
}) {
  const intl = useIntl();
  const { impediments } = overview;

  return (
    <section aria-labelledby="analytics-impediments-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="analytics-impediments-heading" className="text-xl font-semibold text-foreground">
          {intl.formatMessage({ id: 'analytics.impediments.title' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'analytics.impediments.description' })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.impediments.totalInPeriodLabel' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(impediments.totalInPeriod)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.impediments.openCountLabel' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(impediments.openCount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.impediments.resolvedInPeriodLabel' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(impediments.resolvedInPeriod)}
            </p>
          </CardContent>
        </Card>
        <AnalyticsMetricCard
          label={intl.formatMessage({ id: 'analytics.impediments.avgResolutionLabel' })}
          metric={impediments.averageResolutionMs}
          kind="duration"
        />
      </div>

      <ImpedimentsDistributionCharts impediments={impediments} />
    </section>
  );
}

export function BottlenecksAnalyticsSection({
  overview,
}: {
  readonly overview: AnalyticsOverview;
}) {
  const intl = useIntl();
  const { bottlenecks } = overview;

  return (
    <section aria-labelledby="analytics-bottlenecks-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="analytics-bottlenecks-heading" className="text-xl font-semibold text-foreground">
          {intl.formatMessage({ id: 'analytics.bottlenecks.title' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'analytics.bottlenecks.description' })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.bottlenecks.totalActiveAlertsLabel' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(bottlenecks.totalActiveAlerts)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.bottlenecks.overloadedCountLabel' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(bottlenecks.overloadedMemberCount)}
            </p>
          </CardContent>
        </Card>
      </div>

      <BottlenecksDistributionCharts bottlenecks={bottlenecks} />

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold leading-none tracking-tight">
            {intl.formatMessage({ id: 'analytics.bottlenecks.alertsListTitle' })}
          </h3>
        </CardHeader>
        <CardContent>
          {bottlenecks.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'analytics.bottlenecks.empty' })}
            </p>
          ) : (
            <ul className="space-y-2">
              {bottlenecks.alerts.map((alert) => (
                <li
                  key={alert.alertId}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3 text-sm"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={resolveSeverityBadgeVariant(alert.severity)}>
                        {resolveBottleneckSeverityLabel(alert.severity, intl)}
                      </Badge>
                      <Badge variant="outline">
                        {resolveBottleneckIndicatorLabel(alert.indicator, intl)}
                      </Badge>
                      <span className="text-xs font-medium text-muted-foreground">
                        {alert.status}
                      </span>
                    </div>
                    <p className="font-medium text-foreground">{alert.summary}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatAnalyticsDateTime(alert.lastSeenAt, intl)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function FeedbackAnalyticsSection({ overview }: { readonly overview: AnalyticsOverview }) {
  const intl = useIntl();
  const { feedback } = overview;

  return (
    <section aria-labelledby="analytics-feedback-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="analytics-feedback-heading" className="text-xl font-semibold text-foreground">
          {intl.formatMessage({ id: 'analytics.feedback.title' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'analytics.feedback.description' })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.feedback.totalInPeriod.label' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(feedback.totalInPeriod)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.feedback.resolvedInPeriod.label' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(feedback.resolvedInPeriod)}
            </p>
          </CardContent>
        </Card>
        <AnalyticsMetricCard
          label={intl.formatMessage({ id: 'analytics.feedback.resolutionRate.label' })}
          metric={feedback.resolutionRate}
          kind="percent"
        />
        <AnalyticsMetricCard
          label={intl.formatMessage({ id: 'analytics.feedback.sla.complianceRate.label' })}
          metric={feedback.slaSummary.complianceRate}
          kind="percent"
        />
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.feedback.contestsInPeriod.label' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(feedback.contestsInPeriod)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              {intl.formatMessage({ id: 'analytics.feedback.reopeningsInPeriod.label' })}
            </h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {intl.formatNumber(feedback.reopeningsInPeriod)}
            </p>
          </CardContent>
        </Card>
        <AnalyticsMetricCard
          label={intl.formatMessage({ id: 'analytics.feedback.averageFirstResponse.label' })}
          metric={feedback.averageFirstResponseMs}
          kind="duration"
        />
        <AnalyticsMetricCard
          label={intl.formatMessage({ id: 'analytics.feedback.averageResolution.label' })}
          metric={feedback.averageResolutionMs}
          kind="duration"
        />
      </div>

      <FeedbackAnalyticsCharts feedback={feedback} />

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold leading-none tracking-tight">
            {intl.formatMessage({ id: 'analytics.feedback.assigneePerformance.title' })}
          </h3>
        </CardHeader>
        <CardContent>
          {!overview.includesThirdPartyIndividualMetrics ? (
            <Alert variant="warning">
              <AlertDescription>
                {intl.formatMessage({
                  id: 'analytics.feedback.assigneePerformance.privacyRestricted',
                })}
              </AlertDescription>
            </Alert>
          ) : feedback.assigneePerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'analytics.feedback.assigneePerformance.empty' })}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">
                  {intl.formatMessage({ id: 'analytics.feedback.assigneePerformance.title' })}
                </caption>
                <thead className="bg-muted/50">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                      {intl.formatMessage({ id: 'analytics.feedback.columns.assignee' })}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold text-foreground">
                      {intl.formatMessage({ id: 'analytics.feedback.columns.assigned' })}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold text-foreground">
                      {intl.formatMessage({ id: 'analytics.feedback.columns.resolved' })}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold text-foreground">
                      {intl.formatMessage({ id: 'analytics.feedback.columns.breached' })}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold text-foreground">
                      {intl.formatMessage({ id: 'analytics.feedback.columns.avgResolution' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {feedback.assigneePerformance.map((row) => (
                    <tr key={row.assigneeUserId} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{row.displayName}</td>
                      <td className="px-3 py-2 text-right">
                        {intl.formatNumber(row.assignedCount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {intl.formatNumber(row.resolvedCount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {intl.formatNumber(row.breachedCount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatAnalyticsMetricValue(row.averageResolutionMs, 'duration', intl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
