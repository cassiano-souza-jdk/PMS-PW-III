import { IconActivity, IconInfoCircle } from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import type { WorkloadScoreResult } from '@/modules/bottlenecks';
import type { MessageId } from '@/shared/i18n';
import type { BottleneckSeverity } from '@/shared/kernel';
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
import type { FocusPersonalCounters } from '../application/contracts';

const WORKLOAD_BAND_LABEL_ID: Readonly<Record<BottleneckSeverity, MessageId>> = {
  LOW: 'workload.band.LOW',
  MODERATE: 'workload.band.MODERATE',
  HIGH: 'workload.band.HIGH',
  CRITICAL: 'workload.band.CRITICAL',
};

const WORKLOAD_BAR_COLOR_BY_LEVEL: Readonly<Record<BottleneckSeverity, string>> = {
  LOW: 'bg-emerald-600 dark:bg-emerald-500',
  MODERATE: 'bg-sky-600 dark:bg-sky-500',
  HIGH: 'bg-amber-600 dark:bg-amber-500',
  CRITICAL: 'bg-destructive',
};

const WORKLOAD_BADGE_VARIANT_BY_LEVEL: Readonly<
  Record<BottleneckSeverity, 'secondary' | 'default' | 'outline' | 'destructive'>
> = {
  LOW: 'secondary',
  MODERATE: 'default',
  HIGH: 'outline',
  CRITICAL: 'destructive',
};

export interface FocusWorkloadCardProps {
  readonly workload: WorkloadScoreResult;
  readonly counters: FocusPersonalCounters;
  readonly inactiveCount: number;
}

export function FocusWorkloadCard({ workload, counters, inactiveCount }: FocusWorkloadCardProps) {
  const intl = useIntl();
  const clampedScore = Math.max(0, Math.min(100, workload.score));
  const bandLabel = intl.formatMessage({ id: WORKLOAD_BAND_LABEL_ID[workload.level] });
  const scoreText = intl.formatMessage({ id: 'workload.scoreLabel' }, { score: clampedScore });
  const levelText = intl.formatMessage({ id: 'workload.levelLabel' }, { band: bandLabel });

  const counterItems: readonly string[] = [
    intl.formatMessage(
      { id: 'focus.counters.visibleActive' },
      { count: counters.totalVisibleActiveCount },
    ),
    intl.formatMessage({ id: 'focus.counters.actionable' }, { count: counters.actionableCount }),
    intl.formatMessage({ id: 'focus.counters.inProgress' }, { count: counters.inProgressCount }),
    intl.formatMessage({ id: 'focus.counters.todo' }, { count: counters.todoCount }),
    intl.formatMessage({ id: 'focus.counters.paused' }, { count: counters.pausedCount }),
    intl.formatMessage({ id: 'focus.counters.blocked' }, { count: counters.blockedCount }),
    intl.formatMessage({ id: 'focus.counters.overdue' }, { count: counters.overdueCount }),
    intl.formatMessage({ id: 'focus.counters.inactive' }, { count: inactiveCount }),
    intl.formatMessage({ id: 'focus.counters.pinned' }, { count: counters.pinnedCount }),
    intl.formatMessage({ id: 'focus.counters.hidden' }, { count: counters.hiddenCount }),
    intl.formatMessage({ id: 'focus.counters.assigned' }, { count: counters.myAssignedTaskCount }),
    intl.formatMessage(
      { id: 'focus.counters.openSubtasks' },
      { count: counters.myOpenSubtaskCount },
    ),
  ];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconActivity className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle>{intl.formatMessage({ id: 'workload.title' })}</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={WORKLOAD_BADGE_VARIANT_BY_LEVEL[workload.level]}>{levelText}</Badge>
            <span className="text-sm font-semibold text-foreground">{scoreText}</span>
          </div>
        </div>
        <CardDescription>
          {intl.formatMessage({ id: 'workload.methodologySummary' })}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{scoreText}</span>
            <span>{bandLabel}</span>
          </div>
          <div
            role="progressbar"
            aria-label={intl.formatMessage({ id: 'workload.title' })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampedScore}
            aria-valuetext={`${scoreText} — ${levelText}`}
            className="h-3 w-full overflow-hidden rounded-full border border-border bg-muted"
          >
            <div
              className={`h-full transition-all ${WORKLOAD_BAR_COLOR_BY_LEVEL[workload.level]}`}
              style={{ width: `${clampedScore}%` }}
            />
          </div>
        </div>

        {!workload.representsHours ? (
          <Alert variant="info">
            <IconInfoCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              {intl.formatMessage({ id: 'workload.notHoursNotice' })}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
          <p>
            {intl.formatMessage(
              { id: 'workload.activeTasksCount' },
              { count: workload.activeTaskCount },
            )}
          </p>
          <p>
            {intl.formatMessage(
              { id: 'workload.activeSubtasksCount' },
              { count: workload.activeSubtaskCount },
            )}
          </p>
          <p>{intl.formatMessage({ id: 'workload.pausedReductionHint' })}</p>
          <p>{intl.formatMessage({ id: 'workload.subtasksIndependentHint' })}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            {intl.formatMessage({ id: 'focus.counters.title' })}
          </h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {counterItems.map((label) => (
              <li
                key={label}
                className="rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground"
              >
                {label}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
