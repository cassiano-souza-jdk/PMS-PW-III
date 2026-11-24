/**
 * Optional per-project bottleneck evaluation thresholds (PRD.md §12.2, ADR-0012).
 *
 * Defined as a pure value contract in `@/shared/kernel` so `projects` and `bottlenecks`
 * share the same structural schema without introducing cross-module imports.
 * Any omitted field falls back deterministically to `DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS`.
 */
export interface ProjectBottleneckThresholds {
  /** Column WIP occupancy percentage (1–100) that triggers a preventive WIP warning. Default: 80. */
  readonly wipUtilizationPercent?: number;
  /** Minimum inactive active-task count (based on `lastMovedAt`) for warning severity. Default: 2. */
  readonly inactivityWarningCount?: number;
  /** Minimum inactive active-task count (based on `lastMovedAt`) for critical severity. Default: 5. */
  readonly inactivityCriticalCount?: number;
  /** Minimum overdue active-task count for warning severity. Default: 1. */
  readonly overdueWarningCount?: number;
  /** Minimum overdue active-task count for critical severity. Default: 3. */
  readonly overdueCriticalCount?: number;
  /** Minimum blocked active-task / open-blocking-impediment count for warning severity. Default: 1. */
  readonly blockedWarningCount?: number;
  /** Minimum blocked active-task / open-blocking-impediment count for critical severity. Default: 3. */
  readonly blockedCriticalCount?: number;
  /** Member workload score (1–100) that triggers a HIGH overload alert. Default: 50. */
  readonly overloadHighScore?: number;
  /** Member workload score (1–100) that triggers a CRITICAL overload alert. Default: 75. */
  readonly overloadCriticalScore?: number;
}
