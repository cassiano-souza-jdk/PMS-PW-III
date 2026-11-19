import type { OrganizationId, ProjectId, TeamId, UserId } from '@/shared/kernel';
import type { Project, ProjectMember } from '../../domain/project';

export interface ProjectRepositoryPort {
  findById(organizationId: OrganizationId, projectId: ProjectId): Promise<Project | null>;
  listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeArchived?: boolean; readonly includeDeleted?: boolean },
  ): Promise<readonly Project[]>;
  listByTeam(organizationId: OrganizationId, teamId: TeamId): Promise<readonly Project[]>;
  save(project: Project): Promise<void>;
}

export interface ProjectMemberRepositoryPort {
  findByProjectAndUser(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Promise<ProjectMember | null>;
  listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly ProjectMember[]>;
  listByUser(organizationId: OrganizationId, userId: UserId): Promise<readonly ProjectMember[]>;
  save(member: ProjectMember): Promise<void>;
}
