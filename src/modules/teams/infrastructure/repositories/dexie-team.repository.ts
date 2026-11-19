import {
  TRANSACTION_RESOURCES,
  type OrganizationId,
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
  TeamMemberRepositoryPort,
  TeamRepositoryPort,
} from '../../application/ports/team-repository.port';
import type { Team, TeamMember, TeamMemberId } from '../../domain/team';

export class DexieTeamRepository implements TeamRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Team, TeamId>(TRANSACTION_RESOURCES.TEAMS);
  }

  async findById(organizationId: OrganizationId, teamId: TeamId): Promise<Team | null> {
    return findOrganizationScopedById(this.table, organizationId, teamId, 'Team');
  }

  async listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeArchived?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly Team[]> {
    return withPersistenceErrorHandling('Team.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      const afterSoftDelete = filterSoftDeleted(records, options?.includeDeleted);
      const filtered =
        options?.includeArchived === true
          ? afterSoftDelete
          : afterSoftDelete.filter((team) => team.archivedAt === undefined);

      return filtered.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async save(team: Team): Promise<void> {
    await saveOrganizationScopedEntity(this.table, team, 'Team');
  }
}

export class DexieTeamMemberRepository implements TeamMemberRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TeamMember, TeamMemberId>(TRANSACTION_RESOURCES.TEAM_MEMBERS);
  }

  async findByTeamAndUser(
    organizationId: OrganizationId,
    teamId: TeamId,
    userId: UserId,
  ): Promise<TeamMember | null> {
    return withPersistenceErrorHandling('TeamMember.findByTeamAndUser', async () => {
      const record = await this.table
        .where('[organizationId+teamId+userId]')
        .equals([organizationId, teamId, userId])
        .first();
      return record ?? null;
    });
  }

  async listByTeam(organizationId: OrganizationId, teamId: TeamId): Promise<readonly TeamMember[]> {
    return withPersistenceErrorHandling('TeamMember.listByTeam', async () => {
      return this.table.where('[organizationId+teamId]').equals([organizationId, teamId]).toArray();
    });
  }

  async listByUser(organizationId: OrganizationId, userId: UserId): Promise<readonly TeamMember[]> {
    return withPersistenceErrorHandling('TeamMember.listByUser', async () => {
      return this.table.where('[organizationId+userId]').equals([organizationId, userId]).toArray();
    });
  }

  async save(member: TeamMember): Promise<void> {
    await saveOrganizationScopedEntity(this.table, member, 'TeamMember');
  }
}
