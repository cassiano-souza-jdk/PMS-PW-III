export const METRIC_AVAILABILITY_STATUSES = {
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;

export type MetricAvailabilityStatus =
  (typeof METRIC_AVAILABILITY_STATUSES)[keyof typeof METRIC_AVAILABILITY_STATUSES];

export const METRIC_UNAVAILABLE_REASONS = {
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  NO_COMPLETED_CYCLES: 'NO_COMPLETED_CYCLES',
  ZERO_DENOMINATOR: 'ZERO_DENOMINATOR',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

export type MetricUnavailableReason =
  (typeof METRIC_UNAVAILABLE_REASONS)[keyof typeof METRIC_UNAVAILABLE_REASONS];

export interface AvailableMetricValue<TValue> {
  readonly status: typeof METRIC_AVAILABILITY_STATUSES.AVAILABLE;
  readonly value: TValue;
}

export interface UnavailableMetricValue {
  readonly status: typeof METRIC_AVAILABILITY_STATUSES.UNAVAILABLE;
  readonly reason: MetricUnavailableReason;
}

/**
 * Discriminated metric contract (docs/contracts/metric-definitions.md):
 * insufficient data must always be represented as UNAVAILABLE, never as an implicit zero.
 */
export type MetricValue<TValue> = AvailableMetricValue<TValue> | UnavailableMetricValue;

export function availableMetric<TValue>(value: TValue): AvailableMetricValue<TValue> {
  return Object.freeze({
    status: METRIC_AVAILABILITY_STATUSES.AVAILABLE,
    value,
  });
}

export function unavailableMetric(reason: MetricUnavailableReason): UnavailableMetricValue {
  return Object.freeze({
    status: METRIC_AVAILABILITY_STATUSES.UNAVAILABLE,
    reason,
  });
}

export function isMetricAvailable<TValue>(
  metric: MetricValue<TValue>,
): metric is AvailableMetricValue<TValue> {
  return metric.status === METRIC_AVAILABILITY_STATUSES.AVAILABLE;
}
