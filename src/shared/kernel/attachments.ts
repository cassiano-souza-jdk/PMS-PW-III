import { ValidationError } from '@/shared/errors';
import type { OrganizationScoped } from './entity-traits';
import type { AttachmentId, OrganizationId, UserId } from './identifiers';
import type { IsoDateTime } from './temporal';

/** Maximum allowed size per individual attachment (15 MB — DATA-PERSISTENCE.md). */
export const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;

/** Maximum allowed cumulative size per task or feedback context (50 MB — DATA-PERSISTENCE.md). */
export const MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES = 50 * 1024 * 1024;

/** Canonical denylist of executable and active web attachment MIME types. */
export const DISALLOWED_ATTACHMENT_MIME_TYPES = Object.freeze([
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-csh',
  'application/x-shellscript',
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-elf',
  'application/vnd.microsoft.portable-executable',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
]) as readonly string[];

const DISALLOWED_ATTACHMENT_MIME_TYPE_SET = new Set<string>(DISALLOWED_ATTACHMENT_MIME_TYPES);

/**
 * Normalizes a MIME string (stripping optional parameters like `; charset=utf-8`)
 * and checks whether the base MIME type belongs to `DISALLOWED_ATTACHMENT_MIME_TYPES`.
 */
export function isDisallowedAttachmentMimeType(mimeType: string): boolean {
  const baseMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return DISALLOWED_ATTACHMENT_MIME_TYPE_SET.has(baseMimeType);
}

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
  const baseMimeType = normalizedMimeType.split(';', 1)[0]?.trim() ?? '';
  if (baseMimeType.length === 0) {
    throw new ValidationError('Attachment "mimeType" must be a non-empty string.', {
      details: { field: 'mimeType' },
    });
  }

  if (isDisallowedAttachmentMimeType(normalizedMimeType)) {
    throw new ValidationError(`Attachment MIME type "${baseMimeType}" is not allowed.`, {
      details: {
        field: 'mimeType',
        mimeType: baseMimeType,
        reason: 'DISALLOWED_MIME_TYPE',
      },
    });
  }

  if (
    input.allowedMimeTypes !== undefined &&
    input.allowedMimeTypes.length > 0 &&
    !input.allowedMimeTypes.some((allowed) => {
      const normalizedAllowed = allowed.trim().toLowerCase();
      return normalizedAllowed === baseMimeType || normalizedAllowed === normalizedMimeType;
    })
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
