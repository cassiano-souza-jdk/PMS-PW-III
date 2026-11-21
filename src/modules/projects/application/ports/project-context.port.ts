import type {
  BoardColumnId,
  BoardId,
  IsoDateTime,
  OrganizationId,
  ProjectId,
  TeamId,
  UserId,
} from '@/shared/kernel';

export interface ProjectTeamSummary {
  readonly id: TeamId;
  readonly organizationId: OrganizationId;
  readonly name: string;
  readonly archivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
}

/**
 * Local lookup port allowing `ProjectService` to validate team state and resolve `managedTeamIds`
 * without importing `@/modules/teams` (preserving an acyclic DAG — ADR-0010 §3).
 */
export interface ProjectTeamLookupPort {
  findTeamById(organizationId: OrganizationId, teamId: TeamId): Promise<ProjectTeamSummary | null>;
  listManagedTeamIds(organizationId: OrganizationId, userId: UserId): Promise<readonly TeamId[]>;
  listTeamsForOrganization(organizationId: OrganizationId): Promise<readonly ProjectTeamSummary[]>;
}

export interface InitializePrimaryBoardInput {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly now: IsoDateTime;
  readonly nextUuid: () => string;
}

export interface ProjectBoardExportSummary {
  readonly id: BoardId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly isPrimary: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface BoardColumnExportSummary {
  readonly id: BoardColumnId;
  readonly organizationId: OrganizationId;
  readonly boardId: BoardId;
  readonly name: string;
  readonly columnRole: 'INITIAL' | 'OPERATIONAL' | 'FINAL';
  readonly order: number;
  readonly wipLimit: number | null;
  readonly archivedAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ProjectBoardExportResult {
  readonly board?: ProjectBoardExportSummary;
  readonly columns: readonly BoardColumnExportSummary[];
}

/**
 * Local initializer/read port allowing `ProjectService` to initialize the primary Kanban board
 * inside `createProject` and read board structure for `exportProjectData` without importing
 * `@/modules/kanban` (ADR-0010 §3).
 */
export interface ProjectBoardInitializerPort {
  initializePrimaryBoard(input: InitializePrimaryBoardInput): Promise<void>;
  findPrimaryBoardForExport?(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ProjectBoardExportResult>;
}
