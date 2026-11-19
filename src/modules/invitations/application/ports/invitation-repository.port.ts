import type { OrganizationId } from '@/shared/kernel';
import type { Invitation, InvitationId, InvitationStatus } from '../../domain/invitation';

export interface InvitationRepositoryPort {
  findById(organizationId: OrganizationId, invitationId: InvitationId): Promise<Invitation | null>;
  /** Controlled lookup by invitation code for the acceptance workflow. */
  findByCode(code: string): Promise<Invitation | null>;
  listByOrganization(
    organizationId: OrganizationId,
    status?: InvitationStatus,
  ): Promise<readonly Invitation[]>;
  save(invitation: Invitation): Promise<void>;
}
