import {
  TRANSACTION_RESOURCES,
  type OrganizationId,
  type ProjectId,
  type TeamId,
  type UserId,
} from '@/shared/kernel';
import {
  filterSoftDeleted,
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  ProjectMemberRepositoryPort,
  ProjectRepositoryPort,
} from '../../application/ports/project-repository.port';
import {
  PROJECT_STATUSES,
  type Project,
  type ProjectMember,
  type ProjectMemberId,
} from '../../domain/project';

export class DexieProjectRepository implements ProjectRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Project, ProjectId>(TRANSACTION_RESOURCES.PROJECTS);
  }

  async findById(organizationId: OrganizationId, projectId: ProjectId): Promise<Project | null> {
    return findOrganizationScopedById(this.table, organizationId, projectId, 'Project');
  }

  async listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeArchived?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly Project[]> {
    return withPersistenceErrorHandling('Project.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      const afterSoftDelete = filterSoftDeleted(records, options?.includeDeleted);
      const filtered =
        options?.includeArchived === true
          ? afterSoftDelete
          : afterSoftDelete.filter(
              (project) =>
                project.status !== PROJECT_STATUSES.ARCHIVED && project.archivedAt === undefined,
            );

      return filtered.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async listByTeam(organizationId: OrganizationId, teamId: TeamId): Promise<readonly Project[]> {
    return withPersistenceErrorHandling('Project.listByTeam', async () => {
      const records = await this.table
        .where('[organizationId+teamId]')
        .equals([organizationId, teamId])
        .toArray();

      return filterSoftDeleted(records).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async save(project: Project): Promise<void> {
    await saveOrganizationScopedEntity(this.table, project, 'Project');
  }
}

export class DexieProjectMemberRepository implements ProjectMemberRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<ProjectMember, ProjectMemberId>(TRANSACTION_RESOURCES.PROJECT_MEMBERS);
  }

  async findByProjectAndUser(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Promise<ProjectMember | null> {
    return withPersistenceErrorHandling('ProjectMember.findByProjectAndUser', async () => {
      const record = await this.table
        .where('[organizationId+projectId+userId]')
        .equals([organizationId, projectId, userId])
        .first();
      return record ?? null;
    });
  }

  async listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly ProjectMember[]> {
    return withPersistenceErrorHandling('ProjectMember.listByProject', async () => {
      return this.table
        .where('[organizationId+projectId]')
        .equals([organizationId, projectId])
        .toArray();
    });
  }

  async listByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly ProjectMember[]> {
    return withPersistenceErrorHandling('ProjectMember.listByUser', async () => {
      return this.table.where('[organizationId+userId]').equals([organizationId, userId]).toArray();
    });
  }

  async save(member: ProjectMember): Promise<void> {
    await saveOrganizationScopedEntity(this.table, member, 'ProjectMember');
  }
}
