import type { ImpedimentId, OrganizationId, ProjectId, TaskId } from '@/shared/kernel';
import type { Impediment } from '../../domain/impediment';

export interface ImpedimentRepositoryPort {
  findById(organizationId: OrganizationId, impedimentId: ImpedimentId): Promise<Impediment | null>;
  listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly Impediment[]>;
  listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly Impediment[]>;
  listOpenByOrganization(organizationId: OrganizationId): Promise<readonly Impediment[]>;
  save(impediment: Impediment): Promise<void>;
}
