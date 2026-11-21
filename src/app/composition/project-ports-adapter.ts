import { BOARD_COLUMN_ROLES, type BoardColumn, type ProjectBoard } from '@/modules/kanban';
import type {
  ProjectBoardExportResult,
  ProjectBoardInitializerPort,
  ProjectTeamLookupPort,
  ProjectTeamSummary,
} from '@/modules/projects';
import {
  asBoardColumnId,
  asBoardId,
  isSoftDeleted,
  type OrganizationId,
  type TeamId,
  type UserId,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';

/**
 * Thin composition-layer adapter bridging `ProjectTeamLookupPort` to `TeamRepositoryPort`
 * without introducing a `projects <-> teams` cycle (ADR-0010 §3).
 */
export function createProjectTeamLookupAdapter(
  repositories: AppRepositoriesRegistry,
): ProjectTeamLookupPort {
  return {
    async findTeamById(
      organizationId: OrganizationId,
      teamId: TeamId,
    ): Promise<ProjectTeamSummary | null> {
      const team = await repositories.teams.teams.findById(organizationId, teamId);
      if (!team) {
        return null;
      }

      return {
        id: team.id,
        organizationId: team.organizationId,
        name: team.name,
        ...(team.archivedAt !== undefined ? { archivedAt: team.archivedAt } : {}),
        ...(team.deletedAt !== undefined ? { deletedAt: team.deletedAt } : {}),
      };
    },

    async listManagedTeamIds(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<readonly TeamId[]> {
      const teams = await repositories.teams.teams.listByOrganization(organizationId, {
        includeArchived: true,
        includeDeleted: false,
      });

      return teams
        .filter((team) => !isSoftDeleted(team) && team.managerUserIds.includes(userId))
        .map((team) => team.id);
    },

    async listTeamsForOrganization(
      organizationId: OrganizationId,
    ): Promise<readonly ProjectTeamSummary[]> {
      const teams = await repositories.teams.teams.listByOrganization(organizationId, {
        includeArchived: true,
        includeDeleted: false,
      });

      return teams
        .filter((team) => !isSoftDeleted(team))
        .map((team) => ({
          id: team.id,
          organizationId: team.organizationId,
          name: team.name,
          ...(team.archivedAt !== undefined ? { archivedAt: team.archivedAt } : {}),
        }));
    },
  };
}

/**
 * Thin composition-layer adapter bridging `ProjectBoardInitializerPort` to `ProjectBoardRepositoryPort`
 * and `BoardColumnRepositoryPort` inside `ProjectService` transactions without importing `@/modules/kanban`
 * inside `src/modules/projects/**` (ADR-0010 §3, §4.1).
 */
export function createProjectBoardInitializerAdapter(
  repositories: AppRepositoriesRegistry,
): ProjectBoardInitializerPort {
  return {
    async initializePrimaryBoard({ organizationId, projectId, now, nextUuid }): Promise<void> {
      const boardId = asBoardId(nextUuid());
      const board: ProjectBoard = {
        id: boardId,
        organizationId,
        projectId,
        name: 'Quadro Principal',
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      };

      const defaultColumns: readonly BoardColumn[] = [
        {
          id: asBoardColumnId(nextUuid()),
          organizationId,
          boardId,
          name: 'A Fazer',
          columnRole: BOARD_COLUMN_ROLES.INITIAL,
          order: 1,
          wipLimit: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: asBoardColumnId(nextUuid()),
          organizationId,
          boardId,
          name: 'Em Execução',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          order: 2,
          wipLimit: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: asBoardColumnId(nextUuid()),
          organizationId,
          boardId,
          name: 'Em Revisão',
          columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
          order: 3,
          wipLimit: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: asBoardColumnId(nextUuid()),
          organizationId,
          boardId,
          name: 'Concluído',
          columnRole: BOARD_COLUMN_ROLES.FINAL,
          order: 4,
          wipLimit: null,
          createdAt: now,
          updatedAt: now,
        },
      ];

      await repositories.kanban.projectBoards.save(board);
      await repositories.kanban.boardColumns.saveMany(organizationId, defaultColumns);
    },

    async findPrimaryBoardForExport(organizationId, projectId): Promise<ProjectBoardExportResult> {
      const board = await repositories.kanban.projectBoards.findPrimaryByProject(
        organizationId,
        projectId,
      );
      if (!board) {
        return { columns: [] };
      }

      const columns = await repositories.kanban.boardColumns.listByBoard(organizationId, board.id, {
        includeArchived: true,
      });

      return { board, columns };
    },
  };
}
