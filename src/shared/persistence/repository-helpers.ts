import type { Table } from 'dexie';
import {
  assertSameOrganization,
  isSoftDeleted,
  type OrganizationId,
  type OrganizationScoped,
  type SoftDeletable,
} from '@/shared/kernel';
import { withPersistenceErrorHandling } from './quota-error';

/**
 * Saves an organization-scoped entity with strict cross-organization collision protection (ADR-0007 §4.1).
 *
 * If an entity with the same primary key (`entity.id`) already exists in the table and belongs to a different
 * `organizationId`, `assertSameOrganization` throws `AuthorizationError` (`APP_ERROR_CODES.AUTHORIZATION_ERROR`)
 * before `table.put(entity)` can overwrite it.
 */
export async function saveOrganizationScopedEntity<
  TEntity extends OrganizationScoped & { readonly id: TId },
  TId extends string = TEntity['id'],
>(table: Table<TEntity, TId, TEntity>, entity: TEntity, resourceLabel: string): Promise<void> {
  await withPersistenceErrorHandling(`${resourceLabel}.save`, async () => {
    const existing = await table.get(entity.id);
    if (existing !== undefined) {
      assertSameOrganization(existing.organizationId, entity.organizationId, resourceLabel);
    }

    await table.put(entity);
  });
}

/**
 * Bulk-saves multiple organization-scoped entities for a single `organizationId` with cross-tenant guard
 * (ADR-0007 §4.1).
 *
 * Validates that every item in `entities` matches `organizationId` and checks pre-existing primary keys
 * via `table.bulkGet(...)` before executing `table.bulkPut(entities)`.
 */
export async function saveManyOrganizationScopedEntities<
  TEntity extends OrganizationScoped & { readonly id: TId },
  TId extends string = TEntity['id'],
>(
  table: Table<TEntity, TId, TEntity>,
  organizationId: OrganizationId,
  entities: readonly TEntity[],
  resourceLabel: string,
): Promise<void> {
  if (entities.length === 0) {
    return;
  }

  for (const entity of entities) {
    assertSameOrganization(organizationId, entity.organizationId, resourceLabel);
  }

  await withPersistenceErrorHandling(`${resourceLabel}.saveMany`, async () => {
    const ids = entities.map((entity) => entity.id);
    const existingRecords = await table.bulkGet(ids);

    for (const existing of existingRecords) {
      if (existing !== undefined) {
        assertSameOrganization(existing.organizationId, organizationId, resourceLabel);
      }
    }

    await table.bulkPut(entities);
  });
}

/**
 * Appends an immutable record using strictly `table.add(entity)` (insert-only — ADR-0007 §4.2).
 *
 * Never overwrites existing history (`auditEvents`, `maintenanceEvents`, `feedbackMessages`,
 * `feedbackInternalNotes`, `feedbackContestAnalyses`, `feedbackContestDecisions`, `taskDeadlineHistory`,
 * version stores, and SLA snapshots). Any duplicate ID triggers a Dexie `ConstraintError`, which
 * `withPersistenceErrorHandling` translates into `ConflictError` (`APP_ERROR_CODES.CONFLICT`).
 */
export async function appendImmutableEntity<
  TEntity extends OrganizationScoped & { readonly id: TId },
  TId extends string = TEntity['id'],
>(table: Table<TEntity, TId, TEntity>, entity: TEntity, resourceLabel: string): Promise<void> {
  await withPersistenceErrorHandling(`${resourceLabel}.append`, async () => {
    await table.add(entity);
  });
}

/**
 * Finds an organization-scoped entity by primary key while enforcing strict multi-organization isolation
 * (ADR-0007 §4.1, §4.3).
 *
 * Returns `null` if the record does not exist OR if `record.organizationId !== organizationId`,
 * ensuring cross-tenant data is never leaked. Soft-deleted records of the same organization ARE returned
 * by `findById` so callers can inspect `DENIED_RESOURCE_DELETED`, Trash views, and restore workflows.
 */
export async function findOrganizationScopedById<
  TEntity extends OrganizationScoped,
  TId extends string = string,
>(
  table: Table<TEntity, TId, TEntity>,
  organizationId: OrganizationId,
  id: TId,
  resourceLabel = 'OrganizationScopedEntity',
): Promise<TEntity | null> {
  return withPersistenceErrorHandling(`${resourceLabel}.findById`, async () => {
    const record = await table.get(id);
    if (record === undefined || record.organizationId !== organizationId) {
      return null;
    }

    return record;
  });
}

/**
 * Deletes an organization-scoped entity by primary key only when it belongs to `organizationId`.
 * Throws `AuthorizationError` if the target primary key belongs to a different organization.
 */
export async function deleteOrganizationScopedById<
  TEntity extends OrganizationScoped,
  TId extends string = string,
>(
  table: Table<TEntity, TId, TEntity>,
  organizationId: OrganizationId,
  id: TId,
  resourceLabel: string,
): Promise<void> {
  await withPersistenceErrorHandling(`${resourceLabel}.delete`, async () => {
    const existing = await table.get(id);
    if (existing === undefined) {
      return;
    }

    assertSameOrganization(organizationId, existing.organizationId, resourceLabel);
    await table.delete(id);
  });
}

/**
 * Filters a collection of `SoftDeletable` entities (ADR-0007 §4.3):
 * omits logically deleted records (`isSoftDeleted(item) === true`) unless `includeDeleted === true`.
 */
export function filterSoftDeleted<TEntity extends SoftDeletable>(
  items: readonly TEntity[],
  includeDeleted = false,
): TEntity[] {
  if (includeDeleted) {
    return [...items];
  }

  return items.filter((item) => !isSoftDeleted(item));
}
