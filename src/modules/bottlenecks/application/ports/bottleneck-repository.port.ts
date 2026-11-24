import type { OrganizationId, ProjectId } from '@/shared/kernel';
import type {
  BottleneckAlert,
  BottleneckAlertId,
  BottleneckAlertStatus,
} from '../../domain/bottleneck';

export interface BottleneckAlertRepositoryPort {
  findById(
    organizationId: OrganizationId,
    alertId: BottleneckAlertId,
  ): Promise<BottleneckAlert | null>;
  findActiveByDeduplicationKey(
    organizationId: OrganizationId,
    deduplicationKey: string,
  ): Promise<BottleneckAlert | null>;
  listByOrganization(
    organizationId: OrganizationId,
    options?: {
      readonly projectId?: ProjectId;
      readonly status?: BottleneckAlertStatus;
    },
  ): Promise<readonly BottleneckAlert[]>;
  listActiveByOrganization(
    organizationId: OrganizationId,
    options?: {
      readonly projectId?: ProjectId;
    },
  ): Promise<readonly BottleneckAlert[]>;
  save(alert: BottleneckAlert): Promise<void>;
  saveMany(organizationId: OrganizationId, alerts: readonly BottleneckAlert[]): Promise<void>;
}
