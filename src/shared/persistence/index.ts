export {
  estimateStorageDiagnostic,
  isConstraintError,
  isQuotaExceededError,
  translateDexieError,
  withPersistenceErrorHandling,
  type StorageDiagnosticEstimate,
} from './quota-error';

export {
  AUXILIARY_TABLES,
  PMS_DATABASE_NAME,
  PMS_SCHEMA_V1_STORES,
  PMS_SCHEMA_V2_STORES,
  PMS_SCHEMA_VERSION,
  PmsDatabase,
  createPmsDatabase,
  ensureDatabaseOpen,
  type AuxiliaryTableName,
  type BackupPayloadRecord,
  type CreatePmsDatabaseOptions,
  type PmsTableName,
  type PmsV1TableName,
} from './pms-database';

export {
  PostCommitDomainEventBus,
  resolveRootDexieTransaction,
  type DomainEventSubscriber,
} from './post-commit-event-bus';

export { DexieTransactionAdapter, expandTransactionTableNames } from './dexie-transaction-adapter';

export { DexieAttachmentBlobStore } from './dexie-attachment-blob-store';

export {
  appendImmutableEntity,
  deleteOrganizationScopedById,
  filterSoftDeleted,
  findOrganizationScopedById,
  saveManyOrganizationScopedEntities,
  saveOrganizationScopedEntity,
} from './repository-helpers';
