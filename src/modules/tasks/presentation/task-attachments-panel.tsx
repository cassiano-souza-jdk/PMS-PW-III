import { IconDownload, IconPaperclip, IconTrash, IconUpload } from '@tabler/icons-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { useIntl } from 'react-intl';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { TASK_STATUSES, type AttachmentId, type TaskStatus, type UserId } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  ModalDialog,
} from '@/shared/ui';
import type { TaskAttachment } from '../application/contracts';
import {
  formatByteSize,
  formatIsoDateTimeShort,
  resolveUserDisplayName,
  type TaskUserOption,
} from './task-ui-helpers';

const DISALLOWED_EXECUTABLE_MIME_TYPES = new Set<string>([
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-sh',
  'application/x-executable',
]);

export interface TaskAttachmentsPanelProps {
  readonly attachments: readonly TaskAttachment[];
  readonly taskStatus: TaskStatus;
  readonly maxAttachmentSizeBytes: number;
  readonly maxContextAttachmentsSizeBytes: number;
  readonly maxAttachmentsPerContext: number;
  readonly isReadOnly: boolean;
  readonly canManageAttachments: boolean;
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
  readonly isMutating: boolean;
  readonly onUploadAttachment: (file: File) => Promise<void>;
  readonly onDownloadAttachment: (attachment: TaskAttachment) => Promise<void>;
  readonly onDeleteAttachment: (attachmentId: AttachmentId, fileName: string) => Promise<void>;
}

function isQuotaError(error: unknown): boolean {
  if (
    isAppError(error) &&
    error.code === APP_ERROR_CODES.INFRASTRUCTURE_ERROR &&
    error.details?.reason === 'STORAGE_QUOTA_EXCEEDED'
  ) {
    return true;
  }
  if (error instanceof Error) {
    const lowerName = error.name.toLowerCase();
    const lowerMessage = error.message.toLowerCase();
    return (
      lowerName.includes('quotaexceeded') ||
      lowerMessage.includes('quotaexceeded') ||
      lowerMessage.includes('storage_quota_exceeded')
    );
  }
  return false;
}

export function TaskAttachmentsPanel({
  attachments,
  taskStatus,
  maxAttachmentSizeBytes,
  maxContextAttachmentsSizeBytes,
  maxAttachmentsPerContext,
  isReadOnly,
  canManageAttachments,
  usersById,
  isMutating,
  onUploadAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
}: TaskAttachmentsPanelProps) {
  const intl = useIntl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingAttachment, setDeletingAttachment] = useState<TaskAttachment | null>(null);

  const canUpload = canManageAttachments && !isReadOnly && taskStatus !== TASK_STATUSES.CANCELLED;
  const existingTotalBytes = attachments.reduce((sum, item) => sum + item.sizeBytes, 0);

  const validateSelectedFile = (file: File): string | null => {
    if (file.size <= 0) {
      return intl.formatMessage({ id: 'attachments.upload.emptyFileError' });
    }
    const normalizedMime = file.type.trim().toLowerCase();
    if (normalizedMime.length === 0 || DISALLOWED_EXECUTABLE_MIME_TYPES.has(normalizedMime)) {
      return intl.formatMessage({ id: 'attachments.upload.invalidTypeError' });
    }
    if (
      attachments.length >= maxAttachmentsPerContext ||
      file.size > maxAttachmentSizeBytes ||
      existingTotalBytes + file.size > maxContextAttachmentsSizeBytes
    ) {
      return intl.formatMessage({ id: 'attachments.upload.sizeExceededError' });
    }
    return null;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file !== null) {
      setUploadError(validateSelectedFile(file));
    } else {
      setUploadError(null);
    }
  };

  const handleUploadClick = async () => {
    if (selectedFile === null) {
      setUploadError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    const validationError = validateSelectedFile(selectedFile);
    if (validationError !== null) {
      setUploadError(validationError);
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    try {
      await onUploadAttachment(selectedFile);
      setSelectedFile(null);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      if (isQuotaError(error)) {
        setUploadError(intl.formatMessage({ id: 'attachments.upload.quotaExceededError' }));
        return;
      }
      if (isAppError(error) && error.code === APP_ERROR_CODES.VALIDATION_ERROR) {
        if (error.details?.field === 'mimeType') {
          setUploadError(intl.formatMessage({ id: 'attachments.upload.invalidTypeError' }));
          return;
        }
        if (error.details?.field === 'sizeBytes' && error.details?.sizeBytes === 0) {
          setUploadError(intl.formatMessage({ id: 'attachments.upload.emptyFileError' }));
          return;
        }
        if (error.details?.field === 'sizeBytes' || error.details?.field === 'attachments') {
          setUploadError(intl.formatMessage({ id: 'attachments.upload.sizeExceededError' }));
          return;
        }
      }
      setUploadError(intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (deletingAttachment === null) {
      return;
    }
    await onDeleteAttachment(deletingAttachment.id, deletingAttachment.fileName);
    setDeletingAttachment(null);
  };

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: 'attachments.title' })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: 'attachments.description' })}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage(
            { id: 'attachments.upload.limitsHint' },
            {
              maxFileSize: formatByteSize(maxAttachmentSizeBytes, intl),
              maxTotalSize: formatByteSize(maxContextAttachmentsSizeBytes, intl),
              maxCount: maxAttachmentsPerContext,
            },
          )}
        </p>

        {canUpload ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-attachment-file-input">
                {intl.formatMessage({ id: 'attachments.upload.label' })}
              </Label>
              <input
                ref={fileInputRef}
                id="task-attachment-file-input"
                type="file"
                disabled={isMutating || isUploading}
                onChange={handleFileChange}
                aria-invalid={uploadError !== null}
                aria-describedby={uploadError !== null ? 'task-attachment-upload-error' : undefined}
                className="flex min-h-[44px] w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            {uploadError !== null ? (
              <Alert id="task-attachment-upload-error" variant="destructive" role="alert">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="button"
              className="min-h-[44px]"
              disabled={isMutating || isUploading}
              onClick={() => void handleUploadClick()}
            >
              <IconUpload className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isUploading ? 'attachments.upload.uploading' : 'attachments.upload.action',
                })}
              </span>
            </Button>
          </div>
        ) : null}

        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'attachments.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {attachments.map((attachment) => {
              const uploaderName = resolveUserDisplayName(
                attachment.uploadedBy,
                usersById,
                unknownUserLabel,
              );

              return (
                <li
                  key={attachment.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-background p-4 shadow-sm"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <IconPaperclip
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <h3 className="break-words text-sm font-semibold text-foreground">
                        {attachment.fileName}
                      </h3>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {intl.formatMessage(
                          { id: 'attachments.mimeTypeLabel' },
                          { mimeType: attachment.mimeType },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'attachments.sizeLabel' },
                          { size: formatByteSize(attachment.sizeBytes, intl) },
                        )}
                      </span>
                      <span>
                        {intl.formatMessage(
                          { id: 'attachments.uploadedAtLabel' },
                          { date: formatIsoDateTimeShort(attachment.uploadedAt, intl) },
                        )}
                      </span>
                      <span>{uploaderName}</span>
                    </div>

                    {attachment.checksumSha256 !== undefined ? (
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {intl.formatMessage(
                          { id: 'attachments.checksumLabel' },
                          { hash: attachment.checksumSha256 },
                        )}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      disabled={isMutating || isUploading}
                      onClick={() => void onDownloadAttachment(attachment)}
                    >
                      <IconDownload className="h-4 w-4" aria-hidden="true" />
                      <span>{intl.formatMessage({ id: 'attachments.download.action' })}</span>
                    </Button>

                    {canManageAttachments && !isReadOnly ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={isMutating || isUploading}
                        onClick={() => setDeletingAttachment(attachment)}
                      >
                        <IconTrash className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'attachments.delete.action' })}</span>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ModalDialog
        isOpen={deletingAttachment !== null}
        titleId="delete-attachment-dialog-title"
        title={intl.formatMessage({ id: 'attachments.delete.confirmTitle' })}
        descriptionId="delete-attachment-dialog-description"
        description={
          deletingAttachment !== null
            ? intl.formatMessage(
                { id: 'attachments.delete.confirmDescription' },
                { fileName: deletingAttachment.fileName },
              )
            : undefined
        }
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isMutating}
        onClose={() => setDeletingAttachment(null)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => void handleConfirmDelete()}
          >
            {intl.formatMessage({ id: 'attachments.delete.confirmAction' })}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={isMutating}
            onClick={() => setDeletingAttachment(null)}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
        </div>
      </ModalDialog>
    </Card>
  );
}
