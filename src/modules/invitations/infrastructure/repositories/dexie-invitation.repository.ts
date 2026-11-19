import { ConflictError } from '@/shared/errors';
import { TRANSACTION_RESOURCES, parseIsoDateTimeMs, type OrganizationId } from '@/shared/kernel';
import {
  findOrganizationScopedById,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { InvitationRepositoryPort } from '../../application/ports/invitation-repository.port';
import type { Invitation, InvitationId, InvitationStatus } from '../../domain/invitation';

export class DexieInvitationRepository implements InvitationRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Invitation, InvitationId>(TRANSACTION_RESOURCES.INVITATIONS);
  }

  async findById(
    organizationId: OrganizationId,
    invitationId: InvitationId,
  ): Promise<Invitation | null> {
    return findOrganizationScopedById(this.table, organizationId, invitationId, 'Invitation');
  }

  async findByCode(code: string): Promise<Invitation | null> {
    return withPersistenceErrorHandling('Invitation.findByCode', async () => {
      const normalizedCode = code.trim();
      if (normalizedCode.length === 0) {
        return null;
      }
      const record = await this.table.where('code').equals(normalizedCode).first();
      return record ?? null;
    });
  }

  async listByOrganization(
    organizationId: OrganizationId,
    status?: InvitationStatus,
  ): Promise<readonly Invitation[]> {
    return withPersistenceErrorHandling('Invitation.listByOrganization', async () => {
      const records =
        status !== undefined
          ? await this.table
              .where('[organizationId+status]')
              .equals([organizationId, status])
              .toArray()
          : await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) => parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt),
      );
    });
  }

  async save(invitation: Invitation): Promise<void> {
    await withPersistenceErrorHandling('Invitation.save', async () => {
      const existingByCode = await this.table.where('code').equals(invitation.code).first();
      if (existingByCode !== undefined && existingByCode.id !== invitation.id) {
        throw new ConflictError(`An invitation with code "${invitation.code}" already exists.`, {
          details: { field: 'code', code: invitation.code },
        });
      }
    });

    await saveOrganizationScopedEntity(this.table, invitation, 'Invitation');
  }
}
