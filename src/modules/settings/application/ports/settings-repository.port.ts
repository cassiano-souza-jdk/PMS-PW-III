import type { OrganizationId } from '@/shared/kernel';
import type { OrganizationSettings } from '../../domain/organization-settings';

export interface OrganizationSettingsRepositoryPort {
  findByOrganization(organizationId: OrganizationId): Promise<OrganizationSettings | null>;
  save(settings: OrganizationSettings): Promise<void>;
}
