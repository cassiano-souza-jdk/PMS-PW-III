import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  TASK_STATUSES,
  assertSameOrganization,
  type AuditableTimestamps,
  type BoardColumnId,
  type BoardId,
  type IsoDateTime,
  type OrganizationScoped,
  type ProjectId,
  type TaskStatus,
} from '@/shared/kernel';

export const BOARD_COLUMN_ROLES = {
  INITIAL: 'INITIAL',
  OPERATIONAL: 'OPERATIONAL',
  FINAL: 'FINAL',
} as const;

export type BoardColumnRole = (typeof BOARD_COLUMN_ROLES)[keyof typeof BOARD_COLUMN_ROLES];

export interface ProjectBoard extends OrganizationScoped, AuditableTimestamps {
  readonly id: BoardId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly isPrimary: boolean;
}

export interface BoardColumn extends OrganizationScoped, AuditableTimestamps {
  readonly id: BoardColumnId;
  readonly boardId: BoardId;
  readonly name: string;
  readonly columnRole: BoardColumnRole;
  readonly order: number;
  readonly wipLimit: number | null;
  readonly archivedAt?: IsoDateTime;
}

export interface AuthorizedExceptionInput {
  readonly authorized: boolean;
  readonly justification: string;
}

export interface WipCheckInput {
  readonly targetColumn: BoardColumn;
  readonly currentColumnOccupyingTaskCount: number;
  readonly movingTaskStatus: TaskStatus;
  readonly isSameColumnReorder?: boolean;
  readonly wipException?: AuthorizedExceptionInput;
}

export interface CardMoveCheckInput extends WipCheckInput {
  readonly projectArchived: boolean;
  readonly isTaskPaused: boolean;
  readonly pausedMoveException?: AuthorizedExceptionInput;
}

export interface CardMoveCheckResult {
  readonly allowed: true;
  readonly exceededWip: boolean;
  readonly requiresAudit: boolean;
}

function isOperationalColumn(column: BoardColumn): boolean {
  return (
    column.columnRole === BOARD_COLUMN_ROLES.INITIAL ||
    column.columnRole === BOARD_COLUMN_ROLES.OPERATIONAL
  );
}

/**
 * All active tasks present in a column count toward WIP — including BLOCKED tasks.
 * DONE and CANCELLED tasks do not occupy WIP (PRD.md §9).
 */
export function doesTaskStatusOccupyWip(status: TaskStatus): boolean {
  return status !== TASK_STATUSES.DONE && status !== TASK_STATUSES.CANCELLED;
}

/**
 * Validates board structural invariants (PRD.md §9):
 * at least one active operational column (INITIAL or OPERATIONAL) and at least one active FINAL column.
 */
export function assertValidBoardColumns(columns: readonly BoardColumn[]): void {
  const seenIds = new Set<BoardColumnId>();
  let activeOperationalCount = 0;
  let activeFinalCount = 0;

  for (const column of columns) {
    if (seenIds.has(column.id)) {
      throw new ValidationError(`Duplicate board column id "${column.id}".`, {
        details: { columnId: column.id },
      });
    }
    seenIds.add(column.id);

    if (column.name.trim().length === 0) {
      throw new ValidationError('Board column name must be a non-empty string.', {
        details: { columnId: column.id, field: 'name' },
      });
    }

    if (column.wipLimit !== null && (!Number.isInteger(column.wipLimit) || column.wipLimit < 1)) {
      throw new ValidationError('Board column "wipLimit" must be null or an integer >= 1.', {
        details: { columnId: column.id, field: 'wipLimit' },
      });
    }

    if (column.archivedAt === undefined) {
      if (isOperationalColumn(column)) {
        activeOperationalCount += 1;
      } else if (column.columnRole === BOARD_COLUMN_ROLES.FINAL) {
        activeFinalCount += 1;
      }
    }
  }

  if (activeOperationalCount < 1) {
    throw new ConflictError('A board must retain at least one active operational column.');
  }

  if (activeFinalCount < 1) {
    throw new ConflictError('A board must retain at least one active final completion column.');
  }
}

/**
 * Prevents deleting a column containing tasks without a valid migration target column,
 * and prevents violating mandatory board structure (PRD.md §9 / permission-matrix.md §5.4).
 */
export function assertColumnCanBeDeleted(
  column: BoardColumn,
  allBoardColumns: readonly BoardColumn[],
  activeTaskCount: number,
  migrationTargetColumn?: BoardColumn,
): void {
  if (!Number.isInteger(activeTaskCount) || activeTaskCount < 0) {
    throw new ValidationError('Parameter "activeTaskCount" must be an integer >= 0.', {
      details: { field: 'activeTaskCount' },
    });
  }

  const remainingColumns = allBoardColumns.filter((candidate) => candidate.id !== column.id);
  assertValidBoardColumns(remainingColumns);

  if (activeTaskCount > 0 && !migrationTargetColumn) {
    throw new ConflictError(
      'Cannot delete a column containing tasks without migrating them to a valid target column.',
      {
        details: { columnId: column.id, activeTaskCount },
      },
    );
  }

  if (!migrationTargetColumn) {
    return;
  }

  assertSameOrganization(
    column.organizationId,
    migrationTargetColumn.organizationId,
    'migrationTargetColumn',
  );

  if (migrationTargetColumn.boardId !== column.boardId) {
    throw new ConflictError('Migration target column must belong to the same board.', {
      details: { columnId: column.id, migrationTargetColumnId: migrationTargetColumn.id },
    });
  }

  if (migrationTargetColumn.id === column.id) {
    throw new ConflictError(
      'Migration target column must be different from the column being deleted.',
      {
        details: { columnId: column.id },
      },
    );
  }

  if (migrationTargetColumn.archivedAt !== undefined) {
    throw new ConflictError('Cannot migrate tasks into an archived column.', {
      details: { migrationTargetColumnId: migrationTargetColumn.id },
    });
  }
}

function assertAuthorizedException(
  exception: AuthorizedExceptionInput,
  operationLabel: string,
): void {
  if (!exception.authorized) {
    throw new AuthorizationError(
      `Actor is not authorized to apply an exception for ${operationLabel}.`,
    );
  }

  if (exception.justification.trim().length === 0) {
    throw new ValidationError(
      `An explicit non-empty justification is required for ${operationLabel} exception.`,
      {
        details: { field: 'justification' },
      },
    );
  }
}

/**
 * Evaluates WIP rules for moving a card into a target column (PRD.md §9).
 */
export function assertWipAllowsCardMove(input: WipCheckInput): CardMoveCheckResult {
  if (
    !Number.isInteger(input.currentColumnOccupyingTaskCount) ||
    input.currentColumnOccupyingTaskCount < 0
  ) {
    throw new ValidationError(
      'Parameter "currentColumnOccupyingTaskCount" must be an integer >= 0.',
      {
        details: { field: 'currentColumnOccupyingTaskCount' },
      },
    );
  }

  const wipLimit = input.targetColumn.wipLimit;
  const occupiesWip = !input.isSameColumnReorder && doesTaskStatusOccupyWip(input.movingTaskStatus);

  if (wipLimit === null || !occupiesWip) {
    return Object.freeze({ allowed: true, exceededWip: false, requiresAudit: false });
  }

  const projectedCount = input.currentColumnOccupyingTaskCount + 1;
  if (projectedCount <= wipLimit) {
    return Object.freeze({ allowed: true, exceededWip: false, requiresAudit: false });
  }

  if (!input.wipException) {
    throw new ConflictError(
      `WIP limit (${wipLimit}) exceeded for column "${input.targetColumn.name}".`,
      {
        details: {
          columnId: input.targetColumn.id,
          wipLimit,
          projectedCount,
        },
      },
    );
  }

  assertAuthorizedException(input.wipException, 'WIP limit override');

  return Object.freeze({
    allowed: true,
    exceededWip: true,
    requiresAudit: true,
  });
}

/**
 * Evaluates card movement invariants: archived project, archived column, paused task, and WIP (PRD.md §9, §10).
 */
export function assertCardMoveAllowed(input: CardMoveCheckInput): CardMoveCheckResult {
  if (input.projectArchived) {
    throw new ConflictError('Cannot move cards in an archived project.');
  }

  if (input.targetColumn.archivedAt !== undefined) {
    throw new ConflictError('Cannot move a card into an archived column.', {
      details: { columnId: input.targetColumn.id },
    });
  }

  let requiresAuditForPause = false;
  if (input.isTaskPaused) {
    if (!input.pausedMoveException) {
      throw new ConflictError(
        'Cannot move a paused task without resuming it or providing an authorized exception.',
      );
    }

    assertAuthorizedException(input.pausedMoveException, 'paused task movement');
    requiresAuditForPause = true;
  }

  const wipResult = assertWipAllowsCardMove(input);

  return Object.freeze({
    allowed: true,
    exceededWip: wipResult.exceededWip,
    requiresAudit: wipResult.requiresAudit || requiresAuditForPause,
  });
}
