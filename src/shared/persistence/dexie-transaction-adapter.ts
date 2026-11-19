import { Dexie, type Table, type Transaction } from 'dexie';
import { ValidationError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  type TransactionPort,
  type TransactionResource,
} from '@/shared/kernel';
import { AUXILIARY_TABLES, type PmsDatabase, type PmsTableName } from './pms-database';
import {
  resolveRootDexieTransaction,
  type PostCommitDomainEventBus,
} from './post-commit-event-bus';
import { withPersistenceErrorHandling } from './quota-error';

/**
 * Expands logical `TransactionResource` names into physical Dexie table names (ADR-0007 §3.1).
 * Automatically includes `'backupPayloads'` whenever `TRANSACTION_RESOURCES.BACKUPS` is requested.
 */
export function expandTransactionTableNames(
  resources: readonly TransactionResource[],
): readonly PmsTableName[] {
  if (resources.length === 0) {
    throw new ValidationError(
      'TransactionPort.run requires at least one declarative TransactionResource.',
      {
        details: { field: 'resources' },
      },
    );
  }

  const expanded = new Set<PmsTableName>();
  for (const resource of resources) {
    expanded.add(resource);
    if (resource === TRANSACTION_RESOURCES.BACKUPS) {
      expanded.add(AUXILIARY_TABLES.BACKUP_PAYLOADS);
    }
  }

  return Object.freeze([...expanded]);
}

function isReentrantCompatibleTransaction(
  db: PmsDatabase,
  currentTx: Transaction | null | undefined,
  requiredTableNames: readonly PmsTableName[],
  eventBus?: PostCommitDomainEventBus,
): boolean {
  if (!currentTx || !currentTx.active || currentTx.db !== db) {
    return false;
  }

  if (currentTx.mode !== 'readwrite') {
    return false;
  }

  if (eventBus !== undefined && !eventBus.hasActiveTransactionBuffer(currentTx)) {
    return false;
  }

  const activeStoreSet = new Set<string>(currentTx.storeNames);
  return requiredTableNames.every((tableName) => activeStoreSet.has(tableName));
}

/**
 * Dexie v4 implementation of `TransactionPort` coordinated with `PostCommitDomainEventBus` (ADR-0007 §3).
 *
 * Features:
 * - Validates non-empty `resources` and expands `BACKUPS` with `backupPayloads`.
 * - Supports safe reentrancy when nested `run()` calls request a subset of an active root transaction's stores,
 *   accumulating domain events in the root transaction buffer.
 * - Flushes buffered domain events in FIFO order strictly after the root IndexedDB transaction commits.
 * - Discards buffered domain events if the root transaction fails or rolls back.
 */
export class DexieTransactionAdapter implements TransactionPort {
  private readonly db: PmsDatabase;
  private readonly eventBus?: PostCommitDomainEventBus;

  constructor(db: PmsDatabase, eventBus?: PostCommitDomainEventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  async run<TResult>(
    resources: readonly TransactionResource[],
    work: () => Promise<TResult>,
  ): Promise<TResult> {
    const tableNames = expandTransactionTableNames(resources);
    const currentTx = Dexie.currentTransaction;

    if (isReentrantCompatibleTransaction(this.db, currentTx, tableNames, this.eventBus)) {
      return withPersistenceErrorHandling('DexieTransactionAdapter.run(reentrant)', work);
    }

    const tables: readonly Table[] = tableNames.map((tableName) => this.db.table(tableName));
    let rootTransaction: Transaction | null = null;

    const result = await withPersistenceErrorHandling('DexieTransactionAdapter.run', async () => {
      try {
        return await this.db.transaction('rw', tables, async (tx) => {
          rootTransaction = resolveRootDexieTransaction(tx) ?? tx;
          this.eventBus?.beginTransactionBuffer(rootTransaction);
          return await work();
        });
      } catch (error: unknown) {
        if (rootTransaction !== null) {
          this.eventBus?.discardTransactionBuffer(rootTransaction);
        }
        throw error;
      }
    });

    if (rootTransaction !== null && this.eventBus !== undefined) {
      await this.eventBus.flushTransactionBuffer(rootTransaction);
    }

    return result;
  }
}
