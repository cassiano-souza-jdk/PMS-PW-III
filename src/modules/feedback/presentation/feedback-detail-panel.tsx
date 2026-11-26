import { IconArrowLeft, IconDownload } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import {
  PRIORITIES,
  type AttachmentId,
  type FeedbackContestId,
  type OrganizationRole,
  type Priority,
  type UserId,
} from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@/shared/ui';
import type {
  ContestRecommendation,
  FeedbackActorProfile,
  FeedbackAttachmentContentResult,
  FeedbackCategoryId,
  FeedbackCategoryWithVersion,
  FeedbackContestReasonWithVersion,
  FeedbackDetail,
  FeedbackExportFormat,
  FeedbackExportResult,
  FeedbackInternalNoteId,
  FeedbackMessageId,
  FeedbackReopenRequestId,
  FeedbackStatus,
} from '../application/contracts';
import { FeedbackAttachmentsPanel } from './feedback-attachments-panel';
import { FeedbackContestationPanel } from './feedback-contestation-panel';
import { FeedbackInternalNotesPanel } from './feedback-internal-notes-panel';
import { FeedbackMessagesPanel } from './feedback-messages-panel';
import { FeedbackSlaPanel } from './feedback-sla-panel';
import {
  ALLOWED_FEEDBACK_STATUS_TRANSITIONS,
  CONTROL_SELECT_CLASS_NAME,
  CONTROL_TEXTAREA_CLASS_NAME,
  FEEDBACK_CLOSURE_REASON_LABEL_IDS,
  FEEDBACK_PRIORITY_BADGE_VARIANTS,
  FEEDBACK_PRIORITY_LABEL_IDS,
  FEEDBACK_STATUS_BADGE_VARIANTS,
  FEEDBACK_STATUS_LABEL_IDS,
  formatFeedbackDateTime,
  resolveFeedbackModuleLabelId,
  triggerFeedbackBlobDownload,
  type FeedbackPanelFeedback,
} from './feedback-ui-helpers';

export interface FeedbackDetailPanelProps {
  readonly detail: FeedbackDetail;
  readonly currentUserId: UserId;
  readonly currentUserRole: OrganizationRole;
  readonly categories: readonly FeedbackCategoryWithVersion[];
  readonly contestReasons: readonly FeedbackContestReasonWithVersion[];
  readonly assignableHandlers: readonly FeedbackActorProfile[];
  readonly canDelegateContest: boolean;
  readonly canAnalyzeContest: boolean;
  readonly canDecideContest: boolean;
  readonly maxAttachmentSizeBytes?: number;
  readonly maxContextAttachmentsSizeBytes?: number;
  readonly maxAttachmentsPerContext?: number;
  readonly isBusy: boolean;
  readonly feedback?: FeedbackPanelFeedback | null;
  readonly announcement?: string;
  readonly focusHeadingTrigger?: string;
  readonly onAssignHandler: (assigneeId: UserId) => Promise<void>;
  readonly onUpdateTriage: (input: {
    readonly priority?: Priority;
    readonly categoryId?: FeedbackCategoryId;
  }) => Promise<void>;
  readonly onTransitionStatus: (input: {
    readonly targetStatus: FeedbackStatus;
    readonly resolutionDescription?: string;
  }) => Promise<void>;
  readonly onAddMessage: (body: string) => Promise<void>;
  readonly onAddInternalNote: (input: {
    readonly body: string;
    readonly mentionedUserIds: readonly UserId[];
  }) => Promise<void>;
  readonly onUploadAttachment: (input: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly messageId?: FeedbackMessageId;
    readonly internalNoteId?: FeedbackInternalNoteId;
  }) => Promise<void>;
  readonly onDownloadAttachment: (
    attachmentId: AttachmentId,
  ) => Promise<FeedbackAttachmentContentResult>;
  readonly onConfirmResolution: () => Promise<void>;
  readonly onOpenContest: (input: {
    readonly reasonId: FeedbackContestReasonWithVersion['reason']['id'];
    readonly justification: string;
  }) => Promise<void>;
  readonly onDelegateAnalysis: (
    contestId: FeedbackContestId,
    input: { readonly analystUserId: UserId; readonly reason?: string },
  ) => Promise<void>;
  readonly onSubmitAnalysis: (
    contestId: FeedbackContestId,
    input: { readonly recommendation: ContestRecommendation; readonly summary: string },
  ) => Promise<void>;
  readonly onDecideContest: (
    contestId: FeedbackContestId,
    input: { readonly outcome: ContestRecommendation; readonly justification: string },
  ) => Promise<void>;
  readonly onRequestReopen: (justification: string) => Promise<void>;
  readonly onDecideReopen: (
    requestId: FeedbackReopenRequestId,
    input: {
      readonly decision: 'APPROVED' | 'REJECTED';
      readonly justification: string;
      readonly assigneeId?: UserId;
      readonly priority?: Priority;
    },
  ) => Promise<void>;
  readonly onExportSingleFeedback: (format: FeedbackExportFormat) => Promise<FeedbackExportResult>;
}

export function FeedbackDetailPanel({
  detail,
  currentUserId,
  currentUserRole,
  categories,
  contestReasons,
  assignableHandlers,
  canDelegateContest,
  canAnalyzeContest,
  canDecideContest,
  maxAttachmentSizeBytes,
  maxContextAttachmentsSizeBytes,
  maxAttachmentsPerContext,
  isBusy,
  feedback = null,
  announcement = '',
  focusHeadingTrigger,
  onAssignHandler,
  onUpdateTriage,
  onTransitionStatus,
  onAddMessage,
  onAddInternalNote,
  onUploadAttachment,
  onDownloadAttachment,
  onConfirmResolution,
  onOpenContest,
  onDelegateAnalysis,
  onSubmitAnalysis,
  onDecideContest,
  onRequestReopen,
  onDecideReopen,
  onExportSingleFeedback,
}: FeedbackDetailPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const assignSelectId = useId();
  const triagePriorityId = useId();
  const triageCategoryId = useId();
  const transitionStatusId = useId();
  const resolutionDescId = useId();

  const { feedback: item, currentCycle, capabilities } = detail;
  const isClosed = item.status === 'CLOSED' || item.closedAt !== undefined;

  // DN-04: Hide/block non-ADMIN feedback author from assignee selector.
  const eligibleHandlers = assignableHandlers.filter(
    (handler) => !(handler.userId === item.authorUserId && handler.organizationRole !== 'ADMIN'),
  );
  const activeCategories = categories.filter(
    (entry) => entry.category.active || entry.category.id === item.categoryId,
  );

  const hasPendingContest = detail.contests.some(
    (entry) => entry.contest.status === 'OPEN' || entry.contest.status === 'IN_ANALYSIS',
  );
  const availableTransitions = ALLOWED_FEEDBACK_STATUS_TRANSITIONS[item.status].filter((target) => {
    if (target === 'ASSIGNED' && item.assigneeId === undefined) {
      return false;
    }
    if (target === 'CLOSED' && (currentUserRole !== 'ADMIN' || hasPendingContest)) {
      return false;
    }
    return true;
  });

  const syncKey = `${item.id}:${item.status}:${item.priority}:${item.categoryId}:${item.assigneeId ?? ''}`;
  const [assigneeDraft, setAssigneeDraft] = useState<{
    readonly key: string;
    readonly value: string;
  } | null>(null);
  const [triagePriorityDraft, setTriagePriorityDraft] = useState<{
    readonly key: string;
    readonly value: Priority;
  } | null>(null);
  const [triageCategoryDraft, setTriageCategoryDraft] = useState<{
    readonly key: string;
    readonly value: string;
  } | null>(null);
  const [targetStatusDraft, setTargetStatusDraft] = useState<{
    readonly key: string;
    readonly value: string;
  } | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState<{
    readonly key: string;
    readonly value: string;
  } | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  const selectedAssigneeId =
    assigneeDraft?.key === syncKey
      ? assigneeDraft.value
      : (item.assigneeId ?? eligibleHandlers[0]?.userId ?? '');
  const triagePriority =
    triagePriorityDraft?.key === syncKey ? triagePriorityDraft.value : item.priority;
  const triageCategoryIdValue =
    triageCategoryDraft?.key === syncKey ? triageCategoryDraft.value : item.categoryId;
  const targetStatus =
    targetStatusDraft?.key === syncKey ? targetStatusDraft.value : (availableTransitions[0] ?? '');
  const resolutionDescription = resolutionDraft?.key === syncKey ? resolutionDraft.value : '';

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  const handleTransitionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (targetStatus === '') {
      return;
    }
    const nextStatus = targetStatus as FeedbackStatus;
    if (nextStatus === 'RESOLVED' && resolutionDescription.trim().length === 0) {
      setResolutionError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }
    setResolutionError(null);
    await onTransitionStatus({
      targetStatus: nextStatus,
      ...(nextStatus === 'RESOLVED' ? { resolutionDescription: resolutionDescription.trim() } : {}),
    });
  };

  const handleExportFormat = async (format: FeedbackExportFormat) => {
    const result = await onExportSingleFeedback(format);
    triggerFeedbackBlobDownload(result.content, result.mimeType, result.fileName);
  };

  const authorName =
    detail.authorProfile?.displayName ??
    intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });
  const assigneeName =
    detail.assigneeProfile?.displayName ??
    intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });

  return (
    <section aria-labelledby="feedback-detail-heading" className="mx-auto max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'feedbacks.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/feedback">
            <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'feedbacks.nav.backToQueue' })}</span>
          </Link>
        </Button>

        {capabilities.canExport ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => void handleExportFormat('JSON')}
              className="min-h-[44px] gap-2"
            >
              <IconDownload className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.export.formatJson' })}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => void handleExportFormat('CSV')}
              className="min-h-[44px] gap-2"
            >
              <IconDownload className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.export.formatCsv' })}</span>
            </Button>
          </div>
        ) : null}
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={FEEDBACK_STATUS_BADGE_VARIANTS[item.status]}>
            {intl.formatMessage({ id: FEEDBACK_STATUS_LABEL_IDS[item.status] })}
          </Badge>
          <Badge variant={FEEDBACK_PRIORITY_BADGE_VARIANTS[item.priority]}>
            {intl.formatMessage({ id: FEEDBACK_PRIORITY_LABEL_IDS[item.priority] })}
          </Badge>
          <Badge variant="outline">
            {intl.formatMessage({ id: resolveFeedbackModuleLabelId(item.moduleKey) })}
          </Badge>
          <Badge variant="outline">
            {intl.formatMessage(
              { id: 'feedbacks.detail.categoryVersionLabel' },
              { name: detail.category.name, version: detail.category.versionNumber },
            )}
          </Badge>
          {item.closedAt !== undefined ? (
            <Badge variant="secondary">
              {intl.formatMessage({
                id: item.authorConfirmedResolution
                  ? 'feedbacks.detail.authorConfirmedBadge'
                  : 'feedbacks.detail.authorNotConfirmedBadge',
              })}
            </Badge>
          ) : null}
        </div>

        <h1
          ref={headingRef}
          id="feedback-detail-heading"
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-foreground focus:outline-none"
        >
          {intl.formatMessage({ id: 'feedbacks.detail.title' }, { title: item.title })}
        </h1>
      </header>

      {feedback !== null ? (
        <Alert
          variant={feedback.type === 'destructive' ? 'destructive' : 'success'}
          role={feedback.type === 'destructive' ? 'alert' : 'status'}
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card aria-labelledby="feedback-overview-heading">
        <CardHeader>
          <CardTitle id="feedback-overview-heading" className="text-lg">
            {intl.formatMessage({ id: 'feedbacks.detail.metadataTitle' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap text-sm text-foreground">{item.description}</p>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <p>{intl.formatMessage({ id: 'feedbacks.queue.authorLabel' }, { name: authorName })}</p>
            <p>
              {intl.formatMessage({ id: 'feedbacks.queue.assigneeLabel' }, { name: assigneeName })}
            </p>
            <p>
              {intl.formatMessage(
                { id: 'feedbacks.detail.createdAtLabel' },
                { date: formatFeedbackDateTime(item.createdAt, intl) },
              )}
            </p>
            {item.closedAt !== undefined ? (
              <p>
                {intl.formatMessage(
                  { id: 'feedbacks.detail.closedAtLabel' },
                  { date: formatFeedbackDateTime(item.closedAt, intl) },
                )}
              </p>
            ) : null}
          </div>

          {currentCycle.resolutionDescription !== undefined ? (
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {intl.formatMessage({ id: 'feedbacks.detail.resolutionDescriptionLabel' })}
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {currentCycle.resolutionDescription}
              </p>
            </div>
          ) : null}

          {item.closureReason !== undefined ? (
            <Alert role="status">
              <AlertDescription className="space-y-1">
                <p className="font-medium">
                  {intl.formatMessage({
                    id: FEEDBACK_CLOSURE_REASON_LABEL_IDS[item.closureReason],
                  })}
                </p>
                {item.closureReason === 'EXPIRED_WITHOUT_CONTEST' ? (
                  <p className="text-xs text-muted-foreground">
                    {intl.formatMessage({
                      id: 'feedbacks.closureReason.expiredWithoutContestNotice',
                    })}
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {(capabilities.canAssign || capabilities.canUpdateTriage || capabilities.canManageStatus) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {capabilities.canAssign ? (
            <Card aria-labelledby="feedback-assign-heading">
              <CardHeader>
                <CardTitle id="feedback-assign-heading" className="text-base">
                  {intl.formatMessage({ id: 'feedbacks.assign.title' })}
                </CardTitle>
                <CardDescription className="text-xs">
                  {intl.formatMessage({ id: 'feedbacks.assign.selfAuthorRestrictionNotice' })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (selectedAssigneeId !== '') {
                      void onAssignHandler(selectedAssigneeId as UserId);
                    }
                  }}
                  className="space-y-3"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={assignSelectId}>
                      {intl.formatMessage({ id: 'feedbacks.assign.assigneeLabel' })}
                    </Label>
                    <select
                      id={assignSelectId}
                      value={selectedAssigneeId}
                      onChange={(event) =>
                        setAssigneeDraft({ key: syncKey, value: event.target.value })
                      }
                      className={CONTROL_SELECT_CLASS_NAME}
                      disabled={isBusy || eligibleHandlers.length === 0}
                    >
                      <option value="">
                        {intl.formatMessage({ id: 'feedbacks.assign.selectPlaceholder' })}
                      </option>
                      {eligibleHandlers.map((handler) => (
                        <option key={handler.userId} value={handler.userId}>
                          {handler.displayName}
                          {handler.organizationRole !== undefined
                            ? ` (${handler.organizationRole})`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="submit"
                    disabled={isBusy || selectedAssigneeId === ''}
                    className="min-h-[44px] w-full"
                  >
                    {intl.formatMessage({ id: 'feedbacks.assign.submitAction' })}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {capabilities.canUpdateTriage ? (
            <Card aria-labelledby="feedback-triage-heading">
              <CardHeader>
                <CardTitle id="feedback-triage-heading" className="text-base">
                  {intl.formatMessage({ id: 'feedbacks.triage.title' })}
                </CardTitle>
                <CardDescription className="text-xs">
                  {intl.formatMessage({ id: 'feedbacks.triage.snapshotImmutableNotice' })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onUpdateTriage({
                      priority: triagePriority,
                      categoryId: triageCategoryIdValue as FeedbackCategoryId,
                    });
                  }}
                  className="space-y-3"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={triagePriorityId}>
                      {intl.formatMessage({ id: 'feedbacks.triage.priorityLabel' })}
                    </Label>
                    <select
                      id={triagePriorityId}
                      value={triagePriority}
                      onChange={(event) =>
                        setTriagePriorityDraft({
                          key: syncKey,
                          value: event.target.value as Priority,
                        })
                      }
                      className={CONTROL_SELECT_CLASS_NAME}
                      disabled={isBusy}
                    >
                      {Object.values(PRIORITIES).map((priority) => (
                        <option key={priority} value={priority}>
                          {intl.formatMessage({ id: FEEDBACK_PRIORITY_LABEL_IDS[priority] })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={triageCategoryId}>
                      {intl.formatMessage({ id: 'feedbacks.triage.categoryLabel' })}
                    </Label>
                    <select
                      id={triageCategoryId}
                      value={triageCategoryIdValue}
                      onChange={(event) =>
                        setTriageCategoryDraft({ key: syncKey, value: event.target.value })
                      }
                      className={CONTROL_SELECT_CLASS_NAME}
                      disabled={isBusy}
                    >
                      {activeCategories.map((entry) => (
                        <option key={entry.category.id} value={entry.category.id}>
                          {entry.currentVersion.name} (v{entry.currentVersion.versionNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" disabled={isBusy} className="min-h-[44px] w-full">
                    {intl.formatMessage({ id: 'feedbacks.triage.submitAction' })}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {capabilities.canManageStatus && availableTransitions.length > 0 ? (
            <Card aria-labelledby="feedback-transition-heading">
              <CardHeader>
                <CardTitle id="feedback-transition-heading" className="text-base">
                  {intl.formatMessage({ id: 'feedbacks.transition.title' })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleTransitionSubmit} className="space-y-3" noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor={transitionStatusId}>
                      {intl.formatMessage({ id: 'feedbacks.transition.targetStatusLabel' })}
                    </Label>
                    <select
                      id={transitionStatusId}
                      value={targetStatus}
                      onChange={(event) => {
                        setTargetStatusDraft({ key: syncKey, value: event.target.value });
                        setResolutionError(null);
                      }}
                      className={CONTROL_SELECT_CLASS_NAME}
                      disabled={isBusy}
                    >
                      {availableTransitions.map((status) => (
                        <option key={status} value={status}>
                          {intl.formatMessage({ id: FEEDBACK_STATUS_LABEL_IDS[status] })}
                        </option>
                      ))}
                    </select>
                  </div>

                  {targetStatus === 'RESOLVED' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={resolutionDescId}>
                        {intl.formatMessage({
                          id: 'feedbacks.transition.resolutionDescriptionLabel',
                        })}
                      </Label>
                      <textarea
                        id={resolutionDescId}
                        value={resolutionDescription}
                        onChange={(event) => {
                          setResolutionDraft({ key: syncKey, value: event.target.value });
                          if (resolutionError !== null) {
                            setResolutionError(null);
                          }
                        }}
                        placeholder={intl.formatMessage({
                          id: 'feedbacks.transition.resolutionDescriptionPlaceholder',
                        })}
                        className={CONTROL_TEXTAREA_CLASS_NAME}
                        disabled={isBusy}
                      />
                      <p className="text-xs text-muted-foreground">
                        {intl.formatMessage({ id: 'feedbacks.transition.resolutionRequiredHint' })}
                      </p>
                      {resolutionError !== null ? (
                        <p role="alert" className="text-sm text-destructive">
                          {resolutionError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <Button type="submit" disabled={isBusy} className="min-h-[44px] w-full">
                    {intl.formatMessage({ id: 'feedbacks.transition.submitAction' })}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <FeedbackSlaPanel
        feedbackId={item.id}
        feedbackStatus={item.status}
        currentCycle={currentCycle}
        cycles={detail.cycles}
        currentSlaSnapshot={detail.currentSlaSnapshot}
        slaSnapshots={detail.slaSnapshots}
        slaStatus={detail.slaStatus}
      />

      <FeedbackMessagesPanel
        feedbackId={item.id}
        feedbackStatus={item.status}
        feedbackAuthorUserId={item.authorUserId}
        currentUserId={currentUserId}
        messages={detail.messages}
        actorProfiles={detail.actorProfiles}
        canSendMessage={capabilities.canSendMessage}
        isBusy={isBusy}
        onAddMessage={onAddMessage}
      />

      <FeedbackInternalNotesPanel
        feedbackId={item.id}
        feedbackAuthorUserId={item.authorUserId}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        canViewInternalNotes={detail.canViewInternalNotes}
        canCreateInternalNotes={capabilities.canCreateInternalNote}
        notes={detail.internalNotes}
        actorProfiles={detail.actorProfiles}
        mentionableActors={assignableHandlers}
        isBusy={isBusy}
        onAddInternalNote={onAddInternalNote}
      />

      <FeedbackAttachmentsPanel
        feedbackId={item.id}
        feedbackAuthorUserId={item.authorUserId}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        isClosed={isClosed}
        publicAttachments={detail.publicAttachments}
        internalAttachments={detail.internalAttachments}
        messages={detail.messages}
        internalNotes={detail.internalNotes}
        actorProfiles={detail.actorProfiles}
        canSendMessage={capabilities.canSendMessage}
        canViewInternalNotes={detail.canViewInternalNotes}
        canCreateInternalNotes={capabilities.canCreateInternalNote}
        maxAttachmentSizeBytes={maxAttachmentSizeBytes}
        maxContextAttachmentsSizeBytes={maxContextAttachmentsSizeBytes}
        maxAttachmentsPerContext={maxAttachmentsPerContext}
        isBusy={isBusy}
        onUploadAttachment={onUploadAttachment}
        onDownloadAttachment={onDownloadAttachment}
      />

      <FeedbackContestationPanel
        feedbackId={item.id}
        feedbackAuthorUserId={item.authorUserId}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        canConfirmResolution={capabilities.canConfirmResolution}
        canOpenContest={capabilities.canOpenContest}
        canDelegateContest={canDelegateContest}
        canAnalyzeContest={canAnalyzeContest}
        canDecideContest={canDecideContest}
        canRequestReopen={capabilities.canRequestReopen}
        canDecideReopen={capabilities.canDecideReopen}
        contestReasons={contestReasons}
        assignableAnalysts={assignableHandlers}
        contests={detail.contests}
        reopenRequests={detail.reopenRequests}
        actorProfiles={detail.actorProfiles}
        isBusy={isBusy}
        onConfirmResolution={onConfirmResolution}
        onOpenContest={onOpenContest}
        onDelegateAnalysis={onDelegateAnalysis}
        onSubmitAnalysis={onSubmitAnalysis}
        onDecideContest={onDecideContest}
        onRequestReopen={onRequestReopen}
        onDecideReopen={onDecideReopen}
      />
    </section>
  );
}
