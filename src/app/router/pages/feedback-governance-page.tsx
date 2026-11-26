import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  CreateCatalogItemInput,
  FeedbackCategoryId,
  FeedbackCategoryWithVersion,
  FeedbackContestReasonId,
  FeedbackContestReasonWithVersion,
  FeedbackSlaSettingsView,
  UpdateCatalogItemInput,
  UpdateFeedbackSlaSettingsInput,
} from '@/modules/feedback';
import {
  FeedbackGovernancePanel,
  type FeedbackPanelFeedback,
} from '@/modules/feedback/presentation';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type { MessageId } from '@/shared/i18n';
import { asEntityId, asIsoDateTime } from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedGovernanceState {
  readonly contextKey: string | null;
  readonly categories: readonly FeedbackCategoryWithVersion[];
  readonly contestReasons: readonly FeedbackContestReasonWithVersion[];
  readonly slaSettings: FeedbackSlaSettingsView | null;
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_GOVERNANCE_STATE: LoadedGovernanceState = {
  contextKey: null,
  categories: [],
  contestReasons: [],
  slaSettings: null,
  settings: null,
  errorMessageId: null,
};

export function FeedbackGovernancePage() {
  const intl = useIntl();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FeedbackPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedGovernanceState>(INITIAL_GOVERNANCE_STATE);

  const contextKey =
    user !== null && activeOrganization !== null ? `${user.id}:${activeOrganization.id}` : null;

  const fetchGovernanceBundle = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    const [categories, contestReasons, slaSettings, persistedSettings] = await Promise.all([
      services.feedback.listFeedbackCategories(user.id, activeOrganization.id, {
        includeInactive: true,
      }),
      services.feedback.listFeedbackContestReasons(user.id, activeOrganization.id, {
        includeInactive: true,
      }),
      services.feedback.getFeedbackSlaSettings(user.id, activeOrganization.id),
      repositories.settings.organizationSettings
        .findByOrganization(activeOrganization.id)
        .catch(() => null),
    ]);

    setState({
      contextKey,
      categories,
      contestReasons,
      slaSettings,
      settings: persistedSettings,
      errorMessageId: null,
    });
  }, [activeOrganization, contextKey, repositories.settings, services.feedback, user]);

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
        const [categories, contestReasons, slaSettings, persistedSettings] = await Promise.all([
          services.feedback.listFeedbackCategories(targetUserId, targetOrgId, {
            includeInactive: true,
          }),
          services.feedback.listFeedbackContestReasons(targetUserId, targetOrgId, {
            includeInactive: true,
          }),
          services.feedback.getFeedbackSlaSettings(targetUserId, targetOrgId),
          repositories.settings.organizationSettings
            .findByOrganization(targetOrgId)
            .catch(() => null),
        ]);

        if (!isActive) {
          return;
        }

        setState({
          contextKey: targetKey,
          categories,
          contestReasons,
          slaSettings,
          settings: persistedSettings,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          categories: [],
          contestReasons: [],
          slaSettings: null,
          settings: null,
          errorMessageId: resolveTaskPageErrorMessageId(error),
        });
      }
    }

    void loadInitial();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, contextKey, repositories.settings, services.feedback, user]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const slaSettings = isCurrentContext ? state.slaSettings : null;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;

  const effectiveSettings =
    activeOrganization !== null
      ? (state.settings ??
        createDefaultOrganizationSettings(
          activeOrganization.id,
          asIsoDateTime(new Date().toISOString()),
        ))
      : null;
  const policyConfig =
    effectiveSettings !== null ? toAuthorizationPolicyConfig(effectiveSettings) : undefined;
  const orgResource =
    activeOrganization !== null
      ? {
          kind: 'ORGANIZATION' as const,
          id: asEntityId(activeOrganization.id),
          exists: true,
          organizationId: activeOrganization.id,
        }
      : undefined;

  const isAuthorizedAdmin =
    activeOrganization !== null &&
    activeOrganization.role === 'ADMIN' &&
    can(PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE, orgResource, policyConfig) &&
    can(PERMISSION_CODES.FEEDBACK_SLA_MANAGE, orgResource, policyConfig);

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (activeOrganization === null) {
      document.title = `${intl.formatMessage({ id: 'organizations.title' })} | ${shortName}`;
      return;
    }
    if (!isAuthorizedAdmin || loadErrorMessageId === 'errors.AUTHORIZATION_ERROR') {
      document.title = `${intl.formatMessage({ id: 'feedback.unauthorizedTitle' })} | ${shortName}`;
      return;
    }
    if (loadErrorMessageId !== null) {
      document.title = `${intl.formatMessage({ id: loadErrorMessageId })} | ${shortName}`;
      return;
    }
    if (slaSettings !== null) {
      document.title = intl.formatMessage({ id: 'feedbacks.governance.pageTitle' });
      return;
    }
    document.title = intl.formatMessage({ id: 'app.name' });
  }, [activeOrganization, intl, isAuthorizedAdmin, loadErrorMessageId, slaSettings]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="feedback-gov-no-org" headingText="" />;
  }

  if (!isAuthorizedAdmin) {
    return (
      <TaskPageStatusView
        kind="error"
        headingId="feedback-gov-unauthorized"
        headingText={intl.formatMessage({ id: 'feedback.unauthorizedTitle' })}
        descriptionText={intl.formatMessage({ id: 'feedback.unauthorizedDescription' })}
        backToPath="/feedback"
        backLabelId="feedbacks.nav.backToQueue"
      />
    );
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="feedback-gov-loading"
        headingText={intl.formatMessage({ id: 'feedbacks.governance.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || slaSettings === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="feedback-gov-error"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
        backToPath="/feedback"
        backLabelId="feedbacks.nav.backToQueue"
      />
    );
  }

  const runMutation = async (mutate: () => Promise<unknown>, successMessage: string) => {
    setFeedback(null);
    setIsBusy(true);
    try {
      await mutate();
      await fetchGovernanceBundle();
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

  const catalogSavedMsg = intl.formatMessage({ id: 'feedbacks.governance.catalog.savedSuccess' });
  const catalogDeletedMsg = intl.formatMessage({
    id: 'feedbacks.governance.catalog.deletedSuccess',
  });

  return (
    <FeedbackGovernancePanel
      organizationName={activeOrganization.name}
      categories={state.categories}
      contestReasons={state.contestReasons}
      slaSettings={slaSettings}
      isBusy={isBusy}
      feedback={feedback}
      announcement={announcement}
      focusHeadingTrigger={activeOrganization.id}
      onCreateCategory={(input: CreateCatalogItemInput) =>
        runMutation(
          () => services.feedback.createFeedbackCategory(user.id, activeOrganization.id, input),
          catalogSavedMsg,
        )
      }
      onUpdateCategory={(categoryId: FeedbackCategoryId, input: UpdateCatalogItemInput) =>
        runMutation(
          () =>
            services.feedback.updateFeedbackCategory(
              user.id,
              activeOrganization.id,
              categoryId,
              input,
            ),
          catalogSavedMsg,
        )
      }
      onReorderCategories={(orderedIds: readonly FeedbackCategoryId[]) =>
        runMutation(
          () =>
            services.feedback.reorderFeedbackCategories(user.id, activeOrganization.id, {
              orderedIds,
            }),
          catalogSavedMsg,
        )
      }
      onDeleteCategory={(categoryId: FeedbackCategoryId) =>
        runMutation(
          () =>
            services.feedback.deleteFeedbackCategory(user.id, activeOrganization.id, categoryId),
          catalogDeletedMsg,
        )
      }
      onCreateContestReason={(input: CreateCatalogItemInput) =>
        runMutation(
          () =>
            services.feedback.createFeedbackContestReason(user.id, activeOrganization.id, input),
          catalogSavedMsg,
        )
      }
      onUpdateContestReason={(reasonId: FeedbackContestReasonId, input: UpdateCatalogItemInput) =>
        runMutation(
          () =>
            services.feedback.updateFeedbackContestReason(
              user.id,
              activeOrganization.id,
              reasonId,
              input,
            ),
          catalogSavedMsg,
        )
      }
      onReorderContestReasons={(orderedIds: readonly FeedbackContestReasonId[]) =>
        runMutation(
          () =>
            services.feedback.reorderFeedbackContestReasons(user.id, activeOrganization.id, {
              orderedIds,
            }),
          catalogSavedMsg,
        )
      }
      onDeleteContestReason={(reasonId: FeedbackContestReasonId) =>
        runMutation(
          () =>
            services.feedback.deleteFeedbackContestReason(user.id, activeOrganization.id, reasonId),
          catalogDeletedMsg,
        )
      }
      onSaveSlaSettings={(input: UpdateFeedbackSlaSettingsInput) =>
        runMutation(
          () => services.feedback.updateFeedbackSlaSettings(user.id, activeOrganization.id, input),
          intl.formatMessage({ id: 'feedbacks.governance.sla.saveSuccess' }),
        )
      }
      onEvaluateSlas={async () => {
        setFeedback(null);
        setIsBusy(true);
        try {
          const result = await services.feedback.evaluateFeedbackSlas(
            user.id,
            activeOrganization.id,
          );
          await fetchGovernanceBundle();
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
      }}
    />
  );
}

export default FeedbackGovernancePage;
