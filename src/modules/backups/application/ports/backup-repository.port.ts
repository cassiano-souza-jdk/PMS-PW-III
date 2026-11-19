import type { BackupId, OrganizationId } from '@/shared/kernel';
import type { Backup, BackupKind } from '../../domain/backup';

export interface BackupRepositoryPort {
  findById(organizationId: OrganizationId, backupId: BackupId): Promise<Backup | null>;
  listByOrganization(organizationId: OrganizationId, kind?: BackupKind): Promise<readonly Backup[]>;
  save(backup: Backup, payloadJson: string): Promise<void>;
  getPayloadJson(organizationId: OrganizationId, backupId: BackupId): Promise<string | null>;
  delete(organizationId: OrganizationId, backupId: BackupId): Promise<void>;
}
