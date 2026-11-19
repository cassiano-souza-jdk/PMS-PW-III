import type { OrganizationId, UserId } from '@/shared/kernel';
import type { Organization, OrganizationMember } from '../../domain/organization';

export interface OrganizationRepositoryPort {
  findById(organizationId: OrganizationId): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  listByIds(organizationIds: readonly OrganizationId[]): Promise<readonly Organization[]>;
  save(organization: Organization): Promise<void>;
}

export interface OrganizationMemberRepositoryPort {
  findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMember | null>;
  listByOrganization(organizationId: OrganizationId): Promise<readonly OrganizationMember[]>;
  /**
   * Restricted exclusively to resolving the authenticated actor's own organization memberships
   * (e.g., organization selector and session context bootstrap — PRD.md §5).
   */
  listByUser(userId: UserId): Promise<readonly OrganizationMember[]>;
  save(member: OrganizationMember): Promise<void>;
}
