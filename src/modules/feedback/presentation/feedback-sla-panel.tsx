import { IconAlertTriangle, IconClock, IconHistory } from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import type {
  FeedbackCycle,
  FeedbackSlaLiveStatus,
  FeedbackSlaSnapshot,
  FeedbackStatus,
} from '../application/contracts';
import {
  CYCLE_ORIGIN_LABEL_IDS,
  FEEDBACK_PRIORITY_LABEL_IDS,
  SLA_CALENDAR_MODE_LABEL_IDS,
  SLA_EVALUATION_LABEL_IDS,
  formatFeedbackDateTime,
  formatFeedbackDurationMs,
} from './feedback-ui-helpers';

export interface FeedbackSlaPanelProps {
  readonly feedbackId: string;
  readonly feedbackStatus: FeedbackStatus;
  readonly currentCycle: FeedbackCycle;
  readonly cycles: readonly FeedbackCycle[];
  readonly currentSlaSnapshot: FeedbackSlaSnapshot;
  readonly slaSnapshots: readonly FeedbackSlaSnapshot[];
  readonly slaStatus: FeedbackSlaLiveStatus;
}

export function FeedbackSlaPanel({
  feedbackId,
  feedbackStatus,
  currentCycle,
  cycles,
  currentSlaSnapshot,
  slaSnapshots,
  slaStatus,
}: FeedbackSlaPanelProps) {
  const intl = useIntl();
  const headingId = `feedback-sla-heading-${feedbackId}`;
  const cyclesHeadingId = `feedback-cycles-heading-${feedbackId}`;

  const snapshotsById = new Map(slaSnapshots.map((snap) => [snap.id, snap]));

  const firstResponseBadgeLabel = slaStatus.firstResponseCompleted
    ? intl.formatMessage({ id: 'feedbacks.sla.status.COMPLETED' })
    : intl.formatMessage({ id: SLA_EVALUATION_LABEL_IDS[slaStatus.firstResponseStatus] });

  const resolutionPaused = feedbackStatus === 'WAITING_INFO' && !slaStatus.resolutionCompleted;
  const resolutionBadgeLabel = slaStatus.resolutionCompleted
    ? intl.formatMessage({ id: 'feedbacks.sla.status.COMPLETED' })
    : resolutionPaused
      ? intl.formatMessage({ id: 'feedbacks.sla.status.PAUSED' })
      : intl.formatMessage({ id: SLA_EVALUATION_LABEL_IDS[slaStatus.resolutionStatus] });

  const firstResponseVariant = slaStatus.firstResponseCompleted
    ? 'secondary'
    : slaStatus.firstResponseStatus === 'BREACHED'
      ? 'destructive'
      : slaStatus.firstResponseStatus === 'WARNING'
        ? 'default'
        : 'outline';

  const resolutionVariant = slaStatus.resolutionCompleted
    ? 'secondary'
    : resolutionPaused
      ? 'outline'
      : slaStatus.resolutionStatus === 'BREACHED'
        ? 'destructive'
        : slaStatus.resolutionStatus === 'WARNING'
          ? 'default'
          : 'outline';

  return (
    <div className="space-y-4">
      <Card aria-labelledby={headingId}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle id={headingId} className="flex items-center gap-2 text-lg">
              <IconClock className="h-5 w-5" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.sla.title' })}</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {intl.formatMessage({
                  id: SLA_CALENDAR_MODE_LABEL_IDS[currentSlaSnapshot.calendarMode],
                })}
              </Badge>
              {currentCycle.escalatedAt !== undefined ? (
                <Badge variant="destructive">
                  {intl.formatMessage({ id: 'feedbacks.sla.escalatedBadge' })}
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {intl.formatMessage({ id: 'feedbacks.sla.firstResponseLabel' })}
                </span>
                <Badge variant={firstResponseVariant}>{firstResponseBadgeLabel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {intl.formatMessage(
                  { id: 'feedbacks.sla.elapsedTarget' },
                  {
                    elapsed: formatFeedbackDurationMs(slaStatus.firstResponseElapsedMs, intl),
                    target: formatFeedbackDurationMs(slaStatus.firstResponseTargetMs, intl),
                  },
                )}
              </p>
            </div>

            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {intl.formatMessage({ id: 'feedbacks.sla.resolutionLabel' })}
                </span>
                <Badge variant={resolutionVariant}>{resolutionBadgeLabel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {intl.formatMessage(
                  { id: 'feedbacks.sla.elapsedTarget' },
                  {
                    elapsed: formatFeedbackDurationMs(slaStatus.resolutionElapsedMs, intl),
                    target: formatFeedbackDurationMs(slaStatus.resolutionTargetMs, intl),
                  },
                )}
              </p>
            </div>
          </div>

          {feedbackStatus === 'WAITING_INFO' ? (
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: 'feedbacks.status.waitingInfoPauseHint' })}
            </p>
          ) : null}

          {currentCycle.escalatedAt !== undefined ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
              <IconAlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span>
                {intl.formatMessage(
                  { id: 'feedbacks.sla.escalatedNotice' },
                  { date: formatFeedbackDateTime(currentCycle.escalatedAt, intl) },
                )}
              </span>
            </div>
          ) : null}

          {(currentCycle.manifestationDeadlineAt !== undefined ||
            currentCycle.contestDeadlineAt !== undefined) && (
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              {currentCycle.manifestationDeadlineAt !== undefined ? (
                <p>
                  {intl.formatMessage(
                    { id: 'feedbacks.sla.manifestationDeadlineLabel' },
                    { date: formatFeedbackDateTime(currentCycle.manifestationDeadlineAt, intl) },
                  )}
                </p>
              ) : null}
              {currentCycle.contestDeadlineAt !== undefined ? (
                <p>
                  {intl.formatMessage(
                    { id: 'feedbacks.sla.contestDeadlineLabel' },
                    { date: formatFeedbackDateTime(currentCycle.contestDeadlineAt, intl) },
                  )}
                </p>
              ) : null}
            </div>
          )}

          {(currentCycle.firstResponseWarningAt !== undefined ||
            currentCycle.firstResponseBreachedAt !== undefined ||
            currentCycle.resolutionWarningAt !== undefined ||
            currentCycle.resolutionBreachedAt !== undefined) && (
            <div className="space-y-1 border-t pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {intl.formatMessage({ id: 'feedbacks.sla.milestonesTitle' })}
              </h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {currentCycle.firstResponseWarningAt !== undefined ? (
                  <li>
                    {intl.formatMessage(
                      { id: 'feedbacks.sla.milestoneFirstResponseWarning' },
                      { date: formatFeedbackDateTime(currentCycle.firstResponseWarningAt, intl) },
                    )}
                  </li>
                ) : null}
                {currentCycle.firstResponseBreachedAt !== undefined ? (
                  <li>
                    {intl.formatMessage(
                      { id: 'feedbacks.sla.milestoneFirstResponseBreached' },
                      { date: formatFeedbackDateTime(currentCycle.firstResponseBreachedAt, intl) },
                    )}
                  </li>
                ) : null}
                {currentCycle.resolutionWarningAt !== undefined ? (
                  <li>
                    {intl.formatMessage(
                      { id: 'feedbacks.sla.milestoneResolutionWarning' },
                      { date: formatFeedbackDateTime(currentCycle.resolutionWarningAt, intl) },
                    )}
                  </li>
                ) : null}
                {currentCycle.resolutionBreachedAt !== undefined ? (
                  <li>
                    {intl.formatMessage(
                      { id: 'feedbacks.sla.milestoneResolutionBreached' },
                      { date: formatFeedbackDateTime(currentCycle.resolutionBreachedAt, intl) },
                    )}
                  </li>
                ) : null}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card aria-labelledby={cyclesHeadingId}>
        <CardHeader>
          <CardTitle id={cyclesHeadingId} className="flex items-center gap-2 text-lg">
            <IconHistory className="h-5 w-5" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'feedbacks.cycles.title' })}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cycles.map((cycle) => {
            const snapshot = snapshotsById.get(cycle.slaSnapshotId) ?? currentSlaSnapshot;
            const pauses = cycle.waitingInfoPauses ?? [];
            return (
              <div
                key={cycle.id}
                className="rounded-md border border-border bg-muted/20 p-3 text-sm space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {intl.formatMessage(
                        { id: 'feedbacks.cycles.cycleHeading' },
                        { number: cycle.cycleNumber },
                      )}
                    </span>
                    <Badge variant="outline">
                      {intl.formatMessage({ id: CYCLE_ORIGIN_LABEL_IDS[cycle.origin] })}
                    </Badge>
                  </div>
                  <time dateTime={cycle.startedAt} className="text-xs text-muted-foreground">
                    {formatFeedbackDateTime(cycle.startedAt, intl)}
                  </time>
                </div>

                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'feedbacks.cycles.snapshotSummary' },
                    {
                      priority: intl.formatMessage({
                        id: FEEDBACK_PRIORITY_LABEL_IDS[snapshot.prioritySnapshot],
                      }),
                      calendarMode: intl.formatMessage({
                        id: SLA_CALENDAR_MODE_LABEL_IDS[snapshot.calendarMode],
                      }),
                      firstResponse: formatFeedbackDurationMs(snapshot.firstResponseTargetMs, intl),
                      resolution: formatFeedbackDurationMs(snapshot.resolutionTargetMs, intl),
                    },
                  )}
                </p>

                {pauses.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      {intl.formatMessage(
                        { id: 'feedbacks.cycles.pausesTitle' },
                        { count: pauses.length },
                      )}
                    </p>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {pauses.map((pause) => (
                        <li key={pause.startedAt}>
                          {pause.endedAt === undefined
                            ? intl.formatMessage(
                                { id: 'feedbacks.cycles.pauseOpen' },
                                { startedAt: formatFeedbackDateTime(pause.startedAt, intl) },
                              )
                            : intl.formatMessage(
                                { id: 'feedbacks.cycles.pauseClosed' },
                                {
                                  startedAt: formatFeedbackDateTime(pause.startedAt, intl),
                                  endedAt: formatFeedbackDateTime(pause.endedAt, intl),
                                },
                              )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
