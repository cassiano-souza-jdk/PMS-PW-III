import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconArrowLeft,
  IconChevronRight,
  IconEdit,
  IconFilterOff,
  IconLayoutKanban,
  IconPlus,
  IconTag,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  parseIsoDateTimeMs,
  type Priority,
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
  TaskBoardColumnSummary,
  TaskProjectSummary,
} from '../application/ports/task-project-context.port';
import type {
  CreateTagInput,
  CreateTaskInput,
  UpdateTagInput,
} from '../application/services/task-service';
import type { Tag, TagId, Task } from '../application/contracts';
import {
  TASK_PRIORITY_BADGE_VARIANTS,
  TASK_PRIORITY_LABEL_IDS,
  TASK_PRIORITY_RANK,
  TASK_STATUS_BADGE_VARIANTS,
  TASK_STATUS_LABEL_IDS,
  dateInputToEndOfDayIso,
  formatIsoDateTimeShort,
  resolveTagBadgeClassName,
  resolveUserDisplayName,
  type TaskPanelFeedback,
  type TaskUserOption,
} from './task-ui-helpers';

type TaskSortOption =
  | 'order'
  | 'titleAsc'
  | 'priorityDesc'
  | 'dueDateAsc'
  | 'lastActivityDesc'
  | 'lastMovedDesc'
  | 'createdAtDesc';

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

const createTaskFormSchema = z.object({
  title: z.string().trim().min(2, 'validation.displayNameMin').max(160),
  description: z.string().trim().max(4000).optional(),
  columnId: z.string().optional(),
  priority: z.enum([PRIORITIES.LOW, PRIORITIES.MEDIUM, PRIORITIES.HIGH, PRIORITIES.CRITICAL]),
  assigneeId: z.string().optional(),
  dueDateInput: z
    .string()
    .trim()
    .refine((value) => value === '' || isIsoDate(value), 'validation.dateInvalid'),
  deadlineJustification: z.string().trim().max(500).optional(),
});

const tagFormSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(50),
  colorToken: z.string().trim().max(40).optional(),
});

type CreateTaskFormValues = z.infer<typeof createTaskFormSchema>;
type TagFormValues = z.infer<typeof tagFormSchema>;

export interface ProjectTasksPanelProps {
  readonly project: TaskProjectSummary;
  readonly tasks: readonly Task[];
  readonly columns: readonly TaskBoardColumnSummary[];
  readonly tags: readonly Tag[];
  readonly projectMembers: readonly TaskUserOption[];
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
  readonly includeDeleted: boolean;
  readonly isLoading: boolean;
  readonly canViewBoard: boolean;
  readonly canCreateTask: boolean;
  readonly canAssignTask: boolean;
  readonly canIncludeDeleted: boolean;
  readonly canManageTagCatalog: boolean;
  readonly feedback?: TaskPanelFeedback | null;
  readonly onToggleIncludeDeleted: (next: boolean) => void;
  readonly onCreateTask: (input: CreateTaskInput) => Promise<void>;
  readonly onCreateTag: (input: CreateTagInput) => Promise<void>;
  readonly onUpdateTag: (tagId: TagId, input: UpdateTagInput) => Promise<void>;
  readonly onDeleteTag: (tagId: TagId, name: string) => Promise<void>;
}

export function ProjectTasksPanel({
  project,
  tasks,
  columns,
  tags,
  projectMembers,
  usersById,
  includeDeleted,
  isLoading,
  canViewBoard,
  canCreateTask,
  canAssignTask,
  canIncludeDeleted,
  canManageTagCatalog,
  feedback = null,
  onToggleIncludeDeleted,
  onCreateTask,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: ProjectTasksPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const createTitleInputRef = useRef<HTMLInputElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<string>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<TaskSortOption>('order');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFullMode, setCreateFullMode] = useState(true);
  const [selectedCreateTagIds, setSelectedCreateTagIds] = useState<readonly TagId[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const [tagError, setTagError] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [project.id]);

  const isProjectArchived = project.archivedAt !== undefined || project.status === 'ARCHIVED';
  const isProjectDeleted = isSoftDeleted(project);
  const isReadOnly = isProjectArchived || isProjectDeleted;

  const eligibleCreateColumns = useMemo(
    () =>
      [...columns]
        .filter((col) => col.archivedAt === undefined && col.columnRole !== 'FINAL')
        .sort((a, b) => a.order - b.order),
    [columns],
  );

  const defaultCreateColumnId =
    eligibleCreateColumns.find((col) => col.columnRole === 'INITIAL')?.id ??
    eligibleCreateColumns[0]?.id ??
    '';

  const columnsById = useMemo(() => new Map(columns.map((col) => [col.id, col])), [columns]);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const createTaskForm = useForm<CreateTaskFormValues>({
    resolver: zodResolver(createTaskFormSchema),
    defaultValues: {
      title: '',
      description: '',
      columnId: defaultCreateColumnId,
      priority: PRIORITIES.MEDIUM,
      assigneeId: '',
      dueDateInput: '',
      deadlineJustification: '',
    },
  });

  const createTagForm = useForm<TagFormValues>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: { name: '', colorToken: '' },
  });

  const editTagForm = useForm<TagFormValues>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: { name: '', colorToken: '' },
  });

  const handleOpenCreateModal = () => {
    setCreateError(null);
    setSelectedCreateTagIds([]);
    createTaskForm.reset({
      title: '',
      description: '',
      columnId: defaultCreateColumnId,
      priority: PRIORITIES.MEDIUM,
      assigneeId: '',
      dueDateInput: '',
      deadlineJustification: '',
    });
    setIsCreateOpen(true);
  };

  const handleCreateTaskSubmit = async (values: CreateTaskFormValues) => {
    setCreateError(null);
    setIsMutating(true);
    try {
      const trimmedDesc = values.description?.trim() ?? '';
      const trimmedAssignee = values.assigneeId?.trim() ?? '';
      const parsedDueDate = dateInputToEndOfDayIso(values.dueDateInput);
      const trimmedDeadlineReason = values.deadlineJustification?.trim() ?? '';
      const resolvedColumnId =
        values.columnId !== undefined && values.columnId.trim().length > 0
          ? asBoardColumnId(values.columnId, 'columnId')
          : undefined;

      await onCreateTask({
        title: values.title,
        ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
        ...(resolvedColumnId !== undefined ? { columnId: resolvedColumnId } : {}),
        priority: values.priority as Priority,
        ...(canAssignTask && trimmedAssignee.length > 0
          ? { assigneeId: asUserId(trimmedAssignee, 'assigneeId') }
          : {}),
        ...(parsedDueDate !== null ? { dueDate: parsedDueDate } : {}),
        ...(selectedCreateTagIds.length > 0 ? { tagIds: selectedCreateTagIds } : {}),
        ...(parsedDueDate !== null && trimmedDeadlineReason.length > 0
          ? { deadlineJustification: trimmedDeadlineReason }
          : {}),
      });
      setIsCreateOpen(false);
    } catch (error) {
      if (isAppError(error)) {
        setCreateError(error.message);
      } else {
        setCreateError(intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }));
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleCreateTagSubmit = async (values: TagFormValues) => {
    setTagError(null);
    setIsMutating(true);
    try {
      const trimmedColor = values.colorToken?.trim() ?? '';
      await onCreateTag({
        name: values.name,
        ...(trimmedColor.length > 0 ? { colorToken: trimmedColor } : {}),
      });
      createTagForm.reset({ name: '', colorToken: '' });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setTagError(intl.formatMessage({ id: 'tags.catalog.duplicateError' }));
      } else {
        setTagError(intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }));
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleOpenEditTag = (tag: Tag) => {
    setTagError(null);
    editTagForm.reset({
      name: tag.name,
      colorToken: tag.colorToken ?? '',
    });
    setEditingTag(tag);
  };

  const handleEditTagSubmit = async (values: TagFormValues) => {
    if (editingTag === null) {
      return;
    }
    setTagError(null);
    setIsMutating(true);
    try {
      const trimmedColor = values.colorToken?.trim() ?? '';
      await onUpdateTag(editingTag.id, {
        name: values.name,
        colorToken: trimmedColor.length > 0 ? trimmedColor : null,
      });
      setEditingTag(null);
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setTagError(intl.formatMessage({ id: 'tags.catalog.duplicateError' }));
      } else {
        setTagError(intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }));
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleConfirmDeleteTag = async () => {
    if (deletingTag === null) {
      return;
    }
    setTagError(null);
    setIsMutating(true);
    try {
      await onDeleteTag(deletingTag.id, deletingTag.name);
      setDeletingTag(null);
    } finally {
      setIsMutating(false);
    }
  };

  const filteredAndSortedTasks = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase();

    const filtered = tasks.filter((task) => {
      if (normalizedQuery.length > 0) {
        const matchesTitle = task.title.toLowerCase().includes(normalizedQuery);
        const matchesDesc = (task.description ?? '').toLowerCase().includes(normalizedQuery);
        if (!matchesTitle && !matchesDesc) {
          return false;
        }
      }

      if (statusFilter !== 'ALL' && task.status !== statusFilter) {
        return false;
      }

      if (priorityFilter !== 'ALL' && task.priority !== priorityFilter) {
        return false;
      }

      if (tagFilter !== 'ALL' && !task.tagIds.some((id) => id === tagFilter)) {
        return false;
      }

      if (assigneeFilter === 'UNASSIGNED' && task.assigneeId !== undefined) {
        return false;
      }

      if (
        assigneeFilter !== 'ALL' &&
        assigneeFilter !== 'UNASSIGNED' &&
        task.assigneeId !== assigneeFilter
      ) {
        return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'titleAsc':
          return a.title.localeCompare(b.title);
        case 'priorityDesc':
          return (
            TASK_PRIORITY_RANK[b.priority] - TASK_PRIORITY_RANK[a.priority] || a.order - b.order
          );
        case 'dueDateAsc': {
          const aDue =
            a.dueDate !== undefined ? parseIsoDateTimeMs(a.dueDate) : Number.POSITIVE_INFINITY;
          const bDue =
            b.dueDate !== undefined ? parseIsoDateTimeMs(b.dueDate) : Number.POSITIVE_INFINITY;
          return aDue - bDue || a.order - b.order;
        }
        case 'lastActivityDesc':
          return (
            parseIsoDateTimeMs(b.lastActivityAt) - parseIsoDateTimeMs(a.lastActivityAt) ||
            a.order - b.order
          );
        case 'lastMovedDesc':
          return (
            parseIsoDateTimeMs(b.lastMovedAt) - parseIsoDateTimeMs(a.lastMovedAt) ||
            a.order - b.order
          );
        case 'createdAtDesc':
          return (
            parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt) || a.order - b.order
          );
        case 'order':
        default: {
          const aColOrder = columnsById.get(a.columnId)?.order ?? Number.MAX_SAFE_INTEGER;
          const bColOrder = columnsById.get(b.columnId)?.order ?? Number.MAX_SAFE_INTEGER;
          return aColOrder - bColOrder || a.order - b.order;
        }
      }
    });
  }, [
    assigneeFilter,
    columnsById,
    priorityFilter,
    searchTerm,
    sortBy,
    statusFilter,
    tagFilter,
    tasks,
  ]);

  const statusTotals = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      TODO: 0,
      IN_PROGRESS: 0,
      PAUSED: 0,
      BLOCKED: 0,
      DONE: 0,
      CANCELLED: 0,
    };
    for (const task of tasks) {
      counts[task.status] += 1;
    }
    return counts;
  }, [tasks]);

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    statusFilter !== 'ALL' ||
    priorityFilter !== 'ALL' ||
    tagFilter !== 'ALL' ||
    assigneeFilter !== 'ALL';

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });
  const { ref: createTitleRef, ...createTitleProps } = createTaskForm.register('title');

  return (
    <section aria-labelledby="project-tasks-heading" className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" className="min-h-[44px]">
              <Link to="/projects">
                <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'tasks.list.backToProjects' })}</span>
              </Link>
            </Button>

            {canViewBoard ? (
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${project.id}/board`}>
                  <IconLayoutKanban className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'tasks.list.openBoardAction' })}</span>
                </Link>
              </Button>
            ) : null}
          </div>

          <h1
            ref={headingRef}
            id="project-tasks-heading"
            tabIndex={-1}
            className="pt-1 text-2xl font-bold tracking-tight text-foreground focus:outline-none sm:text-3xl"
          >
            {intl.formatMessage({ id: 'tasks.list.title' }, { name: project.name })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'tasks.list.subtitle' })}
          </p>
        </div>

        {canCreateTask && !isReadOnly && eligibleCreateColumns.length > 0 ? (
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={handleOpenCreateModal}
          >
            <IconPlus className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'tasks.list.newTaskAction' })}</span>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <Badge variant="secondary">
          {intl.formatMessage(
            { id: 'tasks.list.countLabel' },
            { count: filteredAndSortedTasks.length },
          )}
        </Badge>
        {(Object.values(TASK_STATUSES) as readonly TaskStatus[]).map((status) => (
          <Badge key={status} variant={TASK_STATUS_BADGE_VARIANTS[status]}>
            {intl.formatMessage({ id: TASK_STATUS_LABEL_IDS[status] })}: {statusTotals[status]}
          </Badge>
        ))}
      </div>

      {isProjectArchived ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'tasks.list.archivedBanner' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {!canCreateTask && !isReadOnly ? (
        <Alert variant="info">
          <AlertDescription>
            {intl.formatMessage({ id: 'tasks.create.noPermission' })}
          </AlertDescription>
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

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tasks-filter-search">
                {intl.formatMessage({ id: 'tasks.filters.searchLabel' })}
              </Label>
              <Input
                id="tasks-filter-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={intl.formatMessage({ id: 'tasks.filters.searchPlaceholder' })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tasks-filter-status">
                {intl.formatMessage({ id: 'tasks.filters.statusLabel' })}
              </Label>
              <select
                id="tasks-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ALL">
                  {intl.formatMessage({ id: 'tasks.filters.allStatuses' })}
                </option>
                {(Object.values(TASK_STATUSES) as readonly TaskStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {intl.formatMessage({ id: TASK_STATUS_LABEL_IDS[status] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tasks-filter-priority">
                {intl.formatMessage({ id: 'tasks.filters.priorityLabel' })}
              </Label>
              <select
                id="tasks-filter-priority"
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ALL">
                  {intl.formatMessage({ id: 'tasks.filters.allPriorities' })}
                </option>
                {(Object.values(PRIORITIES) as readonly Priority[]).map((priority) => (
                  <option key={priority} value={priority}>
                    {intl.formatMessage({ id: TASK_PRIORITY_LABEL_IDS[priority] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tasks-filter-tag">
                {intl.formatMessage({ id: 'tasks.filters.tagLabel' })}
              </Label>
              <select
                id="tasks-filter-tag"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ALL">{intl.formatMessage({ id: 'tasks.filters.allTags' })}</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tasks-filter-assignee">
                {intl.formatMessage({ id: 'tasks.filters.assigneeLabel' })}
              </Label>
              <select
                id="tasks-filter-assignee"
                value={assigneeFilter}
                onChange={(event) => setAssigneeFilter(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ALL">
                  {intl.formatMessage({ id: 'tasks.filters.allAssignees' })}
                </option>
                <option value="UNASSIGNED">
                  {intl.formatMessage({ id: 'tasks.filters.unassignedOnly' })}
                </option>
                {projectMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tasks-sort-select">
                {intl.formatMessage({ id: 'tasks.sort.label' })}
              </Label>
              <select
                id="tasks-sort-select"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as TaskSortOption)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="order">{intl.formatMessage({ id: 'tasks.sort.order' })}</option>
                <option value="titleAsc">
                  {intl.formatMessage({ id: 'tasks.sort.titleAsc' })}
                </option>
                <option value="priorityDesc">
                  {intl.formatMessage({ id: 'tasks.sort.priorityDesc' })}
                </option>
                <option value="dueDateAsc">
                  {intl.formatMessage({ id: 'tasks.sort.dueDateAsc' })}
                </option>
                <option value="lastActivityDesc">
                  {intl.formatMessage({ id: 'tasks.sort.lastActivityDesc' })}
                </option>
                <option value="lastMovedDesc">
                  {intl.formatMessage({ id: 'tasks.sort.lastMovedDesc' })}
                </option>
                <option value="createdAtDesc">
                  {intl.formatMessage({ id: 'tasks.sort.createdAtDesc' })}
                </option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            {canIncludeDeleted ? (
              <label
                htmlFor="tasks-include-deleted"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
              >
                <input
                  id="tasks-include-deleted"
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(event) => onToggleIncludeDeleted(event.target.checked)}
                  className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <span>{intl.formatMessage({ id: 'tasks.filters.includeDeleted' })}</span>
              </label>
            ) : (
              <span />
            )}

            {hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('ALL');
                  setPriorityFilter('ALL');
                  setTagFilter('ALL');
                  setAssigneeFilter('ALL');
                }}
              >
                <IconFilterOff className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'tasks.filters.clearAction' })}</span>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'app.loading' })}
        </p>
      ) : filteredAndSortedTasks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: 'tasks.list.emptyTitle' })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'tasks.list.emptyDescription' })}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {filteredAndSortedTasks.map((task) => {
            const columnName = columnsById.get(task.columnId)?.name;
            const taskTags = task.tagIds
              .map((tagId) => tagsById.get(tagId))
              .filter((tag): tag is Tag => tag !== undefined);
            const assigneeDisplay =
              task.assigneeId !== undefined
                ? intl.formatMessage(
                    { id: 'tasks.fields.assigneeDisplay' },
                    {
                      name: resolveUserDisplayName(task.assigneeId, usersById, unknownUserLabel),
                    },
                  )
                : intl.formatMessage({ id: 'tasks.fields.unassignedOption' });

            return (
              <li key={task.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <article
                  aria-labelledby={`task-list-title-${task.id}`}
                  className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        id={`task-list-title-${task.id}`}
                        className="break-words text-base font-semibold text-foreground"
                      >
                        {task.title}
                      </h2>
                      <Badge variant={TASK_STATUS_BADGE_VARIANTS[task.status]}>
                        {intl.formatMessage({ id: TASK_STATUS_LABEL_IDS[task.status] })}
                      </Badge>
                      <Badge variant={TASK_PRIORITY_BADGE_VARIANTS[task.priority]}>
                        {intl.formatMessage({ id: TASK_PRIORITY_LABEL_IDS[task.priority] })}
                      </Badge>
                      {isSoftDeleted(task) ? (
                        <Badge variant="destructive">
                          {intl.formatMessage({ id: 'tasks.list.deletedBadge' })}
                        </Badge>
                      ) : null}
                    </div>

                    {task.description !== undefined ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    ) : null}

                    {taskTags.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {taskTags.map((tag) => (
                          <Badge
                            key={tag.id}
                            variant="outline"
                            className={resolveTagBadgeClassName(tag.colorToken)}
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {columnName !== undefined ? (
                        <span>
                          {intl.formatMessage(
                            { id: 'tasks.fields.columnDisplay' },
                            { column: columnName },
                          )}
                        </span>
                      ) : null}
                      <span>{assigneeDisplay}</span>
                      <span>
                        {task.dueDate !== undefined
                          ? intl.formatMessage(
                              { id: 'tasks.fields.dueDateDisplay' },
                              { date: formatIsoDateTimeShort(task.dueDate, intl) },
                            )
                          : intl.formatMessage({ id: 'tasks.fields.noDueDate' })}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.fields.lastMovedLabel' },
                          { date: formatIsoDateTimeShort(task.lastMovedAt, intl) },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'tasks.fields.lastActivityLabel' },
                          { date: formatIsoDateTimeShort(task.lastActivityAt, intl) },
                        )}
                      </span>
                    </div>
                  </div>

                  <Button asChild variant="outline" className="min-h-[44px] min-w-[44px] shrink-0">
                    <Link
                      to={`/projects/${project.id}/tasks/${task.id}`}
                      aria-label={intl.formatMessage(
                        { id: 'tasks.list.openDetailAriaLabel' },
                        { title: task.title },
                      )}
                    >
                      <span>{intl.formatMessage({ id: 'tasks.list.openDetailAction' })}</span>
                      <IconChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {canManageTagCatalog ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconTag className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>{intl.formatMessage({ id: 'tags.catalog.title' })}</CardTitle>
            </div>
            <CardDescription>
              {intl.formatMessage({ id: 'tags.catalog.description' })}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {tagError !== null ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{tagError}</AlertDescription>
              </Alert>
            ) : null}

            <form
              onSubmit={createTagForm.handleSubmit(handleCreateTagSubmit)}
              noValidate
              className="space-y-4 rounded-lg border bg-muted/30 p-4"
            >
              <h3 className="text-base font-semibold text-foreground">
                {intl.formatMessage({ id: 'tags.catalog.createTitle' })}
              </h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tag-catalog-create-name" required>
                    {intl.formatMessage({ id: 'tags.catalog.nameLabel' })}
                  </Label>
                  <Input
                    id="tag-catalog-create-name"
                    type="text"
                    placeholder={intl.formatMessage({ id: 'tags.catalog.namePlaceholder' })}
                    aria-invalid={createTagForm.formState.errors.name !== undefined}
                    aria-describedby={
                      createTagForm.formState.errors.name !== undefined
                        ? 'tag-catalog-create-name-error'
                        : undefined
                    }
                    {...createTagForm.register('name')}
                  />
                  {createTagForm.formState.errors.name !== undefined ? (
                    <p
                      id="tag-catalog-create-name-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({ id: 'validation.required' })}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tag-catalog-create-color">
                    {intl.formatMessage({ id: 'tags.catalog.colorLabel' })}
                  </Label>
                  <Input
                    id="tag-catalog-create-color"
                    type="text"
                    placeholder={intl.formatMessage({ id: 'tags.catalog.colorPlaceholder' })}
                    {...createTagForm.register('colorToken')}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={isMutating || createTagForm.formState.isSubmitting}
              >
                <IconPlus className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'tags.catalog.createAction' })}</span>
              </Button>
            </form>

            {tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {intl.formatMessage({ id: 'tags.catalog.empty' })}
              </p>
            ) : (
              <ul className="space-y-2">
                {tags.map((tag) => (
                  <li
                    key={tag.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={resolveTagBadgeClassName(tag.colorToken)}>
                        {tag.name}
                      </Badge>
                      {tag.colorToken !== undefined ? (
                        <span className="text-xs text-muted-foreground">{tag.colorToken}</span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={isMutating}
                        onClick={() => handleOpenEditTag(tag)}
                      >
                        <IconEdit className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'tags.catalog.editAction' })}</span>
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={isMutating}
                        onClick={() => setDeletingTag(tag)}
                      >
                        <IconTrash className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'tags.catalog.deleteAction' })}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <ModalDialog
        isOpen={isCreateOpen}
        titleId="create-task-dialog-title"
        title={intl.formatMessage({ id: 'tasks.create.title' })}
        descriptionId="create-task-dialog-description"
        description={intl.formatMessage({ id: 'tasks.create.description' })}
        closeLabel={intl.formatMessage({ id: 'tasks.create.closeLabel' })}
        isBusy={isMutating || createTaskForm.formState.isSubmitting}
        initialFocusRef={createTitleInputRef}
        className="max-w-2xl"
        onClose={() => setIsCreateOpen(false)}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={createFullMode ? 'outline' : 'default'}
              className="min-h-[44px]"
              onClick={() => setCreateFullMode(false)}
            >
              {intl.formatMessage({ id: 'tasks.create.quickModeAction' })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={createFullMode ? 'default' : 'outline'}
              className="min-h-[44px]"
              onClick={() => setCreateFullMode(true)}
            >
              {intl.formatMessage({ id: 'tasks.create.fullModeAction' })}
            </Button>
          </div>

          {createError !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}

          <form
            onSubmit={createTaskForm.handleSubmit(handleCreateTaskSubmit)}
            noValidate
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="create-task-title" required>
                {intl.formatMessage({ id: 'tasks.fields.titleLabel' })}
              </Label>
              <Input
                id="create-task-title"
                type="text"
                placeholder={intl.formatMessage({ id: 'tasks.fields.titlePlaceholder' })}
                aria-invalid={createTaskForm.formState.errors.title !== undefined}
                aria-describedby={
                  createTaskForm.formState.errors.title !== undefined
                    ? 'create-task-title-error'
                    : undefined
                }
                ref={(node) => {
                  createTitleRef(node);
                  createTitleInputRef.current = node;
                }}
                {...createTitleProps}
              />
              {createTaskForm.formState.errors.title !== undefined ? (
                <p
                  id="create-task-title-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id: resolveValidationMessageId(createTaskForm.formState.errors.title.message),
                  })}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-task-column">
                  {intl.formatMessage({ id: 'tasks.fields.columnLabel' })}
                </Label>
                <select
                  id="create-task-column"
                  className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  {...createTaskForm.register('columnId')}
                >
                  {eligibleCreateColumns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-task-priority">
                  {intl.formatMessage({ id: 'tasks.fields.priorityLabel' })}
                </Label>
                <select
                  id="create-task-priority"
                  className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  {...createTaskForm.register('priority')}
                >
                  {(Object.values(PRIORITIES) as readonly Priority[]).map((priority) => (
                    <option key={priority} value={priority}>
                      {intl.formatMessage({ id: TASK_PRIORITY_LABEL_IDS[priority] })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {createFullMode ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="create-task-description">
                    {intl.formatMessage({ id: 'tasks.fields.descriptionLabel' })}
                  </Label>
                  <textarea
                    id="create-task-description"
                    rows={3}
                    placeholder={intl.formatMessage({ id: 'tasks.fields.descriptionPlaceholder' })}
                    className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    {...createTaskForm.register('description')}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {canAssignTask ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="create-task-assignee">
                        {intl.formatMessage({ id: 'tasks.fields.assigneeLabel' })}
                      </Label>
                      <select
                        id="create-task-assignee"
                        className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...createTaskForm.register('assigneeId')}
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
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="create-task-due-date">
                      {intl.formatMessage({ id: 'tasks.fields.dueDateLabel' })}
                    </Label>
                    <Input
                      id="create-task-due-date"
                      type="date"
                      aria-invalid={createTaskForm.formState.errors.dueDateInput !== undefined}
                      aria-describedby={
                        createTaskForm.formState.errors.dueDateInput !== undefined
                          ? 'create-task-due-date-error'
                          : undefined
                      }
                      {...createTaskForm.register('dueDateInput')}
                    />
                    {createTaskForm.formState.errors.dueDateInput !== undefined ? (
                      <p
                        id="create-task-due-date-error"
                        role="alert"
                        className="text-xs font-medium text-destructive"
                      >
                        {intl.formatMessage({ id: 'validation.dateInvalid' })}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="create-task-deadline-justification">
                    {intl.formatMessage({ id: 'tasks.fields.deadlineJustificationLabel' })}
                  </Label>
                  <Input
                    id="create-task-deadline-justification"
                    type="text"
                    placeholder={intl.formatMessage({
                      id: 'tasks.fields.deadlineJustificationPlaceholder',
                    })}
                    {...createTaskForm.register('deadlineJustification')}
                  />
                </div>

                {tags.length > 0 ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">
                      {intl.formatMessage({ id: 'tasks.fields.tagsLabel' })}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => {
                        const checked = selectedCreateTagIds.includes(tag.id);
                        return (
                          <label
                            key={tag.id}
                            htmlFor={`create-task-tag-${tag.id}`}
                            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-foreground"
                          >
                            <input
                              id={`create-task-tag-${tag.id}`}
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setSelectedCreateTagIds((prev) => [...prev, tag.id]);
                                } else {
                                  setSelectedCreateTagIds((prev) =>
                                    prev.filter((id) => id !== tag.id),
                                  );
                                }
                              }}
                              className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                            <span>{tag.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}
              </>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={isMutating || createTaskForm.formState.isSubmitting}
              >
                {intl.formatMessage({
                  id: createTaskForm.formState.isSubmitting
                    ? 'auth.common.submitting'
                    : 'tasks.create.submit',
                })}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => setIsCreateOpen(false)}
              >
                {intl.formatMessage({ id: 'tasks.create.cancelAction' })}
              </Button>
            </div>
          </form>
        </div>
      </ModalDialog>

      <ModalDialog
        isOpen={editingTag !== null}
        titleId="edit-tag-dialog-title"
        title={intl.formatMessage({ id: 'tags.catalog.editAction' })}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating || editTagForm.formState.isSubmitting}
        onClose={() => setEditingTag(null)}
      >
        <form
          onSubmit={editTagForm.handleSubmit(handleEditTagSubmit)}
          noValidate
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="tag-catalog-edit-name" required>
              {intl.formatMessage({ id: 'tags.catalog.nameLabel' })}
            </Label>
            <Input
              id="tag-catalog-edit-name"
              type="text"
              aria-invalid={editTagForm.formState.errors.name !== undefined}
              aria-describedby={
                editTagForm.formState.errors.name !== undefined
                  ? 'tag-catalog-edit-name-error'
                  : undefined
              }
              {...editTagForm.register('name')}
            />
            {editTagForm.formState.errors.name !== undefined ? (
              <p
                id="tag-catalog-edit-name-error"
                role="alert"
                className="text-xs font-medium text-destructive"
              >
                {intl.formatMessage({ id: 'validation.required' })}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tag-catalog-edit-color">
              {intl.formatMessage({ id: 'tags.catalog.colorLabel' })}
            </Label>
            <Input
              id="tag-catalog-edit-color"
              type="text"
              {...editTagForm.register('colorToken')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={isMutating || editTagForm.formState.isSubmitting}
            >
              {intl.formatMessage({ id: 'tags.catalog.saveAction' })}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isMutating}
              onClick={() => setEditingTag(null)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        isOpen={deletingTag !== null}
        titleId="delete-tag-dialog-title"
        title={intl.formatMessage({ id: 'tags.catalog.deleteConfirmTitle' })}
        descriptionId="delete-tag-dialog-description"
        description={
          deletingTag !== null
            ? intl.formatMessage(
                { id: 'tags.catalog.deleteConfirmDescription' },
                { name: deletingTag.name },
              )
            : undefined
        }
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating}
        onClose={() => setDeletingTag(null)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void handleConfirmDeleteTag()}
          >
            {intl.formatMessage({ id: 'tags.catalog.deleteAction' })}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => setDeletingTag(null)}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
        </div>
      </ModalDialog>
    </section>
  );
}
