import type { BoardColumnId, BoardId, OrganizationId, ProjectId } from '@/shared/kernel';
import type { BoardColumn, ProjectBoard } from '../../domain/board';

export interface ProjectBoardRepositoryPort {
  findById(organizationId: OrganizationId, boardId: BoardId): Promise<ProjectBoard | null>;
  findPrimaryByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ProjectBoard | null>;
  save(board: ProjectBoard): Promise<void>;
}

export interface BoardColumnRepositoryPort {
  findById(organizationId: OrganizationId, columnId: BoardColumnId): Promise<BoardColumn | null>;
  listByBoard(
    organizationId: OrganizationId,
    boardId: BoardId,
    options?: { readonly includeArchived?: boolean },
  ): Promise<readonly BoardColumn[]>;
  save(column: BoardColumn): Promise<void>;
  saveMany(columns: readonly BoardColumn[]): Promise<void>;
  delete(organizationId: OrganizationId, columnId: BoardColumnId): Promise<void>;
}
