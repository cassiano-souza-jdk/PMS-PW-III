import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconArrowLeft,
  IconBan,
  IconCheck,
  IconLayoutKanban,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconRestore,
  IconTrash,
  IconUserMinus,
  IconUserPlus,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import {
  PRIORITIES,
  TASK_STATUSES,
  asBoardColumnId,
  asUserId,
  isIsoDate,
  isSoftDeleted,
  type AttachmentId,
  type IsoDateTime,
  type Priority,
  type SubtaskId,
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
import type { TaskBoardColumnSummary } from '../application/ports/task-project-context.port';
import type {
  AssignSubtaskInput,
  AssignTaskInput,
  CompleteTaskInput,
  CreateSubtaskInput,
  ReopenTaskInput,
  TaskCommentInput,
  TaskDetail,
  UpdateSubtaskInput,
  UpdateTaskInput,
} from '../application/services/task-service';
import type { Tag, TagId, TaskAttachment, TaskCommentId } from '../application/contracts';
import { TaskAttachmentsPanel } from './task-attachments-panel';
import { TaskCommentsPanel } from './task-comments-panel';
import { TaskCyclesAndHistoryPanel } from './task-cycles-and-history-panel';
import { TaskSubtasksPanel } from './task-subtasks-panel';
import {
  TASK_PRIORITY_BADGE_VARIANTS,
  TASK_PRIORITY_LABEL_IDS,
  TASK_STATUS_BADGE_VARIANTS,
  TASK_STATUS_LABEL_IDS,
  dateInputToEndOfDayIso,
  formatIsoDateTimeShort,
  resolveTagBadgeClassName,
  resolveUserDisplayName,
  toIsoDateInputValue,
  type TaskPanelFeedback,
  type TaskUserOption,
} from './task-ui-helpers';

type DetailTabId =
  'overview' | 'subtasks' | 'dependencies' | 'impediments' | 'comments' | 'attachments' | 'history';

const TAB_ORDER: readonly DetailTabId[] = [
  'overview',
  'subtasks',
  'dependencies',
  'impediments',
  'comments',
  'attachments',
  'history',
];

export interface TaskDetailPermissions {
  readonly canViewBoard: boolean;
  readonly canEditCoreFields: boolean;
  readonly canEditPriority: boolean;
  readonly canEditDueDate: boolean;
  readonly canEditTags: boolean;
  readonly canAssignTask: boolean;
  readonly canManageParticipants: boolean;
  readonly canStartTask: boolean;
  readonly canPauseTask: boolean;
  readonly canCompleteTask: boolean;
  readonly canCancelTask: boolean;
  readonly canReopenTask: boolean;
  readonly canDeleteTask: boolean;
  readonly canRestoreTask: boolean;
  readonly canManageSubtasks: boolean;
  readonly canAssignSubtasks: boolean;
  readonly canCompleteBySubtaskId: Readonly<Record<string, boolean>>;
  readonly canComment: boolean;
  readonly canModerateComments: boolean;
  readonly canManageAttachments: boolean;
  readonly canViewHistory: boolean;
  readonly canManageDependencies: boolean;
}

export interface TaskDetailPanelProps {
  readonly detail: TaskDetail;
  readonly actorUserId: UserId;
  readonly orgTags: readonly Tag[];
  readonly boardColumns: readonly TaskBoardColumnSummary[];
  readonly projectMembers: readonly TaskUserOption[];
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
  readonly permissions: TaskDetailPermissions;
  readonly commentEditWindowMinutes: number;
  readonly maxAttachmentSizeBytes: number;
  readonly maxContextAttachmentsSizeBytes: number;
  readonly maxAttachmentsPerContext: number;
  readonly referenceNowIso: IsoDateTime;
  readonly referenceNowMs: number;
  readonly dependenciesCount: number;
  readonly impedimentsCount: number;
  readonly dependenciesContent: ReactNode;
  readonly impedimentsContent: ReactNode;
  readonly feedback?: TaskPanelFeedback | null;
  readonly onUpdateTask: (input: UpdateTaskInput) => Promise<void>;
  readonly onAssignTask: (input: AssignTaskInput) => Promise<void>;
  readonly onAddParticipant: (userId: UserId) => Promise<void>;
  readonly onRemoveParticipant: (userId: UserId) => Promise<void>;
  readonly onStartTask: () => Promise<void>;
  readonly onPauseTask: (reason: string) => Promise<void>;
  readonly onResumeTask: () => Promise<void>;
  readonly onCompleteTask: (input?: CompleteTaskInput) => Promise<void>;
  readonly onCancelTask: (justification: string) => Promise<void>;
  readonly onRequestTaskCancellation: (justification: string) => Promise<void>;
  readonly onReopenTask: (input: ReopenTaskInput) => Promise<void>;
  readonly onDeleteTask: (reason?: string) => Promise<void>;
  readonly onRestoreTask: () => Promise<void>;
  readonly onCreateSubtask: (input: CreateSubtaskInput) => Promise<void>;
  readonly onUpdateSubtask: (subtaskId: SubtaskId, input: UpdateSubtaskInput) => Promise<void>;
  readonly onAssignSubtask: (subtaskId: SubtaskId, input: AssignSubtaskInput) => Promise<void>;
  readonly onCompleteSubtask: (subtaskId: SubtaskId, title: string) => Promise<void>;
  readonly onReorderSubtasks: (orderedSubtaskIds: readonly SubtaskId[]) => Promise<void>;
  readonly onDeleteSubtask: (subtaskId: SubtaskId, title: string) => Promise<void>;
  readonly onAddComment: (input: TaskCommentInput) => Promise<void>;
  readonly onUpdateComment: (commentId: TaskCommentId, input: TaskCommentInput) => Promise<void>;
  readonly onDeleteComment: (commentId: TaskCommentId, reason?: string) => Promise<void>;
  readonly onUploadAttachment: (file: File) => Promise<void>;
  readonly onDownloadAttachment: (attachment: TaskAttachment) => Promise<void>;
  readonly onDeleteAttachment: (attachmentId: AttachmentId, fileName: string) => Promise<void>;
}

const VALIDATION_ERROR_IDS: Readonly<Record<string, MessageId>> = {
  'validation.required': 'validation.required',
  'validation.displayNameMin': 'validation.displayNameMin',
  'validation.dateInvalid': 'validation.dateInvalid',
};

function resolveValidationMessageId(code: string | undefined): MessageId {
  if (code !== undefined && code in VALIDATION_ERROR_IDS) {
    return VALIDATION_ERROR_IDS[code] ?? 'validation.required';
  }
  return 'validation.required';
}

const editTaskFormSchema = z.object({
  title: z.string().trim().min(2, 'validation.displayNameMin').max(160),
  description: z.string().trim().max(4000),
  priority: z.enum([PRIORITIES.LOW, PRIORITIES.MEDIUM, PRIORITIES.HIGH, PRIORITIES.CRITICAL]),
  dueDateInput: z
    .string()
    .trim()
    .refine((value) => value === '' || isIsoDate(value), 'validation.dateInvalid'),
  deadlineJustification: z.string().trim().max(500).optional(),
});

type EditTaskFormValues = z.infer<typeof editTaskFormSchema>;

type ActiveLifecycleDialog =
  null | 'PAUSE' | 'DEPENDENCY_OVERRIDE' | 'CANCEL' | 'CANCEL_REQUEST' | 'REOPEN' | 'DELETE';

interface OverviewEditSectionProps {
  readonly detail: TaskDetail;
  readonly orgTags: readonly Tag[];
  readonly projectMembers: readonly TaskUserOption[];
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
  readonly permissions: TaskDetailPermissions;
  readonly isReadOnly: boolean;
  readonly isMutating: boolean;
  readonly onUpdateTask: (input: UpdateTaskInput) => Promise<void>;
  readonly onAssignTask: (input: AssignTaskInput) => Promise<void>;
  readonly onAddParticipant: (userId: UserId) => Promise<void>;
  readonly onRemoveParticipant: (userId: UserId) => Promise<void>;
}

function OverviewEditSection({
  detail,
  orgTags,
  projectMembers,
  usersById,
  permissions,
  isReadOnly,
  isMutating,
  onUpdateTask,
  onAssignTask,
  onAddParticipant,
  onRemoveParticipant,
}: OverviewEditSectionProps) {
  const intl = useIntl();
  const { task, participants, tags } = detail;
  const isCancelled = task.status === TASK_STATUSES.CANCELLED;

  const canEditAnyTaskField =
    !isReadOnly &&
    !isCancelled &&
    (permissions.canEditCoreFields ||
      permissions.canEditPriority ||
      permissions.canEditDueDate ||
      permissions.canEditTags);

  const [selectedTagIds, setSelectedTagIds] = useState<readonly TagId[]>(task.tagIds);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>(task.assigneeId ?? '');
  const [selectedAddParticipantId, setSelectedAddParticipantId] = useState<string>('');

  const editForm = useForm<EditTaskFormValues>({
    resolver: zodResolver(editTaskFormSchema),
    defaultValues: {
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      dueDateInput: toIsoDateInputValue(task.dueDate),
      deadlineJustification: '',
    },
  });

  const handleEditSubmit = async (values: EditTaskFormValues) => {
    const payload: {
      title?: string;
      description?: string | null;
      priority?: Priority;
      dueDate?: IsoDateTime | null;
      tagIds?: readonly TagId[];
      deadlineJustification?: string;
    } = {};

    if (permissions.canEditCoreFields) {
      if (values.title !== task.title) {
        payload.title = values.title;
      }
      const nextDesc = values.description.trim();
      const prevDesc = task.description ?? '';
      if (nextDesc !== prevDesc) {
        payload.description = nextDesc.length > 0 ? nextDesc : null;
      }
    }

    if (permissions.canEditPriority && values.priority !== task.priority) {
      payload.priority = values.priority as Priority;
    }

    if (permissions.canEditDueDate) {
      const prevDateVal = toIsoDateInputValue(task.dueDate);
      if (values.dueDateInput !== prevDateVal) {
        const nextIso = dateInputToEndOfDayIso(values.dueDateInput);
        payload.dueDate = nextIso;
        const trimmedReason = values.deadlineJustification?.trim() ?? '';
        if (trimmedReason.length > 0) {
          payload.deadlineJustification = trimmedReason;
        }
      }
    }

    if (permissions.canEditTags) {
      const prevSorted = [...task.tagIds].sort().join(',');
      const nextSorted = [...selectedTagIds].sort().join(',');
      if (prevSorted !== nextSorted) {
        payload.tagIds = selectedTagIds;
      }
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await onUpdateTask(payload);
  };

  const activeParticipantUserIds = new Set(participants.map((p) => p.userId));
  const candidateParticipants = projectMembers.filter(
    (member) => !activeParticipantUserIds.has(member.userId),
  );
  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'tasks.edit.title' })}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {canEditAnyTaskField ? (
            <form
              onSubmit={editForm.handleSubmit(handleEditSubmit)}
              noValidate
              className="space-y-4"
            >
              {permissions.canEditCoreFields ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-detail-edit-title" required>
                      {intl.formatMessage({ id: 'tasks.fields.titleLabel' })}
                    </Label>
                    <Input
                      id="task-detail-edit-title"
                      type="text"
                      aria-invalid={editForm.formState.errors.title !== undefined}
                      aria-describedby={
                        editForm.formState.errors.title !== undefined
                          ? 'task-detail-edit-title-error'
                          : undefined
                      }
                      {...editForm.register('title')}
                    />
                    {editForm.formState.errors.title !== undefined ? (
                      <p
                        id="task-detail-edit-title-error"
                        role="alert"
                        className="text-xs font-medium text-destructive"
                      >
                        {intl.formatMessage({
                          id: resolveValidationMessageId(editForm.formState.errors.title.message),
                        })}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="task-detail-edit-description">
                      {intl.formatMessage({ id: 'tasks.fields.descriptionLabel' })}
                    </Label>
                    <textarea
                      id="task-detail-edit-description"
                      rows={3}
                      className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...editForm.register('description')}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-foreground">
                    {task.description ?? intl.formatMessage({ id: 'tasks.fields.noDescription' })}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {permissions.canEditPriority ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="task-detail-edit-priority">
                      {intl.formatMessage({ id: 'tasks.fields.priorityLabel' })}
                    </Label>
                    <select
                      id="task-detail-edit-priority"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...editForm.register('priority')}
                    >
                      {(Object.values(PRIORITIES) as readonly Priority[]).map((priority) => (
                        <option key={priority} value={priority}>
                          {intl.formatMessage({ id: TASK_PRIORITY_LABEL_IDS[priority] })}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {intl.formatMessage({ id: 'tasks.fields.priorityLabel' })}
                    </p>
                    <Badge variant={TASK_PRIORITY_BADGE_VARIANTS[task.priority]}>
                      {intl.formatMessage({ id: TASK_PRIORITY_LABEL_IDS[task.priority] })}
                    </Badge>
                  </div>
                )}

                {permissions.canEditDueDate ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="task-detail-edit-due-date">
                      {intl.formatMessage({ id: 'tasks.fields.dueDateLabel' })}
                    </Label>
                    <Input
                      id="task-detail-edit-due-date"
                      type="date"
                      aria-invalid={editForm.formState.errors.dueDateInput !== undefined}
                      aria-describedby={
                        editForm.formState.errors.dueDateInput !== undefined
                          ? 'task-detail-edit-due-date-error'
                          : undefined
                      }
                      {...editForm.register('dueDateInput')}
                    />
                    {editForm.formState.errors.dueDateInput !== undefined ? (
                      <p
                        id="task-detail-edit-due-date-error"
                        role="alert"
                        className="text-xs font-medium text-destructive"
                      >
                        {intl.formatMessage({ id: 'validation.dateInvalid' })}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {intl.formatMessage({ id: 'tasks.fields.dueDateLabel' })}
                    </p>
                    <p className="text-sm text-foreground">
                      {task.dueDate !== undefined
                        ? formatIsoDateTimeShort(task.dueDate, intl)
                        : intl.formatMessage({ id: 'tasks.fields.noDueDate' })}
                    </p>
                  </div>
                )}
              </div>

              {permissions.canEditDueDate ? (
                <div className="space-y-1.5">
                  <Label htmlFor="task-detail-edit-deadline-reason">
                    {intl.formatMessage({ id: 'tasks.fields.deadlineJustificationLabel' })}
                  </Label>
                  <Input
                    id="task-detail-edit-deadline-reason"
                    type="text"
                    placeholder={intl.formatMessage({
                      id: 'tasks.fields.deadlineJustificationPlaceholder',
                    })}
                    {...editForm.register('deadlineJustification')}
                  />
                </div>
              ) : null}

              {permissions.canEditTags ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-foreground">
                    {intl.formatMessage({ id: 'tags.task.title' })}
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    {intl.formatMessage({ id: 'tags.task.description' })}
                  </p>
                  {orgTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {intl.formatMessage({ id: 'tags.catalog.empty' })}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {orgTags.map((tag) => {
                        const checked = selectedTagIds.includes(tag.id);
                        return (
                          <label
                            key={tag.id}
                            htmlFor={`task-detail-tag-${tag.id}`}
                            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-foreground"
                          >
                            <input
                              id={`task-detail-tag-${tag.id}`}
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setSelectedTagIds((prev) => [...prev, tag.id]);
                                } else {
                                  setSelectedTagIds((prev) => prev.filter((id) => id !== tag.id));
                                }
                              }}
                              className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                            <span>{tag.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {intl.formatMessage({ id: 'tags.task.title' })}
                  </p>
                  {tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {intl.formatMessage({ id: 'tags.task.empty' })}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="outline"
                          className={resolveTagBadgeClassName(tag.colorToken)}
                        >
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={isMutating || editForm.formState.isSubmitting}
              >
                <IconCheck className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({
                    id: editForm.formState.isSubmitting
                      ? 'auth.common.submitting'
                      : 'tasks.edit.saveAction',
                  })}
                </span>
              </Button>
            </form>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap text-foreground">
                {task.description ?? intl.formatMessage({ id: 'tasks.fields.noDescription' })}
              </p>
              <p className="text-muted-foreground">
                {task.dueDate !== undefined
                  ? intl.formatMessage(
                      { id: 'tasks.fields.dueDateDisplay' },
                      { date: formatIsoDateTimeShort(task.dueDate, intl) },
                    )
                  : intl.formatMessage({ id: 'tasks.fields.noDueDate' })}
              </p>
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: 'tags.task.empty' })}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className={resolveTagBadgeClassName(tag.colorToken)}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'tasks.participants.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'tasks.participants.description' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2 border-b pb-4">
            <p className="text-sm font-medium text-foreground">
              {intl.formatMessage(
                { id: 'tasks.fields.assigneeDisplay' },
                {
                  name:
                    task.assigneeId !== undefined
                      ? resolveUserDisplayName(task.assigneeId, usersById, unknownUserLabel)
                      : intl.formatMessage({ id: 'tasks.fields.unassignedOption' }),
                },
              )}
            </p>

            {permissions.canAssignTask && !isReadOnly && !isCancelled ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="task-detail-assign-select">
                    {intl.formatMessage({ id: 'tasks.assign.label' })}
                  </Label>
                  <select
                    id="task-detail-assign-select"
                    value={selectedAssigneeId}
                    onChange={(event) => setSelectedAssigneeId(event.target.value)}
                    className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">
                      {intl.formatMessage({ id: 'tasks.fields.unassignedOption' })}
                    </option>
                    {projectMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  disabled={isMutating}
                  onClick={() =>
                    void onAssignTask({
                      assigneeId:
                        selectedAssigneeId === ''
                          ? null
                          : asUserId(selectedAssigneeId, 'assigneeId'),
                    })
                  }
                >
                  {intl.formatMessage({ id: 'tasks.assign.saveAction' })}
                </Button>
              </div>
            ) : null}
          </div>

          {permissions.canManageParticipants && !isReadOnly && !isCancelled ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="task-detail-add-participant">
                  {intl.formatMessage({ id: 'tasks.participants.addLabel' })}
                </Label>
                <select
                  id="task-detail-add-participant"
                  value={selectedAddParticipantId}
                  onChange={(event) => setSelectedAddParticipantId(event.target.value)}
                  className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">
                    {intl.formatMessage({ id: 'tasks.participants.addPlaceholder' })}
                  </option>
                  {candidateParticipants.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={isMutating || selectedAddParticipantId === ''}
                onClick={() => {
                  const userId = asUserId(selectedAddParticipantId, 'userId');
                  void onAddParticipant(userId).then(() => setSelectedAddParticipantId(''));
                }}
              >
                <IconUserPlus className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'tasks.participants.addAction' })}</span>
              </Button>
            </div>
          ) : null}

          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'tasks.participants.empty' })}
            </p>
          ) : (
            <ul className="space-y-2">
              {participants.map((participant) => {
                const displayName = resolveUserDisplayName(
                  participant.userId,
                  usersById,
                  unknownUserLabel,
                );
                const isMainAssignee = participant.userId === task.assigneeId;

                return (
                  <li
                    key={participant.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{displayName}</span>
                      {isMainAssignee ? (
                        <Badge variant="secondary">
                          {intl.formatMessage({ id: 'tasks.participants.assigneeBadge' })}
                        </Badge>
                      ) : null}
                    </div>

                    {permissions.canManageParticipants && !isReadOnly && !isCancelled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={isMutating}
                        onClick={() => void onRemoveParticipant(participant.userId)}
                      >
                        <IconUserMinus className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'tasks.participants.removeAction' })}</span>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function TaskDetailPanel({
  detail,
  actorUserId,
  orgTags,
  boardColumns,
  projectMembers,
  usersById,
  permissions,
  commentEditWindowMinutes,
  maxAttachmentSizeBytes,
  maxContextAttachmentsSizeBytes,
  maxAttachmentsPerContext,
  referenceNowIso,
  referenceNowMs,
  dependenciesCount,
  impedimentsCount,
  dependenciesContent,
  impedimentsContent,
  feedback = null,
  onUpdateTask,
  onAssignTask,
  onAddParticipant,
  onRemoveParticipant,
  onStartTask,
  onPauseTask,
  onResumeTask,
  onCompleteTask,
  onCancelTask,
  onRequestTaskCancellation,
  onReopenTask,
  onDeleteTask,
  onRestoreTask,
  onCreateSubtask,
  onUpdateSubtask,
  onAssignSubtask,
  onCompleteSubtask,
  onReorderSubtasks,
  onDeleteSubtask,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onUploadAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
}: TaskDetailPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const dialogInputRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef<Partial<Record<DetailTabId, HTMLButtonElement | null>>>({});

  const {
    task,
    project,
    column,
    subtasks,
    comments,
    attachments,
    pauses,
    executionCycles,
    deadlineHistory,
  } = detail;

  const isProjectArchived = project.archivedAt !== undefined || project.status === 'ARCHIVED';
  const isTaskDeleted = isSoftDeleted(task);
  const isReadOnly = isProjectArchived || isTaskDeleted;
  const isTerminal = task.status === TASK_STATUSES.DONE || task.status === TASK_STATUSES.CANCELLED;

  const [activeTab, setActiveTab] = useState<DetailTabId>('overview');
  const [activeDialog, setActiveDialog] = useState<ActiveLifecycleDialog>(null);
  const [dialogText, setDialogText] = useState('');
  const [reopenColumnId, setReopenColumnId] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, [task.id]);

  const reopenEligibleColumns = useMemo(
    () =>
      [...boardColumns]
        .filter((col) => col.archivedAt === undefined && col.columnRole !== 'FINAL')
        .sort((a, b) => a.order - b.order),
    [boardColumns],
  );

  const openLifecycleDialog = (kind: Exclude<ActiveLifecycleDialog, null>) => {
    setDialogError(null);
    setDialogText('');
    if (kind === 'REOPEN') {
      const defaultReopenCol =
        reopenEligibleColumns.find((col) => col.columnRole === 'OPERATIONAL')?.id ??
        reopenEligibleColumns[0]?.id ??
        '';
      setReopenColumnId(defaultReopenCol);
    }
    setActiveDialog(kind);
  };

  const runAction = async (fn: () => Promise<void>) => {
    setLifecycleError(null);
    setIsMutating(true);
    try {
      await fn();
    } finally {
      setIsMutating(false);
    }
  };

  const handleCompleteClick = async () => {
    setLifecycleError(null);
    setIsMutating(true);
    try {
      await onCompleteTask();
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        if (error.details?.pendingRequiredDependencyIds !== undefined) {
          if (permissions.canManageDependencies) {
            openLifecycleDialog('DEPENDENCY_OVERRIDE');
          } else {
            setLifecycleError(intl.formatMessage({ id: 'kanban.dependencyOverride.error' }));
          }
          return;
        }
        if (error.details?.incompleteSubtaskIds !== undefined) {
          setLifecycleError(intl.formatMessage({ id: 'tasks.complete.blockedBySubtasksError' }));
          return;
        }
        if (error.details?.openBlockingImpedimentIds !== undefined) {
          setLifecycleError(intl.formatMessage({ id: 'tasks.complete.blockedByImpedimentsError' }));
          return;
        }
        setLifecycleError(error.message);
        return;
      }
      setLifecycleError(
        isAppError(error) ? error.message : intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }),
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleConfirmLifecycleDialog = async () => {
    if (activeDialog === null) {
      return;
    }

    const trimmed = dialogText.trim();
    const requiresText =
      activeDialog === 'PAUSE' ||
      activeDialog === 'DEPENDENCY_OVERRIDE' ||
      activeDialog === 'CANCEL' ||
      activeDialog === 'CANCEL_REQUEST';

    if (requiresText && trimmed.length === 0) {
      setDialogError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    setDialogError(null);
    setIsMutating(true);
    try {
      if (activeDialog === 'PAUSE') {
        await onPauseTask(trimmed);
      } else if (activeDialog === 'DEPENDENCY_OVERRIDE') {
        await onCompleteTask({ dependencyOverrideJustification: trimmed });
      } else if (activeDialog === 'CANCEL') {
        await onCancelTask(trimmed);
      } else if (activeDialog === 'CANCEL_REQUEST') {
        await onRequestTaskCancellation(trimmed);
      } else if (activeDialog === 'REOPEN') {
        const targetColId =
          reopenColumnId.trim().length > 0
            ? asBoardColumnId(reopenColumnId, 'targetColumnId')
            : undefined;
        await onReopenTask({
          ...(trimmed.length > 0 ? { reason: trimmed } : {}),
          ...(targetColId !== undefined ? { targetColumnId: targetColId } : {}),
        });
      } else if (activeDialog === 'DELETE') {
        await onDeleteTask(trimmed.length > 0 ? trimmed : undefined);
      }
      setActiveDialog(null);
      setDialogText('');
    } catch (error) {
      if (isAppError(error)) {
        setDialogError(error.message);
      } else {
        setDialogError(intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }));
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TAB_ORDER.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const targetTab = TAB_ORDER[nextIndex];
    if (targetTab !== undefined) {
      setActiveTab(targetTab);
      tabRefs.current[targetTab]?.focus();
    }
  };

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });
  const creatorDisplay = resolveUserDisplayName(task.createdByUserId, usersById, unknownUserLabel);

  const tabLabels: Readonly<Record<DetailTabId, string>> = {
    overview: intl.formatMessage({ id: 'tasks.detail.tabs.overview' }),
    subtasks: intl.formatMessage({ id: 'tasks.detail.tabs.subtasks' }, { count: subtasks.length }),
    dependencies: intl.formatMessage(
      { id: 'tasks.detail.tabs.dependencies' },
      { count: dependenciesCount },
    ),
    impediments: intl.formatMessage(
      { id: 'tasks.detail.tabs.impediments' },
      { count: impedimentsCount },
    ),
    comments: intl.formatMessage({ id: 'tasks.detail.tabs.comments' }, { count: comments.length }),
    attachments: intl.formatMessage(
      { id: 'tasks.detail.tabs.attachments' },
      { count: attachments.length },
    ),
    history: intl.formatMessage({ id: 'tasks.detail.tabs.history' }),
  };

  const dialogMetadata = useMemo(() => {
    switch (activeDialog) {
      case 'PAUSE':
        return {
          title: intl.formatMessage({ id: 'tasks.pause.title' }),
          description: undefined,
          label: intl.formatMessage({ id: 'tasks.pause.reasonLabel' }),
          placeholder: intl.formatMessage({ id: 'tasks.pause.reasonPlaceholder' }),
          confirmLabel: intl.formatMessage({ id: 'tasks.pause.confirmAction' }),
          required: true,
          destructive: false,
        };
      case 'DEPENDENCY_OVERRIDE':
        return {
          title: intl.formatMessage({ id: 'tasks.complete.dependencyOverrideTitle' }),
          description: intl.formatMessage({ id: 'tasks.complete.dependencyOverrideDescription' }),
          label: intl.formatMessage({ id: 'tasks.complete.dependencyOverrideLabel' }),
          placeholder: intl.formatMessage({ id: 'tasks.complete.dependencyOverridePlaceholder' }),
          confirmLabel: intl.formatMessage({ id: 'tasks.complete.dependencyOverrideConfirm' }),
          required: true,
          destructive: false,
        };
      case 'CANCEL':
        return {
          title: intl.formatMessage({ id: 'tasks.cancel.title' }),
          description: intl.formatMessage({ id: 'tasks.cancel.description' }),
          label: intl.formatMessage({ id: 'tasks.cancel.justificationLabel' }),
          placeholder: intl.formatMessage({ id: 'tasks.cancel.justificationPlaceholder' }),
          confirmLabel: intl.formatMessage({ id: 'tasks.cancel.confirmAction' }),
          required: true,
          destructive: true,
        };
      case 'CANCEL_REQUEST':
        return {
          title: intl.formatMessage({ id: 'tasks.cancelRequest.title' }),
          description: intl.formatMessage({ id: 'tasks.cancelRequest.description' }),
          label: intl.formatMessage({ id: 'tasks.cancelRequest.justificationLabel' }),
          placeholder: intl.formatMessage({ id: 'tasks.cancelRequest.justificationPlaceholder' }),
          confirmLabel: intl.formatMessage({ id: 'tasks.cancelRequest.confirmAction' }),
          required: true,
          destructive: false,
        };
      case 'REOPEN':
        return {
          title: intl.formatMessage({ id: 'tasks.reopen.title' }),
          description: undefined,
          label: intl.formatMessage({ id: 'tasks.reopen.reasonLabel' }),
          placeholder: intl.formatMessage({ id: 'tasks.reopen.reasonPlaceholder' }),
          confirmLabel: intl.formatMessage({ id: 'tasks.reopen.confirmAction' }),
          required: false,
          destructive: false,
        };
      case 'DELETE':
        return {
          title: intl.formatMessage({ id: 'tasks.delete.confirmTitle' }),
          description: intl.formatMessage({ id: 'tasks.delete.confirmHint' }),
          label: intl.formatMessage({ id: 'tasks.delete.reasonLabel' }),
          placeholder: intl.formatMessage({ id: 'tasks.delete.reasonPlaceholder' }),
          confirmLabel: intl.formatMessage({ id: 'tasks.delete.confirmAction' }),
          required: false,
          destructive: true,
        };
      case null:
      default:
        return null;
    }
  }, [activeDialog, intl]);

  return (
    <section aria-labelledby="task-detail-heading" className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to={`/projects/${project.id}/tasks`}>
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'tasks.detail.backToList' })}</span>
            </Link>
          </Button>

          {permissions.canViewBoard ? (
            <Button asChild variant="outline" className="min-h-[44px]">
              <Link to={`/projects/${project.id}/board`}>
                <IconLayoutKanban className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'tasks.detail.backToBoard' })}</span>
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{project.name}</p>
          <h1
            ref={headingRef}
            id="task-detail-heading"
            tabIndex={-1}
            className="break-words text-2xl font-bold tracking-tight text-foreground focus:outline-none sm:text-3xl"
          >
            {task.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={TASK_STATUS_BADGE_VARIANTS[task.status]}>
              {intl.formatMessage({ id: TASK_STATUS_LABEL_IDS[task.status] })}
            </Badge>
            <Badge variant={TASK_PRIORITY_BADGE_VARIANTS[task.priority]}>
              {intl.formatMessage({ id: TASK_PRIORITY_LABEL_IDS[task.priority] })}
            </Badge>
            {column !== undefined ? (
              <Badge variant="outline">
                {intl.formatMessage({ id: 'tasks.fields.columnDisplay' }, { column: column.name })}
              </Badge>
            ) : null}
            {isTaskDeleted ? (
              <Badge variant="destructive">
                {intl.formatMessage({ id: 'tasks.list.deletedBadge' })}
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {intl.formatMessage({ id: 'tasks.fields.creatorDisplay' }, { name: creatorDisplay })}
            </span>
            <span>
              {intl.formatMessage(
                { id: 'tasks.fields.createdAtLabel' },
                { date: formatIsoDateTimeShort(task.createdAt, intl) },
              )}
            </span>
            {task.startedAt !== undefined ? (
              <span>
                {intl.formatMessage(
                  { id: 'tasks.fields.startedAtLabel' },
                  { date: formatIsoDateTimeShort(task.startedAt, intl) },
                )}
              </span>
            ) : null}
            {task.completedAt !== undefined ? (
              <span>
                {intl.formatMessage(
                  { id: 'tasks.fields.completedAtLabel' },
                  { date: formatIsoDateTimeShort(task.completedAt, intl) },
                )}
              </span>
            ) : null}
            {task.cancelledAt !== undefined ? (
              <span>
                {intl.formatMessage(
                  { id: 'tasks.fields.cancelledAtLabel' },
                  { date: formatIsoDateTimeShort(task.cancelledAt, intl) },
                )}
              </span>
            ) : null}
            <span className="font-medium text-foreground">
              {intl.formatMessage(
                { id: 'tasks.fields.lastMovedLabel' },
                { date: formatIsoDateTimeShort(task.lastMovedAt, intl) },
              )}
            </span>
            <span className="font-medium text-foreground">
              {intl.formatMessage(
                { id: 'tasks.fields.lastActivityLabel' },
                { date: formatIsoDateTimeShort(task.lastActivityAt, intl) },
              )}
            </span>
          </div>

          {task.cancellationReason !== undefined ? (
            <p className="text-xs font-medium text-destructive">
              {intl.formatMessage(
                { id: 'tasks.cancel.reasonDisplay' },
                { reason: task.cancellationReason },
              )}
            </p>
          ) : null}
        </div>
      </div>

      {isProjectArchived ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'tasks.detail.archivedBanner' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {isTaskDeleted ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'tasks.detail.deletedBanner' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {lifecycleError !== null ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{lifecycleError}</AlertDescription>
        </Alert>
      ) : null}

      {feedback !== null ? (
        <Alert
          variant={feedback.type}
          role={feedback.type === 'destructive' ? 'alert' : 'status'}
          aria-live={feedback.type === 'destructive' ? 'assertive' : 'polite'}
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        {permissions.canStartTask && task.status === TASK_STATUSES.TODO && !isReadOnly ? (
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void runAction(onStartTask)}
          >
            <IconPlayerPlay className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.actions.start' })}</span>
          </Button>
        ) : null}

        {permissions.canPauseTask &&
        !isTerminal &&
        task.status !== TASK_STATUSES.PAUSED &&
        !isReadOnly ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => openLifecycleDialog('PAUSE')}
          >
            <IconPlayerPause className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.pause.action' })}</span>
          </Button>
        ) : null}

        {permissions.canPauseTask && task.status === TASK_STATUSES.PAUSED && !isReadOnly ? (
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void runAction(onResumeTask)}
          >
            <IconPlayerPlay className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.resume.action' })}</span>
          </Button>
        ) : null}

        {permissions.canCompleteTask && !isTerminal && !isReadOnly ? (
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void handleCompleteClick()}
          >
            <IconCheck className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.complete.action' })}</span>
          </Button>
        ) : null}

        {permissions.canReopenTask && isTerminal && !isReadOnly ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => openLifecycleDialog('REOPEN')}
          >
            <IconRefresh className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.reopen.action' })}</span>
          </Button>
        ) : null}

        {permissions.canCancelTask && !isTerminal && !isReadOnly ? (
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => openLifecycleDialog('CANCEL')}
          >
            <IconBan className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.cancel.action' })}</span>
          </Button>
        ) : null}

        {!permissions.canCancelTask && permissions.canComment && !isTerminal && !isReadOnly ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => openLifecycleDialog('CANCEL_REQUEST')}
          >
            <IconBan className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.cancelRequest.action' })}</span>
          </Button>
        ) : null}

        {permissions.canDeleteTask && !isTaskDeleted && !isProjectArchived ? (
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => openLifecycleDialog('DELETE')}
          >
            <IconTrash className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.delete.action' })}</span>
          </Button>
        ) : null}

        {permissions.canRestoreTask && isTaskDeleted && !isProjectArchived ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void runAction(onRestoreTask)}
          >
            <IconRestore className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.restore.action' })}</span>
          </Button>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label={intl.formatMessage({ id: 'tasks.detail.tabsLabel' })}
        className="flex flex-wrap gap-2 border-b pb-3"
      >
        {TAB_ORDER.map((tabId, index) => {
          const isSelected = activeTab === tabId;
          return (
            <button
              key={tabId}
              ref={(node) => {
                tabRefs.current[tabId] = node;
              }}
              id={`task-tab-${tabId}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`task-tabpanel-${tabId}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tabId)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`inline-flex min-h-[44px] items-center rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                isSelected
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {tabLabels[tabId]}
            </button>
          );
        })}
      </div>

      <div
        id="task-tabpanel-overview"
        role="tabpanel"
        aria-labelledby="task-tab-overview"
        hidden={activeTab !== 'overview'}
      >
        <OverviewEditSection
          key={`${task.id}:${task.updatedAt}:${task.tagIds.join(',')}`}
          detail={detail}
          orgTags={orgTags}
          projectMembers={projectMembers}
          usersById={usersById}
          permissions={permissions}
          isReadOnly={isReadOnly}
          isMutating={isMutating}
          onUpdateTask={(input) => runAction(() => onUpdateTask(input))}
          onAssignTask={(input) => runAction(() => onAssignTask(input))}
          onAddParticipant={(userId) => runAction(() => onAddParticipant(userId))}
          onRemoveParticipant={(userId) => runAction(() => onRemoveParticipant(userId))}
        />
      </div>

      <div
        id="task-tabpanel-subtasks"
        role="tabpanel"
        aria-labelledby="task-tab-subtasks"
        hidden={activeTab !== 'subtasks'}
      >
        <TaskSubtasksPanel
          subtasks={subtasks}
          taskStatus={task.status}
          isReadOnly={isReadOnly}
          canManageSubtasks={permissions.canManageSubtasks}
          canAssignSubtasks={permissions.canAssignSubtasks}
          canCompleteBySubtaskId={permissions.canCompleteBySubtaskId}
          assignableUsers={projectMembers}
          usersById={usersById}
          isMutating={isMutating}
          onCreateSubtask={(input) => runAction(() => onCreateSubtask(input))}
          onUpdateSubtask={(subtaskId, input) => runAction(() => onUpdateSubtask(subtaskId, input))}
          onAssignSubtask={(subtaskId, input) => runAction(() => onAssignSubtask(subtaskId, input))}
          onCompleteSubtask={(subtaskId, title) =>
            runAction(() => onCompleteSubtask(subtaskId, title))
          }
          onReorderSubtasks={(orderedIds) => runAction(() => onReorderSubtasks(orderedIds))}
          onDeleteSubtask={(subtaskId, title) => runAction(() => onDeleteSubtask(subtaskId, title))}
        />
      </div>

      <div
        id="task-tabpanel-dependencies"
        role="tabpanel"
        aria-labelledby="task-tab-dependencies"
        hidden={activeTab !== 'dependencies'}
      >
        {dependenciesContent}
      </div>

      <div
        id="task-tabpanel-impediments"
        role="tabpanel"
        aria-labelledby="task-tab-impediments"
        hidden={activeTab !== 'impediments'}
      >
        {impedimentsContent}
      </div>

      <div
        id="task-tabpanel-comments"
        role="tabpanel"
        aria-labelledby="task-tab-comments"
        hidden={activeTab !== 'comments'}
      >
        <TaskCommentsPanel
          comments={comments}
          actorUserId={actorUserId}
          commentEditWindowMinutes={commentEditWindowMinutes}
          referenceNowMs={referenceNowMs}
          isReadOnly={isReadOnly}
          canComment={permissions.canComment}
          canModerateComments={permissions.canModerateComments}
          usersById={usersById}
          isMutating={isMutating}
          onAddComment={(input) => runAction(() => onAddComment(input))}
          onUpdateComment={(commentId, input) => runAction(() => onUpdateComment(commentId, input))}
          onDeleteComment={(commentId, reason) =>
            runAction(() => onDeleteComment(commentId, reason))
          }
        />
      </div>

      <div
        id="task-tabpanel-attachments"
        role="tabpanel"
        aria-labelledby="task-tab-attachments"
        hidden={activeTab !== 'attachments'}
      >
        <TaskAttachmentsPanel
          attachments={attachments}
          taskStatus={task.status}
          maxAttachmentSizeBytes={maxAttachmentSizeBytes}
          maxContextAttachmentsSizeBytes={maxContextAttachmentsSizeBytes}
          maxAttachmentsPerContext={maxAttachmentsPerContext}
          isReadOnly={isReadOnly}
          canManageAttachments={permissions.canManageAttachments}
          usersById={usersById}
          isMutating={isMutating}
          onUploadAttachment={(file) => runAction(() => onUploadAttachment(file))}
          onDownloadAttachment={(attachment) => runAction(() => onDownloadAttachment(attachment))}
          onDeleteAttachment={(attachmentId, fileName) =>
            runAction(() => onDeleteAttachment(attachmentId, fileName))
          }
        />
      </div>

      <div
        id="task-tabpanel-history"
        role="tabpanel"
        aria-labelledby="task-tab-history"
        hidden={activeTab !== 'history'}
      >
        <TaskCyclesAndHistoryPanel
          executionCycles={executionCycles}
          pauses={pauses}
          deadlineHistory={deadlineHistory}
          canViewHistory={permissions.canViewHistory}
          referenceNowIso={referenceNowIso}
          usersById={usersById}
        />
      </div>

      <ModalDialog
        isOpen={activeDialog !== null && dialogMetadata !== null}
        titleId="task-lifecycle-dialog-title"
        title={dialogMetadata?.title ?? ''}
        descriptionId={
          dialogMetadata?.description !== undefined
            ? 'task-lifecycle-dialog-description'
            : undefined
        }
        description={dialogMetadata?.description}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating}
        initialFocusRef={dialogInputRef}
        onClose={() => setActiveDialog(null)}
      >
        {dialogMetadata !== null ? (
          <div className="space-y-4">
            {activeDialog === 'REOPEN' && reopenEligibleColumns.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="task-lifecycle-reopen-column">
                  {intl.formatMessage({ id: 'tasks.reopen.targetColumnLabel' })}
                </Label>
                <select
                  id="task-lifecycle-reopen-column"
                  value={reopenColumnId}
                  onChange={(event) => setReopenColumnId(event.target.value)}
                  className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {reopenEligibleColumns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="task-lifecycle-dialog-input" required={dialogMetadata.required}>
                {dialogMetadata.label}
              </Label>
              <Input
                ref={dialogInputRef}
                id="task-lifecycle-dialog-input"
                type="text"
                value={dialogText}
                onChange={(event) => {
                  setDialogText(event.target.value);
                  if (dialogError !== null) {
                    setDialogError(null);
                  }
                }}
                placeholder={dialogMetadata.placeholder}
                aria-invalid={dialogError !== null}
                aria-describedby={dialogError !== null ? 'task-lifecycle-dialog-error' : undefined}
              />
              {dialogError !== null ? (
                <p
                  id="task-lifecycle-dialog-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {dialogError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={dialogMetadata.destructive ? 'destructive' : 'default'}
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => void handleConfirmLifecycleDialog()}
              >
                {dialogMetadata.confirmLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => setActiveDialog(null)}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </Button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </section>
  );
}
