import type { OrganizationId, ProjectId, UserId } from '@/shared/kernel';
import type { DashboardPreference, DashboardScope } from '../../domain/analytics';

export interface DashboardPreferenceRepositoryPort {
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
  save(preference: DashboardPreference): Promise<void>;
}
