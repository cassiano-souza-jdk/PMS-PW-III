import {
  parseBrandedUuid,
  type BackupId,
  type Brand,
  type IsoDateTime,
  type OrganizationScoped,
  type UserId,
} from '@/shared/kernel';

export type MaintenanceEventId = Brand<string, 'MaintenanceEventId'>;

export function asMaintenanceEventId(
  value: string,
  fieldName = 'maintenanceEventId',
): MaintenanceEventId {
  return parseBrandedUuid<'MaintenanceEventId'>(value, fieldName);
}

export const DEMO_SEED_VERSION = '1.0.0' as const;

export const MAINTENANCE_ACTIONS = {
  SEED: 'SEED',
  RESET: 'RESET',
  RESTORE: 'RESTORE',
  ROLLBACK: 'ROLLBACK',
} as const;

export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[keyof typeof MAINTENANCE_ACTIONS];

export const MAINTENANCE_STATUSES = {
  SUCCESS: 'SUCCESS',
  ROLLED_BACK: 'ROLLED_BACK',
  FAILED: 'FAILED',
} as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[keyof typeof MAINTENANCE_STATUSES];

/**
 * Independent, permanent maintenance history for the isolated demo organization (PRD.md §18).
 * Maintenance operations require separate `demo.maintenance.*` permissions not inherited from ADMIN/MANAGER.
 */
export interface MaintenanceEvent extends OrganizationScoped {
  readonly id: MaintenanceEventId;
  readonly action: MaintenanceAction;
  readonly performedByUserId: UserId;
  readonly backupId?: BackupId;
  readonly status: MaintenanceStatus;
  readonly details: string;
  readonly occurredAt: IsoDateTime;
}
