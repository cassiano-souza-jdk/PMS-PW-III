import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconColumns3,
  IconListCheck,
  IconPlus,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import type { MessageId } from '@/shared/i18n';
import { asBoardColumnId, type BoardColumnId, type Priority, type TaskId } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui';
import type {
  BoardColumnWithWip,
  CreateColumnInput,
  CreateQuickCardInput,
  KanbanCardProjection,
  MoveCardInput,
  ProjectBoardView,
  UpdateColumnInput,
} from '../application/use-cases/kanban-service';
import { KanbanSortableColumn } from './kanban-sortable-column';

type MoveExceptionKind =
  'WIP_OVERRIDE' | 'PAUSED_OVERRIDE' | 'REOPEN_REASON' | 'DEPENDENCY_OVERRIDE';

interface PendingMoveExceptionState {
  readonly kind: MoveExceptionKind;
  readonly card: KanbanCardProjection;
  readonly targetColumn: BoardColumnWithWip;
  readonly targetOrder?: number;
  readonly accumulatedInput: Omit<MoveCardInput, 'targetColumnId' | 'targetOrder'>;
}

interface ExceptionDialogCopy {
  readonly titleId: MessageId;
  readonly descriptionId: MessageId;
  readonly labelId: MessageId;
  readonly placeholderId: MessageId;
  readonly confirmActionId: MessageId;
}

const EXCEPTION_DIALOG_COPY: Readonly<Record<MoveExceptionKind, ExceptionDialogCopy>> = {
  WIP_OVERRIDE: {
    titleId: 'kanban.wipOverride.title',
    descriptionId: 'kanban.wipOverride.description',
    labelId: 'kanban.wipOverride.justificationLabel',
    placeholderId: 'kanban.wipOverride.justificationPlaceholder',
    confirmActionId: 'kanban.wipOverride.confirmAction',
  },
  PAUSED_OVERRIDE: {
    titleId: 'kanban.pausedOverride.title',
    descriptionId: 'kanban.pausedOverride.description',
    labelId: 'kanban.pausedOverride.justificationLabel',
    placeholderId: 'kanban.pausedOverride.justificationPlaceholder',
    confirmActionId: 'kanban.wipOverride.confirmAction',
  },
  DEPENDENCY_OVERRIDE: {
    titleId: 'kanban.dependencyOverride.title',
    descriptionId: 'kanban.dependencyOverride.description',
    labelId: 'kanban.dependencyOverride.justificationLabel',
    placeholderId: 'kanban.dependencyOverride.justificationPlaceholder',
    confirmActionId: 'kanban.wipOverride.confirmAction',
  },
  REOPEN_REASON: {
    titleId: 'kanban.reopenReason.title',
    descriptionId: 'kanban.reopenReason.description',
    labelId: 'kanban.reopenReason.label',
    placeholderId: 'kanban.reopenReason.placeholder',
    confirmActionId: 'kanban.reopenReason.confirmAction',
  },
};

const VALIDATION_ERROR_IDS: Readonly<Record<string, MessageId>> = {
  'validation.required': 'validation.required',
  'validation.displayNameMin': 'validation.displayNameMin',
  'errors.VALIDATION_ERROR': 'errors.VALIDATION_ERROR',
};

function resolveValidationMessageId(code: string | undefined): MessageId {
  if (code !== undefined && code in VALIDATION_ERROR_IDS) {
    return VALIDATION_ERROR_IDS[code] ?? 'validation.required';
  }
  return 'validation.required';
}

const quickCardFormSchema = z.object({
  title: z.string().trim().min(2, 'validation.displayNameMin').max(160),
  description: z.string().trim().max(2000).optional(),
  columnId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
});

const createColumnFormSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(80),
  columnRole: z.enum(['INITIAL', 'OPERATIONAL', 'FINAL']),
  wipLimitInput: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1),
      'errors.VALIDATION_ERROR',
    ),
});

type QuickCardFormValues = z.infer<typeof quickCardFormSchema>;
type CreateColumnFormValues = z.infer<typeof createColumnFormSchema>;

export interface KanbanPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface KanbanBoardPanelProps {
  readonly boardView: ProjectBoardView;
  readonly canOpenBottlenecks?: boolean;
  readonly isLoading?: boolean;
  readonly feedback?: KanbanPanelFeedback | null;
  readonly onBackToProjects: () => void;
  readonly onMoveCard: (taskId: TaskId, input: MoveCardInput) => Promise<void>;
  readonly onCreateQuickCard: (input: CreateQuickCardInput) => Promise<void>;
  readonly onCreateColumn: (input: CreateColumnInput) => Promise<void>;
  readonly onUpdateColumn: (columnId: BoardColumnId, input: UpdateColumnInput) => Promise<void>;
  readonly onReorderColumns: (orderedColumnIds: readonly BoardColumnId[]) => Promise<void>;
  readonly onArchiveColumn: (columnId: BoardColumnId, name: string) => Promise<void>;
  readonly onRestoreColumn: (columnId: BoardColumnId, name: string) => Promise<void>;
  readonly onDeleteColumn: (
    columnId: BoardColumnId,
    name: string,
    migrationTargetColumnId?: BoardColumnId,
  ) => Promise<void>;
}

function isWipConflictError(error: unknown): boolean {
  if (!isAppError(error) || error.code !== APP_ERROR_CODES.CONFLICT) {
    return false;
  }
  const messageLower = error.message.toLowerCase();
  return messageLower.includes('wip limit') || error.details?.wipLimit !== undefined;
}

function isPausedConflictError(error: unknown): boolean {
  if (!isAppError(error) || error.code !== APP_ERROR_CODES.CONFLICT) {
    return false;
  }
  return error.message.toLowerCase().includes('paused');
}

function isDependencyConflictError(error: unknown): boolean {
  if (!isAppError(error) || error.code !== APP_ERROR_CODES.CONFLICT) {
    return false;
  }
  const messageLower = error.message.toLowerCase();
  return (
    messageLower.includes('dependencies') ||
    error.details?.pendingRequiredDependencyIds !== undefined
  );
}

export function KanbanBoardPanel({
  boardView,
  canOpenBottlenecks = false,
  isLoading = false,
  feedback = null,
  onBackToProjects,
  onMoveCard,
  onCreateQuickCard,
  onCreateColumn,
  onUpdateColumn,
  onReorderColumns,
  onArchiveColumn,
  onRestoreColumn,
  onDeleteColumn,
}: KanbanBoardPanelProps) {
  const intl = useIntl();
  const { project, columns, cards, permissions } = boardView;
  const isProjectArchived = project.archivedAt !== undefined || project.status === 'ARCHIVED';

  const [includeArchivedColumns, setIncludeArchivedColumns] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null);
  const [pendingException, setPendingException] = useState<PendingMoveExceptionState | null>(null);
  const [exceptionJustification, setExceptionJustification] = useState('');
  const [exceptionValidationError, setExceptionValidationError] = useState<string | null>(null);
  const exceptionInputRef = useRef<HTMLInputElement | null>(null);
  const exceptionTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pendingException !== null) {
      exceptionInputRef.current?.focus();
    }
  }, [pendingException]);

  const openPendingException = (next: PendingMoveExceptionState) => {
    if (
      pendingException === null &&
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      exceptionTriggerRef.current = document.activeElement;
    }
    setPendingException(next);
    setExceptionJustification('');
    setExceptionValidationError(null);
  };

  const closePendingException = (restoreFocus: boolean) => {
    setPendingException(null);
    setExceptionJustification('');
    setExceptionValidationError(null);
    const trigger = exceptionTriggerRef.current;
    exceptionTriggerRef.current = null;
    if (restoreFocus && trigger !== null && trigger.isConnected) {
      trigger.focus();
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
  const activeColumns = sortedColumns.filter((column) => column.archivedAt === undefined);
  const archivedColumns = sortedColumns.filter((column) => column.archivedAt !== undefined);
  const visibleColumns = includeArchivedColumns ? sortedColumns : activeColumns;
  const hasArchivedColumns = archivedColumns.length > 0;

  const quickCardEligibleColumns = activeColumns.filter((column) => column.columnRole !== 'FINAL');
  const defaultQuickCardColumnId =
    quickCardEligibleColumns.find((column) => column.columnRole === 'INITIAL')?.id ??
    quickCardEligibleColumns[0]?.id ??
    '';

  const quickCardForm = useForm<QuickCardFormValues>({
    resolver: zodResolver(quickCardFormSchema),
    defaultValues: {
      title: '',
      description: '',
      columnId: defaultQuickCardColumnId,
      priority: 'MEDIUM',
    },
  });

  const createColumnForm = useForm<CreateColumnFormValues>({
    resolver: zodResolver(createColumnFormSchema),
    defaultValues: {
      name: '',
      columnRole: 'OPERATIONAL',
      wipLimitInput: '',
    },
  });

  const cardsByColumnId = new Map<BoardColumnId, KanbanCardProjection[]>();
  for (const col of sortedColumns) {
    cardsByColumnId.set(col.id, []);
  }
  for (const card of cards) {
    const list = cardsByColumnId.get(card.task.columnId);
    if (list !== undefined) {
      list.push(card);
    }
  }
  for (const [, list] of cardsByColumnId) {
    list.sort((a, b) => a.task.order - b.task.order);
  }

  const executeMoveCard = async (
    card: KanbanCardProjection,
    targetColumn: BoardColumnWithWip,
    targetOrder: number | undefined,
    extraInput: Omit<MoveCardInput, 'targetColumnId' | 'targetOrder'>,
  ) => {
    setLocalError(null);
    setIsMutating(true);
    try {
      await onMoveCard(card.task.id, {
        targetColumnId: targetColumn.id,
        ...(targetOrder !== undefined ? { targetOrder } : {}),
        ...extraInput,
      });
      closePendingException(false);
      setAnnouncement(
        intl.formatMessage(
          { id: 'kanban.cardMovedAnnouncement' },
          { title: card.task.title, column: targetColumn.name },
        ),
      );
    } catch (error) {
      if (isWipConflictError(error)) {
        if (permissions.canMoveWithWipOverride) {
          openPendingException({
            kind: 'WIP_OVERRIDE',
            card,
            targetColumn,
            ...(targetOrder !== undefined ? { targetOrder } : {}),
            accumulatedInput: extraInput,
          });
        } else {
          const msg = intl.formatMessage({ id: 'kanban.wipOverride.noPermissionError' });
          setLocalError(msg);
          setAnnouncement(msg);
        }
        return;
      }

      if (isPausedConflictError(error)) {
        openPendingException({
          kind: 'PAUSED_OVERRIDE',
          card,
          targetColumn,
          ...(targetOrder !== undefined ? { targetOrder } : {}),
          accumulatedInput: extraInput,
        });
        return;
      }

      if (isDependencyConflictError(error)) {
        openPendingException({
          kind: 'DEPENDENCY_OVERRIDE',
          card,
          targetColumn,
          ...(targetOrder !== undefined ? { targetOrder } : {}),
          accumulatedInput: extraInput,
        });
        return;
      }

      if (isAppError(error)) {
        const messageId: MessageId =
          error.code === APP_ERROR_CODES.AUTHORIZATION_ERROR
            ? 'errors.AUTHORIZATION_ERROR'
            : error.code === APP_ERROR_CODES.CONFLICT
              ? 'errors.CONFLICT'
              : 'errors.UNEXPECTED_ERROR';
        const msg = intl.formatMessage({ id: messageId });
        setLocalError(msg);
        setAnnouncement(msg);
      }
    } finally {
      setIsMutating(false);
    }
  };

  const attemptMoveCard = (
    card: KanbanCardProjection,
    targetColumnId: BoardColumnId,
    targetOrder?: number,
  ) => {
    if (isProjectArchived || !card.canMove) {
      return;
    }

    const sourceColumn = columns.find((col) => col.id === card.task.columnId);
    const targetColumn = activeColumns.find((col) => col.id === targetColumnId);
    if (sourceColumn === undefined || targetColumn === undefined) {
      return;
    }

    const isCrossColumn = sourceColumn.id !== targetColumn.id;
    const isLeavingFinalColumn =
      isCrossColumn &&
      sourceColumn.columnRole === 'FINAL' &&
      targetColumn.columnRole !== 'FINAL' &&
      card.task.status === 'DONE';

    if (card.isPaused) {
      setLocalError(null);
      openPendingException({
        kind: 'PAUSED_OVERRIDE',
        card,
        targetColumn,
        ...(targetOrder !== undefined ? { targetOrder } : {}),
        accumulatedInput: {},
      });
      return;
    }

    if (isLeavingFinalColumn) {
      setLocalError(null);
      openPendingException({
        kind: 'REOPEN_REASON',
        card,
        targetColumn,
        ...(targetOrder !== undefined ? { targetOrder } : {}),
        accumulatedInput: {},
      });
      return;
    }

    const occupiesWipOnTarget = isCrossColumn && targetColumn.columnRole !== 'FINAL';
    const willExceedWip =
      occupiesWipOnTarget &&
      targetColumn.wipLimit !== null &&
      targetColumn.occupyingTaskCount >= targetColumn.wipLimit;

    if (willExceedWip) {
      if (!permissions.canMoveWithWipOverride) {
        const msg = intl.formatMessage({ id: 'kanban.wipOverride.noPermissionError' });
        setLocalError(msg);
        setAnnouncement(msg);
        return;
      }

      setLocalError(null);
      openPendingException({
        kind: 'WIP_OVERRIDE',
        card,
        targetColumn,
        ...(targetOrder !== undefined ? { targetOrder } : {}),
        accumulatedInput: {},
      });
      return;
    }

    void executeMoveCard(card, targetColumn, targetOrder, {});
  };

  const handleConfirmException = async () => {
    if (pendingException === null) {
      return;
    }
    const trimmed = exceptionJustification.trim();
    if (trimmed.length === 0) {
      setExceptionValidationError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    const { kind, card, targetColumn, targetOrder, accumulatedInput } = pendingException;
    const nextInput: Omit<MoveCardInput, 'targetColumnId' | 'targetOrder'> = {
      ...accumulatedInput,
      ...(kind === 'WIP_OVERRIDE' ? { wipOverrideJustification: trimmed } : {}),
      ...(kind === 'PAUSED_OVERRIDE' ? { pausedOverrideJustification: trimmed } : {}),
      ...(kind === 'REOPEN_REASON' ? { reopenReason: trimmed } : {}),
      ...(kind === 'DEPENDENCY_OVERRIDE' ? { dependencyOverrideJustification: trimmed } : {}),
    };

    if (kind === 'REOPEN_REASON') {
      const willExceedWipAfterReopen =
        targetColumn.columnRole !== 'FINAL' &&
        targetColumn.wipLimit !== null &&
        targetColumn.occupyingTaskCount >= targetColumn.wipLimit;

      if (willExceedWipAfterReopen) {
        if (!permissions.canMoveWithWipOverride) {
          const msg = intl.formatMessage({ id: 'kanban.wipOverride.noPermissionError' });
          closePendingException(true);
          setLocalError(msg);
          setAnnouncement(msg);
          return;
        }
        openPendingException({
          kind: 'WIP_OVERRIDE',
          card,
          targetColumn,
          ...(targetOrder !== undefined ? { targetOrder } : {}),
          accumulatedInput: nextInput,
        });
        return;
      }
    }

    await executeMoveCard(card, targetColumn, targetOrder, nextInput);
  };

  const handleReorderColumnsList = async (
    nextActiveColumns: readonly BoardColumnWithWip[],
    movedColumnName: string,
    newPosition: number,
  ) => {
    setLocalError(null);
    setIsMutating(true);
    try {
      await onReorderColumns(nextActiveColumns.map((col) => col.id));
      setAnnouncement(
        intl.formatMessage(
          { id: 'kanban.columnReorderedAnnouncement' },
          { column: movedColumnName, position: newPosition },
        ),
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleReorderColumnStep = (columnId: BoardColumnId, direction: 'left' | 'right') => {
    if (!permissions.canManageColumns || isProjectArchived) {
      return;
    }
    const currentIndex = activeColumns.findIndex((col) => col.id === columnId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= activeColumns.length) {
      return;
    }
    const reordered = arrayMove([...activeColumns], currentIndex, targetIndex);
    const movedColumn = activeColumns[currentIndex];
    if (movedColumn !== undefined) {
      void handleReorderColumnsList(reordered, movedColumn.name, targetIndex + 1);
    }
  };

  const handleReorderCardWithinColumn = (card: KanbanCardProjection, targetOrder: number) => {
    const columnCards = cardsByColumnId.get(card.task.columnId) ?? [];
    if (targetOrder < 1 || targetOrder > columnCards.length) {
      return;
    }
    attemptMoveCard(card, card.task.columnId, targetOrder);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as
      | { readonly type?: 'card'; readonly taskId?: TaskId }
      | { readonly type?: 'column'; readonly columnId?: BoardColumnId }
      | undefined;

    if (data?.type === 'card') {
      const found = cards.find((c) => c.task.id === data.taskId);
      setActiveDragLabel(found?.task.title ?? null);
    } else if (data?.type === 'column') {
      const found = activeColumns.find((c) => c.id === data.columnId);
      setActiveDragLabel(found?.name ?? null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragLabel(null);
    if (isProjectArchived) {
      return;
    }

    const { active, over } = event;
    if (over === null || active.id === over.id) {
      return;
    }

    const activeData = active.data.current as
      | { readonly type: 'card'; readonly taskId: TaskId; readonly columnId: BoardColumnId }
      | { readonly type: 'column'; readonly columnId: BoardColumnId }
      | undefined;

    const overData = over.data.current as
      | { readonly type: 'card'; readonly taskId: TaskId; readonly columnId: BoardColumnId }
      | { readonly type: 'column' | 'column-body'; readonly columnId: BoardColumnId }
      | undefined;

    if (activeData === undefined || overData === undefined) {
      return;
    }

    if (activeData.type === 'column') {
      if (!permissions.canManageColumns) {
        return;
      }
      const targetColumnId = overData.columnId;
      const oldIndex = activeColumns.findIndex((c) => c.id === activeData.columnId);
      const newIndex = activeColumns.findIndex((c) => c.id === targetColumnId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        return;
      }
      const reordered = arrayMove([...activeColumns], oldIndex, newIndex);
      const movedColumn = activeColumns[oldIndex];
      if (movedColumn !== undefined) {
        void handleReorderColumnsList(reordered, movedColumn.name, newIndex + 1);
      }
      return;
    }

    const draggedCard = cards.find((c) => c.task.id === activeData.taskId);
    if (draggedCard === undefined || !draggedCard.canMove) {
      return;
    }

    if (overData.type === 'card') {
      const targetColumnCards = cardsByColumnId.get(overData.columnId) ?? [];
      const overCardIndex = targetColumnCards.findIndex((c) => c.task.id === overData.taskId);
      const targetOrder = overCardIndex >= 0 ? overCardIndex + 1 : undefined;
      attemptMoveCard(draggedCard, overData.columnId, targetOrder);
      return;
    }

    const targetColumnCards = cardsByColumnId.get(overData.columnId) ?? [];
    const targetOrder =
      draggedCard.task.columnId === overData.columnId
        ? targetColumnCards.length
        : targetColumnCards.length + 1;
    attemptMoveCard(draggedCard, overData.columnId, targetOrder);
  };

  const handleQuickCardSubmit = async (values: QuickCardFormValues) => {
    setLocalError(null);
    const trimmedDesc = values.description?.trim() ?? '';
    const selectedEligibleColumn = quickCardEligibleColumns.find(
      (column) => column.id === values.columnId,
    );
    const resolvedColumnId =
      selectedEligibleColumn?.id ??
      (defaultQuickCardColumnId !== ''
        ? asBoardColumnId(defaultQuickCardColumnId, 'columnId')
        : undefined);

    await onCreateQuickCard({
      title: values.title,
      ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
      ...(resolvedColumnId !== undefined ? { columnId: resolvedColumnId } : {}),
      priority: values.priority as Priority,
    });

    quickCardForm.reset({
      title: '',
      description: '',
      columnId: resolvedColumnId ?? '',
      priority: 'MEDIUM',
    });
  };

  const handleCreateColumnSubmit = async (values: CreateColumnFormValues) => {
    setLocalError(null);
    const parsedWipLimit =
      permissions.canManageWip && values.wipLimitInput !== '' ? Number(values.wipLimitInput) : null;

    await onCreateColumn({
      name: values.name,
      columnRole: values.columnRole,
      wipLimit: parsedWipLimit,
    });

    createColumnForm.reset({
      name: '',
      columnRole: 'OPERATIONAL',
      wipLimitInput: '',
    });
  };

  const exceptionDialogCopy =
    pendingException !== null ? EXCEPTION_DIALOG_COPY[pendingException.kind] : null;

  return (
    <section aria-labelledby="kanban-board-heading" className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={onBackToProjects}
            >
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'kanban.backToProjects' })}</span>
            </Button>

            <Button asChild variant="outline" className="min-h-[44px]">
              <Link to={`/projects/${project.id}/tasks`}>
                <IconListCheck className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'kanban.openTaskListAction' })}</span>
              </Link>
            </Button>

            {canOpenBottlenecks ? (
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${project.id}/bottlenecks`}>
                  <IconAlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'kanban.openBottlenecksAction' })}</span>
                </Link>
              </Button>
            ) : null}
          </div>
          <h1
            id="kanban-board-heading"
            className="pt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            {intl.formatMessage({ id: 'kanban.title' }, { name: project.name })}
          </h1>
        </div>

        {hasArchivedColumns || permissions.canManageColumns ? (
          <label
            htmlFor="kanban-include-archived-columns"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id="kanban-include-archived-columns"
              type="checkbox"
              checked={includeArchivedColumns}
              onChange={(event) => setIncludeArchivedColumns(event.target.checked)}
              className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <span>{intl.formatMessage({ id: 'kanban.includeArchivedColumns' })}</span>
          </label>
        ) : null}
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'kanban.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      {isProjectArchived ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'kanban.archivedLockBanner' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {localError !== null ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{localError}</AlertDescription>
        </Alert>
      ) : null}

      {feedback !== null ? (
        <Alert
          variant={feedback.type}
          role={feedback.type === 'destructive' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      {pendingException !== null && exceptionDialogCopy !== null ? (
        <Card
          role="dialog"
          aria-modal="false"
          aria-labelledby="move-exception-title"
          aria-describedby="move-exception-description"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !isMutating) {
              closePendingException(true);
            }
          }}
          className="border-amber-700/60 bg-amber-50/70 dark:border-amber-400/60 dark:bg-amber-950/30"
        >
          <CardHeader>
            <CardTitle id="move-exception-title">
              {intl.formatMessage({ id: exceptionDialogCopy.titleId })}
            </CardTitle>
            <CardDescription id="move-exception-description">
              {intl.formatMessage({ id: exceptionDialogCopy.descriptionId })}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kanban-exception-justification" required>
                {intl.formatMessage({ id: exceptionDialogCopy.labelId })}
              </Label>
              <Input
                ref={exceptionInputRef}
                id="kanban-exception-justification"
                type="text"
                value={exceptionJustification}
                onChange={(event) => {
                  setExceptionJustification(event.target.value);
                  if (exceptionValidationError !== null) {
                    setExceptionValidationError(null);
                  }
                }}
                placeholder={intl.formatMessage({ id: exceptionDialogCopy.placeholderId })}
                aria-invalid={exceptionValidationError !== null}
                aria-describedby={
                  exceptionValidationError !== null
                    ? 'kanban-exception-justification-error'
                    : undefined
                }
              />
              {exceptionValidationError !== null ? (
                <p
                  id="kanban-exception-justification-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {exceptionValidationError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => void handleConfirmException()}
              >
                {intl.formatMessage({ id: exceptionDialogCopy.confirmActionId })}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => closePendingException(true)}
              >
                {intl.formatMessage({ id: 'kanban.wipOverride.cancelAction' })}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'app.loading' })}
        </p>
      ) : visibleColumns.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'kanban.emptyBoard' })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragLabel(null)}
        >
          <div className="overflow-x-auto pb-4">
            <SortableContext
              items={activeColumns.map((column) => `col:${column.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-start gap-4">
                {visibleColumns.map((column) => {
                  const activeIndex = activeColumns.findIndex((c) => c.id === column.id);
                  return (
                    <KanbanSortableColumn
                      key={column.id}
                      column={column}
                      activeColumns={activeColumns}
                      columnCards={cardsByColumnId.get(column.id) ?? []}
                      activeColumnIndex={activeIndex}
                      totalActiveColumns={activeColumns.length}
                      permissions={permissions}
                      isProjectArchived={isProjectArchived}
                      isMutating={isMutating}
                      onReorderColumnStep={handleReorderColumnStep}
                      onUpdateColumn={onUpdateColumn}
                      onArchiveColumn={onArchiveColumn}
                      onRestoreColumn={onRestoreColumn}
                      onDeleteColumn={onDeleteColumn}
                      onMoveCardToColumn={(card, targetColumnId) =>
                        attemptMoveCard(card, targetColumnId)
                      }
                      onReorderCardWithinColumn={handleReorderCardWithinColumn}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </div>

          <DragOverlay>
            {activeDragLabel !== null ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-lg">
                {activeDragLabel}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {permissions.canCreateQuickCard &&
        !isProjectArchived &&
        quickCardEligibleColumns.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: 'kanban.quickCard.title' })}</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={quickCardForm.handleSubmit(handleQuickCardSubmit)}
                noValidate
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="quick-card-title" required>
                    {intl.formatMessage({ id: 'kanban.quickCard.titleLabel' })}
                  </Label>
                  <Input
                    id="quick-card-title"
                    type="text"
                    placeholder={intl.formatMessage({ id: 'kanban.quickCard.titlePlaceholder' })}
                    aria-invalid={quickCardForm.formState.errors.title !== undefined}
                    aria-describedby={
                      quickCardForm.formState.errors.title !== undefined
                        ? 'quick-card-title-error'
                        : undefined
                    }
                    {...quickCardForm.register('title')}
                  />
                  {quickCardForm.formState.errors.title !== undefined ? (
                    <p
                      id="quick-card-title-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({
                        id: resolveValidationMessageId(
                          quickCardForm.formState.errors.title.message,
                        ),
                      })}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="quick-card-description">
                    {intl.formatMessage({ id: 'kanban.quickCard.descriptionLabel' })}
                  </Label>
                  <Input
                    id="quick-card-description"
                    type="text"
                    {...quickCardForm.register('description')}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="quick-card-column">
                      {intl.formatMessage({ id: 'kanban.quickCard.columnLabel' })}
                    </Label>
                    <select
                      id="quick-card-column"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...quickCardForm.register('columnId')}
                    >
                      {quickCardEligibleColumns.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="quick-card-priority">
                      {intl.formatMessage({ id: 'kanban.quickCard.priorityLabel' })}
                    </Label>
                    <select
                      id="quick-card-priority"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...quickCardForm.register('priority')}
                    >
                      <option value="LOW">
                        {intl.formatMessage({ id: 'kanban.priority.LOW' })}
                      </option>
                      <option value="MEDIUM">
                        {intl.formatMessage({ id: 'kanban.priority.MEDIUM' })}
                      </option>
                      <option value="HIGH">
                        {intl.formatMessage({ id: 'kanban.priority.HIGH' })}
                      </option>
                      <option value="CRITICAL">
                        {intl.formatMessage({ id: 'kanban.priority.CRITICAL' })}
                      </option>
                    </select>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="min-h-[44px]"
                  disabled={isMutating || quickCardForm.formState.isSubmitting}
                >
                  <IconPlus className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {intl.formatMessage({
                      id: quickCardForm.formState.isSubmitting
                        ? 'auth.common.submitting'
                        : 'kanban.quickCard.submit',
                    })}
                  </span>
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {permissions.canManageColumns && !isProjectArchived ? (
          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: 'kanban.column.createTitle' })}</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={createColumnForm.handleSubmit(handleCreateColumnSubmit)}
                noValidate
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="create-column-name" required>
                    {intl.formatMessage({ id: 'kanban.column.nameLabel' })}
                  </Label>
                  <Input
                    id="create-column-name"
                    type="text"
                    aria-invalid={createColumnForm.formState.errors.name !== undefined}
                    aria-describedby={
                      createColumnForm.formState.errors.name !== undefined
                        ? 'create-column-name-error'
                        : undefined
                    }
                    {...createColumnForm.register('name')}
                  />
                  {createColumnForm.formState.errors.name !== undefined ? (
                    <p
                      id="create-column-name-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({
                        id: resolveValidationMessageId(
                          createColumnForm.formState.errors.name.message,
                        ),
                      })}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="create-column-role">
                      {intl.formatMessage({ id: 'kanban.column.roleLabel' })}
                    </Label>
                    <select
                      id="create-column-role"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...createColumnForm.register('columnRole')}
                    >
                      <option value="INITIAL">
                        {intl.formatMessage({ id: 'kanban.column.role.INITIAL' })}
                      </option>
                      <option value="OPERATIONAL">
                        {intl.formatMessage({ id: 'kanban.column.role.OPERATIONAL' })}
                      </option>
                      <option value="FINAL">
                        {intl.formatMessage({ id: 'kanban.column.role.FINAL' })}
                      </option>
                    </select>
                  </div>

                  {permissions.canManageWip ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="create-column-wip">
                        {intl.formatMessage({ id: 'kanban.column.wipLimitLabel' })}
                      </Label>
                      <Input
                        id="create-column-wip"
                        type="number"
                        min={1}
                        step={1}
                        placeholder={intl.formatMessage({
                          id: 'kanban.column.wipLimitPlaceholder',
                        })}
                        aria-invalid={createColumnForm.formState.errors.wipLimitInput !== undefined}
                        aria-describedby={
                          createColumnForm.formState.errors.wipLimitInput !== undefined
                            ? 'create-column-wip-error'
                            : undefined
                        }
                        {...createColumnForm.register('wipLimitInput')}
                      />
                      {createColumnForm.formState.errors.wipLimitInput !== undefined ? (
                        <p
                          id="create-column-wip-error"
                          role="alert"
                          className="text-xs font-medium text-destructive"
                        >
                          {intl.formatMessage({
                            id: resolveValidationMessageId(
                              createColumnForm.formState.errors.wipLimitInput.message,
                            ),
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <Button
                  type="submit"
                  className="min-h-[44px]"
                  disabled={isMutating || createColumnForm.formState.isSubmitting}
                >
                  <IconColumns3 className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {intl.formatMessage({
                      id: createColumnForm.formState.isSubmitting
                        ? 'auth.common.submitting'
                        : 'kanban.column.createAction',
                    })}
                  </span>
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
