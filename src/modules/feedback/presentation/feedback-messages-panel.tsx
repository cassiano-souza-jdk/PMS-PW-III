import { IconMessage, IconSend } from '@tabler/icons-react';
import { useId, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import type { UserId } from '@/shared/kernel';
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
  FeedbackActorProfile,
  FeedbackMessage,
  FeedbackStatus,
} from '../application/contracts';
import {
  CONTROL_TEXTAREA_CLASS_NAME,
  formatFeedbackDateTime,
  resolveFeedbackActorDisplayName,
} from './feedback-ui-helpers';

export interface FeedbackMessagesPanelProps {
  readonly feedbackId: string;
  readonly feedbackStatus: FeedbackStatus;
  readonly feedbackAuthorUserId: UserId;
  readonly currentUserId: UserId;
  readonly messages: readonly FeedbackMessage[];
  readonly actorProfiles: Readonly<Record<string, FeedbackActorProfile>>;
  readonly canSendMessage: boolean;
  readonly isBusy: boolean;
  readonly onAddMessage: (body: string) => Promise<void>;
}

export function FeedbackMessagesPanel({
  feedbackId,
  feedbackStatus,
  feedbackAuthorUserId,
  currentUserId,
  messages,
  actorProfiles,
  canSendMessage,
  isBusy,
  onAddMessage,
}: FeedbackMessagesPanelProps) {
  const intl = useIntl();
  const bodyId = useId();
  const headingId = `feedback-messages-heading-${feedbackId}`;
  const [body, setBody] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isWaitingInfoAuthor =
    feedbackStatus === 'WAITING_INFO' && feedbackAuthorUserId === currentUserId;
  const fallbackActorLabel = intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setErrorMessage(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    setErrorMessage(null);
    await onAddMessage(trimmed);
    setBody('');
  };

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2 text-lg">
          <IconMessage className="h-5 w-5" aria-hidden="true" />
          <span>{intl.formatMessage({ id: 'feedbacks.messages.title' })}</span>
        </CardTitle>
        <CardDescription>
          {intl.formatMessage({ id: 'feedbacks.messages.immutabilityNotice' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isWaitingInfoAuthor ? (
          <Alert role="status">
            <AlertDescription>
              {intl.formatMessage({ id: 'feedbacks.messages.resumedFromWaitingInfoNotice' })}
            </AlertDescription>
          </Alert>
        ) : null}

        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'feedbacks.messages.empty' })}
          </p>
        ) : (
          <ul
            className="space-y-3"
            aria-label={intl.formatMessage({ id: 'feedbacks.messages.title' })}
          >
            {messages.map((message) => {
              const authorName = resolveFeedbackActorDisplayName(
                message.authorUserId,
                actorProfiles,
                fallbackActorLabel,
              );
              const isAuthor = message.authorUserId === feedbackAuthorUserId;
              return (
                <li
                  key={message.id}
                  className="rounded-md border border-border bg-muted/20 p-3 text-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">
                        {intl.formatMessage(
                          { id: 'feedbacks.queue.authorLabel' },
                          { name: authorName },
                        )}
                      </span>
                      {isAuthor ? (
                        <Badge variant="outline">
                          {intl.formatMessage({ id: 'roles.MEMBER' })}
                        </Badge>
                      ) : null}
                    </div>
                    <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                      {formatFeedbackDateTime(message.createdAt, intl)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-foreground">{message.body}</p>
                </li>
              );
            })}
          </ul>
        )}

        {canSendMessage ? (
          <form onSubmit={handleSubmit} className="space-y-3 border-t pt-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor={bodyId}>
                {intl.formatMessage({ id: 'feedbacks.messages.bodyLabel' })}
              </Label>
              <textarea
                id={bodyId}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  if (errorMessage !== null) {
                    setErrorMessage(null);
                  }
                }}
                placeholder={intl.formatMessage({ id: 'feedbacks.messages.bodyPlaceholder' })}
                className={CONTROL_TEXTAREA_CLASS_NAME}
                aria-invalid={errorMessage !== null}
                aria-describedby={errorMessage !== null ? `${bodyId}-error` : undefined}
                disabled={isBusy}
              />
              {errorMessage !== null ? (
                <p id={`${bodyId}-error`} role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}
            </div>
            <Button type="submit" disabled={isBusy} className="min-h-[44px] gap-2">
              <IconSend className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.messages.submitAction' })}</span>
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
