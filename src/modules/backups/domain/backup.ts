import {
  assertSameOrganization,
  parseIsoDateTimeMs,
  type BackupId,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationScoped,
  type UserId,
} from '@/shared/kernel';

export const BACKUP_KINDS = {
  AUTO_DAILY: 'AUTO_DAILY',
  MANUAL: 'MANUAL',
  PRE_RESTORE: 'PRE_RESTORE',
} as const;

export type BackupKind = (typeof BACKUP_KINDS)[keyof typeof BACKUP_KINDS];

/** Retain the 7 latest automatic daily backups while preserving all manual backups (PRD.md §20, DATA-PERSISTENCE.md). */
export const MAX_AUTOMATIC_DAILY_BACKUPS = 7;

export interface Backup extends OrganizationScoped {
  readonly id: BackupId;
  readonly kind: BackupKind;
  readonly schemaVersion: number;
  readonly integrityHash: string;
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly createdAt: IsoDateTime;
  readonly createdByUserId: UserId;
}

export interface BackupExportEnvelope {
  readonly formatVersion: string;
  readonly schemaVersion: number;
  readonly organizationId: OrganizationId;
  readonly exportedAt: IsoDateTime;
  readonly integrityHash: string;
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly collections: Readonly<Record<string, readonly unknown[]>>;
}

/**
 * Selects only expired AUTO_DAILY backups beyond the retention limit (7).
 * Manual and pre-restore backups are NEVER selected for automatic pruning (PRD.md §20).
 */
export function selectExpiredAutoBackupsForRetention(
  backups: readonly Backup[],
  maxAutomaticToKeep = MAX_AUTOMATIC_DAILY_BACKUPS,
): readonly Backup[] {
  const autoBackups = backups
    .filter((backup) => backup.kind === BACKUP_KINDS.AUTO_DAILY)
    .sort((a, b) => parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt));

  if (autoBackups.length <= maxAutomaticToKeep) {
    return Object.freeze([]);
  }

  return Object.freeze(autoBackups.slice(maxAutomaticToKeep));
}

/**
 * Guarantees that a backup can never be restored into a different organization (PRD.md §20).
 */
export function assertBackupMatchesTargetOrganization(
  backup: Backup,
  targetOrganizationId: OrganizationId,
): void {
  assertSameOrganization(targetOrganizationId, backup.organizationId, 'backup');
}
