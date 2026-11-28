import { IconArrowLeft } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  CreateColumnInput,
  CreateQuickCardInput,
  MoveCardInput,
  ProjectBoardView,
  UpdateColumnInput,
} from '@/modules/kanban';
import {
  KanbanBoardPanel,
  type KanbanPanelFeedback,
} from '@/modules/kanban/presentation/kanban-board-panel';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';
import {
  asEntityId,
  asProjectId,
  isUuid,
  type BoardColumnId,
  type ProjectId,
  type TaskId,
} from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui';

interface LoadedBoardState {
  readonly contextKey: string | null;
  readonly boardView: ProjectBoardView | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_BOARD_STATE: LoadedBoardState = {
  contextKey: null,
  boardView: null,
  errorMessageId: null,
};

function mapMoveCardErrorMessageId(error: unknown, canMoveWithWipOverride: boolean): MessageId {
  if (!isAppError(error)) {
    return 'errors.UNEXPECTED_ERROR';
  }
  if (error.code === APP_ERROR_CODES.CONFLICT) {
    const messageLower = error.message.toLowerCase();
    if (messageLower.includes('wip limit') || error.details?.wipLimit !== undefined) {
      return canMoveWithWipOverride ? 'errors.CONFLICT' : 'kanban.wipOverride.noPermissionError';
    }
    if (messageLower.includes('paused')) {
      return 'kanban.pausedOverride.error';
    }
    if (
      messageLower.includes('dependencies') ||
      error.details?.pendingRequiredDependencyIds !== undefined
    ) {
      return 'kanban.dependencyOverride.error';
    }
  }
  return getErrorMessageId(error.code);
}

export function ProjectBoardPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { projectId } = useParams<{ readonly projectId: string }>();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const [boardState, setBoardState] = useState<LoadedBoardState>(INITIAL_BOARD_STATE);
  const [feedback, setFeedback] = useState<KanbanPanelFeedback | null>(null);

  const validProjectId: ProjectId | null =
    projectId !== undefined && isUuid(projectId) ? asProjectId(projectId, 'projectId') : null;

  const contextKey =
    user !== null && activeOrganization !== null && validProjectId !== null
      ? `${user.id}:${activeOrganization.id}:${validProjectId}`
      : null;

  const reloadBoard = useCallback(async () => {
    if (
      user === null ||
      activeOrganization === null ||
      validProjectId === null ||
      contextKey === null
    ) {
      return;
    }
    const view = await services.kanban.getProjectBoard(
      user.id,
      activeOrganization.id,
      validProjectId,
    );
    setBoardState({
      contextKey,
      boardView: view,
      errorMessageId: null,
    });
  }, [activeOrganization, contextKey, services.kanban, user, validProjectId]);

  useEffect(() => {
    if (
      user === null ||
      activeOrganization === null ||
      validProjectId === null ||
      contextKey === null
    ) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetProjectId = validProjectId;
    const targetKey = contextKey;

    async function loadBoard() {
      try {
        const view = await services.kanban.getProjectBoard(
          actorUserId,
          targetOrgId,
          targetProjectId,
        );
        if (!isActive) {
          return;
        }
        setBoardState({
          contextKey: targetKey,
          boardView: view,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        const messageId = isAppError(error)
          ? getErrorMessageId(error.code)
          : 'errors.UNEXPECTED_ERROR';
        setBoardState({
          contextKey: targetKey,
          boardView: null,
          errorMessageId: messageId,
        });
      }
    }

    void loadBoard();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, contextKey, services.kanban, user, validProjectId]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'organizations.emptyTitle' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'organizations.emptyDescription' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="min-h-[44px]">
            <Link to="/organizations">{intl.formatMessage({ id: 'nav.organizations' })}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const handleBackToProjects = () => {
    void navigate('/projects');
  };

  if (validProjectId === null) {
    return (
      <section aria-labelledby="board-error-heading" className="mx-auto max-w-2xl space-y-4">
        <h1 id="board-error-heading" className="text-2xl font-bold text-foreground">
          {intl.formatMessage({ id: 'errors.NOT_FOUND' })}
        </h1>
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {intl.formatMessage({ id: 'validation.uuidInvalid' })}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={handleBackToProjects}
        >
          <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{intl.formatMessage({ id: 'kanban.backToProjects' })}</span>
        </Button>
      </section>
    );
  }

  const isCurrentContext = contextKey !== null && boardState.contextKey === contextKey;
  const isLoadingBoard = contextKey !== null && !isCurrentContext;
  const boardView = isCurrentContext ? boardState.boardView : null;
  const loadErrorMessageId = isCurrentContext ? boardState.errorMessageId : null;

  if (isLoadingBoard) {
    return (
      <section aria-labelledby="board-loading-heading" className="mx-auto max-w-2xl space-y-4">
        <h1 id="board-loading-heading" className="sr-only">
          {intl.formatMessage({ id: 'nav.projects' })}
        </h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'app.loading' })}
        </p>
      </section>
    );
  }

  if (loadErrorMessageId !== null || boardView === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    return (
      <section aria-labelledby="board-error-heading" className="mx-auto max-w-2xl space-y-4">
        <h1 id="board-error-heading" className="text-2xl font-bold text-foreground">
          {intl.formatMessage({ id: resolvedErrorId })}
        </h1>
        <Alert variant="destructive" role="alert">
          <AlertDescription>{intl.formatMessage({ id: resolvedErrorId })}</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={handleBackToProjects}
        >
          <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{intl.formatMessage({ id: 'kanban.backToProjects' })}</span>
        </Button>
      </section>
    );
  }

  const boardResource = {
    kind: 'BOARD' as const,
    id: asEntityId(boardView.board.id),
    exists: true,
    organizationId: boardView.project.organizationId,
    projectId: boardView.project.id,
    teamId: boardView.project.teamId,
    ownerUserId: boardView.project.ownerUserId,
    deletedAt: boardView.project.deletedAt,
    archivedAt: boardView.project.archivedAt,
    projectArchivedAt: boardView.project.archivedAt,
  };

  const canOpenBottlenecks = can(PERMISSION_CODES.BOTTLENECK_VIEW, {
    kind: 'BOTTLENECK',
    id: asEntityId(boardView.project.id),
    exists: true,
    organizationId: boardView.project.organizationId,
    projectId: boardView.project.id,
    teamId: boardView.project.teamId,
    ownerUserId: boardView.project.ownerUserId,
    deletedAt: boardView.project.deletedAt,
    archivedAt: boardView.project.archivedAt,
    projectArchivedAt: boardView.project.archivedAt,
  });

  const canOpenAnalytics = can(PERMISSION_CODES.ANALYTICS_PROJECT_VIEW, {
    kind: 'ANALYTICS',
    id: asEntityId(boardView.project.id),
    exists: true,
    organizationId: boardView.project.organizationId,
    projectId: boardView.project.id,
    teamId: boardView.project.teamId,
    ownerUserId: boardView.project.ownerUserId,
    deletedAt: boardView.project.deletedAt,
    archivedAt: boardView.project.archivedAt,
    projectArchivedAt: boardView.project.archivedAt,
    includesThirdPartyIndividualMetrics: false,
  });

  const effectiveBoardView: ProjectBoardView = {
    ...boardView,
    permissions: {
      ...boardView.permissions,
      canConfigureBoard:
        boardView.permissions.canConfigureBoard &&
        can(PERMISSION_CODES.BOARD_CONFIGURE, boardResource),
      canManageColumns:
        boardView.permissions.canManageColumns &&
        can(PERMISSION_CODES.BOARD_COLUMNS_MANAGE, boardResource),
      canManageWip:
        boardView.permissions.canManageWip && can(PERMISSION_CODES.BOARD_WIP_MANAGE, boardResource),
      canMoveWithWipOverride:
        boardView.permissions.canMoveWithWipOverride &&
        can(PERMISSION_CODES.BOARD_WIP_MANAGE, boardResource),
    },
  };

  const handleMoveCard = async (taskId: TaskId, input: MoveCardInput) => {
    setFeedback(null);
    try {
      await services.kanban.moveCard(user.id, activeOrganization.id, validProjectId, taskId, input);
      await reloadBoard();
    } catch (error) {
      const messageId = mapMoveCardErrorMessageId(
        error,
        effectiveBoardView.permissions.canMoveWithWipOverride,
      );
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleCreateQuickCard = async (input: CreateQuickCardInput) => {
    setFeedback(null);
    try {
      const created = await services.kanban.createQuickCard(
        user.id,
        activeOrganization.id,
        validProjectId,
        input,
      );
      await reloadBoard();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'kanban.quickCard.success' }, { title: created.title }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleCreateColumn = async (input: CreateColumnInput) => {
    setFeedback(null);
    try {
      const created = await services.kanban.createColumn(
        user.id,
        activeOrganization.id,
        validProjectId,
        input,
      );
      await reloadBoard();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'kanban.column.createSuccess' }, { name: created.name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleUpdateColumn = async (columnId: BoardColumnId, input: UpdateColumnInput) => {
    setFeedback(null);
    try {
      const updated = await services.kanban.updateColumn(
        user.id,
        activeOrganization.id,
        validProjectId,
        columnId,
        input,
      );
      await reloadBoard();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'kanban.column.saveSuccess' }, { name: updated.name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleReorderColumns = async (orderedColumnIds: readonly BoardColumnId[]) => {
    setFeedback(null);
    try {
      await services.kanban.reorderColumns(
        user.id,
        activeOrganization.id,
        validProjectId,
        orderedColumnIds,
      );
      await reloadBoard();
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleArchiveColumn = async (columnId: BoardColumnId, name: string) => {
    setFeedback(null);
    try {
      await services.kanban.archiveColumn(user.id, activeOrganization.id, validProjectId, columnId);
      await reloadBoard();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'kanban.column.archiveSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleRestoreColumn = async (columnId: BoardColumnId, name: string) => {
    setFeedback(null);
    try {
      await services.kanban.restoreColumn(user.id, activeOrganization.id, validProjectId, columnId);
      await reloadBoard();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'kanban.column.restoreSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleDeleteColumn = async (
    columnId: BoardColumnId,
    name: string,
    migrationTargetColumnId?: BoardColumnId,
  ) => {
    setFeedback(null);
    try {
      await services.kanban.deleteColumn(
        user.id,
        activeOrganization.id,
        validProjectId,
        columnId,
        migrationTargetColumnId !== undefined ? { migrationTargetColumnId } : {},
      );
      await reloadBoard();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'kanban.column.deleteSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  return (
    <KanbanBoardPanel
      boardView={effectiveBoardView}
      canOpenBottlenecks={canOpenBottlenecks}
      canOpenAnalytics={canOpenAnalytics}
      feedback={feedback}
      onBackToProjects={handleBackToProjects}
      onMoveCard={handleMoveCard}
      onCreateQuickCard={handleCreateQuickCard}
      onCreateColumn={handleCreateColumn}
      onUpdateColumn={handleUpdateColumn}
      onReorderColumns={handleReorderColumns}
      onArchiveColumn={handleArchiveColumn}
      onRestoreColumn={handleRestoreColumn}
      onDeleteColumn={handleDeleteColumn}
    />
  );
}

export default ProjectBoardPage;
