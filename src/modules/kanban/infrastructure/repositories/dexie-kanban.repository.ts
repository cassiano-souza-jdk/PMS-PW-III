import {
  TRANSACTION_RESOURCES,
  type BoardColumnId,
  type BoardId,
  type OrganizationId,
  type ProjectId,
} from '@/shared/kernel';
import {
  deleteOrganizationScopedById,
  findOrganizationScopedById,
  saveManyOrganizationScopedEntities,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  BoardColumnRepositoryPort,
  ProjectBoardRepositoryPort,
} from '../../application/ports/kanban-repository.port';
import type { BoardColumn, ProjectBoard } from '../../domain/board';

export class DexieProjectBoardRepository implements ProjectBoardRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<ProjectBoard, BoardId>(TRANSACTION_RESOURCES.PROJECT_BOARDS);
  }

  async findById(organizationId: OrganizationId, boardId: BoardId): Promise<ProjectBoard | null> {
    return findOrganizationScopedById(this.table, organizationId, boardId, 'ProjectBoard');
  }

  async findPrimaryByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ProjectBoard | null> {
    return withPersistenceErrorHandling('ProjectBoard.findPrimaryByProject', async () => {
      const boards = await this.table
        .where('[organizationId+projectId]')
        .equals([organizationId, projectId])
        .toArray();

      const primary = boards.find((board) => board.isPrimary);
      return primary ?? boards[0] ?? null;
    });
  }

  async save(board: ProjectBoard): Promise<void> {
    await saveOrganizationScopedEntity(this.table, board, 'ProjectBoard');
  }
}

export class DexieBoardColumnRepository implements BoardColumnRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<BoardColumn, BoardColumnId>(TRANSACTION_RESOURCES.BOARD_COLUMNS);
  }

  async findById(
    organizationId: OrganizationId,
    columnId: BoardColumnId,
  ): Promise<BoardColumn | null> {
    return findOrganizationScopedById(this.table, organizationId, columnId, 'BoardColumn');
  }

  async listByBoard(
    organizationId: OrganizationId,
    boardId: BoardId,
    options?: { readonly includeArchived?: boolean },
  ): Promise<readonly BoardColumn[]> {
    return withPersistenceErrorHandling('BoardColumn.listByBoard', async () => {
      const records = await this.table
        .where('[organizationId+boardId]')
        .equals([organizationId, boardId])
        .toArray();

      const filtered =
        options?.includeArchived === true
          ? records
          : records.filter((column) => column.archivedAt === undefined);

      return filtered.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }

  async save(column: BoardColumn): Promise<void> {
    await saveOrganizationScopedEntity(this.table, column, 'BoardColumn');
  }

  async saveMany(organizationId: OrganizationId, columns: readonly BoardColumn[]): Promise<void> {
    await saveManyOrganizationScopedEntities(this.table, organizationId, columns, 'BoardColumn');
  }

  async delete(organizationId: OrganizationId, columnId: BoardColumnId): Promise<void> {
    await deleteOrganizationScopedById(this.table, organizationId, columnId, 'BoardColumn');
  }
}
