import { useIntl } from 'react-intl';
import { parseIsoDateTimeMs, type IsoDateTime, type UserId } from '@/shared/kernel';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui';
import {
  calculateTaskEffectiveDurationMs,
  type TaskDeadlineHistoryEntry,
  type TaskExecutionCycle,
  type TaskPause,
} from '../application/contracts';
import {
  formatDurationMs,
  formatIsoDateTimeShort,
  resolveUserDisplayName,
  type TaskUserOption,
} from './task-ui-helpers';

export interface TaskCyclesAndHistoryPanelProps {
  readonly executionCycles: readonly TaskExecutionCycle[];
  readonly pauses: readonly TaskPause[];
  readonly deadlineHistory: readonly TaskDeadlineHistoryEntry[];
  readonly canViewHistory: boolean;
  readonly referenceNowIso: IsoDateTime;
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
}

function computeSafeCycleDuration(
  cycle: TaskExecutionCycle,
  pauses: readonly TaskPause[],
  referenceNowIso: IsoDateTime,
): { readonly effectiveDurationMs: number; readonly pausedDurationMs: number } | null {
  try {
    const startIso = cycle.effectiveStartedAt ?? cycle.startedAt;
    const safeEndIso =
      cycle.completedAt ??
      (parseIsoDateTimeMs(referenceNowIso) >= parseIsoDateTimeMs(startIso)
        ? referenceNowIso
        : startIso);

    const result = calculateTaskEffectiveDurationMs(cycle, pauses, safeEndIso);
    return {
      effectiveDurationMs: result.effectiveDurationMs,
      pausedDurationMs: result.pausedDurationMs,
    };
  } catch {
    return null;
  }
}

export function TaskCyclesAndHistoryPanel({
  executionCycles,
  pauses,
  deadlineHistory,
  canViewHistory,
  referenceNowIso,
  usersById,
}: TaskCyclesAndHistoryPanelProps) {
  const intl = useIntl();
  const sortedCycles = [...executionCycles].sort((a, b) => a.cycleNumber - b.cycleNumber);
  const sortedPauses = [...pauses].sort(
    (a, b) => parseIsoDateTimeMs(a.startedAt) - parseIsoDateTimeMs(b.startedAt),
  );
  const sortedDeadlines = [...deadlineHistory].sort(
    (a, b) => parseIsoDateTimeMs(a.changedAt) - parseIsoDateTimeMs(b.changedAt),
  );

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'tasks.cycles.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'tasks.cycles.description' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedCycles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'tasks.cycles.empty' })}
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedCycles.map((cycle) => {
                const isActive = cycle.completedAt === undefined;
                const duration = computeSafeCycleDuration(cycle, pauses, referenceNowIso);

                return (
                  <li key={cycle.id} className="space-y-2 rounded-lg border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {intl.formatMessage(
                          { id: 'tasks.cycles.cycleLabel' },
                          { number: cycle.cycleNumber },
                        )}
                      </h3>
                      <Badge variant={isActive ? 'default' : 'secondary'}>
                        {intl.formatMessage({
                          id: isActive ? 'tasks.cycles.activeBadge' : 'tasks.cycles.closedBadge',
                        })}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.cycles.startedAtLabel' },
                          { date: formatIsoDateTimeShort(cycle.startedAt, intl) },
                        )}
                      </span>
                      {cycle.effectiveStartedAt !== undefined ? (
                        <span>
                          {intl.formatMessage(
                            { id: 'tasks.cycles.effectiveStartedAtLabel' },
                            { date: formatIsoDateTimeShort(cycle.effectiveStartedAt, intl) },
                          )}
                        </span>
                      ) : null}
                      {cycle.completedAt !== undefined ? (
                        <span>
                          {intl.formatMessage(
                            { id: 'tasks.cycles.completedAtLabel' },
                            { date: formatIsoDateTimeShort(cycle.completedAt, intl) },
                          )}
                        </span>
                      ) : null}
                      {duration !== null ? (
                        <>
                          <span>
                            {intl.formatMessage(
                              { id: 'tasks.cycles.effectiveDurationLabel' },
                              { duration: formatDurationMs(duration.effectiveDurationMs, intl) },
                            )}
                          </span>
                          <span>
                            {intl.formatMessage(
                              { id: 'tasks.cycles.pausedDurationLabel' },
                              { duration: formatDurationMs(duration.pausedDurationMs, intl) },
                            )}
                          </span>
                        </>
                      ) : null}
                    </div>

                    {cycle.reopenReason !== undefined ? (
                      <p className="text-xs text-foreground">
                        {intl.formatMessage(
                          { id: 'tasks.cycles.reopenReasonLabel' },
                          { reason: cycle.reopenReason },
                        )}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'tasks.pauses.title' })}</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedPauses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'tasks.pauses.empty' })}
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedPauses.map((pause) => {
                const isOpen = pause.endedAt === undefined;
                const starterName = resolveUserDisplayName(
                  pause.startedByUserId,
                  usersById,
                  unknownUserLabel,
                );

                return (
                  <li key={pause.id} className="space-y-1.5 rounded-lg border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {intl.formatMessage(
                          { id: 'tasks.pauses.reasonDisplay' },
                          { reason: pause.reason },
                        )}
                      </p>
                      {isOpen ? (
                        <Badge variant="outline">
                          {intl.formatMessage({ id: 'tasks.pauses.activeBadge' })}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.pauses.startedByLabel' },
                          { name: starterName },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.pauses.startedAtLabel' },
                          { date: formatIsoDateTimeShort(pause.startedAt, intl) },
                        )}
                      </span>
                      {pause.endedAt !== undefined ? (
                        <span>
                          {intl.formatMessage(
                            { id: 'tasks.pauses.endedAtLabel' },
                            { date: formatIsoDateTimeShort(pause.endedAt, intl) },
                          )}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'tasks.deadlineHistory.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'tasks.deadlineHistory.description' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canViewHistory ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'tasks.deadlineHistory.noPermission' })}
            </p>
          ) : sortedDeadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'tasks.deadlineHistory.empty' })}
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedDeadlines.map((entry) => {
                const changerName = resolveUserDisplayName(
                  entry.changedByUserId,
                  usersById,
                  unknownUserLabel,
                );
                const noDateLabel = intl.formatMessage({ id: 'tasks.deadlineHistory.noDate' });

                return (
                  <li key={entry.id} className="space-y-1.5 rounded-lg border bg-background p-4">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.deadlineHistory.previousLabel' },
                          {
                            date:
                              entry.previousDueDate !== undefined
                                ? formatIsoDateTimeShort(entry.previousDueDate, intl)
                                : noDateLabel,
                          },
                        )}
                      </span>
                      <span className="font-semibold">
                        {intl.formatMessage(
                          { id: 'tasks.deadlineHistory.newLabel' },
                          {
                            date:
                              entry.newDueDate !== undefined
                                ? formatIsoDateTimeShort(entry.newDueDate, intl)
                                : noDateLabel,
                          },
                        )}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.deadlineHistory.changedByLabel' },
                          { name: changerName },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.deadlineHistory.changedAtLabel' },
                          { date: formatIsoDateTimeShort(entry.changedAt, intl) },
                        )}
                      </span>
                    </div>

                    {entry.justification !== undefined ? (
                      <p className="text-xs text-foreground">
                        {intl.formatMessage(
                          { id: 'tasks.deadlineHistory.justificationLabel' },
                          { reason: entry.justification },
                        )}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
