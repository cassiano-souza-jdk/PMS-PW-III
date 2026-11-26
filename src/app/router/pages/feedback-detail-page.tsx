import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  ContestRecommendation,
  FeedbackActorProfile,
  FeedbackCategoryId,
  FeedbackCategoryWithVersion,
  FeedbackContestReasonId,
  FeedbackContestReasonWithVersion,
  FeedbackDetail,
  FeedbackExportFormat,
  FeedbackInternalNoteId,
  FeedbackMessageId,
  FeedbackReopenRequestId,
  FeedbackStatus,
} from '@/modules/feedback';
import { FeedbackDetailPanel, type FeedbackPanelFeedback } from '@/modules/feedback/presentation';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type { MessageId } from '@/shared/i18n';
import {
  asEntityId,
  asFeedbackId,
  asIsoDateTime,
  isUuid,
  type AttachmentId,
  type FeedbackContestId,
  type FeedbackId,
  type Priority,
  type UserId,
} from '@/shared/kernel';
import { resolveTaskPageErrorMessageId } from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedFeedbackDetailState {
  readonly contextKey: string | null;
  readonly detail: FeedbackDetail | null;
  readonly categories: readonly FeedbackCategoryWithVersion[];
  readonly contestReasons: readonly FeedbackContestReasonWithVersion[];
  readonly assignableHandlers: readonly FeedbackActorProfile[];
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_DETAIL_STATE: LoadedFeedbackDetailState = {
  contextKey: null,
  detail: null,
  categories: [],
  contestReasons: [],
  assignableHandlers: [],
  settings: null,
  errorMessageId: null,
};

export function FeedbackDetailPage() {
  const intl = useIntl();
  const { feedbackId: feedbackIdParam } = useParams<{ readonly feedbackId: string }>();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FeedbackPanelFeedback | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [state, setState] = useState<LoadedFeedbackDetailState>(INITIAL_DETAIL_STATE);

  const validFeedbackId: FeedbackId | null =
    feedbackIdParam !== undefined && isUuid(feedbackIdParam)
      ? asFeedbackId(feedbackIdParam, 'feedbackId')
      : null;

  const contextKey =
    user !== null && activeOrganization !== null && validFeedbackId !== null
      ? `${user.id}:${activeOrganization.id}:${validFeedbackId}`
      : null;

  const fetchDetailBundle = useCallback(async () => {
    if (
      user === null ||
      activeOrganization === null ||
      validFeedbackId === null ||
      contextKey === null
    ) {
      return;
    }

    const [detail, categories, contestReasons, assignableHandlers, persistedSettings] =
      await Promise.all([
        services.feedback.getFeedbackDetail(user.id, activeOrganization.id, validFeedbackId),
        services.feedback.listFeedbackCategories(user.id, activeOrganization.id).catch(() => []),
        services.feedback
          .listFeedbackContestReasons(user.id, activeOrganization.id)
          .catch(() => []),
        services.feedback.listAssignableHandlers(user.id, activeOrganization.id).catch(() => []),
        repositories.settings.organizationSettings
          .findByOrganization(activeOrganization.id)
          .catch(() => null),
      ]);

    setState({
      contextKey,
      detail,
      categories,
      contestReasons,
      assignableHandlers,
      settings: persistedSettings,
      errorMessageId: null,
    });
  }, [
    activeOrganization,
    contextKey,
    repositories.settings,
    services.feedback,
    user,
    validFeedbackId,
  ]);

  useEffect(() => {
    if (
      user === null ||
      activeOrganization === null ||
      validFeedbackId === null ||
      contextKey === null
    ) {
      return;
    }

    let isActive = true;
    const targetUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetFeedbackId = validFeedbackId;
    const targetKey = contextKey;

    async function loadInitial() {
      try {
        const [detail, categories, contestReasons, assignableHandlers, persistedSettings] =
          await Promise.all([
            services.feedback.getFeedbackDetail(targetUserId, targetOrgId, targetFeedbackId),
            services.feedback.listFeedbackCategories(targetUserId, targetOrgId).catch(() => []),
            services.feedback.listFeedbackContestReasons(targetUserId, targetOrgId).catch(() => []),
            services.feedback.listAssignableHandlers(targetUserId, targetOrgId).catch(() => []),
            repositories.settings.organizationSettings
              .findByOrganization(targetOrgId)
              .catch(() => null),
          ]);

        if (!isActive) {
          return;
        }

        setState({
          contextKey: targetKey,
          detail,
          categories,
          contestReasons,
          assignableHandlers,
          settings: persistedSettings,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          detail: null,
          categories: [],
          contestReasons: [],
          assignableHandlers: [],
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
    repositories.settings,
    services.feedback,
    user,
    validFeedbackId,
  ]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const detail = isCurrentContext ? state.detail : null;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (validFeedbackId === null) {
      document.title = `${intl.formatMessage({ id: 'feedbacks.detail.invalidIdError' })} | ${shortName}`;
      return;
    }
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
    if (detail !== null) {
      document.title = intl.formatMessage(
        { id: 'feedbacks.detail.pageTitle' },
        { title: detail.feedback.title },
      );
      return;
    }
    document.title = intl.formatMessage({ id: 'app.name' });
  }, [activeOrganization, detail, intl, loadErrorMessageId, validFeedbackId]);

  if (user === null) {
    return null;
  }

  if (validFeedbackId === null) {
    return (
      <TaskPageStatusView
        kind="error"
        headingId="feedback-detail-invalid-id"
        headingText={intl.formatMessage({ id: 'feedbacks.detail.invalidIdError' })}
        descriptionText={intl.formatMessage({ id: 'feedbacks.detail.invalidIdError' })}
        backToPath="/feedback"
        backLabelId="feedbacks.nav.backToQueue"
      />
    );
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="feedback-detail-no-org" headingText="" />;
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="feedback-detail-loading"
        headingText={intl.formatMessage({ id: 'feedbacks.queue.title' })}
      />
    );
  }

  if (loadErrorMessageId !== null || detail === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="feedback-detail-error"
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

  const effectiveSettings =
    state.settings ??
    createDefaultOrganizationSettings(
      activeOrganization.id,
      asIsoDateTime(new Date().toISOString()),
    );
  const policyConfig = toAuthorizationPolicyConfig(effectiveSettings);

  const feedbackAbacResource = {
    kind: 'FEEDBACK' as const,
    id: asEntityId(detail.feedback.id),
    exists: true,
    organizationId: detail.feedback.organizationId,
    feedbackId: detail.feedback.id,
    createdBy: detail.feedback.authorUserId,
    assigneeId: detail.feedback.assigneeId,
    deletedAt: undefined,
    closedAt: detail.feedback.closedAt ?? detail.currentCycle.closedAt,
  };

  // DN-04 defense-in-depth on UI capability propagation
  const isBlockedNonAdminAuthor =
    detail.feedback.authorUserId === user.id && activeOrganization.role !== 'ADMIN';

  const canViewInternalNotes =
    detail.canViewInternalNotes &&
    !isBlockedNonAdminAuthor &&
    can(PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW, feedbackAbacResource, policyConfig);

  const canCreateInternalNote =
    detail.capabilities.canCreateInternalNote &&
    !isBlockedNonAdminAuthor &&
    can(PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE, feedbackAbacResource, policyConfig);

  const canDelegateContest = can(
    PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE,
    { ...feedbackAbacResource, kind: 'FEEDBACK_CONTEST' },
    policyConfig,
  );
  const canAnalyzeContest =
    !isBlockedNonAdminAuthor &&
    can(
      PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE,
      { ...feedbackAbacResource, kind: 'FEEDBACK_CONTEST' },
      policyConfig,
    );
  const canDecideContest = can(
    PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE,
    { ...feedbackAbacResource, kind: 'FEEDBACK_CONTEST' },
    policyConfig,
  );

  const effectiveDetail: FeedbackDetail = {
    ...detail,
    canViewInternalNotes,
    internalNotes: canViewInternalNotes ? detail.internalNotes : [],
    internalAttachments: canViewInternalNotes ? detail.internalAttachments : [],
    capabilities: {
      ...detail.capabilities,
      canViewInternalNotes,
      canCreateInternalNote,
    },
  };

  const runMutation = async (mutate: () => Promise<unknown>, successMessage: string) => {
    setFeedback(null);
    setIsBusy(true);
    try {
      await mutate();
      await fetchDetailBundle();
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

  return (
    <FeedbackDetailPanel
      detail={effectiveDetail}
      currentUserId={user.id}
      currentUserRole={activeOrganization.role}
      categories={state.categories}
      contestReasons={state.contestReasons}
      assignableHandlers={state.assignableHandlers}
      canDelegateContest={canDelegateContest}
      canAnalyzeContest={canAnalyzeContest}
      canDecideContest={canDecideContest}
      maxAttachmentSizeBytes={effectiveSettings.pendingPermissionDefaults.maxAttachmentSizeBytes}
      maxContextAttachmentsSizeBytes={
        effectiveSettings.pendingPermissionDefaults.maxContextAttachmentsSizeBytes
      }
      maxAttachmentsPerContext={
        effectiveSettings.pendingPermissionDefaults.maxAttachmentsPerContext
      }
      isBusy={isBusy}
      feedback={feedback}
      announcement={announcement}
      focusHeadingTrigger={validFeedbackId}
      onAssignHandler={(assigneeId) =>
        runMutation(
          () =>
            services.feedback.assignFeedback(user.id, activeOrganization.id, validFeedbackId, {
              assigneeId,
            }),
          intl.formatMessage({ id: 'feedbacks.assign.success' }),
        )
      }
      onUpdateTriage={(input: {
        readonly priority?: Priority;
        readonly categoryId?: FeedbackCategoryId;
      }) =>
        runMutation(
          () =>
            services.feedback.updateFeedbackTriage(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.triage.success' }),
        )
      }
      onTransitionStatus={(input: {
        readonly targetStatus: FeedbackStatus;
        readonly resolutionDescription?: string;
      }) =>
        runMutation(
          () =>
            services.feedback.transitionFeedbackStatus(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              input,
            ),
          intl.formatMessage(
            { id: 'feedbacks.transition.success' },
            {
              status: intl.formatMessage({
                id: `feedbacks.status.${input.targetStatus}` as MessageId,
              }),
            },
          ),
        )
      }
      onAddMessage={async (body) => {
        setFeedback(null);
        setIsBusy(true);
        try {
          const result = await services.feedback.addFeedbackMessage(
            user.id,
            activeOrganization.id,
            validFeedbackId,
            { body },
          );
          await fetchDetailBundle();
          const successMessage = result.resumedFromWaitingInfo
            ? intl.formatMessage({ id: 'feedbacks.messages.resumedFromWaitingInfoNotice' })
            : intl.formatMessage({ id: 'feedbacks.messages.success' });
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
      }}
      onAddInternalNote={(input: {
        readonly body: string;
        readonly mentionedUserIds: readonly UserId[];
      }) =>
        runMutation(
          () =>
            services.feedback.addFeedbackInternalNote(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.internalNotes.success' }),
        )
      }
      onUploadAttachment={async (input: {
        readonly fileName: string;
        readonly mimeType: string;
        readonly bytes: Uint8Array;
        readonly messageId?: FeedbackMessageId;
        readonly internalNoteId?: FeedbackInternalNoteId;
      }) => {
        await services.feedback.uploadFeedbackAttachment(
          user.id,
          activeOrganization.id,
          validFeedbackId,
          input,
        );
        await fetchDetailBundle();
        const message = intl.formatMessage(
          { id: 'feedbacks.attachments.uploadSuccess' },
          { fileName: input.fileName },
        );
        setAnnouncement(message);
        setFeedback({ type: 'success', message });
      }}
      onDownloadAttachment={(attachmentId: AttachmentId) =>
        services.feedback.getFeedbackAttachmentContent(
          user.id,
          activeOrganization.id,
          validFeedbackId,
          attachmentId,
        )
      }
      onConfirmResolution={() =>
        runMutation(
          () =>
            services.feedback.confirmFeedbackResolution(
              user.id,
              activeOrganization.id,
              validFeedbackId,
            ),
          intl.formatMessage({ id: 'feedbacks.contests.confirmResolutionSuccess' }),
        )
      }
      onOpenContest={(input: {
        readonly reasonId: FeedbackContestReasonId;
        readonly justification: string;
      }) =>
        runMutation(
          () =>
            services.feedback.openFeedbackContest(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.contests.openSuccess' }),
        )
      }
      onDelegateAnalysis={(contestId: FeedbackContestId, input) =>
        runMutation(
          () =>
            services.feedback.delegateFeedbackContestAnalysis(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              contestId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.contests.delegateSuccess' }),
        )
      }
      onSubmitAnalysis={(
        contestId: FeedbackContestId,
        input: { readonly recommendation: ContestRecommendation; readonly summary: string },
      ) =>
        runMutation(
          () =>
            services.feedback.submitFeedbackContestAnalysis(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              contestId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.contests.submitAnalysisSuccess' }),
        )
      }
      onDecideContest={(
        contestId: FeedbackContestId,
        input: { readonly outcome: ContestRecommendation; readonly justification: string },
      ) =>
        runMutation(
          () =>
            services.feedback.decideFeedbackContest(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              contestId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.contests.submitDecisionSuccess' }),
        )
      }
      onRequestReopen={(justification: string) =>
        runMutation(
          () =>
            services.feedback.requestExceptionalReopen(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              { justification },
            ),
          intl.formatMessage({ id: 'feedbacks.reopen.requestSuccess' }),
        )
      }
      onDecideReopen={(requestId: FeedbackReopenRequestId, input) =>
        runMutation(
          () =>
            services.feedback.decideExceptionalReopen(
              user.id,
              activeOrganization.id,
              validFeedbackId,
              requestId,
              input,
            ),
          intl.formatMessage({ id: 'feedbacks.reopen.decideSuccess' }),
        )
      }
      onExportSingleFeedback={async (format: FeedbackExportFormat) => {
        const result = await services.feedback.exportFeedbacks(user.id, activeOrganization.id, {
          format,
          feedbackId: validFeedbackId,
        });
        const message = intl.formatMessage(
          { id: 'feedbacks.export.success' },
          { fileName: result.fileName, totalCount: result.totalCount },
        );
        setAnnouncement(message);
        setFeedback({ type: 'success', message });
        return result;
      }}
    />
  );
}

export default FeedbackDetailPage;
