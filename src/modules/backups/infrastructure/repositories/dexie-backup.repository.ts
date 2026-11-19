import {
  TRANSACTION_RESOURCES,
  assertSameOrganization,
  parseIsoDateTimeMs,
  type BackupId,
  type OrganizationId,
} from '@/shared/kernel';
import {
  AUXILIARY_TABLES,
  findOrganizationScopedById,
  withPersistenceErrorHandling,
  type BackupPayloadRecord,
  type PmsDatabase,
} from '@/shared/persistence';
import type { BackupRepositoryPort } from '../../application/ports/backup-repository.port';
import type { Backup, BackupKind } from '../../domain/backup';

export class DexieBackupRepository implements BackupRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get backupTable() {
    return this.db.getTable<Backup, BackupId>(TRANSACTION_RESOURCES.BACKUPS);
  }

  private get payloadTable() {
    return this.db.getTable<BackupPayloadRecord, BackupId>(AUXILIARY_TABLES.BACKUP_PAYLOADS);
  }

  async findById(organizationId: OrganizationId, backupId: BackupId): Promise<Backup | null> {
    return findOrganizationScopedById(this.backupTable, organizationId, backupId, 'Backup');
  }

  async listByOrganization(
    organizationId: OrganizationId,
    kind?: BackupKind,
  ): Promise<readonly Backup[]> {
    return withPersistenceErrorHandling('Backup.listByOrganization', async () => {
      const records = await this.backupTable
        .where('organizationId')
        .equals(organizationId)
        .toArray();

      const filtered = kind !== undefined ? records.filter((item) => item.kind === kind) : records;

      return filtered.sort(
        (a, b) =>
          parseIsoDateTimeMs(b.createdAt) - parseIsoDateTimeMs(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(backup: Backup, payloadJson: string): Promise<void> {
    await withPersistenceErrorHandling('Backup.save', async () => {
      await this.db.transaction('rw', [this.backupTable, this.payloadTable], async () => {
        const existingBackup = await this.backupTable.get(backup.id);
        if (existingBackup !== undefined) {
          assertSameOrganization(existingBackup.organizationId, backup.organizationId, 'Backup');
        }

        const existingPayload = await this.payloadTable.get(backup.id);
        if (existingPayload !== undefined) {
          assertSameOrganization(
            existingPayload.organizationId,
            backup.organizationId,
            'BackupPayload',
          );
        }

        await this.backupTable.put(backup);
        await this.payloadTable.put({
          backupId: backup.id,
          organizationId: backup.organizationId,
          payloadJson,
        });
      });
    });
  }

  async getPayloadJson(organizationId: OrganizationId, backupId: BackupId): Promise<string | null> {
    return withPersistenceErrorHandling('Backup.getPayloadJson', async () => {
      const record = await this.payloadTable.get(backupId);
      if (record === undefined || record.organizationId !== organizationId) {
        return null;
      }

      return record.payloadJson;
    });
  }

  async delete(organizationId: OrganizationId, backupId: BackupId): Promise<void> {
    await withPersistenceErrorHandling('Backup.delete', async () => {
      await this.db.transaction('rw', [this.backupTable, this.payloadTable], async () => {
        const existingBackup = await this.backupTable.get(backupId);
        if (existingBackup !== undefined) {
          assertSameOrganization(organizationId, existingBackup.organizationId, 'Backup');
        }

        const existingPayload = await this.payloadTable.get(backupId);
        if (existingPayload !== undefined) {
          assertSameOrganization(organizationId, existingPayload.organizationId, 'BackupPayload');
        }

        if (existingBackup === undefined && existingPayload === undefined) {
          return;
        }

        await this.backupTable.delete(backupId);
        await this.payloadTable.delete(backupId);
      });
    });
  }
}
