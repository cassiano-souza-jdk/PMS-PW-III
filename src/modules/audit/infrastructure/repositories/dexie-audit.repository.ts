import {
  TRANSACTION_RESOURCES,
  assertValidDateRange,
  assertValidPaginationParams,
  createPaginatedResult,
  parseIsoDateTimeMs,
  type AuditEventId,
  type OrganizationId,
  type PaginatedResult,
  type PaginationParams,
  type ProjectId,
} from '@/shared/kernel';
import {
  appendImmutableEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  AuditEventRepositoryPort,
  AuditQueryFilters,
} from '../../application/ports/audit-repository.port';
import type { AuditEvent } from '../../domain/audit-event';

function applyAuditFilters(
  events: readonly AuditEvent[],
  filters?: AuditQueryFilters,
): AuditEvent[] {
  if (!filters) {
    return [...events];
  }

  let startMs: number | undefined;
  let endMs: number | undefined;

  if (filters.dateRange !== undefined) {
    assertValidDateRange(filters.dateRange, 'dateRange');
    startMs = parseIsoDateTimeMs(filters.dateRange.start);
    endMs = parseIsoDateTimeMs(filters.dateRange.end);
  }

  return events.filter((event) => {
    if (filters.category !== undefined && event.category !== filters.category) {
      return false;
    }

    if (filters.result !== undefined && event.result !== filters.result) {
      return false;
    }

    if (startMs !== undefined && endMs !== undefined) {
      const occurredMs = parseIsoDateTimeMs(event.occurredAt);
      if (occurredMs < startMs || occurredMs > endMs) {
        return false;
      }
    }

    return true;
  });
}

export class DexieAuditEventRepository implements AuditEventRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<AuditEvent, AuditEventId>(TRANSACTION_RESOURCES.AUDIT_EVENTS);
  }

  async append(event: AuditEvent): Promise<void> {
    await appendImmutableEntity(this.table, event, 'AuditEvent');
  }

  async listByOrganization(
    organizationId: OrganizationId,
    pagination: PaginationParams,
    filters?: AuditQueryFilters,
  ): Promise<PaginatedResult<AuditEvent>> {
    assertValidPaginationParams(pagination);
    if (filters?.dateRange !== undefined) {
      assertValidDateRange(filters.dateRange, 'dateRange');
    }

    return withPersistenceErrorHandling('AuditEvent.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      const filtered = applyAuditFilters(records, filters);
      filtered.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.occurredAt) - parseIsoDateTimeMs(a.occurredAt) ||
          a.id.localeCompare(b.id),
      );

      const offset = (pagination.page - 1) * pagination.pageSize;
      const pageItems = filtered.slice(offset, offset + pagination.pageSize);
      return createPaginatedResult(pageItems, filtered.length, pagination);
    });
  }

  async listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
    pagination: PaginationParams,
    filters?: AuditQueryFilters,
  ): Promise<PaginatedResult<AuditEvent>> {
    assertValidPaginationParams(pagination);
    if (filters?.dateRange !== undefined) {
      assertValidDateRange(filters.dateRange, 'dateRange');
    }

    return withPersistenceErrorHandling('AuditEvent.listByProject', async () => {
      const records = await this.table
        .where('organizationId')
        .equals(organizationId)
        .filter((event) => event.projectId === projectId)
        .toArray();

      const filtered = applyAuditFilters(records, filters);
      filtered.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.occurredAt) - parseIsoDateTimeMs(a.occurredAt) ||
          a.id.localeCompare(b.id),
      );

      const offset = (pagination.page - 1) * pagination.pageSize;
      const pageItems = filtered.slice(offset, offset + pagination.pageSize);
      return createPaginatedResult(pageItems, filtered.length, pagination);
    });
  }
}
