import { useIntl } from 'react-intl';
import type { MetricValue } from '@/shared/kernel';
import { Badge, Card, CardContent, CardDescription, CardHeader } from '@/shared/ui';
import { METRIC_REASON_LABEL_IDS, formatAnalyticsMetricValue } from './analytics-ui-helpers';

export interface AnalyticsMetricCardProps {
  readonly label: string;
  readonly hint?: string;
  readonly metric: MetricValue<number>;
  readonly kind: 'duration' | 'count' | 'percent' | 'score';
  readonly previousMetric?: MetricValue<number>;
  readonly showComparison?: boolean;
}

export function AnalyticsMetricCard({
  label,
  hint,
  metric,
  kind,
  previousMetric,
  showComparison = false,
}: AnalyticsMetricCardProps) {
  const intl = useIntl();

  const isUnavailable = metric.status === 'UNAVAILABLE';
  const formattedValue = formatAnalyticsMetricValue(metric, kind, intl);

  let deltaText: string | null = null;
  if (
    showComparison &&
    metric.status === 'AVAILABLE' &&
    previousMetric !== undefined &&
    previousMetric.status === 'AVAILABLE'
  ) {
    const diff = metric.value - previousMetric.value;
    if (diff === 0) {
      deltaText = '0%';
    } else if (previousMetric.value === 0) {
      deltaText = diff > 0 ? '+∞' : '-∞';
    } else {
      const pctChange = Math.round((diff / previousMetric.value) * 100 * 10) / 10;
      const sign = pctChange > 0 ? '+' : '';
      deltaText = `${sign}${intl.formatNumber(pctChange, { maximumFractionDigits: 1 })}%`;
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold leading-none tracking-tight">{label}</h3>
          {isUnavailable ? (
            <Badge variant="outline">
              {`${intl.formatMessage({ id: 'analytics.metric.unavailableBadge' })} (UNAVAILABLE)`}
            </Badge>
          ) : deltaText !== null ? (
            <Badge variant="secondary">{deltaText}</Badge>
          ) : null}
        </div>
        {hint !== undefined ? <CardDescription className="text-xs">{hint}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isUnavailable ? (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-muted-foreground">
              {intl.formatMessage({ id: METRIC_REASON_LABEL_IDS[metric.reason] })}
            </p>
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: 'analytics.metric.unavailableNotice' })}
            </p>
          </div>
        ) : (
          <p className="text-2xl font-bold tracking-tight text-foreground">{formattedValue}</p>
        )}

        {showComparison && previousMetric !== undefined ? (
          <p className="text-xs text-muted-foreground">
            {intl.formatMessage(
              { id: 'analytics.period.previousValueLabel' },
              { value: formatAnalyticsMetricValue(previousMetric, kind, intl) },
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
