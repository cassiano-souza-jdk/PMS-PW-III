import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconEdit,
  IconGripVertical,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import type { BoardColumnId } from '@/shared/kernel';
import { Badge, Button, Input, Label } from '@/shared/ui';
import type {
  BoardColumnWithWip,
  KanbanBoardPermissions,
  KanbanCardProjection,
  UpdateColumnInput,
} from '../application/use-cases/kanban-service';
import { KanbanSortableCard } from './kanban-sortable-card';

type ColumnRole = BoardColumnWithWip['columnRole'];

const COLUMN_ROLE_LABEL_IDS: Readonly<Record<ColumnRole, MessageId>> = {
  INITIAL: 'kanban.column.role.INITIAL',
  OPERATIONAL: 'kanban.column.role.OPERATIONAL',
  FINAL: 'kanban.column.role.FINAL',
};

const VALIDATION_ERROR_IDS: Readonly<Record<string, MessageId>> = {
  'validation.required': 'validation.required',
  'errors.VALIDATION_ERROR': 'errors.VALIDATION_ERROR',
};

function resolveValidationMessageId(code: string | undefined): MessageId {
  if (code !== undefined && code in VALIDATION_ERROR_IDS) {
    return VALIDATION_ERROR_IDS[code] ?? 'validation.required';
  }
  return 'validation.required';
}

const editColumnFormSchema = z.object({
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

type EditColumnFormValues = z.infer<typeof editColumnFormSchema>;

export interface KanbanSortableColumnProps {
  readonly column: BoardColumnWithWip;
  readonly activeColumns: readonly BoardColumnWithWip[];
  readonly columnCards: readonly KanbanCardProjection[];
  readonly activeColumnIndex: number;
  readonly totalActiveColumns: number;
  readonly permissions: KanbanBoardPermissions;
  readonly isProjectArchived: boolean;
  readonly isMutating: boolean;
  readonly onReorderColumnStep: (columnId: BoardColumnId, direction: 'left' | 'right') => void;
  readonly onUpdateColumn: (columnId: BoardColumnId, input: UpdateColumnInput) => Promise<void>;
  readonly onArchiveColumn: (columnId: BoardColumnId, name: string) => Promise<void>;
  readonly onRestoreColumn: (columnId: BoardColumnId, name: string) => Promise<void>;
  readonly onDeleteColumn: (
    columnId: BoardColumnId,
    name: string,
    migrationTargetColumnId?: BoardColumnId,
  ) => Promise<void>;
  readonly onMoveCardToColumn: (card: KanbanCardProjection, targetColumnId: BoardColumnId) => void;
  readonly onReorderCardWithinColumn: (card: KanbanCardProjection, targetOrder: number) => void;
}

export function KanbanSortableColumn({
  column,
  activeColumns,
  columnCards,
  activeColumnIndex,
  totalActiveColumns,
  permissions,
  isProjectArchived,
  isMutating,
  onReorderColumnStep,
  onUpdateColumn,
  onArchiveColumn,
  onRestoreColumn,
  onDeleteColumn,
  onMoveCardToColumn,
  onReorderCardWithinColumn,
}: KanbanSortableColumnProps) {
  const intl = useIntl();
  const isColumnArchived = column.archivedAt !== undefined;
  const canDragColumn =
    permissions.canManageColumns && !isProjectArchived && !isColumnArchived && !isMutating;

  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const otherActiveColumns = activeColumns.filter((candidate) => candidate.id !== column.id);
  const [migrationTargetId, setMigrationTargetId] = useState<string>(
    otherActiveColumns[0]?.id ?? '',
  );

  const resolvedMigrationTargetId = otherActiveColumns.some((c) => c.id === migrationTargetId)
    ? migrationTargetId
    : (otherActiveColumns[0]?.id ?? '');

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `col:${column.id}`,
    data: {
      type: 'column' as const,
      columnId: column.id,
    },
    disabled: !canDragColumn,
  });

  const { setNodeRef: setDroppableBodyRef, isOver } = useDroppable({
    id: `col-drop:${column.id}`,
    data: {
      type: 'column-body' as const,
      columnId: column.id,
    },
    disabled: isProjectArchived || isColumnArchived,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const editForm = useForm<EditColumnFormValues>({
    resolver: zodResolver(editColumnFormSchema),
    defaultValues: {
      name: column.name,
      columnRole: column.columnRole,
      wipLimitInput: column.wipLimit !== null ? String(column.wipLimit) : '',
    },
  });

  const handleOpenEdit = () => {
    editForm.reset({
      name: column.name,
      columnRole: column.columnRole,
      wipLimitInput: column.wipLimit !== null ? String(column.wipLimit) : '',
    });
    setIsConfirmingDelete(false);
    setIsEditing((prev) => !prev);
  };

  const handleEditSubmit = async (values: EditColumnFormValues) => {
    const parsedWipLimit = values.wipLimitInput === '' ? null : Number(values.wipLimitInput);

    await onUpdateColumn(column.id, {
      name: values.name,
      columnRole: values.columnRole,
      ...(permissions.canManageWip ? { wipLimit: parsedWipLimit } : {}),
    });
    setIsEditing(false);
  };

  const handleConfirmDelete = async () => {
    const targetCol =
      columnCards.length > 0
        ? otherActiveColumns.find((candidate) => candidate.id === resolvedMigrationTargetId)
        : undefined;

    await onDeleteColumn(column.id, column.name, targetCol?.id);
    setIsConfirmingDelete(false);
  };

  const previousActiveColumnId =
    activeColumnIndex > 0 ? (activeColumns[activeColumnIndex - 1]?.id ?? null) : null;
  const nextActiveColumnId =
    activeColumnIndex >= 0 && activeColumnIndex < totalActiveColumns - 1
      ? (activeColumns[activeColumnIndex + 1]?.id ?? null)
      : null;

  const isWipExceeded = column.wipLimit !== null && column.occupyingTaskCount > column.wipLimit;

  return (
    <section
      ref={setSortableRef}
      style={style}
      aria-labelledby={`column-title-${column.id}`}
      className={`flex w-80 shrink-0 flex-col rounded-lg border bg-card p-4 shadow-sm ${
        isDragging ? 'opacity-60 ring-2 ring-primary' : ''
      } ${isColumnArchived ? 'border-dashed opacity-80' : ''}`}
    >
      <div className="space-y-2 border-b pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <h2
              id={`column-title-${column.id}`}
              className="break-words text-base font-semibold text-foreground"
            >
              {column.name}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                {intl.formatMessage({ id: COLUMN_ROLE_LABEL_IDS[column.columnRole] })}
              </Badge>
              {isColumnArchived ? (
                <Badge variant="outline">
                  {intl.formatMessage({ id: 'kanban.column.archivedBadge' })}
                </Badge>
              ) : null}
              {isWipExceeded ? (
                <Badge variant="destructive">
                  {intl.formatMessage({ id: 'kanban.wipExceededBadge' })}
                </Badge>
              ) : null}
            </div>
          </div>

          {permissions.canManageColumns && !isProjectArchived && !isColumnArchived ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="min-h-[44px] min-w-[44px] shrink-0 cursor-grab active:cursor-grabbing"
              aria-label={column.name}
              disabled={isMutating}
              {...attributes}
              {...listeners}
            >
              <IconGripVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <p className="text-xs font-medium text-muted-foreground">
          {column.wipLimit !== null
            ? intl.formatMessage(
                { id: 'kanban.wipLabel' },
                { current: column.occupyingTaskCount, limit: column.wipLimit },
              )
            : intl.formatMessage(
                { id: 'kanban.wipUnlimited' },
                { current: column.occupyingTaskCount },
              )}
        </p>

        {permissions.canManageColumns && !isProjectArchived ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {!isColumnArchived ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={intl.formatMessage({ id: 'kanban.column.moveLeftAction' })}
                  title={intl.formatMessage({ id: 'kanban.column.moveLeftAction' })}
                  disabled={isMutating || activeColumnIndex <= 0}
                  onClick={() => onReorderColumnStep(column.id, 'left')}
                >
                  <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Button>

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={intl.formatMessage({ id: 'kanban.column.moveRightAction' })}
                  title={intl.formatMessage({ id: 'kanban.column.moveRightAction' })}
                  disabled={isMutating || activeColumnIndex >= totalActiveColumns - 1}
                  onClick={() => onReorderColumnStep(column.id, 'right')}
                >
                  <IconArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={intl.formatMessage({ id: 'kanban.column.editAction' })}
                  title={intl.formatMessage({ id: 'kanban.column.editAction' })}
                  disabled={isMutating}
                  onClick={handleOpenEdit}
                >
                  <IconEdit className="h-4 w-4" aria-hidden="true" />
                </Button>

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={intl.formatMessage({ id: 'kanban.column.archiveAction' })}
                  title={intl.formatMessage({ id: 'kanban.column.archiveAction' })}
                  disabled={isMutating}
                  onClick={() => void onArchiveColumn(column.id, column.name)}
                >
                  <IconArchive className="h-4 w-4" aria-hidden="true" />
                </Button>

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={intl.formatMessage({ id: 'kanban.column.deleteAction' })}
                  title={intl.formatMessage({ id: 'kanban.column.deleteAction' })}
                  disabled={isMutating}
                  onClick={() => {
                    setIsEditing(false);
                    setIsConfirmingDelete((prev) => !prev);
                  }}
                >
                  <IconTrash className="h-4 w-4" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => void onRestoreColumn(column.id, column.name)}
              >
                <IconArchiveOff className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'kanban.column.restoreAction' })}</span>
              </Button>
            )}
          </div>
        ) : null}

        {isEditing ? (
          <form
            onSubmit={editForm.handleSubmit(handleEditSubmit)}
            noValidate
            className="space-y-3 rounded-md border bg-muted/40 p-3"
          >
            <div className="space-y-1">
              <Label htmlFor={`edit-column-name-${column.id}`} required>
                {intl.formatMessage({ id: 'kanban.column.nameLabel' })}
              </Label>
              <Input
                id={`edit-column-name-${column.id}`}
                type="text"
                aria-invalid={editForm.formState.errors.name !== undefined}
                aria-describedby={
                  editForm.formState.errors.name !== undefined
                    ? `edit-column-name-error-${column.id}`
                    : undefined
                }
                {...editForm.register('name')}
              />
              {editForm.formState.errors.name !== undefined ? (
                <p
                  id={`edit-column-name-error-${column.id}`}
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id: resolveValidationMessageId(editForm.formState.errors.name.message),
                  })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`edit-column-role-${column.id}`}>
                {intl.formatMessage({ id: 'kanban.column.roleLabel' })}
              </Label>
              <select
                id={`edit-column-role-${column.id}`}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                {...editForm.register('columnRole')}
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
              <div className="space-y-1">
                <Label htmlFor={`edit-column-wip-${column.id}`}>
                  {intl.formatMessage({ id: 'kanban.column.wipLimitLabel' })}
                </Label>
                <Input
                  id={`edit-column-wip-${column.id}`}
                  type="number"
                  min={1}
                  step={1}
                  placeholder={intl.formatMessage({ id: 'kanban.column.wipLimitPlaceholder' })}
                  aria-invalid={editForm.formState.errors.wipLimitInput !== undefined}
                  aria-describedby={
                    editForm.formState.errors.wipLimitInput !== undefined
                      ? `edit-column-wip-error-${column.id}`
                      : undefined
                  }
                  {...editForm.register('wipLimitInput')}
                />
                {editForm.formState.errors.wipLimitInput !== undefined ? (
                  <p
                    id={`edit-column-wip-error-${column.id}`}
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    {intl.formatMessage({
                      id: resolveValidationMessageId(
                        editForm.formState.errors.wipLimitInput.message,
                      ),
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={isMutating || editForm.formState.isSubmitting}
              >
                <IconCheck className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'kanban.column.saveAction' })}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => setIsEditing(false)}
              >
                {intl.formatMessage({ id: 'projects.cancelAction' })}
              </Button>
            </div>
          </form>
        ) : null}

        {isConfirmingDelete ? (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            {columnCards.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor={`delete-column-target-${column.id}`} required>
                  {intl.formatMessage({ id: 'kanban.column.deleteTargetLabel' })}
                </Label>
                <select
                  id={`delete-column-target-${column.id}`}
                  value={resolvedMigrationTargetId}
                  onChange={(event) => setMigrationTargetId(event.target.value)}
                  className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {otherActiveColumns.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                className="min-h-[44px]"
                disabled={
                  isMutating || (columnCards.length > 0 && resolvedMigrationTargetId === '')
                }
                onClick={() => void handleConfirmDelete()}
              >
                {intl.formatMessage({ id: 'kanban.column.deleteConfirmAction' })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                disabled={isMutating}
                onClick={() => setIsConfirmingDelete(false)}
              >
                {intl.formatMessage({ id: 'projects.cancelAction' })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        ref={setDroppableBodyRef}
        className={`mt-3 min-h-[120px] flex-1 rounded-md p-1 transition-colors ${
          isOver ? 'bg-primary/10 ring-1 ring-primary/40' : ''
        }`}
      >
        <SortableContext
          items={columnCards.map((card) => `card:${card.task.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {columnCards.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {intl.formatMessage({ id: 'kanban.emptyColumn' })}
            </p>
          ) : (
            <ul className="space-y-3">
              {columnCards.map((card, index) => (
                <KanbanSortableCard
                  key={card.task.id}
                  card={card}
                  activeColumns={activeColumns}
                  previousActiveColumnId={previousActiveColumnId}
                  nextActiveColumnId={nextActiveColumnId}
                  cardIndexInColumn={index}
                  totalCardsInColumn={columnCards.length}
                  isProjectArchived={isProjectArchived}
                  isColumnArchived={isColumnArchived}
                  isMutating={isMutating}
                  onMoveToColumn={onMoveCardToColumn}
                  onReorderWithinColumn={onReorderCardWithinColumn}
                />
              ))}
            </ul>
          )}
        </SortableContext>
      </div>
    </section>
  );
}
