import {
  IconArrowDown,
  IconArrowUp,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconLock,
  IconPin,
  IconPinnedOff,
} from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import type { Priority, ProjectId, TaskId, TaskStatus } from '@/shared/kernel';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui';
import type {
  BlockedFocusTask,
  FocusBlockingReasonCode,
  HiddenFocusTaskSummary,
  RankedFocusTask,
} from '../application/contracts';

const PRIORITY_LABEL_ID: Readonly<Record<Priority, MessageId>> = {
  LOW: 'tasks.priority.LOW',
  MEDIUM: 'tasks.priority.MEDIUM',
  HIGH: 'tasks.priority.HIGH',
  CRITICAL: 'tasks.priority.CRITICAL',
};

const STATUS_LABEL_ID: Readonly<Record<TaskStatus, MessageId>> = {
  TODO: 'tasks.status.TODO',
  IN_PROGRESS: 'tasks.status.IN_PROGRESS',
  PAUSED: 'tasks.status.PAUSED',
  BLOCKED: 'tasks.status.BLOCKED',
  DONE: 'tasks.status.DONE',
  CANCELLED: 'tasks.status.CANCELLED',
};

const BLOCKING_REASON_CODE_LABEL_ID: Readonly<Record<FocusBlockingReasonCode, MessageId>> = {
  OPEN_IMPEDIMENT: 'focus.blocked.reasonCode.OPEN_IMPEDIMENT',
  PENDING_DEPENDENCY: 'focus.blocked.reasonCode.PENDING_DEPENDENCY',
  PAUSED: 'focus.blocked.reasonCode.PAUSED',
  OTHER: 'focus.blocked.reasonCode.OTHER',
};

function formatDatePtBr(intl: ReturnType<typeof useIntl>, iso: string): string {
  return intl.formatDate(new Date(iso), { dateStyle: 'short' });
}

export interface FocusActionableSectionProps {
  readonly actionableTasks: readonly RankedFocusTask[];
  readonly projectNameById: ReadonlyMap<ProjectId, string>;
  readonly isBusy: boolean;
  readonly onPinTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onUnpinTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onHideTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onMoveTask: (taskId: TaskId, title: string, direction: 'UP' | 'DOWN') => Promise<void>;
}

export function FocusActionableSection({
  actionableTasks,
  projectNameById,
  isBusy,
  onPinTask,
  onUnpinTask,
  onHideTask,
  onMoveTask,
}: FocusActionableSectionProps) {
  const intl = useIntl();
  const pinnedTasks = actionableTasks.filter((item) => item.isPinned);
  const unpinnedTasks = actionableTasks.filter((item) => !item.isPinned);

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle>
          {intl.formatMessage({ id: 'focus.actionable.title' }, { count: actionableTasks.length })}
        </CardTitle>
        <CardDescription>
          {intl.formatMessage({ id: 'focus.actionable.description' })}
        </CardDescription>
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage({ id: 'focus.score.weightsSummary' })}
        </p>
      </CardHeader>

      <CardContent>
        {actionableTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'focus.actionable.emptyTitle' })}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {intl.formatMessage({ id: 'focus.actionable.emptyDescription' })}
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {actionableTasks.map((item) => {
              const { candidate, isPinned, score, factors } = item;
              const projectName = projectNameById.get(candidate.projectId);
              const groupList = isPinned ? pinnedTasks : unpinnedTasks;
              const groupIndex = groupList.findIndex(
                (entry) => entry.candidate.taskId === candidate.taskId,
              );
              const canMoveUp = groupIndex > 0;
              const canMoveDown = groupIndex >= 0 && groupIndex < groupList.length - 1;

              return (
                <li key={candidate.taskId} className="space-y-3 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">
                          {candidate.title}
                        </h3>
                        {isPinned ? (
                          <Badge variant="default">
                            {intl.formatMessage({ id: 'focus.actions.pinnedBadge' })}
                          </Badge>
                        ) : null}
                        {projectName !== undefined ? (
                          <Badge variant="outline">{projectName}</Badge>
                        ) : null}
                        <Badge variant="secondary">
                          {intl.formatMessage({ id: STATUS_LABEL_ID[candidate.status] })}
                        </Badge>
                        <Badge variant="outline">
                          {intl.formatMessage({ id: PRIORITY_LABEL_ID[candidate.priority] })}
                        </Badge>
                      </div>
                      {candidate.dueDate !== undefined ? (
                        <p className="text-xs text-muted-foreground">
                          {intl.formatMessage(
                            { id: 'tasks.dueDateLabel' },
                            { date: formatDatePtBr(intl, candidate.dueDate) },
                          )}
                        </p>
                      ) : null}
                    </div>

                    <Badge variant="secondary">
                      {intl.formatMessage({ id: 'focus.score.totalLabel' }, { score })}
                    </Badge>
                  </div>

                  <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-foreground">
                      {intl.formatMessage({ id: 'focus.score.breakdownTitle' })}
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                      <span>
                        {intl.formatMessage(
                          { id: 'focus.score.priorityFactor' },
                          { score: factors.priorityScore },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'focus.score.deadlineFactor' },
                          { score: factors.deadlineScore },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'focus.score.dependenciesFactor' },
                          { score: factors.dependencyScore },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'focus.score.inactivityFactor' },
                          { score: factors.inactivityScore },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'focus.score.workloadCompatibilityFactor' },
                          { score: factors.workloadCompatibilityScore },
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" className="min-h-[44px]">
                      <Link
                        to={`/projects/${candidate.projectId}/tasks/${candidate.taskId}`}
                        aria-label={intl.formatMessage(
                          { id: 'focus.actions.openTaskDetailAriaLabel' },
                          { title: candidate.title },
                        )}
                      >
                        <IconExternalLink className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'focus.actions.openTaskDetail' })}</span>
                      </Link>
                    </Button>

                    <Button
                      type="button"
                      variant={isPinned ? 'secondary' : 'outline'}
                      className="min-h-[44px]"
                      disabled={isBusy}
                      onClick={() =>
                        void (isPinned
                          ? onUnpinTask(candidate.taskId, candidate.title)
                          : onPinTask(candidate.taskId, candidate.title))
                      }
                    >
                      {isPinned ? (
                        <IconPinnedOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <IconPin className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>
                        {intl.formatMessage({
                          id: isPinned ? 'focus.actions.unpin' : 'focus.actions.pin',
                        })}
                      </span>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px]"
                      disabled={isBusy}
                      onClick={() => void onHideTask(candidate.taskId, candidate.title)}
                    >
                      <IconEyeOff className="h-4 w-4" aria-hidden="true" />
                      <span>{intl.formatMessage({ id: 'focus.actions.hide' })}</span>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-[44px]"
                      disabled={isBusy || !canMoveUp}
                      onClick={() => void onMoveTask(candidate.taskId, candidate.title, 'UP')}
                    >
                      <IconArrowUp className="h-4 w-4" aria-hidden="true" />
                      <span>{intl.formatMessage({ id: 'focus.actions.moveUp' })}</span>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-[44px]"
                      disabled={isBusy || !canMoveDown}
                      onClick={() => void onMoveTask(candidate.taskId, candidate.title, 'DOWN')}
                    >
                      <IconArrowDown className="h-4 w-4" aria-hidden="true" />
                      <span>{intl.formatMessage({ id: 'focus.actions.moveDown' })}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export interface FocusBlockedSectionProps {
  readonly blockedTasks: readonly BlockedFocusTask[];
  readonly projectNameById: ReadonlyMap<ProjectId, string>;
}

export function FocusBlockedSection({ blockedTasks, projectNameById }: FocusBlockedSectionProps) {
  const intl = useIntl();

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-center gap-2">
          <IconLock className="h-5 w-5 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <CardTitle>
            {intl.formatMessage({ id: 'focus.blocked.title' }, { count: blockedTasks.length })}
          </CardTitle>
        </div>
        <CardDescription>{intl.formatMessage({ id: 'focus.blocked.description' })}</CardDescription>
      </CardHeader>

      <CardContent>
        {blockedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'focus.blocked.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {blockedTasks.map((item) => {
              const { candidate, reasons } = item;
              const projectName = projectNameById.get(candidate.projectId);

              return (
                <li key={candidate.taskId} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{candidate.title}</h3>
                      {projectName !== undefined ? (
                        <Badge variant="outline">{projectName}</Badge>
                      ) : null}
                      <Badge variant="destructive">
                        {intl.formatMessage({ id: STATUS_LABEL_ID[candidate.status] })}
                      </Badge>
                      <Badge variant="outline">
                        {intl.formatMessage({ id: PRIORITY_LABEL_ID[candidate.priority] })}
                      </Badge>
                    </div>

                    <Button asChild variant="outline" className="min-h-[44px]">
                      <Link
                        to={`/projects/${candidate.projectId}/tasks/${candidate.taskId}`}
                        aria-label={intl.formatMessage(
                          { id: 'focus.actions.openTaskDetailAriaLabel' },
                          { title: candidate.title },
                        )}
                      >
                        <IconExternalLink className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'focus.actions.openTaskDetail' })}</span>
                      </Link>
                    </Button>
                  </div>

                  <ul className="space-y-2">
                    {reasons.map((reason, index) => (
                      <li
                        key={`${reason.code}-${index}`}
                        className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {intl.formatMessage({
                              id: BLOCKING_REASON_CODE_LABEL_ID[reason.code],
                            })}
                          </Badge>
                        </div>
                        <p className="text-foreground">
                          {intl.formatMessage(
                            { id: 'focus.blocked.reasonLabel' },
                            { reason: reason.description },
                          )}
                        </p>
                        <p className="text-muted-foreground">
                          {intl.formatMessage(
                            { id: 'focus.blocked.unblockConditionLabel' },
                            { condition: reason.unblockCondition },
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export interface FocusHiddenSectionProps {
  readonly hiddenTasks: readonly HiddenFocusTaskSummary[];
  readonly projectNameById: ReadonlyMap<ProjectId, string>;
  readonly isBusy: boolean;
  readonly onRestoreHiddenTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onRestoreAllHidden: () => Promise<void>;
}

export function FocusHiddenSection({
  hiddenTasks,
  projectNameById,
  isBusy,
  onRestoreHiddenTask,
  onRestoreAllHidden,
}: FocusHiddenSectionProps) {
  const intl = useIntl();

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle>
              {intl.formatMessage({ id: 'focus.hidden.title' }, { count: hiddenTasks.length })}
            </CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'focus.hidden.description' })}
            </CardDescription>
          </div>
          {hiddenTasks.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isBusy}
              onClick={() => void onRestoreAllHidden()}
            >
              <IconEye className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'focus.actions.restoreAllHidden' })}</span>
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {hiddenTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'focus.hidden.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {hiddenTasks.map((task) => {
              const projectName = projectNameById.get(task.projectId);
              return (
                <li
                  key={task.taskId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{task.title}</h3>
                      {projectName !== undefined ? (
                        <Badge variant="outline">{projectName}</Badge>
                      ) : null}
                      <Badge variant="secondary">
                        {intl.formatMessage({ id: STATUS_LABEL_ID[task.status] })}
                      </Badge>
                      <Badge variant="outline">
                        {intl.formatMessage({ id: PRIORITY_LABEL_ID[task.priority] })}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" className="min-h-[44px]">
                      <Link
                        to={`/projects/${task.projectId}/tasks/${task.taskId}`}
                        aria-label={intl.formatMessage(
                          { id: 'focus.actions.openTaskDetailAriaLabel' },
                          { title: task.title },
                        )}
                      >
                        <IconExternalLink className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'focus.actions.openTaskDetail' })}</span>
                      </Link>
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-[44px]"
                      disabled={isBusy}
                      onClick={() => void onRestoreHiddenTask(task.taskId, task.title)}
                    >
                      <IconEye className="h-4 w-4" aria-hidden="true" />
                      <span>{intl.formatMessage({ id: 'focus.actions.restoreHidden' })}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
