import { useIntl } from 'react-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/shared/ui';
import type {
  AnalyticsBottlenecksSummary,
  AnalyticsChartDataRow,
  AnalyticsFeedbackSummary,
  AnalyticsFlowSummary,
  AnalyticsImpedimentsSummary,
  AnalyticsMemberWorkloadItem,
} from '../application/contracts';
import { AccessibleChartCard } from './accessible-chart-card';
import {
  CHART_ACCESSIBLE_PALETTE,
  TASK_STATUS_LABEL_IDS,
  TASK_STATUS_ORDER,
  durationMsToHours,
  formatAnalyticsMetricValue,
  resolveBottleneckIndicatorLabel,
  resolveBottleneckSeverityLabel,
  resolveContestOutcomeLabel,
  resolveCycleOriginLabel,
  resolveImpedimentCategoryLabel,
  resolveImpedimentSeverityLabel,
} from './analytics-ui-helpers';

interface BarChartRenderProps {
  readonly data: readonly AnalyticsChartDataRow[];
  readonly seriesLabel: string;
  readonly valueSuffix?: string;
}

function AccessibleBarChart({ data, seriesLabel, valueSuffix = '' }: BarChartRenderProps) {
  const mutableData = data.map((row) => ({ ...row }));
  return (
    <div className="h-[280px] w-full min-w-[240px]">
      <ResponsiveContainer
        width="100%"
        height={280}
        minWidth={240}
        minHeight={240}
        initialDimension={{ width: 640, height: 280 }}
      >
        <BarChart data={mutableData} margin={{ top: 12, right: 16, left: 4, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} />
          <YAxis allowDecimals={true} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [`${String(value ?? '')}${valueSuffix}`, seriesLabel]} />
          <Legend />
          <Bar dataKey="value" name={seriesLabel} radius={[4, 4, 0, 0]}>
            {mutableData.map((entry, index) => (
              <Cell
                key={entry.key}
                fill={CHART_ACCESSIBLE_PALETTE[index % CHART_ACCESSIBLE_PALETTE.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FlowCycleComparisonChart({ flow }: { readonly flow: AnalyticsFlowSummary }) {
  const intl = useIntl();

  const metrics = [
    {
      key: 'lead-time',
      label: intl.formatMessage({ id: 'analytics.flow.leadTime.label' }),
      metric: flow.leadTimeMs,
    },
    {
      key: 'effective-cycle-time',
      label: intl.formatMessage({ id: 'analytics.flow.effectiveCycleTime.label' }),
      metric: flow.effectiveCycleTimeMs,
    },
    {
      key: 'total-cycle-time',
      label: intl.formatMessage({ id: 'analytics.flow.totalCycleTime.label' }),
      metric: flow.totalCycleTimeMs,
    },
  ];

  const rows: AnalyticsChartDataRow[] = metrics.map((entry) => ({
    key: entry.key,
    label: entry.label,
    value: entry.metric.status === 'AVAILABLE' ? durationMsToHours(entry.metric.value) : 0,
    formattedValue: formatAnalyticsMetricValue(entry.metric, 'duration', intl),
  }));

  const hasAvailableMetric = metrics.some((entry) => entry.metric.status === 'AVAILABLE');
  const summary = rows.map((row) => `${row.label}: ${row.formattedValue ?? row.value}`).join(' | ');

  return (
    <AccessibleChartCard
      title={intl.formatMessage({ id: 'analytics.flow.cycleComparison.chartTitle' })}
      description={intl.formatMessage({ id: 'analytics.flow.cycleComparison.description' })}
      textSummary={summary}
      rows={hasAvailableMetric ? rows : []}
      emptyMessage={intl.formatMessage({ id: 'analytics.metric.unavailableNotice' })}
    >
      <AccessibleBarChart
        data={rows}
        seriesLabel={intl.formatMessage({ id: 'analytics.flow.cycleComparison.chartTitle' })}
        valueSuffix=" h"
      />
    </AccessibleChartCard>
  );
}

export function TaskStatusBreakdownChart({ flow }: { readonly flow: AnalyticsFlowSummary }) {
  const intl = useIntl();

  const rows: AnalyticsChartDataRow[] = TASK_STATUS_ORDER.map((status) => {
    const count = flow.countsByStatus[status] ?? 0;
    return {
      key: status,
      label: intl.formatMessage({ id: TASK_STATUS_LABEL_IDS[status] }),
      value: count,
      formattedValue: intl.formatNumber(count),
    };
  });

  const nonZeroCount = rows.reduce((sum, row) => sum + row.value, 0);
  const summary = rows.map((row) => `${row.label}: ${row.formattedValue ?? row.value}`).join(' | ');

  return (
    <AccessibleChartCard
      title={intl.formatMessage({ id: 'analytics.flow.statusBreakdown.chartTitle' })}
      description={intl.formatMessage({ id: 'analytics.flow.statusBreakdown.description' })}
      textSummary={summary}
      rows={nonZeroCount > 0 ? rows : []}
      emptyMessage={intl.formatMessage({ id: 'analytics.flow.statusBreakdown.empty' })}
    >
      <AccessibleBarChart
        data={rows}
        seriesLabel={intl.formatMessage({ id: 'analytics.flow.statusBreakdown.title' })}
      />
    </AccessibleChartCard>
  );
}

export function TeamWorkloadChart({
  memberWorkloads,
}: {
  readonly memberWorkloads: readonly AnalyticsMemberWorkloadItem[];
}) {
  const intl = useIntl();

  const rows: AnalyticsChartDataRow[] = memberWorkloads.map((member) => ({
    key: member.userId,
    label: member.displayName,
    value: member.score,
    formattedValue: `${intl.formatNumber(member.score, { maximumFractionDigits: 1 })}/100`,
  }));

  const summary =
    rows.length > 0
      ? rows.map((row) => `${row.label}: ${row.formattedValue ?? row.value}`).join(' | ')
      : intl.formatMessage({ id: 'analytics.workload.empty' });

  return (
    <AccessibleChartCard
      title={intl.formatMessage({ id: 'analytics.workload.teamWorkloadTitle' })}
      description={intl.formatMessage({ id: 'analytics.workload.description' })}
      textSummary={summary}
      rows={rows}
      emptyMessage={intl.formatMessage({ id: 'analytics.workload.empty' })}
      badge={
        <Badge variant="secondary">
          {intl.formatMessage({ id: 'analytics.workload.notHoursBadge' })}
        </Badge>
      }
    >
      <AccessibleBarChart
        data={rows}
        seriesLabel={intl.formatMessage({ id: 'analytics.workload.teamWorkloadTitle' })}
        valueSuffix="/100"
      />
    </AccessibleChartCard>
  );
}

export function ImpedimentsDistributionCharts({
  impediments,
}: {
  readonly impediments: AnalyticsImpedimentsSummary;
}) {
  const intl = useIntl();

  const categoryRows: AnalyticsChartDataRow[] = impediments.byCategory.map((bucket) => ({
    key: bucket.key,
    label: resolveImpedimentCategoryLabel(bucket.key, intl),
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));

  const severityRows: AnalyticsChartDataRow[] = impediments.bySeverity.map((bucket) => ({
    key: bucket.key,
    label: resolveImpedimentSeverityLabel(bucket.key, intl),
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));

  const categorySummary =
    categoryRows.length > 0
      ? categoryRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
      : intl.formatMessage({ id: 'analytics.impediments.empty' });
  const severitySummary =
    severityRows.length > 0
      ? severityRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
      : intl.formatMessage({ id: 'analytics.impediments.empty' });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.impediments.byCategoryTitle' })}
        textSummary={categorySummary}
        rows={categoryRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.impediments.empty' })}
      >
        <AccessibleBarChart
          data={categoryRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.impediments.byCategoryTitle' })}
        />
      </AccessibleChartCard>

      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.impediments.bySeverityTitle' })}
        textSummary={severitySummary}
        rows={severityRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.impediments.empty' })}
      >
        <AccessibleBarChart
          data={severityRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.impediments.bySeverityTitle' })}
        />
      </AccessibleChartCard>
    </div>
  );
}

export function BottlenecksDistributionCharts({
  bottlenecks,
}: {
  readonly bottlenecks: AnalyticsBottlenecksSummary;
}) {
  const intl = useIntl();

  const indicatorRows: AnalyticsChartDataRow[] = bottlenecks.byIndicator.map((bucket) => ({
    key: bucket.key,
    label: resolveBottleneckIndicatorLabel(bucket.key, intl),
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));

  const severityRows: AnalyticsChartDataRow[] = bottlenecks.bySeverity.map((bucket) => ({
    key: bucket.key,
    label: resolveBottleneckSeverityLabel(bucket.key, intl),
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));

  const indicatorSummary =
    indicatorRows.length > 0
      ? indicatorRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
      : intl.formatMessage({ id: 'analytics.bottlenecks.empty' });
  const severitySummary =
    severityRows.length > 0
      ? severityRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
      : intl.formatMessage({ id: 'analytics.bottlenecks.empty' });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.bottlenecks.byIndicatorTitle' })}
        textSummary={indicatorSummary}
        rows={indicatorRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.bottlenecks.empty' })}
      >
        <AccessibleBarChart
          data={indicatorRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.bottlenecks.byIndicatorTitle' })}
        />
      </AccessibleChartCard>

      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.bottlenecks.bySeverityTitle' })}
        textSummary={severitySummary}
        rows={severityRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.bottlenecks.empty' })}
      >
        <AccessibleBarChart
          data={severityRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.bottlenecks.bySeverityTitle' })}
        />
      </AccessibleChartCard>
    </div>
  );
}

export function FeedbackAnalyticsCharts({
  feedback,
}: {
  readonly feedback: AnalyticsFeedbackSummary;
}) {
  const intl = useIntl();

  const slaRows: AnalyticsChartDataRow[] = [
    {
      key: 'ON_TRACK',
      label: intl.formatMessage({ id: 'analytics.feedback.sla.ON_TRACK' }),
      value: feedback.slaSummary.onTrackCount,
      formattedValue: intl.formatNumber(feedback.slaSummary.onTrackCount),
    },
    {
      key: 'WARNING',
      label: intl.formatMessage({ id: 'analytics.feedback.sla.WARNING' }),
      value: feedback.slaSummary.warningCount,
      formattedValue: intl.formatNumber(feedback.slaSummary.warningCount),
    },
    {
      key: 'BREACHED',
      label: intl.formatMessage({ id: 'analytics.feedback.sla.BREACHED' }),
      value: feedback.slaSummary.breachedCount,
      formattedValue: intl.formatNumber(feedback.slaSummary.breachedCount),
    },
  ];
  const totalSla = slaRows.reduce((sum, row) => sum + row.value, 0);

  const cycleOriginRows: AnalyticsChartDataRow[] = feedback.cyclesByOrigin.map((bucket) => ({
    key: bucket.key,
    label: resolveCycleOriginLabel(bucket.key, intl),
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));
  const totalCycles = cycleOriginRows.reduce((sum, row) => sum + row.value, 0);

  const categoryVersionRows: AnalyticsChartDataRow[] = feedback.byCategoryVersion.map((bucket) => ({
    key: bucket.versionId,
    label: `${bucket.name} (${intl.formatMessage(
      { id: 'analytics.feedback.versionBadge' },
      { version: bucket.versionNumber },
    )})`,
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));

  const contestReasonRows: AnalyticsChartDataRow[] = feedback.byContestReasonVersion.map(
    (bucket) => ({
      key: bucket.versionId,
      label: `${bucket.name} (${intl.formatMessage(
        { id: 'analytics.feedback.versionBadge' },
        { version: bucket.versionNumber },
      )})`,
      value: bucket.count,
      formattedValue: intl.formatNumber(bucket.count),
    }),
  );

  const contestOutcomeRows: AnalyticsChartDataRow[] = feedback.contestOutcomes.map((bucket) => ({
    key: bucket.key,
    label: resolveContestOutcomeLabel(bucket.key, intl),
    value: bucket.count,
    formattedValue: intl.formatNumber(bucket.count),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.feedback.sla.title' })}
        textSummary={slaRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')}
        rows={totalSla > 0 ? slaRows : []}
        emptyMessage={intl.formatMessage({ id: 'analytics.feedback.cyclesByOrigin.empty' })}
      >
        <AccessibleBarChart
          data={slaRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.feedback.sla.title' })}
        />
      </AccessibleChartCard>

      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.feedback.cyclesByOrigin.title' })}
        textSummary={
          cycleOriginRows.length > 0
            ? cycleOriginRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
            : intl.formatMessage({ id: 'analytics.feedback.cyclesByOrigin.empty' })
        }
        rows={totalCycles > 0 ? cycleOriginRows : []}
        emptyMessage={intl.formatMessage({ id: 'analytics.feedback.cyclesByOrigin.empty' })}
      >
        <AccessibleBarChart
          data={cycleOriginRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.feedback.cyclesByOrigin.title' })}
        />
      </AccessibleChartCard>

      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.feedback.byCategoryVersion.title' })}
        textSummary={
          categoryVersionRows.length > 0
            ? categoryVersionRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
            : intl.formatMessage({ id: 'analytics.feedback.byCategoryVersion.empty' })
        }
        rows={categoryVersionRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.feedback.byCategoryVersion.empty' })}
      >
        <AccessibleBarChart
          data={categoryVersionRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.feedback.byCategoryVersion.title' })}
        />
      </AccessibleChartCard>

      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.feedback.byContestReasonVersion.title' })}
        textSummary={
          contestReasonRows.length > 0
            ? contestReasonRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
            : intl.formatMessage({ id: 'analytics.feedback.byContestReasonVersion.empty' })
        }
        rows={contestReasonRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.feedback.byContestReasonVersion.empty' })}
      >
        <AccessibleBarChart
          data={contestReasonRows}
          seriesLabel={intl.formatMessage({
            id: 'analytics.feedback.byContestReasonVersion.title',
          })}
        />
      </AccessibleChartCard>

      <AccessibleChartCard
        title={intl.formatMessage({ id: 'analytics.feedback.contestOutcomes.title' })}
        textSummary={
          contestOutcomeRows.length > 0
            ? contestOutcomeRows.map((row) => `${row.label}: ${row.formattedValue}`).join(' | ')
            : intl.formatMessage({ id: 'analytics.feedback.contestOutcomes.empty' })
        }
        rows={contestOutcomeRows}
        emptyMessage={intl.formatMessage({ id: 'analytics.feedback.contestOutcomes.empty' })}
      >
        <AccessibleBarChart
          data={contestOutcomeRows}
          seriesLabel={intl.formatMessage({ id: 'analytics.feedback.contestOutcomes.title' })}
        />
      </AccessibleChartCard>
    </div>
  );
}
