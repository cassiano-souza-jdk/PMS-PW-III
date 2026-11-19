import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_ERROR_CODES,
  AuthorizationError,
  InfrastructureError,
  ValidationError,
} from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  TRANSACTION_RESOURCES,
  asAttachmentId,
  asBackupId,
  asCorrelationId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asUserId,
  createDomainEvent,
  type DomainEventEnvelope,
} from '@/shared/kernel';
import {
  AUXILIARY_TABLES,
  DexieAttachmentBlobStore,
  DexieTransactionAdapter,
  PMS_DATABASE_NAME,
  PMS_SCHEMA_V1_STORES,
  PMS_SCHEMA_VERSION,
  PostCommitDomainEventBus,
  createPmsDatabase,
  ensureDatabaseOpen,
  expandTransactionTableNames,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from './index';

const ORG_A_ID = asOrganizationId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
const ORG_B_ID = asOrganizationId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
const ACTOR_USER_ID = asUserId('cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
const PROJECT_A_ID = asProjectId('dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
const PROJECT_B_ID = asProjectId('dddddddd-dddd-4ddd-8ddd-ddddddddddd2');
const BACKUP_A_ID = asBackupId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1');
const ATTACHMENT_A_ID = asAttachmentId('ffffffff-ffff-4fff-8fff-fffffffffff1');
const CORRELATION_ID = asCorrelationId('11111111-2222-4333-8444-555555555555');
const FIXED_NOW = asIsoDateTime('2026-02-01T10:00:00.000Z');

describe('PmsDatabase, DexieTransactionAdapter, PostCommitDomainEventBus & DexieAttachmentBlobStore Integration', () => {
  let idbFactory: IDBFactory;
  let db: PmsDatabase;

  beforeEach(async () => {
    idbFactory = new IDBFactory();
    db = createPmsDatabase({
      databaseName: `${PMS_DATABASE_NAME}_test_${crypto.randomUUID()}`,
      indexedDB: idbFactory,
      IDBKeyRange,
    });
    await ensureDatabaseOpen(db);
  });

  afterEach(async () => {
    if (db.isOpen()) {
      db.close();
    }
    await db.delete();
  });

  describe('Schema v1 e Inicialização Não-Destrutiva', () => {
    it('registra exatamente 50 tabelas físicas (49 TRANSACTION_RESOURCES + backupPayloads) na versão 1', () => {
      const resourceNames = Object.values(TRANSACTION_RESOURCES);
      expect(resourceNames).toHaveLength(49);

      const schemaTableKeys = Object.keys(PMS_SCHEMA_V1_STORES);
      expect(schemaTableKeys).toHaveLength(50);

      const physicalTableNames = db.tables.map((table) => table.name);
      expect(physicalTableNames).toHaveLength(50);
      expect(db.verno).toBe(PMS_SCHEMA_VERSION);

      for (const resource of resourceNames) {
        expect(physicalTableNames).toContain(resource);
      }
      expect(physicalTableNames).toContain(AUXILIARY_TABLES.BACKUP_PAYLOADS);
    });

    it('abre o banco de forma não-destrutiva e preserva dados existentes ao reabrir outra instância sobre o mesmo banco', async () => {
      const sharedDbName = `${PMS_DATABASE_NAME}_reopen_${crypto.randomUUID()}`;
      const firstInstance = createPmsDatabase({
        databaseName: sharedDbName,
        indexedDB: idbFactory,
        IDBKeyRange,
      });

      expect(firstInstance.isOpen()).toBe(false);
      await ensureDatabaseOpen(firstInstance);
      expect(firstInstance.isOpen()).toBe(true);

      await firstInstance.organizations.put({
        id: ORG_A_ID,
        name: 'Organizacao Persistida',
        slug: 'org-persistida',
        isDemo: false,
        createdByUserId: ACTOR_USER_ID,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      });

      firstInstance.close();
      expect(firstInstance.isOpen()).toBe(false);

      const secondInstance = createPmsDatabase({
        databaseName: sharedDbName,
        indexedDB: idbFactory,
        IDBKeyRange,
      });
      await ensureDatabaseOpen(secondInstance);

      const persistedRecord = await secondInstance.organizations.get(ORG_A_ID);
      expect(persistedRecord).toBeDefined();
      expect(persistedRecord?.name).toBe('Organizacao Persistida');
      expect(persistedRecord?.slug).toBe('org-persistida');

      secondInstance.close();
      await secondInstance.delete();
    });
  });

  describe('Transações Declarativas + Eventos Pós-Commit (DexieTransactionAdapter + PostCommitDomainEventBus)', () => {
    it('enfileira eventos durante a transação sem entregá-los antes do commit e despacha em ordem FIFO estritamente pós-commit', async () => {
      const eventBus = new PostCommitDomainEventBus();
      const transactionPort = new DexieTransactionAdapter(db, eventBus);

      const receivedEvents: DomainEventEnvelope[] = [];
      let subscriberSawPersistedProjectsCount = 0;

      eventBus.subscribe(async (event) => {
        receivedEvents.push(event);
        subscriberSawPersistedProjectsCount = await db.projects.count();
      });

      const event1 = createDomainEvent({
        eventId: asEventId('10000000-0000-4000-8000-000000000001'),
        eventType: 'project.created',
        occurredAt: FIXED_NOW,
        organizationId: ORG_A_ID,
        actorId: ACTOR_USER_ID,
        correlationId: CORRELATION_ID,
        aggregateType: 'Project',
        aggregateId: PROJECT_A_ID,
        payload: { step: 1 },
      });

      const event2 = createDomainEvent({
        eventId: asEventId('10000000-0000-4000-8000-000000000002'),
        eventType: 'project.updated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_A_ID,
        actorId: ACTOR_USER_ID,
        correlationId: CORRELATION_ID,
        aggregateType: 'Project',
        aggregateId: PROJECT_A_ID,
        payload: { step: 2 },
      });

      await transactionPort.run([TRANSACTION_RESOURCES.PROJECTS], async () => {
        await db.projects.put({
          id: PROJECT_A_ID,
          organizationId: ORG_A_ID,
          name: 'Projeto Transacional',
          status: 'ACTIVE',
          ownerUserId: ACTOR_USER_ID,
          inactivityThresholdDays: 7,
          createdByUserId: ACTOR_USER_ID,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
        });

        await eventBus.publish(event1);
        expect(receivedEvents).toHaveLength(0);
        expect(eventBus.getDispatchedEvents()).toHaveLength(0);

        await eventBus.publish(event2);
        expect(receivedEvents).toHaveLength(0);
      });

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]?.eventId).toBe(event1.eventId);
      expect(receivedEvents[1]?.eventId).toBe(event2.eventId);
      expect(subscriberSawPersistedProjectsCount).toBe(1);
      expect(eventBus.getDispatchedEvents()).toHaveLength(2);
    });

    it('reverte todas as escritas no IndexedDB e descarta todos os eventos enfileirados quando a transação falha (rollback)', async () => {
      const eventBus = new PostCommitDomainEventBus();
      const transactionPort = new DexieTransactionAdapter(db, eventBus);

      const receivedEvents: DomainEventEnvelope[] = [];
      eventBus.subscribe((event) => {
        receivedEvents.push(event);
      });

      await expect(
        transactionPort.run(
          [TRANSACTION_RESOURCES.ORGANIZATIONS, TRANSACTION_RESOURCES.PROJECTS],
          async () => {
            await db.organizations.put({
              id: ORG_A_ID,
              name: 'Org Rollback',
              slug: 'org-rollback',
              isDemo: false,
              createdByUserId: ACTOR_USER_ID,
              createdAt: FIXED_NOW,
              updatedAt: FIXED_NOW,
            });

            await db.projects.put({
              id: PROJECT_A_ID,
              organizationId: ORG_A_ID,
              name: 'Project Rollback',
              status: 'ACTIVE',
              ownerUserId: ACTOR_USER_ID,
              inactivityThresholdDays: 7,
              createdByUserId: ACTOR_USER_ID,
              createdAt: FIXED_NOW,
              updatedAt: FIXED_NOW,
            });

            await eventBus.publish(
              createDomainEvent({
                eventId: asEventId('10000000-0000-4000-8000-000000000009'),
                eventType: 'project.created',
                occurredAt: FIXED_NOW,
                organizationId: ORG_A_ID,
                actorId: ACTOR_USER_ID,
                correlationId: CORRELATION_ID,
                aggregateType: 'Project',
                aggregateId: PROJECT_A_ID,
                payload: { shouldNeverBeDispatched: true },
              }),
            );

            throw new ValidationError('Simulated domain invariant failure inside transaction.');
          },
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(await db.organizations.count()).toBe(0);
      expect(await db.projects.count()).toBe(0);
      expect(receivedEvents).toHaveLength(0);
      expect(eventBus.getDispatchedEvents()).toHaveLength(0);
    });

    it('suporta transação reentrante (chamadas aninhadas a transactionPort.run) acumulando eventos e despachando apenas no commit da transação raiz', async () => {
      const eventBus = new PostCommitDomainEventBus();
      const transactionPort = new DexieTransactionAdapter(db, eventBus);

      const receivedOrder: string[] = [];
      eventBus.subscribe((event) => {
        receivedOrder.push(event.eventType);
      });

      const outerEvent = createDomainEvent({
        eventId: asEventId('20000000-0000-4000-8000-000000000001'),
        eventType: 'outer.started',
        occurredAt: FIXED_NOW,
        organizationId: ORG_A_ID,
        actorId: ACTOR_USER_ID,
        correlationId: CORRELATION_ID,
        aggregateType: 'Organization',
        aggregateId: ORG_A_ID,
        payload: {},
      });

      const innerEvent = createDomainEvent({
        eventId: asEventId('20000000-0000-4000-8000-000000000002'),
        eventType: 'inner.completed',
        occurredAt: FIXED_NOW,
        organizationId: ORG_A_ID,
        actorId: ACTOR_USER_ID,
        correlationId: CORRELATION_ID,
        aggregateType: 'Project',
        aggregateId: PROJECT_B_ID,
        payload: {},
      });

      const outerCompletedEvent = createDomainEvent({
        eventId: asEventId('20000000-0000-4000-8000-000000000003'),
        eventType: 'outer.completed',
        occurredAt: FIXED_NOW,
        organizationId: ORG_A_ID,
        actorId: ACTOR_USER_ID,
        correlationId: CORRELATION_ID,
        aggregateType: 'Organization',
        aggregateId: ORG_A_ID,
        payload: {},
      });

      await transactionPort.run(
        [TRANSACTION_RESOURCES.ORGANIZATIONS, TRANSACTION_RESOURCES.PROJECTS],
        async () => {
          await db.organizations.put({
            id: ORG_A_ID,
            name: 'Org Reentrante',
            slug: 'org-reentrante',
            isDemo: false,
            createdByUserId: ACTOR_USER_ID,
            createdAt: FIXED_NOW,
            updatedAt: FIXED_NOW,
          });
          await eventBus.publish(outerEvent);

          await transactionPort.run([TRANSACTION_RESOURCES.PROJECTS], async () => {
            await db.projects.put({
              id: PROJECT_B_ID,
              organizationId: ORG_A_ID,
              name: 'Projeto Aninhado',
              status: 'ACTIVE',
              ownerUserId: ACTOR_USER_ID,
              inactivityThresholdDays: 7,
              createdByUserId: ACTOR_USER_ID,
              createdAt: FIXED_NOW,
              updatedAt: FIXED_NOW,
            });
            await eventBus.publish(innerEvent);
          });

          // Após o run() interno terminar, a transação raiz ainda está ativa: nenhum evento pode ter sido despachado!
          expect(receivedOrder).toHaveLength(0);

          await eventBus.publish(outerCompletedEvent);
          expect(receivedOrder).toHaveLength(0);
        },
      );

      expect(receivedOrder).toEqual(['outer.started', 'inner.completed', 'outer.completed']);
      expect(await db.organizations.get(ORG_A_ID)).toBeDefined();
      expect(await db.projects.get(PROJECT_B_ID)).toBeDefined();
    });

    it('inclui automaticamente backupPayloads no escopo transacional quando TRANSACTION_RESOURCES.BACKUPS é solicitado', async () => {
      const expanded = expandTransactionTableNames([TRANSACTION_RESOURCES.BACKUPS]);
      expect(expanded).toContain(TRANSACTION_RESOURCES.BACKUPS);
      expect(expanded).toContain(AUXILIARY_TABLES.BACKUP_PAYLOADS);

      const transactionPort = new DexieTransactionAdapter(db);

      await transactionPort.run([TRANSACTION_RESOURCES.BACKUPS], async () => {
        await db.backups.put({
          id: BACKUP_A_ID,
          organizationId: ORG_A_ID,
          kind: 'MANUAL',
          schemaVersion: 1,
          integrityHash: 'sha256-valid',
          entityCounts: { projects: 1 },
          createdAt: FIXED_NOW,
          createdByUserId: ACTOR_USER_ID,
        });

        await db.backupPayloads.put({
          backupId: BACKUP_A_ID,
          organizationId: ORG_A_ID,
          payloadJson: JSON.stringify({ formatVersion: '1.0.0' }),
        });
      });

      const savedPayload = await db.backupPayloads.get(BACKUP_A_ID);
      expect(savedPayload?.payloadJson).toBe(JSON.stringify({ formatVersion: '1.0.0' }));
    });
  });

  describe('Blobs de Anexos e Tratamento de QuotaExceededError (DexieAttachmentBlobStore & quota-error.ts)', () => {
    it('executa putBlob, getBlob (retornando Uint8Array íntegro e clonado defensivamente) e deleteBlob', async () => {
      const blobStore = new DexieAttachmentBlobStore(db);
      const originalBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

      await blobStore.putBlob({
        attachmentId: ATTACHMENT_A_ID,
        organizationId: ORG_A_ID,
        mimeType: '  APPLICATION/PDF ',
        bytes: originalBytes,
      });

      // Mutação local no buffer de entrada não deve afetar o registro persistido
      originalBytes[0] = 0x00;

      const retrieved = await blobStore.getBlob(ORG_A_ID, ATTACHMENT_A_ID);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.attachmentId).toBe(ATTACHMENT_A_ID);
      expect(retrieved?.organizationId).toBe(ORG_A_ID);
      expect(retrieved?.mimeType).toBe('application/pdf');
      expect(Array.from(retrieved?.bytes ?? [])).toEqual([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37,
      ]);

      await blobStore.deleteBlob(ORG_A_ID, ATTACHMENT_A_ID);
      expect(await blobStore.getBlob(ORG_A_ID, ATTACHMENT_A_ID)).toBeNull();
    });

    it('rejeita arquivo maior que 15 MB com ValidationError', async () => {
      const blobStore = new DexieAttachmentBlobStore(db);
      const oversizedBytes = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1);

      await expect(
        blobStore.putBlob({
          attachmentId: ATTACHMENT_A_ID,
          organizationId: ORG_A_ID,
          mimeType: 'application/octet-stream',
          bytes: oversizedBytes,
        }),
      ).rejects.toThrowError(ValidationError);

      expect(await db.attachmentBlobs.count()).toBe(0);
    });

    it('impõe isolamento multi-org: Organização B tentando getBlob, deleteBlob ou sobrescrever putBlob da Organização A recebe AuthorizationError e preserva bytes intactos', async () => {
      const blobStore = new DexieAttachmentBlobStore(db);
      const orgABytes = new Uint8Array([10, 20, 30, 40, 50]);

      await blobStore.putBlob({
        attachmentId: ATTACHMENT_A_ID,
        organizationId: ORG_A_ID,
        mimeType: 'image/png',
        bytes: orgABytes,
      });

      await expect(blobStore.getBlob(ORG_B_ID, ATTACHMENT_A_ID)).rejects.toThrowError(
        AuthorizationError,
      );

      await expect(blobStore.deleteBlob(ORG_B_ID, ATTACHMENT_A_ID)).rejects.toThrowError(
        AuthorizationError,
      );

      await expect(
        blobStore.putBlob({
          attachmentId: ATTACHMENT_A_ID,
          organizationId: ORG_B_ID,
          mimeType: 'text/plain',
          bytes: new Uint8Array([99, 99]),
        }),
      ).rejects.toThrowError(AuthorizationError);

      const intactRecord = await blobStore.getBlob(ORG_A_ID, ATTACHMENT_A_ID);
      expect(intactRecord).not.toBeNull();
      expect(intactRecord?.organizationId).toBe(ORG_A_ID);
      expect(intactRecord?.mimeType).toBe('image/png');
      expect(Array.from(intactRecord?.bytes ?? [])).toEqual([10, 20, 30, 40, 50]);
    });

    it('traduz QuotaExceededError simulado para InfrastructureError com details.reason === STORAGE_QUOTA_EXCEEDED sem apagar registros existentes', async () => {
      const blobStore = new DexieAttachmentBlobStore(db);
      const existingBytes = new Uint8Array([1, 2, 3, 4]);

      await blobStore.putBlob({
        attachmentId: ATTACHMENT_A_ID,
        organizationId: ORG_A_ID,
        mimeType: 'text/plain',
        bytes: existingBytes,
      });

      const simulatedQuotaError = new Error('The quota has been exceeded.');
      simulatedQuotaError.name = 'QuotaExceededError';

      let caughtError: unknown;
      try {
        await withPersistenceErrorHandling('DexieAttachmentBlobStore.putBlob', async () => {
          throw simulatedQuotaError;
        });
      } catch (error: unknown) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(InfrastructureError);
      const infraError = caughtError as InfrastructureError;
      expect(infraError.code).toBe(APP_ERROR_CODES.INFRASTRUCTURE_ERROR);
      expect(infraError.details?.reason).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(infraError.details?.operationName).toBe('DexieAttachmentBlobStore.putBlob');

      // Verifica que nenhum registro existente foi apagado
      const stillPersisted = await blobStore.getBlob(ORG_A_ID, ATTACHMENT_A_ID);
      expect(stillPersisted).not.toBeNull();
      expect(Array.from(stillPersisted?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    });
  });
});
