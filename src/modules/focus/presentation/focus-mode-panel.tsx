import { IconInfoCircle, IconRefresh, IconTargetArrow } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import type { ProjectId, TaskId } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  ModalDialog,
} from '@/shared/ui';
import { FOCUS_MODES, type FocusMode, type MyFocusView } from '../application/contracts';
import {
  FocusActionableSection,
  FocusBlockedSection,
  FocusHiddenSection,
} from './focus-task-sections';
import { FocusWorkloadCard } from './focus-workload-card';

export interface FocusPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface FocusProjectFilterOption {
  readonly id: ProjectId;
  readonly name: string;
}

export interface FocusModePanelProps {
  readonly organizationName: string;
  readonly focusView: MyFocusView;
  readonly projects: readonly FocusProjectFilterOption[];
  readonly selectedProjectId: string;
  readonly onlyMyTasks: boolean;
  readonly inactiveCount: number;
  readonly isBusy: boolean;
  readonly focusHeadingTrigger?: string;
  readonly feedback?: FocusPanelFeedback | null;
  readonly announcement?: string;
  readonly onChangeProjectFilter: (projectId: string) => void;
  readonly onChangeOnlyMyTasks: (onlyMyTasks: boolean) => void;
  readonly onSwitchMode: (mode: FocusMode) => Promise<void>;
  readonly onPinTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onUnpinTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onHideTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onRestoreHiddenTask: (taskId: TaskId, title: string) => Promise<void>;
  readonly onRestoreAllHidden: () => Promise<void>;
  readonly onMoveTask: (taskId: TaskId, title: string, direction: 'UP' | 'DOWN') => Promise<void>;
  readonly onResetPreferences: () => Promise<void>;
}

export function FocusModePanel({
  organizationName,
  focusView,
  projects,
  selectedProjectId,
  onlyMyTasks,
  inactiveCount,
  isBusy,
  focusHeadingTrigger,
  feedback = null,
  announcement = '',
  onChangeProjectFilter,
  onChangeOnlyMyTasks,
  onSwitchMode,
  onPinTask,
  onUnpinTask,
  onHideTask,
  onRestoreHiddenTask,
  onRestoreAllHidden,
  onMoveTask,
  onResetPreferences,
}: FocusModePanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  const projectNameById = new Map<ProjectId, string>();
  for (const project of projects) {
    projectNameById.set(project.id, project.name);
  }

  const isAutoMode = focusView.mode === FOCUS_MODES.AUTO;

  const handleConfirmReset = async () => {
    await onResetPreferences();
    setIsResetModalOpen(false);
  };

  return (
    <section aria-labelledby="focus-heading" className="mx-auto w-full max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'focus.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <IconTargetArrow className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1
            ref={headingRef}
            id="focus-heading"
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight text-foreground focus:outline-none sm:text-4xl"
          >
            {intl.formatMessage({ id: 'focus.title' })}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
          <Badge variant="outline">
            {intl.formatMessage({
              id: isAutoMode ? 'focus.mode.AUTO' : 'focus.mode.MANUAL',
            })}
          </Badge>
        </div>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'focus.subtitle' })}
        </p>
      </div>

      <Alert variant="info">
        <IconInfoCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          {intl.formatMessage({ id: 'focus.personalIsolationNotice' })}
        </AlertDescription>
      </Alert>

      {feedback !== null ? (
        <Alert variant={feedback.type} role={feedback.type === 'destructive' ? 'alert' : 'status'}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <FocusWorkloadCard
        workload={focusView.workload}
        counters={focusView.counters}
        inactiveCount={inactiveCount}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{intl.formatMessage({ id: 'focus.mode.label' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="focus-project-filter">
                {intl.formatMessage({ id: 'focus.filters.projectLabel' })}
              </Label>
              <select
                id="focus-project-filter"
                value={selectedProjectId}
                disabled={isBusy}
                onChange={(event) => onChangeProjectFilter(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{intl.formatMessage({ id: 'focus.filters.allProjects' })}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label
                htmlFor="focus-only-my-tasks"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
              >
                <input
                  id="focus-only-my-tasks"
                  type="checkbox"
                  checked={onlyMyTasks}
                  disabled={isBusy}
                  onChange={(event) => onChangeOnlyMyTasks(event.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span>{intl.formatMessage({ id: 'focus.filters.onlyMyTasks' })}</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={isAutoMode ? 'default' : 'outline'}
                className="min-h-[44px]"
                aria-pressed={isAutoMode}
                disabled={isBusy || isAutoMode}
                onClick={() => void onSwitchMode(FOCUS_MODES.AUTO)}
              >
                {intl.formatMessage({ id: 'focus.mode.switchToAuto' })}
              </Button>
              <Button
                type="button"
                variant={!isAutoMode ? 'default' : 'outline'}
                className="min-h-[44px]"
                aria-pressed={!isAutoMode}
                disabled={isBusy || !isAutoMode}
                onClick={() => void onSwitchMode(FOCUS_MODES.MANUAL)}
              >
                {intl.formatMessage({ id: 'focus.mode.switchToManual' })}
              </Button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isBusy}
              onClick={() => setIsResetModalOpen(true)}
            >
              <IconRefresh className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'focus.resetAction' })}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <FocusActionableSection
        actionableTasks={focusView.ranking.actionableTasks}
        projectNameById={projectNameById}
        isBusy={isBusy}
        onPinTask={onPinTask}
        onUnpinTask={onUnpinTask}
        onHideTask={onHideTask}
        onMoveTask={onMoveTask}
      />

      <FocusBlockedSection
        blockedTasks={focusView.ranking.blockedTasks}
        projectNameById={projectNameById}
      />

      <FocusHiddenSection
        hiddenTasks={focusView.hiddenTasks}
        projectNameById={projectNameById}
        isBusy={isBusy}
        onRestoreHiddenTask={onRestoreHiddenTask}
        onRestoreAllHidden={onRestoreAllHidden}
      />

      <ModalDialog
        isOpen={isResetModalOpen}
        titleId="focus-reset-dialog-title"
        title={intl.formatMessage({ id: 'focus.resetConfirmTitle' })}
        descriptionId="focus-reset-dialog-desc"
        description={intl.formatMessage({ id: 'focus.resetConfirmDescription' })}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isBusy}
        onClose={() => setIsResetModalOpen(false)}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isBusy}
            onClick={() => setIsResetModalOpen(false)}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={isBusy}
            onClick={() => void handleConfirmReset()}
          >
            {intl.formatMessage({ id: 'common.confirm' })}
          </Button>
        </div>
      </ModalDialog>
    </section>
  );
}
