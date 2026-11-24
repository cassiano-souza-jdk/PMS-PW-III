import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization } from '@/app/providers';
import { detectInactiveTasks } from '@/modules/bottlenecks';
import { FOCUS_MODES, type FocusMode, type MyFocusView } from '@/modules/focus';
import {
  FocusModePanel,
  type FocusPanelFeedback,
  type FocusProjectFilterOption,
} from '@/modules/focus/presentation';
import type { MessageId } from '@/shared/i18n';
import { asIsoDateTime, asProjectId, isUuid, type ProjectId, type TaskId } from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedFocusState {
  readonly contextKey: string | null;
  readonly focusView: MyFocusView | null;
  readonly projects: readonly FocusProjectFilterOption[];
  readonly errorMessageId: MessageId | null;
}

const INITIAL_FOCUS_STATE: LoadedFocusState = {
  contextKey: null,
  focusView: null,
  projects: [],
  errorMessageId: null,
};

function swapItems<T>(items: readonly T[], fromIndex: number, toIndex: number): readonly T[] {
  const copy = [...items];
  const current = copy[fromIndex];
  const target = copy[toIndex];
  if (current === undefined || target === undefined) {
    return items;
  }
  copy[fromIndex] = target;
  copy[toIndex] = current;
  return copy;
}

export function FocusPage() {
  const intl = useIntl();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [onlyMyTasks, setOnlyMyTasks] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FocusPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedFocusState>(INITIAL_FOCUS_STATE);

  const validFilterProjectId: ProjectId | undefined =
    selectedProjectId !== '' && isUuid(selectedProjectId)
      ? asProjectId(selectedProjectId, 'projectId')
      : undefined;

  const contextKey =
    user !== null && activeOrganization !== null
      ? `${user.id}:${activeOrganization.id}:${validFilterProjectId ?? 'all'}:${onlyMyTasks ? 'mine' : 'all'}`
      : null;

  const fetchFocusBundle = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    const [focusView, projects] = await Promise.all([
      services.focus.getMyFocusView(user.id, activeOrganization.id, {
        ...(validFilterProjectId !== undefined ? { projectId: validFilterProjectId } : {}),
        onlyMyTasks,
      }),
      services.projects
        .listProjects(user.id, activeOrganization.id, { includeArchived: false })
        .then((list) => list.map((item) => ({ id: item.id, name: item.name })))
        .catch(() => []),
    ]);

    setState({
      contextKey,
      focusView,
      projects,
      errorMessageId: null,
    });
  }, [
    activeOrganization,
    contextKey,
    onlyMyTasks,
    services.focus,
    services.projects,
    user,
    validFilterProjectId,
  ]);

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const targetUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetKey = contextKey;

    async function loadInitial() {
      try {
        const [focusView, projects] = await Promise.all([
          services.focus.getMyFocusView(targetUserId, targetOrgId, {
            ...(validFilterProjectId !== undefined ? { projectId: validFilterProjectId } : {}),
            onlyMyTasks,
          }),
          services.projects
            .listProjects(targetUserId, targetOrgId, { includeArchived: false })
            .then((list) => list.map((item) => ({ id: item.id, name: item.name })))
            .catch(() => []),
        ]);

        if (!isActive) {
          return;
        }

        setState({
          contextKey: targetKey,
          focusView,
          projects,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          focusView: null,
          projects: [],
          errorMessageId: resolveTaskPageErrorMessageId(error),
        });
      }
    }

    void loadInitial();

    return () => {
      isActive = false;
    };
  }, [
    activeOrganization,
    contextKey,
    onlyMyTasks,
    services.focus,
    services.projects,
    user,
    validFilterProjectId,
  ]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const focusView = isCurrentContext ? state.focusView : null;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (activeOrganization === null) {
      document.title = `${intl.formatMessage({ id: 'organizations.title' })} | ${shortName}`;
      return;
    }
    if (loadErrorMessageId !== null) {
      const titleId: MessageId =
        loadErrorMessageId === 'errors.AUTHORIZATION_ERROR'
          ? 'feedback.unauthorizedTitle'
          : loadErrorMessageId;
      document.title = `${intl.formatMessage({ id: titleId })} | ${shortName}`;
      return;
    }
    if (focusView !== null) {
      document.title = intl.formatMessage({ id: 'focus.pageTitle' });
      return;
    }
    document.title = intl.formatMessage({ id: 'app.name' });
  }, [activeOrganization, focusView, intl, loadErrorMessageId]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="focus-no-org-heading" headingText="" />;
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="focus-loading-heading"
        headingText={intl.formatMessage({ id: 'focus.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || focusView === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="focus-error-heading"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
        backToPath="/projects"
        backLabelId="bottlenecks.project.backToProjects"
      />
    );
  }

  const inactiveCount = detectInactiveTasks(
    focusView.ranking.actionableTasks.map((entry) => ({
      taskId: entry.candidate.taskId,
      status: entry.candidate.status,
      lastMovedAt: entry.candidate.lastMovedAt,
      lastActivityAt: entry.candidate.lastMovedAt,
      inactivityThresholdDays: entry.candidate.inactivityThresholdDays,
    })),
    asIsoDateTime(focusView.generatedAt),
  ).inactiveTaskIds.length;

  const runPreferenceMutation = async (mutate: () => Promise<unknown>, successMessage: string) => {
    setFeedback(null);
    setIsBusy(true);
    try {
      await mutate();
      await fetchFocusBundle();
      setAnnouncement(successMessage);
      setFeedback({ type: 'success', message: successMessage });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSwitchMode = async (mode: FocusMode) => {
    const modeLabel = intl.formatMessage({
      id: mode === FOCUS_MODES.AUTO ? 'focus.mode.AUTO' : 'focus.mode.MANUAL',
    });
    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          mode,
        }),
      intl.formatMessage({ id: 'focus.mode.updatedSuccess' }, { mode: modeLabel }),
    );
  };

  const handlePinTask = async (taskId: TaskId, title: string) => {
    const existingPinned = focusView.preference?.pinnedTaskIds ?? [];
    const nextPinned = existingPinned.includes(taskId)
      ? existingPinned
      : [...existingPinned, taskId];
    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          pinnedTaskIds: nextPinned,
        }),
      intl.formatMessage({ id: 'focus.actions.pinnedSuccess' }, { title }),
    );
  };

  const handleUnpinTask = async (taskId: TaskId, title: string) => {
    const existingPinned = focusView.preference?.pinnedTaskIds ?? [];
    const nextPinned = existingPinned.filter((id) => id !== taskId);
    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          pinnedTaskIds: nextPinned,
        }),
      intl.formatMessage({ id: 'focus.actions.unpinnedSuccess' }, { title }),
    );
  };

  const handleHideTask = async (taskId: TaskId, title: string) => {
    const existingHidden = focusView.preference?.hiddenTaskIds ?? [];
    const nextHidden = existingHidden.includes(taskId)
      ? existingHidden
      : [...existingHidden, taskId];
    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          hiddenTaskIds: nextHidden,
        }),
      intl.formatMessage({ id: 'focus.actions.hiddenSuccess' }, { title }),
    );
  };

  const handleRestoreHiddenTask = async (taskId: TaskId, title: string) => {
    const existingHidden = focusView.preference?.hiddenTaskIds ?? [];
    const nextHidden = existingHidden.filter((id) => id !== taskId);
    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          hiddenTaskIds: nextHidden,
        }),
      intl.formatMessage({ id: 'focus.actions.restoredSuccess' }, { title }),
    );
  };

  const handleRestoreAllHidden = async () => {
    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          hiddenTaskIds: [],
        }),
      intl.formatMessage({ id: 'focus.actions.restoreAllHidden' }),
    );
  };

  const handleMoveTask = async (taskId: TaskId, title: string, direction: 'UP' | 'DOWN') => {
    const pinnedItems = focusView.ranking.actionableTasks.filter((item) => item.isPinned);
    const unpinnedItems = focusView.ranking.actionableTasks.filter((item) => !item.isPinned);

    const pinnedIndex = pinnedItems.findIndex((item) => item.candidate.taskId === taskId);
    if (pinnedIndex >= 0) {
      const targetIndex = direction === 'UP' ? pinnedIndex - 1 : pinnedIndex + 1;
      if (targetIndex < 0 || targetIndex >= pinnedItems.length) {
        return;
      }
      const nextVisiblePinned = swapItems(
        pinnedItems.map((item) => item.candidate.taskId),
        pinnedIndex,
        targetIndex,
      );
      const visiblePinnedSet = new Set(nextVisiblePinned);
      const remainingPinned = (focusView.preference?.pinnedTaskIds ?? []).filter(
        (id) => !visiblePinnedSet.has(id),
      );
      await runPreferenceMutation(
        () =>
          services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
            pinnedTaskIds: [...nextVisiblePinned, ...remainingPinned],
          }),
        intl.formatMessage(
          { id: 'focus.actions.reorderedAnnouncement' },
          { title, position: targetIndex + 1 },
        ),
      );
      return;
    }

    const unpinnedIndex = unpinnedItems.findIndex((item) => item.candidate.taskId === taskId);
    if (unpinnedIndex < 0) {
      return;
    }
    const targetIndex = direction === 'UP' ? unpinnedIndex - 1 : unpinnedIndex + 1;
    if (targetIndex < 0 || targetIndex >= unpinnedItems.length) {
      return;
    }

    const nextVisibleUnpinned = swapItems(
      unpinnedItems.map((item) => item.candidate.taskId),
      unpinnedIndex,
      targetIndex,
    );
    const visibleUnpinnedSet = new Set(nextVisibleUnpinned);
    const remainingManual = (focusView.preference?.manualOrderTaskIds ?? []).filter(
      (id) => !visibleUnpinnedSet.has(id),
    );

    await runPreferenceMutation(
      () =>
        services.focus.updateFocusPreferences(user.id, activeOrganization.id, {
          mode: FOCUS_MODES.MANUAL,
          manualOrderTaskIds: [...nextVisibleUnpinned, ...remainingManual],
        }),
      intl.formatMessage(
        { id: 'focus.actions.reorderedAnnouncement' },
        { title, position: pinnedItems.length + targetIndex + 1 },
      ),
    );
  };

  const handleResetPreferences = async () => {
    await runPreferenceMutation(
      () => services.focus.resetFocusPreferences(user.id, activeOrganization.id),
      intl.formatMessage({ id: 'focus.resetSuccess' }),
    );
  };

  return (
    <FocusModePanel
      organizationName={activeOrganization.name}
      focusView={focusView}
      projects={state.projects}
      selectedProjectId={selectedProjectId}
      onlyMyTasks={onlyMyTasks}
      inactiveCount={inactiveCount}
      isBusy={isBusy}
      focusHeadingTrigger={`${user.id}:${activeOrganization.id}`}
      feedback={feedback}
      announcement={announcement}
      onChangeProjectFilter={(nextProjectId) => {
        setFeedback(null);
        setSelectedProjectId(nextProjectId);
      }}
      onChangeOnlyMyTasks={(nextOnlyMyTasks) => {
        setFeedback(null);
        setOnlyMyTasks(nextOnlyMyTasks);
      }}
      onSwitchMode={handleSwitchMode}
      onPinTask={handlePinTask}
      onUnpinTask={handleUnpinTask}
      onHideTask={handleHideTask}
      onRestoreHiddenTask={handleRestoreHiddenTask}
      onRestoreAllHidden={handleRestoreAllHidden}
      onMoveTask={handleMoveTask}
      onResetPreferences={handleResetPreferences}
    />
  );
}

export default FocusPage;
