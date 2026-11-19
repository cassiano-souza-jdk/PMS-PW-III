import { ConflictError } from '@/shared/errors';
import { TRANSACTION_RESOURCES, type OrganizationId, type UserId } from '@/shared/kernel';
import {
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  OrganizationMemberRepositoryPort,
  OrganizationRepositoryPort,
} from '../../application/ports/organization-repository.port';
import type {
  Organization,
  OrganizationMember,
  OrganizationMemberId,
} from '../../domain/organization';

export class DexieOrganizationRepository implements OrganizationRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Organization, OrganizationId>(TRANSACTION_RESOURCES.ORGANIZATIONS);
  }

  async findById(organizationId: OrganizationId): Promise<Organization | null> {
    return withPersistenceErrorHandling('Organization.findById', async () => {
      const record = await this.table.get(organizationId);
      return record ?? null;
    });
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return withPersistenceErrorHandling('Organization.findBySlug', async () => {
      const normalizedSlug = slug.trim().toLowerCase();
      if (normalizedSlug.length === 0) {
        return null;
      }
      const record = await this.table.where('slug').equals(normalizedSlug).first();
      return record ?? null;
    });
  }

  async listByIds(organizationIds: readonly OrganizationId[]): Promise<readonly Organization[]> {
    if (organizationIds.length === 0) {
      return [];
    }

    return withPersistenceErrorHandling('Organization.listByIds', async () => {
      const uniqueIds = [...new Set<OrganizationId>(organizationIds)];
      const records = await this.table.bulkGet(uniqueIds);
      return records.filter((record): record is Organization => record !== undefined);
    });
  }

  async save(organization: Organization): Promise<void> {
    const normalizedSlug = organization.slug.trim().toLowerCase();

    await withPersistenceErrorHandling('Organization.save', async () => {
      const existingBySlug = await this.table.where('slug').equals(normalizedSlug).first();
      if (existingBySlug !== undefined && existingBySlug.id !== organization.id) {
        throw new ConflictError(`An organization with slug "${normalizedSlug}" already exists.`, {
          details: { field: 'slug', slug: normalizedSlug },
        });
      }

      const recordToSave: Organization =
        organization.slug === normalizedSlug
          ? organization
          : {
              ...organization,
              slug: normalizedSlug,
            };

      await this.table.put(recordToSave);
    });
  }
}

export class DexieOrganizationMemberRepository implements OrganizationMemberRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<OrganizationMember, OrganizationMemberId>(
      TRANSACTION_RESOURCES.ORGANIZATION_MEMBERS,
    );
  }

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMember | null> {
    return withPersistenceErrorHandling(
      'OrganizationMember.findByOrganizationAndUser',
      async () => {
        const record = await this.table
          .where('[organizationId+userId]')
          .equals([organizationId, userId])
          .first();
        return record ?? null;
      },
    );
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly OrganizationMember[]> {
    return withPersistenceErrorHandling('OrganizationMember.listByOrganization', async () => {
      return this.table.where('organizationId').equals(organizationId).toArray();
    });
  }

  async listByUser(userId: UserId): Promise<readonly OrganizationMember[]> {
    return withPersistenceErrorHandling('OrganizationMember.listByUser', async () => {
      return this.table.where('userId').equals(userId).toArray();
    });
  }

  async save(member: OrganizationMember): Promise<void> {
    await saveOrganizationScopedEntity(this.table, member, 'OrganizationMember');
  }
}
