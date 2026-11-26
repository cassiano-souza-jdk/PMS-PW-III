import { IconCheck, IconGavel, IconRefresh } from '@tabler/icons-react';
import { useId, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import {
  PRIORITIES,
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
  FeedbackContestDetail,
  FeedbackContestReasonWithVersion,
  FeedbackReopenRequest,
  FeedbackReopenRequestId,
} from '../application/contracts';
import {
  CONTEST_RECOMMENDATION_LABEL_IDS,
  CONTEST_STATUS_LABEL_IDS,
  CONTROL_SELECT_CLASS_NAME,
  CONTROL_TEXTAREA_CLASS_NAME,
  FEEDBACK_PRIORITY_LABEL_IDS,
  REOPEN_STATUS_LABEL_IDS,
  formatFeedbackDateTime,
  resolveFeedbackActorDisplayName,
} from './feedback-ui-helpers';

export interface FeedbackContestationPanelProps {
  readonly feedbackId: string;
  readonly feedbackAuthorUserId: UserId;
  readonly currentUserId: UserId;
  readonly currentUserRole: OrganizationRole;
  readonly canConfirmResolution: boolean;
  readonly canOpenContest: boolean;
  readonly canDelegateContest: boolean;
  readonly canAnalyzeContest: boolean;
  readonly canDecideContest: boolean;
  readonly canRequestReopen: boolean;
  readonly canDecideReopen: boolean;
  readonly contestReasons: readonly FeedbackContestReasonWithVersion[];
  readonly assignableAnalysts: readonly FeedbackActorProfile[];
  readonly contests: readonly FeedbackContestDetail[];
  readonly reopenRequests: readonly FeedbackReopenRequest[];
  readonly actorProfiles: Readonly<Record<string, FeedbackActorProfile>>;
  readonly isBusy: boolean;
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
}

export function FeedbackContestationPanel({
  feedbackId,
  feedbackAuthorUserId,
  currentUserId,
  currentUserRole,
  canConfirmResolution,
  canOpenContest,
  canDelegateContest,
  canAnalyzeContest,
  canDecideContest,
  canRequestReopen,
  canDecideReopen,
  contestReasons,
  assignableAnalysts,
  contests,
  reopenRequests,
  actorProfiles,
  isBusy,
  onConfirmResolution,
  onOpenContest,
  onDelegateAnalysis,
  onSubmitAnalysis,
  onDecideContest,
  onRequestReopen,
  onDecideReopen,
}: FeedbackContestationPanelProps) {
  const intl = useIntl();
  const contestHeadingId = `feedback-contests-heading-${feedbackId}`;
  const reopenHeadingId = `feedback-reopen-heading-${feedbackId}`;
  const reasonSelectId = useId();
  const openJustId = useId();
  const reopenReqJustId = useId();

  const activeReasons = contestReasons.filter((item) => item.reason.active);
  const eligibleAnalysts = assignableAnalysts.filter(
    (actor) => !(actor.userId === feedbackAuthorUserId && actor.organizationRole !== 'ADMIN'),
  );
  const fallbackActorLabel = intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });

  const [selectedReasonId, setSelectedReasonId] = useState<string>(
    activeReasons[0]?.reason.id ?? '',
  );
  const [openJustification, setOpenJustification] = useState<string>('');
  const [openError, setOpenError] = useState<string | null>(null);

  const [delegateAnalystByContest, setDelegateAnalystByContest] = useState<Record<string, string>>(
    {},
  );
  const [delegateReasonByContest, setDelegateReasonByContest] = useState<Record<string, string>>(
    {},
  );

  const [analysisRecByContest, setAnalysisRecByContest] = useState<
    Record<string, ContestRecommendation>
  >({});
  const [analysisSummaryByContest, setAnalysisSummaryByContest] = useState<Record<string, string>>(
    {},
  );

  const [decisionOutcomeByContest, setDecisionOutcomeByContest] = useState<
    Record<string, ContestRecommendation>
  >({});
  const [decisionJustByContest, setDecisionJustByContest] = useState<Record<string, string>>({});
  const [decisionErrorByContest, setDecisionErrorByContest] = useState<Record<string, string>>({});

  const [reopenRequestJust, setReopenRequestJust] = useState<string>('');
  const [reopenRequestError, setReopenRequestError] = useState<string | null>(null);

  const [reopenDecisionByReq, setReopenDecisionByReq] = useState<
    Record<string, 'APPROVED' | 'REJECTED'>
  >({});
  const [reopenJustByReq, setReopenJustByReq] = useState<Record<string, string>>({});
  const [reopenAssigneeByReq, setReopenAssigneeByReq] = useState<Record<string, string>>({});
  const [reopenPriorityByReq, setReopenPriorityByReq] = useState<Record<string, string>>({});

  const isBlockedNonAdminAuthor =
    feedbackAuthorUserId === currentUserId && currentUserRole !== 'ADMIN';

  const handleOpenContestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const effectiveReasonId = selectedReasonId || activeReasons[0]?.reason.id || '';
    const trimmed = openJustification.trim();
    if (effectiveReasonId === '' || trimmed.length === 0) {
      setOpenError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }
    setOpenError(null);
    await onOpenContest({
      reasonId: effectiveReasonId as FeedbackContestReasonWithVersion['reason']['id'],
      justification: trimmed,
    });
    setOpenJustification('');
  };

  const handleRequestReopenSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = reopenRequestJust.trim();
    if (trimmed.length === 0) {
      setReopenRequestError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }
    setReopenRequestError(null);
    await onRequestReopen(trimmed);
    setReopenRequestJust('');
  };

  return (
    <div className="space-y-4">
      <Card aria-labelledby={contestHeadingId}>
        <CardHeader>
          <CardTitle id={contestHeadingId} className="flex items-center gap-2 text-lg">
            <IconGavel className="h-5 w-5" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'feedbacks.contests.title' })}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {canConfirmResolution ? (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {intl.formatMessage({ id: 'feedbacks.contests.confirmResolutionTitle' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'feedbacks.contests.confirmResolutionDescription' })}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void onConfirmResolution()}
                disabled={isBusy}
                className="min-h-[44px] gap-2"
              >
                <IconCheck className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({ id: 'feedbacks.contests.confirmResolutionAction' })}
                </span>
              </Button>
            </div>
          ) : null}

          {canOpenContest ? (
            <form
              onSubmit={handleOpenContestSubmit}
              className="rounded-md border border-border p-4 space-y-3"
              noValidate
            >
              <h3 className="text-sm font-semibold text-foreground">
                {intl.formatMessage({ id: 'feedbacks.contests.openTitle' })}
              </h3>
              <div className="space-y-1.5">
                <Label htmlFor={reasonSelectId}>
                  {intl.formatMessage({ id: 'feedbacks.contests.reasonLabel' })}
                </Label>
                <select
                  id={reasonSelectId}
                  value={selectedReasonId || activeReasons[0]?.reason.id || ''}
                  onChange={(event) => setSelectedReasonId(event.target.value)}
                  className={CONTROL_SELECT_CLASS_NAME}
                  disabled={isBusy || activeReasons.length === 0}
                >
                  {activeReasons.map((item) => (
                    <option key={item.reason.id} value={item.reason.id}>
                      {item.currentVersion.name} (v{item.currentVersion.versionNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={openJustId}>
                  {intl.formatMessage({ id: 'feedbacks.contests.justificationLabel' })}
                </Label>
                <textarea
                  id={openJustId}
                  value={openJustification}
                  onChange={(event) => {
                    setOpenJustification(event.target.value);
                    if (openError !== null) {
                      setOpenError(null);
                    }
                  }}
                  placeholder={intl.formatMessage({
                    id: 'feedbacks.contests.justificationPlaceholder',
                  })}
                  className={CONTROL_TEXTAREA_CLASS_NAME}
                  disabled={isBusy}
                />
                {openError !== null ? (
                  <p role="alert" className="text-sm text-destructive">
                    {openError}
                  </p>
                ) : null}
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={isBusy || activeReasons.length === 0}
                className="min-h-[44px]"
              >
                {intl.formatMessage({ id: 'feedbacks.contests.openAction' })}
              </Button>
            </form>
          ) : null}

          {contests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'feedbacks.contests.empty' })}
            </p>
          ) : (
            <div className="space-y-4">
              {contests.map((detail) => {
                const { contest, analyses, decisions } = detail;
                const isPendingContest =
                  contest.status === 'OPEN' || contest.status === 'IN_ANALYSIS';
                const latestAnalysis = analyses[analyses.length - 1];
                const canActorAnalyze =
                  isPendingContest &&
                  !isBlockedNonAdminAuthor &&
                  !analyses.some((item) => item.analystUserId === currentUserId) &&
                  (currentUserRole === 'ADMIN' ||
                    (canAnalyzeContest && contest.delegatedAnalystUserId === currentUserId));

                const selectedAnalyst =
                  delegateAnalystByContest[contest.id] ??
                  contest.delegatedAnalystUserId ??
                  eligibleAnalysts[0]?.userId ??
                  '';
                const delegateReason = delegateReasonByContest[contest.id] ?? '';
                const analysisRec = analysisRecByContest[contest.id] ?? 'KEEP_RESOLUTION';
                const analysisSummary = analysisSummaryByContest[contest.id] ?? '';
                const decisionOutcome = decisionOutcomeByContest[contest.id] ?? 'KEEP_RESOLUTION';
                const decisionJust = decisionJustByContest[contest.id] ?? '';
                const decisionError = decisionErrorByContest[contest.id] ?? null;

                return (
                  <div
                    key={contest.id}
                    className="rounded-md border border-border bg-muted/15 p-4 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={isPendingContest ? 'default' : 'secondary'}>
                          {intl.formatMessage({ id: CONTEST_STATUS_LABEL_IDS[contest.status] })}
                        </Badge>
                        {detail.reasonName !== undefined ? (
                          <span className="text-sm font-medium text-foreground">
                            {intl.formatMessage(
                              { id: 'feedbacks.contests.reasonVersionLabel' },
                              {
                                name: detail.reasonName,
                                version: detail.reasonVersionNumber ?? 1,
                              },
                            )}
                          </span>
                        ) : null}
                      </div>
                      <time dateTime={contest.openedAt} className="text-xs text-muted-foreground">
                        {formatFeedbackDateTime(contest.openedAt, intl)}
                      </time>
                    </div>

                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {contest.justification}
                    </p>

                    {detail.delegatedAnalystProfile !== undefined ? (
                      <p className="text-xs text-muted-foreground">
                        {intl.formatMessage({ id: 'feedbacks.contests.delegateAnalystLabel' })}:{' '}
                        {detail.delegatedAnalystProfile.displayName}
                      </p>
                    ) : null}

                    {analyses.length > 0 ? (
                      <div className="space-y-2 border-t pt-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {intl.formatMessage({ id: 'feedbacks.contests.analysisTitle' })}
                        </h3>
                        {analyses.map((analysis) => (
                          <div
                            key={analysis.id}
                            className="rounded border border-border bg-background p-3 text-sm space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge variant="outline">
                                {intl.formatMessage({
                                  id: CONTEST_RECOMMENDATION_LABEL_IDS[analysis.recommendation],
                                })}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {resolveFeedbackActorDisplayName(
                                  analysis.analystUserId,
                                  actorProfiles,
                                  fallbackActorLabel,
                                )}{' '}
                                · {formatFeedbackDateTime(analysis.createdAt, intl)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap text-foreground">
                              {analysis.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {decisions.length > 0 ? (
                      <div className="space-y-2 border-t pt-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {intl.formatMessage({ id: 'feedbacks.contests.decisionTitle' })}
                        </h3>
                        {decisions.map((decision) => (
                          <div
                            key={decision.id}
                            className="rounded border border-border bg-background p-3 text-sm space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="default">
                                  {intl.formatMessage({
                                    id: CONTEST_RECOMMENDATION_LABEL_IDS[decision.outcome],
                                  })}
                                </Badge>
                                {decision.divergedFromAnalysis ? (
                                  <Badge variant="destructive">
                                    {intl.formatMessage({
                                      id: 'feedbacks.contests.decisionDivergedBadge',
                                    })}
                                  </Badge>
                                ) : null}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {resolveFeedbackActorDisplayName(
                                  decision.decidedByAdminUserId,
                                  actorProfiles,
                                  fallbackActorLabel,
                                )}{' '}
                                · {formatFeedbackDateTime(decision.decidedAt, intl)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap text-foreground">
                              {decision.justification}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {isPendingContest && canDelegateContest && eligibleAnalysts.length > 0 ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (selectedAnalyst === '') {
                            return;
                          }
                          void onDelegateAnalysis(contest.id, {
                            analystUserId: selectedAnalyst as UserId,
                            ...(delegateReason.trim().length > 0
                              ? { reason: delegateReason.trim() }
                              : {}),
                          });
                        }}
                        className="space-y-2 border-t pt-3"
                      >
                        <h3 className="text-sm font-semibold text-foreground">
                          {intl.formatMessage({ id: 'feedbacks.contests.delegateTitle' })}
                        </h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`delegate-analyst-${contest.id}`}>
                              {intl.formatMessage({
                                id: 'feedbacks.contests.delegateAnalystLabel',
                              })}
                            </Label>
                            <select
                              id={`delegate-analyst-${contest.id}`}
                              value={selectedAnalyst}
                              onChange={(event) =>
                                setDelegateAnalystByContest((prev) => ({
                                  ...prev,
                                  [contest.id]: event.target.value,
                                }))
                              }
                              className={CONTROL_SELECT_CLASS_NAME}
                              disabled={isBusy}
                            >
                              {eligibleAnalysts.map((analyst) => (
                                <option key={analyst.userId} value={analyst.userId}>
                                  {analyst.displayName}
                                  {analyst.organizationRole !== undefined
                                    ? ` (${analyst.organizationRole})`
                                    : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`delegate-reason-${contest.id}`}>
                              {intl.formatMessage({ id: 'feedbacks.contests.delegateReasonLabel' })}
                            </Label>
                            <input
                              id={`delegate-reason-${contest.id}`}
                              type="text"
                              value={delegateReason}
                              onChange={(event) =>
                                setDelegateReasonByContest((prev) => ({
                                  ...prev,
                                  [contest.id]: event.target.value,
                                }))
                              }
                              className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                              disabled={isBusy}
                            />
                          </div>
                        </div>
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={isBusy || selectedAnalyst === ''}
                          className="min-h-[44px]"
                        >
                          {intl.formatMessage({ id: 'feedbacks.contests.delegateAction' })}
                        </Button>
                      </form>
                    ) : null}

                    {canActorAnalyze ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (analysisSummary.trim().length === 0) {
                            return;
                          }
                          void onSubmitAnalysis(contest.id, {
                            recommendation: analysisRec,
                            summary: analysisSummary.trim(),
                          });
                        }}
                        className="space-y-2 border-t pt-3"
                      >
                        <h3 className="text-sm font-semibold text-foreground">
                          {intl.formatMessage({ id: 'feedbacks.contests.analysisTitle' })}
                        </h3>
                        <div className="space-y-1">
                          <Label htmlFor={`analysis-rec-${contest.id}`}>
                            {intl.formatMessage({ id: 'feedbacks.contests.recommendationLabel' })}
                          </Label>
                          <select
                            id={`analysis-rec-${contest.id}`}
                            value={analysisRec}
                            onChange={(event) =>
                              setAnalysisRecByContest((prev) => ({
                                ...prev,
                                [contest.id]: event.target.value as ContestRecommendation,
                              }))
                            }
                            className={CONTROL_SELECT_CLASS_NAME}
                            disabled={isBusy}
                          >
                            <option value="KEEP_RESOLUTION">
                              {intl.formatMessage({
                                id: 'feedbacks.contests.recommendation.KEEP_RESOLUTION',
                              })}
                            </option>
                            <option value="RESUME_SERVICE">
                              {intl.formatMessage({
                                id: 'feedbacks.contests.recommendation.RESUME_SERVICE',
                              })}
                            </option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`analysis-summary-${contest.id}`}>
                            {intl.formatMessage({ id: 'feedbacks.contests.analysisSummaryLabel' })}
                          </Label>
                          <textarea
                            id={`analysis-summary-${contest.id}`}
                            value={analysisSummary}
                            onChange={(event) =>
                              setAnalysisSummaryByContest((prev) => ({
                                ...prev,
                                [contest.id]: event.target.value,
                              }))
                            }
                            placeholder={intl.formatMessage({
                              id: 'feedbacks.contests.analysisSummaryPlaceholder',
                            })}
                            className={CONTROL_TEXTAREA_CLASS_NAME}
                            disabled={isBusy}
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={isBusy || analysisSummary.trim().length === 0}
                          className="min-h-[44px]"
                        >
                          {intl.formatMessage({ id: 'feedbacks.contests.submitAnalysisAction' })}
                        </Button>
                      </form>
                    ) : null}

                    {isPendingContest && canDecideContest ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const trimmed = decisionJust.trim();
                          const diverges =
                            latestAnalysis !== undefined &&
                            decisionOutcome !== latestAnalysis.recommendation;
                          if ((diverges && trimmed.length === 0) || trimmed.length === 0) {
                            setDecisionErrorByContest((prev) => ({
                              ...prev,
                              [contest.id]: intl.formatMessage({ id: 'validation.required' }),
                            }));
                            return;
                          }
                          setDecisionErrorByContest((prev) => {
                            const next = { ...prev };
                            delete next[contest.id];
                            return next;
                          });
                          void onDecideContest(contest.id, {
                            outcome: decisionOutcome,
                            justification: trimmed,
                          });
                        }}
                        className="space-y-2 border-t pt-3"
                        noValidate
                      >
                        <h3 className="text-sm font-semibold text-foreground">
                          {intl.formatMessage({ id: 'feedbacks.contests.decisionTitle' })}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {intl.formatMessage({
                            id: 'feedbacks.contests.decisionDivergenceNotice',
                          })}
                        </p>
                        <div className="space-y-1">
                          <Label htmlFor={`decision-outcome-${contest.id}`}>
                            {intl.formatMessage({
                              id: 'feedbacks.contests.decisionOutcomeLabel',
                            })}
                          </Label>
                          <select
                            id={`decision-outcome-${contest.id}`}
                            value={decisionOutcome}
                            onChange={(event) =>
                              setDecisionOutcomeByContest((prev) => ({
                                ...prev,
                                [contest.id]: event.target.value as ContestRecommendation,
                              }))
                            }
                            className={CONTROL_SELECT_CLASS_NAME}
                            disabled={isBusy}
                          >
                            <option value="KEEP_RESOLUTION">
                              {intl.formatMessage({
                                id: 'feedbacks.contests.recommendation.KEEP_RESOLUTION',
                              })}
                            </option>
                            <option value="RESUME_SERVICE">
                              {intl.formatMessage({
                                id: 'feedbacks.contests.recommendation.RESUME_SERVICE',
                              })}
                            </option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`decision-just-${contest.id}`}>
                            {intl.formatMessage({
                              id: 'feedbacks.contests.decisionJustificationLabel',
                            })}
                          </Label>
                          <textarea
                            id={`decision-just-${contest.id}`}
                            value={decisionJust}
                            onChange={(event) => {
                              setDecisionJustByContest((prev) => ({
                                ...prev,
                                [contest.id]: event.target.value,
                              }));
                              if (decisionError !== null) {
                                setDecisionErrorByContest((prev) => {
                                  const next = { ...prev };
                                  delete next[contest.id];
                                  return next;
                                });
                              }
                            }}
                            placeholder={intl.formatMessage({
                              id: 'feedbacks.contests.decisionJustificationPlaceholder',
                            })}
                            className={CONTROL_TEXTAREA_CLASS_NAME}
                            disabled={isBusy}
                          />
                          {decisionError !== null ? (
                            <p role="alert" className="text-sm text-destructive">
                              {decisionError}
                            </p>
                          ) : null}
                        </div>
                        <Button type="submit" disabled={isBusy} className="min-h-[44px]">
                          {intl.formatMessage({ id: 'feedbacks.contests.submitDecisionAction' })}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card aria-labelledby={reopenHeadingId}>
        <CardHeader>
          <CardTitle id={reopenHeadingId} className="flex items-center gap-2 text-lg">
            <IconRefresh className="h-5 w-5" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'feedbacks.reopen.title' })}</span>
          </CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'feedbacks.closureReason.expiredWithoutContestNotice' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canRequestReopen ? (
            <form onSubmit={handleRequestReopenSubmit} className="space-y-3" noValidate>
              <h3 className="text-sm font-semibold text-foreground">
                {intl.formatMessage({ id: 'feedbacks.reopen.requestTitle' })}
              </h3>
              <div className="space-y-1.5">
                <Label htmlFor={reopenReqJustId}>
                  {intl.formatMessage({ id: 'feedbacks.reopen.justificationLabel' })}
                </Label>
                <textarea
                  id={reopenReqJustId}
                  value={reopenRequestJust}
                  onChange={(event) => {
                    setReopenRequestJust(event.target.value);
                    if (reopenRequestError !== null) {
                      setReopenRequestError(null);
                    }
                  }}
                  placeholder={intl.formatMessage({
                    id: 'feedbacks.reopen.justificationPlaceholder',
                  })}
                  className={CONTROL_TEXTAREA_CLASS_NAME}
                  disabled={isBusy}
                />
                {reopenRequestError !== null ? (
                  <p role="alert" className="text-sm text-destructive">
                    {reopenRequestError}
                  </p>
                ) : null}
              </div>
              <Button type="submit" variant="outline" disabled={isBusy} className="min-h-[44px]">
                {intl.formatMessage({ id: 'feedbacks.reopen.requestAction' })}
              </Button>
            </form>
          ) : null}

          {reopenRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'feedbacks.reopen.empty' })}
            </p>
          ) : (
            <div className="space-y-3">
              {reopenRequests.map((req) => {
                const decisionValue = reopenDecisionByReq[req.id] ?? 'APPROVED';
                const decisionJust = reopenJustByReq[req.id] ?? '';
                const assigneeId = reopenAssigneeByReq[req.id] ?? '';
                const priority = reopenPriorityByReq[req.id] ?? '';
                return (
                  <div
                    key={req.id}
                    className="rounded-md border border-border bg-muted/15 p-3 text-sm space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={req.status === 'PENDING' ? 'default' : 'secondary'}>
                        {intl.formatMessage({ id: REOPEN_STATUS_LABEL_IDS[req.status] })}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {resolveFeedbackActorDisplayName(
                          req.requestedByUserId,
                          actorProfiles,
                          fallbackActorLabel,
                        )}{' '}
                        · {formatFeedbackDateTime(req.requestedAt, intl)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-foreground">{req.justification}</p>
                    {req.decisionJustification !== undefined ? (
                      <Alert role="status">
                        <AlertDescription>{req.decisionJustification}</AlertDescription>
                      </Alert>
                    ) : null}

                    {req.status === 'PENDING' && canDecideReopen ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (decisionJust.trim().length === 0) {
                            return;
                          }
                          void onDecideReopen(req.id, {
                            decision: decisionValue,
                            justification: decisionJust.trim(),
                            ...(assigneeId !== '' ? { assigneeId: assigneeId as UserId } : {}),
                            ...(priority !== '' ? { priority: priority as Priority } : {}),
                          });
                        }}
                        className="space-y-2 border-t pt-3"
                      >
                        <h3 className="text-sm font-semibold text-foreground">
                          {intl.formatMessage({ id: 'feedbacks.reopen.decisionTitle' })}
                        </h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label htmlFor={`reopen-decision-${req.id}`}>
                              {intl.formatMessage({ id: 'feedbacks.reopen.decisionLabel' })}
                            </Label>
                            <select
                              id={`reopen-decision-${req.id}`}
                              value={decisionValue}
                              onChange={(event) =>
                                setReopenDecisionByReq((prev) => ({
                                  ...prev,
                                  [req.id]: event.target.value as 'APPROVED' | 'REJECTED',
                                }))
                              }
                              className={CONTROL_SELECT_CLASS_NAME}
                              disabled={isBusy}
                            >
                              <option value="APPROVED">
                                {intl.formatMessage({ id: 'feedbacks.reopen.decisionApprove' })}
                              </option>
                              <option value="REJECTED">
                                {intl.formatMessage({ id: 'feedbacks.reopen.decisionReject' })}
                              </option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor={`reopen-assignee-${req.id}`}>
                              {intl.formatMessage({ id: 'feedbacks.reopen.decisionAssigneeLabel' })}
                            </Label>
                            <select
                              id={`reopen-assignee-${req.id}`}
                              value={assigneeId}
                              onChange={(event) =>
                                setReopenAssigneeByReq((prev) => ({
                                  ...prev,
                                  [req.id]: event.target.value,
                                }))
                              }
                              className={CONTROL_SELECT_CLASS_NAME}
                              disabled={isBusy}
                            >
                              <option value="">
                                {intl.formatMessage({ id: 'feedbacks.assign.selectPlaceholder' })}
                              </option>
                              {eligibleAnalysts.map((handler) => (
                                <option key={handler.userId} value={handler.userId}>
                                  {handler.displayName}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor={`reopen-priority-${req.id}`}>
                              {intl.formatMessage({ id: 'feedbacks.reopen.decisionPriorityLabel' })}
                            </Label>
                            <select
                              id={`reopen-priority-${req.id}`}
                              value={priority}
                              onChange={(event) =>
                                setReopenPriorityByReq((prev) => ({
                                  ...prev,
                                  [req.id]: event.target.value,
                                }))
                              }
                              className={CONTROL_SELECT_CLASS_NAME}
                              disabled={isBusy}
                            >
                              <option value="">
                                {intl.formatMessage({ id: 'feedbacks.filters.allPriorities' })}
                              </option>
                              {Object.values(PRIORITIES).map((item) => (
                                <option key={item} value={item}>
                                  {intl.formatMessage({ id: FEEDBACK_PRIORITY_LABEL_IDS[item] })}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor={`reopen-just-${req.id}`}>
                            {intl.formatMessage({
                              id: 'feedbacks.reopen.decisionJustificationLabel',
                            })}
                          </Label>
                          <textarea
                            id={`reopen-just-${req.id}`}
                            value={decisionJust}
                            onChange={(event) =>
                              setReopenJustByReq((prev) => ({
                                ...prev,
                                [req.id]: event.target.value,
                              }))
                            }
                            className={CONTROL_TEXTAREA_CLASS_NAME}
                            disabled={isBusy}
                          />
                        </div>

                        <Button
                          type="submit"
                          disabled={isBusy || decisionJust.trim().length === 0}
                          className="min-h-[44px]"
                        >
                          {intl.formatMessage({ id: 'feedbacks.reopen.decideAction' })}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
