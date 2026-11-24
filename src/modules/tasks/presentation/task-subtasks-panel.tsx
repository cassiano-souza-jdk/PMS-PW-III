import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconEdit,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import {
  TASK_STATUSES,
  asUserId,
  type SubtaskId,
  type TaskStatus,
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
  Input,
  Label,
  ModalDialog,
} from '@/shared/ui';
import type {
  AssignSubtaskInput,
  CreateSubtaskInput,
  UpdateSubtaskInput,
} from '../application/services/task-service';
import { SUBTASK_STATUSES, type Subtask, type SubtaskStatus } from '../application/contracts';
import {
  SUBTASK_STATUS_BADGE_VARIANTS,
  SUBTASK_STATUS_LABEL_IDS,
  resolveUserDisplayName,
  type TaskUserOption,
} from './task-ui-helpers';

const createSubtaskFormSchema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(160),
  required: z.boolean(),
  assigneeId: z.string().optional(),
});

const editSubtaskFormSchema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(160),
  required: z.boolean(),
  status: z.enum([SUBTASK_STATUSES.OPEN, SUBTASK_STATUSES.DONE, SUBTASK_STATUSES.CANCELLED]),
});

type CreateSubtaskFormValues = z.infer<typeof createSubtaskFormSchema>;
type EditSubtaskFormValues = z.infer<typeof editSubtaskFormSchema>;

export interface TaskSubtasksPanelProps {
  readonly subtasks: readonly Subtask[];
  readonly taskStatus: TaskStatus;
  readonly isReadOnly: boolean;
  readonly canManageSubtasks: boolean;
  readonly canAssignSubtasks: boolean;
  readonly canCompleteBySubtaskId: Readonly<Record<string, boolean>>;
  readonly assignableUsers: readonly TaskUserOption[];
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
  readonly isMutating: boolean;
  readonly onCreateSubtask: (input: CreateSubtaskInput) => Promise<void>;
  readonly onUpdateSubtask: (subtaskId: SubtaskId, input: UpdateSubtaskInput) => Promise<void>;
  readonly onAssignSubtask: (subtaskId: SubtaskId, input: AssignSubtaskInput) => Promise<void>;
  readonly onCompleteSubtask: (subtaskId: SubtaskId, title: string) => Promise<void>;
  readonly onReorderSubtasks: (orderedSubtaskIds: readonly SubtaskId[]) => Promise<void>;
  readonly onDeleteSubtask: (subtaskId: SubtaskId, title: string) => Promise<void>;
}

const VALIDATION_ERROR_IDS: Readonly<Record<string, MessageId>> = {
  'validation.required': 'validation.required',
};

export function TaskSubtasksPanel({
  subtasks,
  taskStatus,
  isReadOnly,
  canManageSubtasks,
  canAssignSubtasks,
  canCompleteBySubtaskId,
  assignableUsers,
  usersById,
  isMutating,
  onCreateSubtask,
  onUpdateSubtask,
  onAssignSubtask,
  onCompleteSubtask,
  onReorderSubtasks,
  onDeleteSubtask,
}: TaskSubtasksPanelProps) {
  const intl = useIntl();
  const [editingSubtask, setEditingSubtask] = useState<Subtask | null>(null);
  const [deletingSubtask, setDeletingSubtask] = useState<Subtask | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isTaskTerminal =
    taskStatus === TASK_STATUSES.DONE || taskStatus === TASK_STATUSES.CANCELLED;
  const canCreateOrEdit = canManageSubtasks && !isReadOnly && !isTaskTerminal;
  const canReorder = canManageSubtasks && !isReadOnly && taskStatus !== TASK_STATUSES.CANCELLED;
  const canAssign = canAssignSubtasks && !isReadOnly && !isTaskTerminal;

  const sortedSubtasks = [...subtasks].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );

  const createForm = useForm<CreateSubtaskFormValues>({
    resolver: zodResolver(createSubtaskFormSchema),
    defaultValues: {
      title: '',
      required: false,
      assigneeId: '',
    },
  });

  const editForm = useForm<EditSubtaskFormValues>({
    resolver: zodResolver(editSubtaskFormSchema),
    defaultValues: {
      title: '',
      required: false,
      status: SUBTASK_STATUSES.OPEN,
    },
  });

  const handleCreateSubmit = async (values: CreateSubtaskFormValues) => {
    setLocalError(null);
    const trimmedAssignee = values.assigneeId?.trim() ?? '';
    await onCreateSubtask({
      title: values.title,
      required: values.required,
      ...(canAssign && trimmedAssignee.length > 0
        ? { assigneeId: asUserId(trimmedAssignee, 'assigneeId') }
        : {}),
    });
    createForm.reset({
      title: '',
      required: false,
      assigneeId: '',
    });
  };

  const handleOpenEdit = (subtask: Subtask) => {
    setLocalError(null);
    editForm.reset({
      title: subtask.title,
      required: subtask.required,
      status: subtask.status,
    });
    setEditingSubtask(subtask);
  };

  const handleEditSubmit = async (values: EditSubtaskFormValues) => {
    if (editingSubtask === null) {
      return;
    }
    setLocalError(null);
    await onUpdateSubtask(editingSubtask.id, {
      title: values.title,
      required: values.required,
      status: values.status as SubtaskStatus,
    });
    setEditingSubtask(null);
  };

  const handleMoveSubtask = async (subtask: Subtask, direction: 'up' | 'down') => {
    setLocalError(null);
    const index = sortedSubtasks.findIndex((item) => item.id === subtask.id);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedSubtasks.length) {
      return;
    }

    const reordered = [...sortedSubtasks];
    const [moved] = reordered.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    reordered.splice(targetIndex, 0, moved);

    await onReorderSubtasks(reordered.map((item) => item.id));
    setAnnouncement(
      intl.formatMessage(
        { id: 'subtasks.reorderAnnouncement' },
        { title: subtask.title, position: targetIndex + 1 },
      ),
    );
  };

  const handleConfirmDelete = async () => {
    if (deletingSubtask === null) {
      return;
    }
    setLocalError(null);
    await onDeleteSubtask(deletingSubtask.id, deletingSubtask.title);
    setDeletingSubtask(null);
  };

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: 'subtasks.title' })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: 'subtasks.description' })}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {localError !== null ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{localError}</AlertDescription>
          </Alert>
        ) : null}

        {canCreateOrEdit ? (
          <form
            onSubmit={createForm.handleSubmit(handleCreateSubmit)}
            noValidate
            className="space-y-4 rounded-lg border bg-muted/30 p-4"
          >
            <h3 className="text-base font-semibold text-foreground">
              {intl.formatMessage({ id: 'subtasks.create.title' })}
            </h3>

            <div className="space-y-1.5">
              <Label htmlFor="subtask-create-title" required>
                {intl.formatMessage({ id: 'subtasks.create.titleLabel' })}
              </Label>
              <Input
                id="subtask-create-title"
                type="text"
                placeholder={intl.formatMessage({ id: 'subtasks.create.titlePlaceholder' })}
                aria-invalid={createForm.formState.errors.title !== undefined}
                aria-describedby={
                  createForm.formState.errors.title !== undefined
                    ? 'subtask-create-title-error'
                    : undefined
                }
                {...createForm.register('title')}
              />
              {createForm.formState.errors.title !== undefined ? (
                <p
                  id="subtask-create-title-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id:
                      VALIDATION_ERROR_IDS[createForm.formState.errors.title.message ?? ''] ??
                      'validation.required',
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <label
                htmlFor="subtask-create-required"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
              >
                <input
                  id="subtask-create-required"
                  type="checkbox"
                  className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  {...createForm.register('required')}
                />
                <span>{intl.formatMessage({ id: 'subtasks.create.requiredLabel' })}</span>
              </label>

              {canAssign ? (
                <div className="w-full space-y-1.5 sm:max-w-xs">
                  <Label htmlFor="subtask-create-assignee">
                    {intl.formatMessage({ id: 'subtasks.create.assigneeLabel' })}
                  </Label>
                  <select
                    id="subtask-create-assignee"
                    className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    {...createForm.register('assigneeId')}
                  >
                    <option value="">
                      {intl.formatMessage({ id: 'subtasks.unassignedOption' })}
                    </option>
                    {assignableUsers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={isMutating || createForm.formState.isSubmitting}
            >
              <IconPlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: createForm.formState.isSubmitting
                    ? 'auth.common.submitting'
                    : 'subtasks.create.submit',
                })}
              </span>
            </Button>
          </form>
        ) : null}

        {sortedSubtasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'subtasks.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {sortedSubtasks.map((subtask, index) => {
              const canCompleteThisSubtask =
                (canCompleteBySubtaskId[subtask.id] ?? false) &&
                !isReadOnly &&
                !isTaskTerminal &&
                subtask.status === SUBTASK_STATUSES.OPEN;

              const assigneeDisplay =
                subtask.assigneeId !== undefined
                  ? intl.formatMessage(
                      { id: 'subtasks.assigneeLabel' },
                      {
                        name: resolveUserDisplayName(
                          subtask.assigneeId,
                          usersById,
                          unknownUserLabel,
                        ),
                      },
                    )
                  : intl.formatMessage({ id: 'subtasks.unassignedLabel' });

              return (
                <li
                  key={subtask.id}
                  className="space-y-3 rounded-lg border bg-background p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <h3 className="break-words text-sm font-semibold text-foreground">
                        {subtask.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={SUBTASK_STATUS_BADGE_VARIANTS[subtask.status]}>
                          {intl.formatMessage({ id: SUBTASK_STATUS_LABEL_IDS[subtask.status] })}
                        </Badge>
                        <Badge variant={subtask.required ? 'destructive' : 'outline'}>
                          {intl.formatMessage({
                            id: subtask.required
                              ? 'subtasks.requiredBadge'
                              : 'subtasks.optionalBadge',
                          })}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{assigneeDisplay}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {canCompleteThisSubtask ? (
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-[44px]"
                          disabled={isMutating}
                          onClick={() => void onCompleteSubtask(subtask.id, subtask.title)}
                        >
                          <IconCheck className="h-4 w-4" aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'subtasks.complete.action' })}</span>
                        </Button>
                      ) : null}

                      {canCreateOrEdit && subtask.status === SUBTASK_STATUSES.OPEN ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-[44px]"
                          disabled={isMutating}
                          onClick={() =>
                            void onUpdateSubtask(subtask.id, {
                              status: SUBTASK_STATUSES.CANCELLED,
                            })
                          }
                        >
                          <IconX className="h-4 w-4" aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'subtasks.cancel.action' })}</span>
                        </Button>
                      ) : null}

                      {canReorder ? (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={`${intl.formatMessage({ id: 'subtasks.moveUpAction' })}: ${subtask.title}`}
                            title={intl.formatMessage({ id: 'subtasks.moveUpAction' })}
                            disabled={isMutating || index === 0}
                            onClick={() => void handleMoveSubtask(subtask, 'up')}
                          >
                            <IconArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={`${intl.formatMessage({ id: 'subtasks.moveDownAction' })}: ${subtask.title}`}
                            title={intl.formatMessage({ id: 'subtasks.moveDownAction' })}
                            disabled={isMutating || index === sortedSubtasks.length - 1}
                            onClick={() => void handleMoveSubtask(subtask, 'down')}
                          >
                            <IconArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </>
                      ) : null}

                      {canCreateOrEdit ? (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={`${intl.formatMessage({ id: 'subtasks.edit.action' })}: ${subtask.title}`}
                            title={intl.formatMessage({ id: 'subtasks.edit.action' })}
                            disabled={isMutating}
                            onClick={() => handleOpenEdit(subtask)}
                          >
                            <IconEdit className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={`${intl.formatMessage({ id: 'subtasks.delete.action' })}: ${subtask.title}`}
                            title={intl.formatMessage({ id: 'subtasks.delete.action' })}
                            disabled={isMutating}
                            onClick={() => setDeletingSubtask(subtask)}
                          >
                            <IconTrash className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {canAssign ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      <Label htmlFor={`subtask-assign-${subtask.id}`} className="text-xs">
                        {intl.formatMessage({ id: 'subtasks.assign.label' })}
                      </Label>
                      <select
                        id={`subtask-assign-${subtask.id}`}
                        value={subtask.assigneeId ?? ''}
                        disabled={isMutating}
                        onChange={(event) => {
                          const nextVal = event.target.value;
                          void onAssignSubtask(subtask.id, {
                            assigneeId: nextVal === '' ? null : asUserId(nextVal, 'assigneeId'),
                          });
                        }}
                        className="flex min-h-[44px] max-w-xs flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="">
                          {intl.formatMessage({ id: 'subtasks.unassignedOption' })}
                        </option>
                        {assignableUsers.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ModalDialog
        isOpen={editingSubtask !== null}
        titleId="edit-subtask-dialog-title"
        title={intl.formatMessage({ id: 'subtasks.edit.action' })}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating || editForm.formState.isSubmitting}
        onClose={() => setEditingSubtask(null)}
      >
        <form onSubmit={editForm.handleSubmit(handleEditSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subtask-edit-title" required>
              {intl.formatMessage({ id: 'subtasks.create.titleLabel' })}
            </Label>
            <Input
              id="subtask-edit-title"
              type="text"
              aria-invalid={editForm.formState.errors.title !== undefined}
              aria-describedby={
                editForm.formState.errors.title !== undefined
                  ? 'subtask-edit-title-error'
                  : undefined
              }
              {...editForm.register('title')}
            />
            {editForm.formState.errors.title !== undefined ? (
              <p
                id="subtask-edit-title-error"
                role="alert"
                className="text-xs font-medium text-destructive"
              >
                {intl.formatMessage({ id: 'validation.required' })}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subtask-edit-status">
              {intl.formatMessage({ id: 'tasks.filters.statusLabel' })}
            </Label>
            <select
              id="subtask-edit-status"
              className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...editForm.register('status')}
            >
              <option value={SUBTASK_STATUSES.OPEN}>
                {intl.formatMessage({ id: 'subtasks.status.OPEN' })}
              </option>
              <option value={SUBTASK_STATUSES.DONE}>
                {intl.formatMessage({ id: 'subtasks.status.DONE' })}
              </option>
              <option value={SUBTASK_STATUSES.CANCELLED}>
                {intl.formatMessage({ id: 'subtasks.status.CANCELLED' })}
              </option>
            </select>
          </div>

          <label
            htmlFor="subtask-edit-required"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id="subtask-edit-required"
              type="checkbox"
              className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...editForm.register('required')}
            />
            <span>{intl.formatMessage({ id: 'subtasks.create.requiredLabel' })}</span>
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={isMutating || editForm.formState.isSubmitting}
            >
              {intl.formatMessage({ id: 'subtasks.edit.saveAction' })}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isMutating}
              onClick={() => setEditingSubtask(null)}
            >
              {intl.formatMessage({ id: 'subtasks.edit.cancelAction' })}
            </Button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        isOpen={deletingSubtask !== null}
        titleId="delete-subtask-dialog-title"
        title={intl.formatMessage({ id: 'subtasks.delete.confirmTitle' })}
        descriptionId="delete-subtask-dialog-description"
        description={
          deletingSubtask !== null
            ? intl.formatMessage(
                { id: 'subtasks.delete.confirmDescription' },
                { title: deletingSubtask.title },
              )
            : undefined
        }
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating}
        onClose={() => setDeletingSubtask(null)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void handleConfirmDelete()}
          >
            {intl.formatMessage({ id: 'subtasks.delete.action' })}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => setDeletingSubtask(null)}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
        </div>
      </ModalDialog>
    </Card>
  );
}
