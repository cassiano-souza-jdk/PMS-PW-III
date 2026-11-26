import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  FeedbackCategoryId,
  FeedbackCategoryWithVersion,
  FeedbackExportFormat,
  FeedbackListResult,
} from '@/modules/feedback';
import {
  FeedbackListPanel,
  type FeedbackPanelFeedback,
  type FeedbackQueueFiltersState,
} from '@/modules/feedback/presentation';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type { MessageId } from '@/shared/i18n';
import { asEntityId, asIsoDateTime, type Priority } from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedFeedbackQueueState {
  readonly contextKey: string | null;
  readonly listResult: FeedbackListResult | null;
  readonly categories: readonly FeedbackCategoryWithVersion[];
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_QUEUE_STATE: LoadedFeedbackQueueState = {
  contextKey: null,
  listResult: null,
  categories: [],
  settings: null,
  errorMessageId: null,
};

const INITIAL_FILTERS: FeedbackQueueFiltersState = {
  search: '',
  status: '',
  priority: '',
  moduleKey: '',
  onlyMine: false,
  assignedToMe: false,
};

export function FeedbackPage() {
  const intl = useIntl();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const [filters, setFilters] = useState<FeedbackQueueFiltersState>(INITIAL_FILTERS);
  const [page, setPage] = useState<number>(1);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FeedbackPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedFeedbackQueueState>(INITIAL_QUEUE_STATE);

  const contextKey =
    user !== null && activeOrganization !== null
      ? `${user.id}:${activeOrganization.id}:${page}:${filters.status}:${filters.priority}:${filters.moduleKey}:${filters.search}:${filters.onlyMine ? 'mine' : 'all'}:${filters.assignedToMe ? 'assigned' : 'all'}`
      : null;

  const fetchQueueBundle = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    const [listResult, categories, persistedSettings] = await Promise.all([
      services.feedback.listFeedbacks(user.id, activeOrganization.id, {
        ...(filters.status !== '' ? { status: filters.status } : {}),
        ...(filters.priority !== '' ? { priority: filters.priority } : {}),
        ...(filters.moduleKey !== '' ? { moduleKey: filters.moduleKey } : {}),
        ...(filters.search.trim().length > 0 ? { search: filters.search.trim() } : {}),
        ...(filters.onlyMine ? { authorUserId: user.id } : {}),
        ...(filters.assignedToMe ? { assigneeId: user.id } : {}),
        page,
        pageSize: 20,
      }),
      services.feedback.listFeedbackCategories(user.id, activeOrganization.id).catch(() => []),
      repositories.settings.organizationSettings
        .findByOrganization(activeOrganization.id)
        .catch(() => null),
    ]);

    setState({
      contextKey,
      listResult,
      categories,
      settings: persistedSettings,
      errorMessageId: null,
    });
  }, [
    activeOrganization,
    contextKey,
    filters,
    page,
    repositories.settings,
    services.feedback,
    user,
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
        const [listResult, categories, persistedSettings] = await Promise.all([
          services.feedback.listFeedbacks(targetUserId, targetOrgId, {
            ...(filters.status !== '' ? { status: filters.status } : {}),
            ...(filters.priority !== '' ? { priority: filters.priority } : {}),
            ...(filters.moduleKey !== '' ? { moduleKey: filters.moduleKey } : {}),
            ...(filters.search.trim().length > 0 ? { search: filters.search.trim() } : {}),
            ...(filters.onlyMine ? { authorUserId: targetUserId } : {}),
            ...(filters.assignedToMe ? { assigneeId: targetUserId } : {}),
            page,
            pageSize: 20,
          }),
          services.feedback.listFeedbackCategories(targetUserId, targetOrgId).catch(() => []),
          repositories.settings.organizationSettings
            .findByOrganization(targetOrgId)
            .catch(() => null),
        ]);

        if (!isActive) {
          return;
        }

        setState({
          contextKey: targetKey,
          listResult,
          categories,
          settings: persistedSettings,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          listResult: null,
          categories: [],
          settings: null,
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
    filters,
    page,
    repositories.settings,
    services.feedback,
    user,
  ]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const listResult = isCurrentContext ? state.listResult : null;
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
    if (listResult !== null) {
      document.title = intl.formatMessage({ id: 'feedbacks.queue.pageTitle' });
      return;
    }
    document.title = intl.formatMessage({ id: 'app.name' });
  }, [activeOrganization, intl, listResult, loadErrorMessageId]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="feedback-no-org-heading" headingText="" />;
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="feedback-loading-heading"
        headingText={intl.formatMessage({ id: 'feedbacks.queue.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || listResult === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="feedback-error-heading"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
        backToPath="/organizations"
        backLabelId="nav.organizations"
      />
    );
  }

  const effectiveSettings =
    state.settings ??
    createDefaultOrganizationSettings(
      activeOrganization.id,
      asIsoDateTime(new Date().toISOString()),
    );
  const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);
  const orgResource = {
    kind: 'FEEDBACK' as const,
    id: asEntityId(activeOrganization.id),
    exists: true,
    organizationId: activeOrganization.id,
  };

  const canCreateFeedback = can(PERMISSION_CODES.FEEDBACK_CREATE, orgResource, policyConfig);
  const canEvaluateSla = can(PERMISSION_CODES.FEEDBACK_SLA_MANAGE, orgResource, policyConfig);
  const canExportFeedbacks = can(PERMISSION_CODES.FEEDBACK_EXPORT, orgResource, policyConfig);
  const canAccessGovernance =
    activeOrganization.role === 'ADMIN' &&
    can(PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE, orgResource, policyConfig);

  const runMutation = async (mutate: () => Promise<unknown>, successMessage: string) => {
    setFeedback(null);
    setIsBusy(true);
    try {
      await mutate();
      await fetchQueueBundle();
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

  const handleCreateFeedback = async (input: {
    readonly moduleKey: string;
    readonly categoryId: FeedbackCategoryId;
    readonly title: string;
    readonly description: string;
    readonly priority: Priority;
  }) => {
    await runMutation(
      () => services.feedback.createFeedback(user.id, activeOrganization.id, input),
      intl.formatMessage({ id: 'feedbacks.create.success' }),
    );
  };

  const handleEvaluateSlas = async () => {
    setFeedback(null);
    setIsBusy(true);
    try {
      const result = await services.feedback.evaluateFeedbackSlas(user.id, activeOrganization.id);
      await fetchQueueBundle();
      const message = intl.formatMessage(
        { id: 'feedbacks.slaEvaluation.success' },
        {
          evaluatedCount: result.evaluatedCount,
          updatedCycleCount: result.updatedCycleCount,
          warningCount: result.warningCount,
          breachedCount: result.breachedCount,
          escalatedCount: result.escalatedCount,
          autoClosedCount: result.autoClosedCount,
        },
      );
      setAnnouncement(message);
      setFeedback({ type: 'success', message });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportFeedbacks = async (format: FeedbackExportFormat) => {
    const result = await services.feedback.exportFeedbacks(user.id, activeOrganization.id, {
      format,
      ...(filters.status !== '' ? { status: filters.status } : {}),
      ...(filters.onlyMine ? { authorUserId: user.id } : {}),
      ...(filters.assignedToMe ? { assigneeId: user.id } : {}),
    });
    const successMessage = intl.formatMessage(
      { id: 'feedbacks.export.success' },
      { fileName: result.fileName, totalCount: result.totalCount },
    );
    setAnnouncement(successMessage);
    setFeedback({ type: 'success', message: successMessage });
    return result;
  };

  return (
    <FeedbackListPanel
      organizationName={activeOrganization.name}
      currentUserName={user.displayName}
      items={listResult.items}
      countsByStatus={listResult.countsByStatus}
      totalCount={listResult.totalCount}
      page={listResult.page}
      totalPages={listResult.totalPages}
      categories={state.categories}
      filters={filters}
      canCreateFeedback={canCreateFeedback}
      canEvaluateSla={canEvaluateSla}
      canExportFeedbacks={canExportFeedbacks}
      canAccessGovernance={canAccessGovernance}
      isBusy={isBusy}
      feedback={feedback}
      announcement={announcement}
      focusHeadingTrigger={activeOrganization.id}
      onChangeFilters={(next) => {
        setPage(1);
        setFilters(next);
      }}
      onClearFilters={() => {
        setPage(1);
        setFilters(INITIAL_FILTERS);
      }}
      onChangePage={setPage}
      onCreateFeedback={handleCreateFeedback}
      onEvaluateSlas={handleEvaluateSlas}
      onExportFeedbacks={handleExportFeedbacks}
    />
  );
}

export default FeedbackPage;
