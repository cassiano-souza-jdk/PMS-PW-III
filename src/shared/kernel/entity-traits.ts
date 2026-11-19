import { AuthorizationError, ValidationError } from '@/shared/errors';
import type { OrganizationId, UserId } from './identifiers';
import type { IsoDateTime } from './temporal';

export interface OrganizationScoped {
  readonly organizationId: OrganizationId;
}

export interface AuditableTimestamps {
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface SoftDeletable {
  readonly deletedAt?: IsoDateTime;
  readonly deletedBy?: UserId;
  readonly deletionReason?: string;
}

export interface PaginationParams {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginatedResult<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export function isSoftDeleted(entity: SoftDeletable): boolean {
  return entity.deletedAt !== undefined;
}

export function assertValidPaginationParams(params: PaginationParams): void {
  if (!Number.isInteger(params.page) || params.page < 1) {
    throw new ValidationError('Pagination "page" must be an integer >= 1.', {
      details: { field: 'page' },
    });
  }

  if (!Number.isInteger(params.pageSize) || params.pageSize < 1) {
    throw new ValidationError('Pagination "pageSize" must be an integer >= 1.', {
      details: { field: 'pageSize' },
    });
  }
}

export function createPaginatedResult<TItem>(
  items: readonly TItem[],
  total: number,
  params: PaginationParams,
): PaginatedResult<TItem> {
  assertValidPaginationParams(params);

  if (!Number.isInteger(total) || total < 0) {
    throw new ValidationError('Pagination "total" must be an integer >= 0.', {
      details: { field: 'total' },
    });
  }

  return Object.freeze({
    items: Object.freeze([...items]),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize),
  });
}

/**
 * Enforces strict multi-organization isolation (DOMAIN.md / permission-matrix.md §8).
 * Throws AuthorizationError when a resource belongs to a different organization.
 */
export function assertSameOrganization(
  expectedOrganizationId: OrganizationId,
  actualOrganizationId: OrganizationId,
  resourceLabel = 'resource',
): void {
  if (expectedOrganizationId !== actualOrganizationId) {
    throw new AuthorizationError(
      `Cross-organization access or relation is forbidden for "${resourceLabel}".`,
      {
        details: { resource: resourceLabel },
      },
    );
  }
}
