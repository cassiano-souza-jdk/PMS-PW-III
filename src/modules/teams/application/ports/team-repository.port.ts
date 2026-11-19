import type { OrganizationId, TeamId, UserId } from '@/shared/kernel';
import type { Team, TeamMember } from '../../domain/team';

export interface TeamRepositoryPort {
  findById(organizationId: OrganizationId, teamId: TeamId): Promise<Team | null>;
  listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeArchived?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly Team[]>;
  save(team: Team): Promise<void>;
}

export interface TeamMemberRepositoryPort {
  findByTeamAndUser(
    organizationId: OrganizationId,
    teamId: TeamId,
    userId: UserId,
  ): Promise<TeamMember | null>;
  listByTeam(organizationId: OrganizationId, teamId: TeamId): Promise<readonly TeamMember[]>;
  listByUser(organizationId: OrganizationId, userId: UserId): Promise<readonly TeamMember[]>;
  save(member: TeamMember): Promise<void>;
}
