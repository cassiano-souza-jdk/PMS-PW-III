import { IconDownload, IconLock, IconPaperclip, IconUpload } from '@tabler/icons-react';
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  isDisallowedAttachmentMimeType,
  type AttachmentId,
  type OrganizationRole,
  type UserId,
} from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@/shared/ui';
import type {
  FeedbackActorProfile,
  FeedbackAttachment,
  FeedbackAttachmentContentResult,
  FeedbackInternalNote,
  FeedbackInternalNoteId,
  FeedbackMessage,
  FeedbackMessageId,
} from '../application/contracts';
import {
  CONTROL_SELECT_CLASS_NAME,
  formatFeedbackByteSize,
  formatFeedbackDateTime,
  isFeedbackStorageQuotaError,
  resolveFeedbackActorDisplayName,
  triggerFeedbackBlobDownload,
} from './feedback-ui-helpers';

export interface FeedbackAttachmentsPanelProps {
  readonly feedbackId: string;
  readonly feedbackAuthorUserId: UserId;
  readonly currentUserId: UserId;
  readonly currentUserRole: OrganizationRole;
  readonly isClosed: boolean;
  readonly publicAttachments: readonly FeedbackAttachment[];
  readonly internalAttachments: readonly FeedbackAttachment[];
  readonly messages: readonly FeedbackMessage[];
  readonly internalNotes: readonly FeedbackInternalNote[];
  readonly actorProfiles: Readonly<Record<string, FeedbackActorProfile>>;
  readonly canSendMessage: boolean;
  readonly canViewInternalNotes: boolean;
  readonly canCreateInternalNotes: boolean;
  readonly maxAttachmentSizeBytes?: number;
  readonly maxContextAttachmentsSizeBytes?: number;
  readonly maxAttachmentsPerContext?: number;
  readonly isBusy: boolean;
  readonly onUploadAttachment: (input: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly messageId?: FeedbackMessageId;
    readonly internalNoteId?: FeedbackInternalNoteId;
  }) => Promise<void>;
  readonly onDownloadAttachment: (
    attachmentId: AttachmentId,
  ) => Promise<FeedbackAttachmentContentResult>;
}

export function FeedbackAttachmentsPanel({
  feedbackId,
  feedbackAuthorUserId,
  currentUserId,
  currentUserRole,
  isClosed,
  publicAttachments,
  internalAttachments,
  messages,
  internalNotes,
  actorProfiles,
  canSendMessage,
  canViewInternalNotes,
  canCreateInternalNotes,
  maxAttachmentSizeBytes = MAX_ATTACHMENT_SIZE_BYTES,
  maxContextAttachmentsSizeBytes = MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  maxAttachmentsPerContext = 20,
  isBusy,
  onUploadAttachment,
  onDownloadAttachment,
}: FeedbackAttachmentsPanelProps) {
  const intl = useIntl();
  const fileInputId = useId();
  const contextSelectId = useId();
  const messageSelectId = useId();
  const noteSelectId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headingId = `feedback-attachments-heading-${feedbackId}`;

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetScope, setTargetScope] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC');
  const [selectedMessageId, setSelectedMessageId] = useState<string>('');
  const [selectedInternalNoteId, setSelectedInternalNoteId] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<AttachmentId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBlockedNonAdminAuthor =
    feedbackAuthorUserId === currentUserId && currentUserRole !== 'ADMIN';
  const showInternalSection =
    currentUserRole !== 'MEMBER' && !isBlockedNonAdminAuthor && canViewInternalNotes;
  const allowInternalUpload =
    showInternalSection && canCreateInternalNotes && internalNotes.length > 0;
  const canUploadAny = !isClosed && (canSendMessage || allowInternalUpload);

  const totalAttachmentsCount = publicAttachments.length + internalAttachments.length;
  const existingTotalBytes = [...publicAttachments, ...internalAttachments].reduce(
    (sum, item) => sum + item.sizeBytes,
    0,
  );
  const fallbackActorLabel = intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });

  const validateFile = (file: File): string | null => {
    const normalizedMime = file.type.trim().toLowerCase();
    const baseMime = normalizedMime.split(';', 1)[0]?.trim() ?? '';
    if (baseMime.length === 0 || isDisallowedAttachmentMimeType(normalizedMime)) {
      return intl.formatMessage({ id: 'feedbacks.attachments.disallowedMimeError' });
    }
    if (
      file.size <= 0 ||
      totalAttachmentsCount >= maxAttachmentsPerContext ||
      file.size > maxAttachmentSizeBytes ||
      existingTotalBytes + file.size > maxContextAttachmentsSizeBytes
    ) {
      return intl.formatMessage({ id: 'feedbacks.attachments.quotaHint' });
    }
    return null;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file !== null) {
      setErrorMessage(validateFile(file));
    } else {
      setErrorMessage(null);
    }
  };

  const handleUploadSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedFile === null) {
      setErrorMessage(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    const validationError = validateFile(selectedFile);
    if (validationError !== null) {
      setErrorMessage(validationError);
      return;
    }

    if (targetScope === 'INTERNAL' && selectedInternalNoteId === '') {
      setErrorMessage(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    setErrorMessage(null);
    setIsUploading(true);
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      await onUploadAttachment({
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        bytes,
        ...(targetScope === 'PUBLIC' && selectedMessageId !== ''
          ? { messageId: selectedMessageId as FeedbackMessageId }
          : {}),
        ...(targetScope === 'INTERNAL' && selectedInternalNoteId !== ''
          ? { internalNoteId: selectedInternalNoteId as FeedbackInternalNoteId }
          : {}),
      });
      setSelectedFile(null);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      if (isFeedbackStorageQuotaError(error)) {
        setErrorMessage(intl.formatMessage({ id: 'feedbacks.attachments.quotaExceededError' }));
      } else if (isAppError(error) && error.code === APP_ERROR_CODES.VALIDATION_ERROR) {
        if (error.details?.field === 'mimeType') {
          setErrorMessage(intl.formatMessage({ id: 'feedbacks.attachments.disallowedMimeError' }));
        } else {
          setErrorMessage(intl.formatMessage({ id: 'feedbacks.attachments.quotaHint' }));
        }
      } else {
        setErrorMessage(intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' }));
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async (attachment: FeedbackAttachment) => {
    setErrorMessage(null);
    setDownloadingId(attachment.id);
    try {
      const content = await onDownloadAttachment(attachment.id);
      triggerFeedbackBlobDownload(content.bytes, content.mimeType, content.attachment.fileName);
    } catch {
      setErrorMessage(intl.formatMessage({ id: 'feedbacks.attachments.downloadError' }));
    } finally {
      setDownloadingId(null);
    }
  };

  const renderAttachmentList = (
    items: readonly FeedbackAttachment[],
    emptyId: 'feedbacks.attachments.emptyPublic' | 'feedbacks.attachments.emptyInternal',
  ) => {
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: emptyId })}</p>;
    }

    return (
      <ul className="space-y-2">
        {items.map((attachment) => {
          const uploaderName = resolveFeedbackActorDisplayName(
            attachment.uploadedBy,
            actorProfiles,
            fallbackActorLabel,
          );
          return (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {attachment.fileName}
                  </span>
                  <Badge variant="outline">{attachment.mimeType}</Badge>
                  {attachment.internalNoteId !== undefined ? (
                    <Badge variant="secondary">
                      {intl.formatMessage({ id: 'feedbacks.internalNotes.restrictedBadge' })}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'feedbacks.attachments.sizeLabel' },
                    { size: formatFeedbackByteSize(attachment.sizeBytes, intl) },
                  )}{' '}
                  · {uploaderName} · {formatFeedbackDateTime(attachment.uploadedAt, intl)}
                </p>
                {attachment.checksumSha256 !== undefined ? (
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {intl.formatMessage(
                      { id: 'feedbacks.attachments.checksumLabel' },
                      { checksum: attachment.checksumSha256 },
                    )}
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDownload(attachment)}
                disabled={isBusy || downloadingId === attachment.id}
                className="min-h-[44px] shrink-0 gap-2"
              >
                <IconDownload className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'feedbacks.attachments.downloadAction' })}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2 text-lg">
          <IconPaperclip className="h-5 w-5" aria-hidden="true" />
          <span>{intl.formatMessage({ id: 'feedbacks.attachments.publicTitle' })}</span>
        </CardTitle>
        <CardDescription>
          {intl.formatMessage({ id: 'feedbacks.attachments.immutabilityNotice' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage({ id: 'feedbacks.attachments.quotaHint' })}
        </p>

        {errorMessage !== null ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            {intl.formatMessage({ id: 'feedbacks.attachments.publicTitle' })}
          </h3>
          {renderAttachmentList(publicAttachments, 'feedbacks.attachments.emptyPublic')}
        </div>

        {showInternalSection ? (
          <div className="space-y-2 border-t pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <IconLock className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.attachments.internalTitle' })}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: 'feedbacks.attachments.internalSegregationNotice' })}
            </p>
            {renderAttachmentList(internalAttachments, 'feedbacks.attachments.emptyInternal')}
          </div>
        ) : null}

        {canUploadAny ? (
          <form onSubmit={handleUploadSubmit} className="space-y-3 border-t pt-4" noValidate>
            <h3 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'feedbacks.attachments.uploadTitle' })}
            </h3>

            {allowInternalUpload ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={contextSelectId}>
                    {intl.formatMessage({ id: 'feedbacks.attachments.targetContextLabel' })}
                  </Label>
                  <select
                    id={contextSelectId}
                    value={targetScope}
                    onChange={(event) => {
                      const next = event.target.value === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC';
                      setTargetScope(next);
                      if (
                        next === 'INTERNAL' &&
                        selectedInternalNoteId === '' &&
                        internalNotes[0]
                      ) {
                        setSelectedInternalNoteId(internalNotes[0].id);
                      }
                    }}
                    className={CONTROL_SELECT_CLASS_NAME}
                    disabled={isBusy || isUploading}
                  >
                    {canSendMessage ? (
                      <option value="PUBLIC">
                        {intl.formatMessage({ id: 'feedbacks.attachments.contextPublic' })}
                      </option>
                    ) : null}
                    <option value="INTERNAL">
                      {intl.formatMessage({ id: 'feedbacks.attachments.contextInternal' })}
                    </option>
                  </select>
                </div>

                {targetScope === 'INTERNAL' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={noteSelectId}>
                      {intl.formatMessage({ id: 'feedbacks.attachments.targetNoteLabel' })}
                    </Label>
                    <select
                      id={noteSelectId}
                      value={selectedInternalNoteId}
                      onChange={(event) => setSelectedInternalNoteId(event.target.value)}
                      className={CONTROL_SELECT_CLASS_NAME}
                      disabled={isBusy || isUploading}
                    >
                      {internalNotes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {formatFeedbackDateTime(note.createdAt, intl)} — {note.body.slice(0, 40)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}

            {targetScope === 'PUBLIC' && messages.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor={messageSelectId}>
                  {intl.formatMessage({ id: 'feedbacks.attachments.targetMessageLabel' })}
                </Label>
                <select
                  id={messageSelectId}
                  value={selectedMessageId}
                  onChange={(event) => setSelectedMessageId(event.target.value)}
                  className={CONTROL_SELECT_CLASS_NAME}
                  disabled={isBusy || isUploading}
                >
                  <option value="">
                    {intl.formatMessage({ id: 'feedbacks.attachments.contextPublic' })}
                  </option>
                  {messages.map((message) => (
                    <option key={message.id} value={message.id}>
                      {formatFeedbackDateTime(message.createdAt, intl)} —{' '}
                      {message.body.slice(0, 40)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor={fileInputId}>
                {intl.formatMessage({ id: 'feedbacks.attachments.fileLabel' })}
              </Label>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                onChange={handleFileChange}
                disabled={isBusy || isUploading}
                className="block min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
              />
            </div>

            <Button type="submit" disabled={isBusy || isUploading} className="min-h-[44px] gap-2">
              <IconUpload className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isUploading
                    ? 'feedbacks.attachments.uploading'
                    : 'feedbacks.attachments.submitAction',
                })}
              </span>
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
