import { ValidationError } from '@/shared/errors';
import type { OrganizationScoped } from './entity-traits';
import type { AttachmentId, OrganizationId, UserId } from './identifiers';
import type { IsoDateTime } from './temporal';

/** Maximum allowed size per individual attachment (15 MB — DATA-PERSISTENCE.md). */
export const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;

/** Maximum allowed cumulative size per task or feedback context (50 MB — DATA-PERSISTENCE.md). */
export const MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES = 50 * 1024 * 1024;

export interface AttachmentDescriptor extends OrganizationScoped {
  readonly id: AttachmentId;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256?: string;
  readonly uploadedBy: UserId;
  readonly uploadedAt: IsoDateTime;
}

export interface ValidateAttachmentQuotaInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly existingContextTotalBytes: number;
  readonly maxFileSizeBytes?: number;
  readonly maxContextTotalBytes?: number;
  readonly allowedMimeTypes?: readonly string[];
}

export interface AttachmentBlobPayload {
  readonly attachmentId: AttachmentId;
  readonly organizationId: OrganizationId;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/**
 * Pure binary storage port for attachments (implemented over IndexedDB Blobs in Phase 03).
 * Uses Uint8Array to keep the shared kernel decoupled from browser File/Blob APIs and Dexie.
 */
export interface AttachmentBlobStorePort {
  putBlob(payload: AttachmentBlobPayload): Promise<void>;
  getBlob(
    organizationId: OrganizationId,
    attachmentId: AttachmentId,
  ): Promise<AttachmentBlobPayload | null>;
  deleteBlob(organizationId: OrganizationId, attachmentId: AttachmentId): Promise<void>;
}

export function validateAttachmentQuota(input: ValidateAttachmentQuotaInput): void {
  const maxFileSizeBytes = input.maxFileSizeBytes ?? MAX_ATTACHMENT_SIZE_BYTES;
  const maxContextTotalBytes = input.maxContextTotalBytes ?? MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES;

  if (input.fileName.trim().length === 0) {
    throw new ValidationError('Attachment "fileName" must be a non-empty string.', {
      details: { field: 'fileName' },
    });
  }

  const normalizedMimeType = input.mimeType.trim().toLowerCase();
  if (normalizedMimeType.length === 0) {
    throw new ValidationError('Attachment "mimeType" must be a non-empty string.', {
      details: { field: 'mimeType' },
    });
  }

  if (
    input.allowedMimeTypes !== undefined &&
    input.allowedMimeTypes.length > 0 &&
    !input.allowedMimeTypes.some((allowed) => allowed.trim().toLowerCase() === normalizedMimeType)
  ) {
    throw new ValidationError(`Attachment MIME type "${normalizedMimeType}" is not allowed.`, {
      details: { field: 'mimeType', mimeType: normalizedMimeType },
    });
  }

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new ValidationError('Attachment "sizeBytes" must be a positive integer.', {
      details: { field: 'sizeBytes' },
    });
  }

  if (!Number.isInteger(input.existingContextTotalBytes) || input.existingContextTotalBytes < 0) {
    throw new ValidationError('Attachment "existingContextTotalBytes" must be an integer >= 0.', {
      details: { field: 'existingContextTotalBytes' },
    });
  }

  if (input.sizeBytes > maxFileSizeBytes) {
    throw new ValidationError(
      `Attachment size (${input.sizeBytes} bytes) exceeds maximum limit (${maxFileSizeBytes} bytes).`,
      {
        details: {
          field: 'sizeBytes',
          sizeBytes: input.sizeBytes,
          maxFileSizeBytes,
        },
      },
    );
  }

  const projectedTotalBytes = input.existingContextTotalBytes + input.sizeBytes;
  if (projectedTotalBytes > maxContextTotalBytes) {
    throw new ValidationError(
      `Cumulative attachment size (${projectedTotalBytes} bytes) exceeds context limit (${maxContextTotalBytes} bytes).`,
      {
        details: {
          field: 'sizeBytes',
          projectedTotalBytes,
          maxContextTotalBytes,
        },
      },
    );
  }
}
