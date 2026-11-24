import { zodResolver } from '@hookform/resolvers/zod';
import { IconEdit, IconMessagePlus, IconShieldLock, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { parseIsoDateTimeMs, type UserId } from '@/shared/kernel';
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
  Input,
  Label,
  ModalDialog,
} from '@/shared/ui';
import type { TaskCommentInput } from '../application/services/task-service';
import type { TaskComment, TaskCommentId } from '../application/contracts';
import {
  formatIsoDateTimeShort,
  resolveUserDisplayName,
  type TaskUserOption,
} from './task-ui-helpers';

const commentFormSchema = z.object({
  body: z.string().trim().min(1, 'validation.required').max(4000),
});

type CommentFormValues = z.infer<typeof commentFormSchema>;

export interface TaskCommentsPanelProps {
  readonly comments: readonly TaskComment[];
  readonly actorUserId: UserId;
  readonly commentEditWindowMinutes: number;
  readonly referenceNowMs: number;
  readonly isReadOnly: boolean;
  readonly canComment: boolean;
  readonly canModerateComments: boolean;
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
  readonly isMutating: boolean;
  readonly onAddComment: (input: TaskCommentInput) => Promise<void>;
  readonly onUpdateComment: (commentId: TaskCommentId, input: TaskCommentInput) => Promise<void>;
  readonly onDeleteComment: (commentId: TaskCommentId, reason?: string) => Promise<void>;
}

export function TaskCommentsPanel({
  comments,
  actorUserId,
  commentEditWindowMinutes,
  referenceNowMs,
  isReadOnly,
  canComment,
  canModerateComments,
  usersById,
  isMutating,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: TaskCommentsPanelProps) {
  const intl = useIntl();
  const [editingCommentId, setEditingCommentId] = useState<TaskCommentId | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingComment, setDeletingComment] = useState<TaskComment | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const createForm = useForm<CommentFormValues>({
    resolver: zodResolver(commentFormSchema),
    defaultValues: { body: '' },
  });

  const sortedComments = [...comments].sort(
    (a, b) => parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt),
  );

  const handleCreateSubmit = async (values: CommentFormValues) => {
    await onAddComment({ body: values.body });
    createForm.reset({ body: '' });
  };

  const canEditComment = (comment: TaskComment): boolean => {
    if (!canComment || isReadOnly) {
      return false;
    }
    if (comment.isSystem || comment.deletedAt !== undefined) {
      return false;
    }
    if (comment.authorUserId !== actorUserId) {
      return false;
    }
    if (!Number.isFinite(commentEditWindowMinutes) || commentEditWindowMinutes <= 0) {
      return false;
    }
    const elapsedMs = referenceNowMs - parseIsoDateTimeMs(comment.createdAt);
    return elapsedMs >= 0 && elapsedMs <= commentEditWindowMinutes * 60_000;
  };

  const canDeleteComment = (comment: TaskComment): boolean => {
    if (!canComment || isReadOnly) {
      return false;
    }
    if (comment.isSystem || comment.deletedAt !== undefined) {
      return false;
    }
    return comment.authorUserId === actorUserId || canModerateComments;
  };

  const handleStartEdit = (comment: TaskComment) => {
    setEditError(null);
    setEditingCommentId(comment.id);
    setEditingBody(comment.body);
  };

  const handleSaveEdit = async (commentId: TaskCommentId) => {
    const trimmed = editingBody.trim();
    if (trimmed.length === 0) {
      setEditError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }
    setEditError(null);
    try {
      await onUpdateComment(commentId, { body: trimmed });
      setEditingCommentId(null);
      setEditingBody('');
    } catch (error) {
      if (isAppError(error)) {
        if (
          error.code === APP_ERROR_CODES.AUTHORIZATION_ERROR &&
          error.details?.reasonCode === 'COMMENT_EDIT_WINDOW_EXPIRED'
        ) {
          setEditError(intl.formatMessage({ id: 'comments.edit.windowExpiredError' }));
          return;
        }
        if (error.code === APP_ERROR_CODES.CONFLICT) {
          setEditError(intl.formatMessage({ id: 'comments.edit.systemImmutableError' }));
          return;
        }
      }
      setEditError(intl.formatMessage({ id: 'errors.AUTHORIZATION_ERROR' }));
    }
  };

  const handleConfirmDelete = async () => {
    if (deletingComment === null) {
      return;
    }
    const trimmedReason = deleteReason.trim();
    await onDeleteComment(deletingComment.id, trimmedReason.length > 0 ? trimmedReason : undefined);
    setDeletingComment(null);
    setDeleteReason('');
  };

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: 'comments.title' })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: 'comments.description' })}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Alert variant="info">
          <AlertDescription>
            {commentEditWindowMinutes > 0
              ? intl.formatMessage(
                  { id: 'comments.edit.windowInfo' },
                  { minutes: commentEditWindowMinutes },
                )
              : intl.formatMessage({ id: 'comments.edit.windowDisabled' })}
          </AlertDescription>
        </Alert>

        {canComment && !isReadOnly ? (
          <form
            onSubmit={createForm.handleSubmit(handleCreateSubmit)}
            noValidate
            className="space-y-3 rounded-lg border bg-muted/30 p-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="task-comment-create-body" required>
                {intl.formatMessage({ id: 'comments.create.label' })}
              </Label>
              <textarea
                id="task-comment-create-body"
                rows={3}
                placeholder={intl.formatMessage({ id: 'comments.create.placeholder' })}
                aria-invalid={createForm.formState.errors.body !== undefined}
                aria-describedby={
                  createForm.formState.errors.body !== undefined
                    ? 'task-comment-create-body-error'
                    : undefined
                }
                className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive"
                {...createForm.register('body')}
              />
              {createForm.formState.errors.body !== undefined ? (
                <p
                  id="task-comment-create-body-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: 'validation.required' })}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={isMutating || createForm.formState.isSubmitting}
            >
              <IconMessagePlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: createForm.formState.isSubmitting
                    ? 'auth.common.submitting'
                    : 'comments.create.submit',
                })}
              </span>
            </Button>
          </form>
        ) : null}

        {sortedComments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'comments.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {sortedComments.map((comment) => {
              const authorName = resolveUserDisplayName(
                comment.authorUserId,
                usersById,
                unknownUserLabel,
              );
              const isEditingThis = editingCommentId === comment.id;
              const allowEdit = canEditComment(comment);
              const allowDelete = canDeleteComment(comment);

              return (
                <li
                  key={comment.id}
                  className={`space-y-2 rounded-lg border p-4 ${
                    comment.isSystem
                      ? 'border-amber-700/40 bg-amber-50/40 dark:bg-amber-950/20'
                      : 'bg-background'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {intl.formatMessage({ id: 'comments.authorLabel' }, { name: authorName })}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'comments.createdAtLabel' },
                          { date: formatIsoDateTimeShort(comment.createdAt, intl) },
                        )}
                      </span>
                      {comment.isSystem ? (
                        <Badge variant="demo">
                          <IconShieldLock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'comments.systemBadge' })}</span>
                        </Badge>
                      ) : null}
                      {comment.editedAt !== undefined ? (
                        <Badge variant="outline">
                          {intl.formatMessage({ id: 'comments.editedBadge' })}
                        </Badge>
                      ) : null}
                      {comment.deletedAt !== undefined ? (
                        <Badge variant="destructive">
                          {intl.formatMessage({ id: 'comments.deletedBadge' })}
                        </Badge>
                      ) : null}
                    </div>

                    {!isEditingThis && (allowEdit || allowDelete) ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {allowEdit ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={isMutating}
                            onClick={() => handleStartEdit(comment)}
                          >
                            <IconEdit className="h-4 w-4" aria-hidden="true" />
                            <span>{intl.formatMessage({ id: 'comments.edit.action' })}</span>
                          </Button>
                        ) : null}
                        {allowDelete ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={isMutating}
                            onClick={() => {
                              setDeleteReason('');
                              setDeletingComment(comment);
                            }}
                          >
                            <IconTrash className="h-4 w-4" aria-hidden="true" />
                            <span>{intl.formatMessage({ id: 'comments.delete.action' })}</span>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {isEditingThis ? (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-comment-body-${comment.id}`} required>
                          {intl.formatMessage({ id: 'comments.edit.label' })}
                        </Label>
                        <textarea
                          id={`edit-comment-body-${comment.id}`}
                          rows={3}
                          value={editingBody}
                          onChange={(event) => {
                            setEditingBody(event.target.value);
                            if (editError !== null) {
                              setEditError(null);
                            }
                          }}
                          aria-invalid={editError !== null}
                          aria-describedby={
                            editError !== null ? `edit-comment-error-${comment.id}` : undefined
                          }
                          className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive"
                        />
                        {editError !== null ? (
                          <p
                            id={`edit-comment-error-${comment.id}`}
                            role="alert"
                            className="text-xs font-medium text-destructive"
                          >
                            {editError}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-[44px]"
                          disabled={isMutating}
                          onClick={() => void handleSaveEdit(comment.id)}
                        >
                          {intl.formatMessage({ id: 'comments.edit.saveAction' })}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-[44px]"
                          disabled={isMutating}
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditError(null);
                          }}
                        >
                          {intl.formatMessage({ id: 'comments.edit.cancelAction' })}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                      {comment.body}
                    </p>
                  )}

                  {comment.editedAt !== undefined ? (
                    <p className="text-xs text-muted-foreground">
                      {intl.formatMessage(
                        { id: 'comments.editedAtLabel' },
                        { date: formatIsoDateTimeShort(comment.editedAt, intl) },
                      )}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ModalDialog
        isOpen={deletingComment !== null}
        titleId="delete-comment-dialog-title"
        title={intl.formatMessage({ id: 'comments.delete.confirmTitle' })}
        descriptionId="delete-comment-dialog-description"
        description={intl.formatMessage({ id: 'comments.delete.confirmDescription' })}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating}
        onClose={() => setDeletingComment(null)}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="delete-comment-reason">
              {intl.formatMessage({ id: 'comments.delete.reasonLabel' })}
            </Label>
            <Input
              id="delete-comment-reason"
              type="text"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              className="min-h-[44px]"
              disabled={isMutating}
              onClick={() => void handleConfirmDelete()}
            >
              {intl.formatMessage({ id: 'comments.delete.confirmAction' })}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isMutating}
              onClick={() => setDeletingComment(null)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </Card>
  );
}
