import { IconLock, IconSend } from '@tabler/icons-react';
import { useId, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import type { OrganizationRole, UserId } from '@/shared/kernel';
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
import type { FeedbackActorProfile, FeedbackInternalNote } from '../application/contracts';
import {
  CONTROL_TEXTAREA_CLASS_NAME,
  formatFeedbackDateTime,
  resolveFeedbackActorDisplayName,
} from './feedback-ui-helpers';

export interface FeedbackInternalNotesPanelProps {
  readonly feedbackId: string;
  readonly feedbackAuthorUserId: UserId;
  readonly currentUserId: UserId;
  readonly currentUserRole: OrganizationRole;
  readonly canViewInternalNotes: boolean;
  readonly canCreateInternalNotes: boolean;
  readonly notes: readonly FeedbackInternalNote[];
  readonly actorProfiles: Readonly<Record<string, FeedbackActorProfile>>;
  readonly mentionableActors: readonly FeedbackActorProfile[];
  readonly isBusy: boolean;
  readonly onAddInternalNote: (input: {
    readonly body: string;
    readonly mentionedUserIds: readonly UserId[];
  }) => Promise<void>;
}

export function FeedbackInternalNotesPanel({
  feedbackId,
  feedbackAuthorUserId,
  currentUserId,
  currentUserRole,
  canViewInternalNotes,
  canCreateInternalNotes,
  notes,
  actorProfiles,
  mentionableActors,
  isBusy,
  onAddInternalNote,
}: FeedbackInternalNotesPanelProps) {
  const intl = useIntl();
  const bodyId = useId();
  const headingId = `feedback-internal-notes-heading-${feedbackId}`;
  const [body, setBody] = useState<string>('');
  const [selectedMentionIds, setSelectedMentionIds] = useState<readonly UserId[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // DN-04 defense-in-depth: never render internal notes to MEMBER or to non-ADMIN feedback author.
  const isBlockedNonAdminAuthor =
    feedbackAuthorUserId === currentUserId && currentUserRole !== 'ADMIN';
  if (currentUserRole === 'MEMBER' || isBlockedNonAdminAuthor || !canViewInternalNotes) {
    return null;
  }

  const eligibleMentions = mentionableActors.filter(
    (actor) => !(actor.userId === feedbackAuthorUserId && actor.organizationRole !== 'ADMIN'),
  );
  const fallbackActorLabel = intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });

  const toggleMention = (userId: UserId) => {
    setSelectedMentionIds((current) =>
      current.includes(userId) ? current.filter((item) => item !== userId) : [...current, userId],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setErrorMessage(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    setErrorMessage(null);
    await onAddInternalNote({
      body: trimmed,
      mentionedUserIds: selectedMentionIds,
    });
    setBody('');
    setSelectedMentionIds([]);
  };

  return (
    <Card aria-labelledby={headingId} className="border-amber-700/40 dark:border-amber-400/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id={headingId} className="flex items-center gap-2 text-lg">
            <IconLock className="h-5 w-5" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'feedbacks.internalNotes.title' })}</span>
          </CardTitle>
          <Badge variant="secondary">
            {intl.formatMessage({ id: 'feedbacks.internalNotes.restrictedBadge' })}
          </Badge>
        </div>
        <CardDescription>
          {intl.formatMessage({ id: 'feedbacks.internalNotes.securityNotice' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert role="status">
          <AlertDescription>
            {intl.formatMessage({ id: 'feedbacks.internalNotes.mentionsHint' })}
          </AlertDescription>
        </Alert>

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'feedbacks.internalNotes.empty' })}
          </p>
        ) : (
          <ul
            className="space-y-3"
            aria-label={intl.formatMessage({ id: 'feedbacks.internalNotes.title' })}
          >
            {notes.map((note) => {
              const authorName = resolveFeedbackActorDisplayName(
                note.authorUserId,
                actorProfiles,
                fallbackActorLabel,
              );
              return (
                <li
                  key={note.id}
                  className="rounded-md border border-border bg-muted/30 p-3 text-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {intl.formatMessage(
                        { id: 'feedbacks.queue.authorLabel' },
                        { name: authorName },
                      )}
                    </span>
                    <time dateTime={note.createdAt} className="text-xs text-muted-foreground">
                      {formatFeedbackDateTime(note.createdAt, intl)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-foreground">{note.body}</p>
                  {note.mentionedUserIds.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {note.mentionedUserIds.map((mentionedId) => {
                        const mentionedName = resolveFeedbackActorDisplayName(
                          mentionedId,
                          actorProfiles,
                          fallbackActorLabel,
                        );
                        return (
                          <Badge key={mentionedId} variant="outline">
                            @{mentionedName}
                          </Badge>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canCreateInternalNotes ? (
          <form onSubmit={handleSubmit} className="space-y-3 border-t pt-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor={bodyId}>
                {intl.formatMessage({ id: 'feedbacks.internalNotes.bodyLabel' })}
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
                placeholder={intl.formatMessage({ id: 'feedbacks.internalNotes.bodyPlaceholder' })}
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

            {eligibleMentions.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">
                  {intl.formatMessage({ id: 'feedbacks.internalNotes.mentionsLabel' })}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {eligibleMentions.map((actor) => {
                    const checkboxId = `${bodyId}-mention-${actor.userId}`;
                    const checked = selectedMentionIds.includes(actor.userId);
                    return (
                      <label
                        key={actor.userId}
                        htmlFor={checkboxId}
                        className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground"
                      >
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMention(actor.userId)}
                          disabled={isBusy}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span>@{actor.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <Button type="submit" disabled={isBusy} className="min-h-[44px] gap-2">
              <IconSend className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.internalNotes.submitAction' })}</span>
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
