import { ValidationError } from '@/shared/errors';

declare const brandSymbol: unique symbol;

export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brandSymbol]: TBrand;
};

export type Uuid = Brand<string, 'Uuid'>;
export type EntityId = Brand<string, 'EntityId'>;
export type UserId = Brand<string, 'UserId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type BoardId = Brand<string, 'BoardId'>;
export type BoardColumnId = Brand<string, 'BoardColumnId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type SubtaskId = Brand<string, 'SubtaskId'>;
export type ImpedimentId = Brand<string, 'ImpedimentId'>;
export type FeedbackId = Brand<string, 'FeedbackId'>;
export type FeedbackCycleId = Brand<string, 'FeedbackCycleId'>;
export type FeedbackContestId = Brand<string, 'FeedbackContestId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type BackupId = Brand<string, 'BackupId'>;
export type AttachmentId = Brand<string, 'AttachmentId'>;
export type GrantId = Brand<string, 'GrantId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type EventId = Brand<string, 'EventId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function parseBrandedUuid<TBrand extends string>(
  value: string,
  fieldName = 'id',
): Brand<string, TBrand> {
  if (!isUuid(value)) {
    throw new ValidationError(`Invalid UUID format for "${fieldName}".`, {
      details: { field: fieldName },
    });
  }

  return value as unknown as Brand<string, TBrand>;
}

export function asUuid(value: string, fieldName = 'id'): Uuid {
  return parseBrandedUuid<'Uuid'>(value, fieldName);
}

export function asEntityId(value: string, fieldName = 'entityId'): EntityId {
  return parseBrandedUuid<'EntityId'>(value, fieldName);
}

export function asUserId(value: string, fieldName = 'userId'): UserId {
  return parseBrandedUuid<'UserId'>(value, fieldName);
}

export function asOrganizationId(value: string, fieldName = 'organizationId'): OrganizationId {
  return parseBrandedUuid<'OrganizationId'>(value, fieldName);
}

export function asTeamId(value: string, fieldName = 'teamId'): TeamId {
  return parseBrandedUuid<'TeamId'>(value, fieldName);
}

export function asProjectId(value: string, fieldName = 'projectId'): ProjectId {
  return parseBrandedUuid<'ProjectId'>(value, fieldName);
}

export function asBoardId(value: string, fieldName = 'boardId'): BoardId {
  return parseBrandedUuid<'BoardId'>(value, fieldName);
}

export function asBoardColumnId(value: string, fieldName = 'boardColumnId'): BoardColumnId {
  return parseBrandedUuid<'BoardColumnId'>(value, fieldName);
}

export function asTaskId(value: string, fieldName = 'taskId'): TaskId {
  return parseBrandedUuid<'TaskId'>(value, fieldName);
}

export function asSubtaskId(value: string, fieldName = 'subtaskId'): SubtaskId {
  return parseBrandedUuid<'SubtaskId'>(value, fieldName);
}

export function asImpedimentId(value: string, fieldName = 'impedimentId'): ImpedimentId {
  return parseBrandedUuid<'ImpedimentId'>(value, fieldName);
}

export function asFeedbackId(value: string, fieldName = 'feedbackId'): FeedbackId {
  return parseBrandedUuid<'FeedbackId'>(value, fieldName);
}

export function asFeedbackCycleId(value: string, fieldName = 'feedbackCycleId'): FeedbackCycleId {
  return parseBrandedUuid<'FeedbackCycleId'>(value, fieldName);
}

export function asFeedbackContestId(
  value: string,
  fieldName = 'feedbackContestId',
): FeedbackContestId {
  return parseBrandedUuid<'FeedbackContestId'>(value, fieldName);
}

export function asNotificationId(value: string, fieldName = 'notificationId'): NotificationId {
  return parseBrandedUuid<'NotificationId'>(value, fieldName);
}

export function asAuditEventId(value: string, fieldName = 'auditEventId'): AuditEventId {
  return parseBrandedUuid<'AuditEventId'>(value, fieldName);
}

export function asBackupId(value: string, fieldName = 'backupId'): BackupId {
  return parseBrandedUuid<'BackupId'>(value, fieldName);
}

export function asAttachmentId(value: string, fieldName = 'attachmentId'): AttachmentId {
  return parseBrandedUuid<'AttachmentId'>(value, fieldName);
}

export function asGrantId(value: string, fieldName = 'grantId'): GrantId {
  return parseBrandedUuid<'GrantId'>(value, fieldName);
}

export function asCorrelationId(value: string, fieldName = 'correlationId'): CorrelationId {
  return parseBrandedUuid<'CorrelationId'>(value, fieldName);
}

export function asEventId(value: string, fieldName = 'eventId'): EventId {
  return parseBrandedUuid<'EventId'>(value, fieldName);
}
