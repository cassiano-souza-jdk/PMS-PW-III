import { Dexie, type Transaction } from 'dexie';
import {
  createDomainEvent,
  type DomainEventEnvelope,
  type DomainEventPublisherPort,
} from '@/shared/kernel';

export type DomainEventSubscriber = (event: DomainEventEnvelope) => void | Promise<void>;

/**
 * Resolves the root Dexie transaction for any nested/reentrant transaction.
 */
export function resolveRootDexieTransaction(
  transaction: Transaction | null | undefined,
): Transaction | null {
  if (!transaction) {
    return null;
  }

  let current: Transaction = transaction;
  while (current.parent !== undefined) {
    current = current.parent;
  }

  return current;
}

/**
 * Post-commit domain event bus implementing `DomainEventPublisherPort` (ADR-0007 §3.2, PRD.md §16/§24).
 *
 * Invariants:
 * - Validates every event envelope synchronously via `createDomainEvent`.
 * - When called inside an active root transaction managed by `DexieTransactionAdapter`,
 *   events are queued synchronously in memory (zero external I/O, zero `PrematureCommitError` risk).
 * - Queued events are drained in FIFO order ONLY after the root Dexie transaction commits.
 * - If the root transaction fails or rolls back, the transaction buffer is discarded without notifying subscribers.
 * - When called outside of any managed transaction, events are dispatched immediately to subscribers.
 */
export class PostCommitDomainEventBus implements DomainEventPublisherPort {
  private readonly subscribers = new Set<DomainEventSubscriber>();
  private readonly transactionBuffers = new Map<Transaction, DomainEventEnvelope[]>();
  private readonly dispatchedHistory: DomainEventEnvelope[] = [];

  subscribe(subscriber: DomainEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * Registers an in-memory event buffer for a root Dexie transaction.
   * Called internally by `DexieTransactionAdapter`.
   */
  beginTransactionBuffer(rootTransaction: Transaction): void {
    const resolvedRoot = resolveRootDexieTransaction(rootTransaction) ?? rootTransaction;
    if (!this.transactionBuffers.has(resolvedRoot)) {
      this.transactionBuffers.set(resolvedRoot, []);
    }
  }

  /**
   * Checks whether `transaction` (or its root parent) already has an active post-commit buffer.
   */
  hasActiveTransactionBuffer(transaction: Transaction | null | undefined): boolean {
    const root = resolveRootDexieTransaction(transaction);
    return root !== null && this.transactionBuffers.has(root);
  }

  /**
   * Discards the buffered events for a failed/aborted root transaction without notifying any subscriber.
   */
  discardTransactionBuffer(rootTransaction: Transaction): void {
    const resolvedRoot = resolveRootDexieTransaction(rootTransaction) ?? rootTransaction;
    this.transactionBuffers.delete(resolvedRoot);
  }

  /**
   * Drains and dispatches all events buffered during `rootTransaction` in strict FIFO order.
   * Must be called ONLY after the root `db.transaction(...)` Promise has resolved.
   */
  async flushTransactionBuffer(rootTransaction: Transaction): Promise<void> {
    const resolvedRoot = resolveRootDexieTransaction(rootTransaction) ?? rootTransaction;
    const buffer = this.transactionBuffers.get(resolvedRoot);
    this.transactionBuffers.delete(resolvedRoot);

    if (!buffer || buffer.length === 0) {
      return;
    }

    await this.dispatchEventsSequentially(buffer);
  }

  publish(event: DomainEventEnvelope): Promise<void> {
    const validated = createDomainEvent(event);
    const activeBuffer = this.getActiveTransactionBuffer();

    if (activeBuffer !== null) {
      activeBuffer.push(validated);
      return Promise.resolve();
    }

    return this.dispatchEventsSequentially([validated]);
  }

  publishMany(events: readonly DomainEventEnvelope[]): Promise<void> {
    if (events.length === 0) {
      return Promise.resolve();
    }

    const validatedEvents = events.map((event) => createDomainEvent(event));
    const activeBuffer = this.getActiveTransactionBuffer();

    if (activeBuffer !== null) {
      activeBuffer.push(...validatedEvents);
      return Promise.resolve();
    }

    return this.dispatchEventsSequentially(validatedEvents);
  }

  /**
   * Returns a read-only snapshot of all events that have been effectively dispatched (post-commit).
   */
  getDispatchedEvents(): readonly DomainEventEnvelope[] {
    return Object.freeze([...this.dispatchedHistory]);
  }

  clearDispatchedHistory(): void {
    this.dispatchedHistory.length = 0;
  }

  private getActiveTransactionBuffer(): DomainEventEnvelope[] | null {
    const currentTx = Dexie.currentTransaction;
    if (!currentTx || !currentTx.active) {
      return null;
    }

    const rootTx = resolveRootDexieTransaction(currentTx);
    if (!rootTx) {
      return null;
    }

    return this.transactionBuffers.get(rootTx) ?? null;
  }

  private async dispatchEventsSequentially(events: readonly DomainEventEnvelope[]): Promise<void> {
    const activeSubscribers = [...this.subscribers];

    for (const event of events) {
      this.dispatchedHistory.push(event);
      for (const subscriber of activeSubscribers) {
        await subscriber(event);
      }
    }
  }
}
