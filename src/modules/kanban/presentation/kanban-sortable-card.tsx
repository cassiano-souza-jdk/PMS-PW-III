import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconChevronRight,
  IconGripVertical,
} from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import type { BoardColumnId, Priority } from '@/shared/kernel';
import { Badge, Button } from '@/shared/ui';
import type {
  BoardColumnWithWip,
  KanbanCardProjection,
} from '../application/use-cases/kanban-service';

const PRIORITY_LABEL_IDS: Readonly<Record<Priority, MessageId>> = {
  LOW: 'kanban.priority.LOW',
  MEDIUM: 'kanban.priority.MEDIUM',
  HIGH: 'kanban.priority.HIGH',
  CRITICAL: 'kanban.priority.CRITICAL',
};

const PRIORITY_BADGE_VARIANTS: Readonly<
  Record<Priority, 'secondary' | 'default' | 'outline' | 'destructive'>
> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'default',
  CRITICAL: 'destructive',
};

export interface KanbanSortableCardProps {
  readonly card: KanbanCardProjection;
  readonly activeColumns: readonly BoardColumnWithWip[];
  readonly previousActiveColumnId: BoardColumnId | null;
  readonly nextActiveColumnId: BoardColumnId | null;
  readonly cardIndexInColumn: number;
  readonly totalCardsInColumn: number;
  readonly isProjectArchived: boolean;
  readonly isColumnArchived: boolean;
  readonly isMutating: boolean;
  readonly onMoveToColumn: (card: KanbanCardProjection, targetColumnId: BoardColumnId) => void;
  readonly onReorderWithinColumn: (card: KanbanCardProjection, targetOrder: number) => void;
}

export function KanbanSortableCard({
  card,
  activeColumns,
  previousActiveColumnId,
  nextActiveColumnId,
  cardIndexInColumn,
  totalCardsInColumn,
  isProjectArchived,
  isColumnArchived,
  isMutating,
  onMoveToColumn,
  onReorderWithinColumn,
}: KanbanSortableCardProps) {
  const intl = useIntl();
  const canOperateCard = card.canMove && !isProjectArchived && !isColumnArchived && !isMutating;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card:${card.task.id}`,
    data: {
      type: 'card' as const,
      taskId: card.task.id,
      columnId: card.task.columnId,
    },
    disabled: !canOperateCard,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const formattedLastMoved = intl.formatDate(card.task.lastMovedAt, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const formattedLastActivity = intl.formatDate(card.task.lastActivityAt, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-background p-3 shadow-sm transition-shadow ${
        isDragging ? 'opacity-60 ring-2 ring-primary' : ''
      }`}
    >
      <article aria-labelledby={`card-title-${card.task.id}`} className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              id={`card-title-${card.task.id}`}
              className="break-words text-sm font-semibold text-foreground"
            >
              {card.task.title}
            </h3>
            {card.task.description !== undefined ? (
              <p className="line-clamp-3 text-xs text-muted-foreground">{card.task.description}</p>
            ) : null}
          </div>

          {card.canMove && !isProjectArchived && !isColumnArchived ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="min-h-[44px] min-w-[44px] shrink-0 cursor-grab active:cursor-grabbing"
              aria-label={card.task.title}
              disabled={isMutating}
              {...attributes}
              {...listeners}
            >
              <IconGripVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={PRIORITY_BADGE_VARIANTS[card.task.priority]}>
            {intl.formatMessage({ id: PRIORITY_LABEL_IDS[card.task.priority] })}
          </Badge>
          {card.isPaused ? (
            <Badge variant="outline">{intl.formatMessage({ id: 'kanban.card.pausedBadge' })}</Badge>
          ) : null}
          {card.task.status === 'BLOCKED' ? (
            <Badge variant="destructive">
              {intl.formatMessage({ id: 'kanban.card.blockedBadge' })}
            </Badge>
          ) : null}
        </div>

        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            {intl.formatMessage({ id: 'kanban.card.lastMovedLabel' }, { date: formattedLastMoved })}
          </p>
          <p>
            {intl.formatMessage(
              { id: 'kanban.card.lastActivityLabel' },
              { date: formattedLastActivity },
            )}
          </p>
        </div>

        <div className="pt-1">
          <Button
            asChild
            variant="ghost"
            className="min-h-[44px] w-full justify-between px-2.5 text-xs"
          >
            <Link
              to={`/projects/${card.task.projectId}/tasks/${card.task.id}`}
              aria-label={intl.formatMessage(
                { id: 'kanban.card.openDetailsAriaLabel' },
                { title: card.task.title },
              )}
            >
              <span>{intl.formatMessage({ id: 'kanban.card.openDetailsAction' })}</span>
              <IconChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {card.canMove && !isProjectArchived && !isColumnArchived ? (
          <div className="space-y-2 border-t pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="min-h-[44px] min-w-[44px]"
                aria-label={intl.formatMessage({ id: 'kanban.card.moveLeftAction' })}
                title={intl.formatMessage({ id: 'kanban.card.moveLeftAction' })}
                disabled={isMutating || previousActiveColumnId === null}
                onClick={() => {
                  if (previousActiveColumnId !== null) {
                    onMoveToColumn(card, previousActiveColumnId);
                  }
                }}
              >
                <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>

              <Button
                type="button"
                size="icon"
                variant="outline"
                className="min-h-[44px] min-w-[44px]"
                aria-label={intl.formatMessage({ id: 'kanban.card.moveRightAction' })}
                title={intl.formatMessage({ id: 'kanban.card.moveRightAction' })}
                disabled={isMutating || nextActiveColumnId === null}
                onClick={() => {
                  if (nextActiveColumnId !== null) {
                    onMoveToColumn(card, nextActiveColumnId);
                  }
                }}
              >
                <IconArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>

              <Button
                type="button"
                size="icon"
                variant="outline"
                className="min-h-[44px] min-w-[44px]"
                aria-label={intl.formatMessage({ id: 'kanban.card.moveOrderUpAction' })}
                title={intl.formatMessage({ id: 'kanban.card.moveOrderUpAction' })}
                disabled={isMutating || cardIndexInColumn <= 0}
                onClick={() => onReorderWithinColumn(card, cardIndexInColumn)}
              >
                <IconArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>

              <Button
                type="button"
                size="icon"
                variant="outline"
                className="min-h-[44px] min-w-[44px]"
                aria-label={intl.formatMessage({ id: 'kanban.card.moveOrderDownAction' })}
                title={intl.formatMessage({ id: 'kanban.card.moveOrderDownAction' })}
                disabled={isMutating || cardIndexInColumn >= totalCardsInColumn - 1}
                onClick={() => onReorderWithinColumn(card, cardIndexInColumn + 2)}
              >
                <IconArrowDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <select
              aria-label={intl.formatMessage({ id: 'kanban.card.moveToColumnLabel' })}
              value={card.task.columnId}
              disabled={isMutating}
              onChange={(event) => {
                const nextColumn = activeColumns.find((col) => col.id === event.target.value);
                if (nextColumn !== undefined && nextColumn.id !== card.task.columnId) {
                  onMoveToColumn(card, nextColumn.id);
                }
              }}
              className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {activeColumns.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </article>
    </li>
  );
}
