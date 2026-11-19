import { ValidationError } from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  TRANSACTION_RESOURCES,
  assertSameOrganization,
  type AttachmentBlobPayload,
  type AttachmentBlobStorePort,
  type AttachmentId,
  type OrganizationId,
} from '@/shared/kernel';
import type { PmsDatabase } from './pms-database';
import { withPersistenceErrorHandling } from './quota-error';

/**
 * Dexie v4 implementation of `AttachmentBlobStorePort` over the `attachmentBlobs` store
 * (DATA-PERSISTENCE.md, ADR-0007 §4.4).
 *
 * Enforces:
 * - Individual attachment size limit (`MAX_ATTACHMENT_SIZE_BYTES = 15 MB`);
 * - Non-empty normalized MIME type;
 * - Cross-organization collision guard via `assertSameOrganization` on `putBlob`, `getBlob`, and `deleteBlob`;
 * - Defensive `Uint8Array` cloning so callers cannot mutate the persisted buffer in place;
 * - Safe translation of `QuotaExceededError` via `withPersistenceErrorHandling`.
 */
export class DexieAttachmentBlobStore implements AttachmentBlobStorePort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  async putBlob(payload: AttachmentBlobPayload): Promise<void> {
    const normalizedMimeType = payload.mimeType.trim().toLowerCase();
    if (normalizedMimeType.length === 0) {
      throw new ValidationError('Attachment blob "mimeType" must be a non-empty string.', {
        details: { field: 'mimeType' },
      });
    }

    const byteLength = payload.bytes.byteLength;
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new ValidationError('Attachment blob "bytes" must be a non-empty Uint8Array.', {
        details: { field: 'bytes', sizeBytes: byteLength },
      });
    }

    if (byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new ValidationError(
        `Attachment blob size (${byteLength} bytes) exceeds maximum limit (${MAX_ATTACHMENT_SIZE_BYTES} bytes).`,
        {
          details: {
            field: 'bytes',
            sizeBytes: byteLength,
            maxFileSizeBytes: MAX_ATTACHMENT_SIZE_BYTES,
          },
        },
      );
    }

    const table = this.db.getTable<AttachmentBlobPayload, AttachmentId>(
      TRANSACTION_RESOURCES.ATTACHMENT_BLOBS,
    );

    await withPersistenceErrorHandling('DexieAttachmentBlobStore.putBlob', async () => {
      const existing = await table.get(payload.attachmentId);
      if (existing !== undefined) {
        assertSameOrganization(existing.organizationId, payload.organizationId, 'AttachmentBlob');
      }

      const recordToStore: AttachmentBlobPayload = {
        attachmentId: payload.attachmentId,
        organizationId: payload.organizationId,
        mimeType: normalizedMimeType,
        bytes: new Uint8Array(payload.bytes),
      };

      await table.put(recordToStore);
    });
  }

  async getBlob(
    organizationId: OrganizationId,
    attachmentId: AttachmentId,
  ): Promise<AttachmentBlobPayload | null> {
    const table = this.db.getTable<AttachmentBlobPayload, AttachmentId>(
      TRANSACTION_RESOURCES.ATTACHMENT_BLOBS,
    );

    return withPersistenceErrorHandling('DexieAttachmentBlobStore.getBlob', async () => {
      const record = await table.get(attachmentId);
      if (record === undefined) {
        return null;
      }

      assertSameOrganization(organizationId, record.organizationId, 'AttachmentBlob');

      return Object.freeze({
        attachmentId: record.attachmentId,
        organizationId: record.organizationId,
        mimeType: record.mimeType,
        bytes: new Uint8Array(record.bytes),
      });
    });
  }

  async deleteBlob(organizationId: OrganizationId, attachmentId: AttachmentId): Promise<void> {
    const table = this.db.getTable<AttachmentBlobPayload, AttachmentId>(
      TRANSACTION_RESOURCES.ATTACHMENT_BLOBS,
    );

    await withPersistenceErrorHandling('DexieAttachmentBlobStore.deleteBlob', async () => {
      const existing = await table.get(attachmentId);
      if (existing === undefined) {
        return;
      }

      assertSameOrganization(organizationId, existing.organizationId, 'AttachmentBlob');
      await table.delete(attachmentId);
    });
  }
}
