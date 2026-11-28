import type { OrganizationId, ProjectId, UserId } from '@/shared/kernel';
import type {
  DashboardPreference,
  DashboardPreferenceId,
  DashboardScope,
} from '../../domain/analytics';

/**
 * Persistence port for individual dashboard preferences (ADR-0014 §5, DN-04).
 *
 * `save` enforces logical uniqueness per `(organizationId, userId, scope, projectId)` on top of the
 * preserved Dexie `v2` schema: when a preference already exists for the same key, its `existing.id`
 * is reused so a user never accumulates duplicated dashboards for the same scope.
 */
export interface DashboardPreferenceRepositoryPort {
  findById(
    organizationId: OrganizationId,
    preferenceId: DashboardPreferenceId,
  ): Promise<DashboardPreference | null>;
  findByUserAndScope(
    organizationId: OrganizationId,
    userId: UserId,
    scope: DashboardScope,
    projectId?: ProjectId,
  ): Promise<DashboardPreference | null>;
  listByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly DashboardPreference[]>;
  save(preference: DashboardPreference): Promise<DashboardPreference>;
  delete(organizationId: OrganizationId, preferenceId: DashboardPreferenceId): Promise<void>;
}
