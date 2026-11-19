import type { OrganizationId } from '@/shared/kernel';
import type { MaintenanceEvent } from '../../domain/maintenance-event';

/**
 * Append-only repository port for independent demo maintenance history (PRD.md §18).
 */
export interface MaintenanceEventRepositoryPort {
  append(event: MaintenanceEvent): Promise<void>;
  listByOrganization(organizationId: OrganizationId): Promise<readonly MaintenanceEvent[]>;
}
