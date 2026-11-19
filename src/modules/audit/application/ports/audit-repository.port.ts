import type {
  DateRange,
  OrganizationId,
  PaginatedResult,
  PaginationParams,
  ProjectId,
} from '@/shared/kernel';
import type { AuditCategory, AuditEvent, AuditResult } from '../../domain/audit-event';

export interface AuditQueryFilters {
  readonly category?: AuditCategory;
  readonly result?: AuditResult;
  readonly dateRange?: DateRange;
}

/**
 * Append-only audit repository port (PRD.md §17 / DOMAIN.md):
 * intentionally exposes no update or delete methods.
 */
export interface AuditEventRepositoryPort {
  append(event: AuditEvent): Promise<void>;
  listByOrganization(
    organizationId: OrganizationId,
    pagination: PaginationParams,
    filters?: AuditQueryFilters,
  ): Promise<PaginatedResult<AuditEvent>>;
  listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
    pagination: PaginationParams,
    filters?: AuditQueryFilters,
  ): Promise<PaginatedResult<AuditEvent>>;
}
