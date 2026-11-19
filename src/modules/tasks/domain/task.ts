import {
  parseBrandedUuid,
  type AttachmentDescriptor,
  type AuditableTimestamps,
  type BoardColumnId,
  type BoardId,
  type Brand,
  type IsoDateTime,
  type OrganizationScoped,
  type Priority,
  type ProjectId,
  type SoftDeletable,
  type SubtaskId,
  type TaskId,
  type TaskStatus,
  type UserId,
} from '@/shared/kernel';

export type TagId = Brand<string, 'TagId'>;
export type TaskParticipantId = Brand<string, 'TaskParticipantId'>;
export type TaskPauseId = Brand<string, 'TaskPauseId'>;
export type TaskExecutionCycleId = Brand<string, 'TaskExecutionCycleId'>;
export type TaskCommentId = Brand<string, 'TaskCommentId'>;
export type TaskDeadlineHistoryEntryId = Brand<string, 'TaskDeadlineHistoryEntryId'>;

export function asTagId(value: string, fieldName = 'tagId'): TagId {
  return parseBrandedUuid<'TagId'>(value, fieldName);
}

export function asTaskParticipantId(
  value: string,
  fieldName = 'taskParticipantId',
): TaskParticipantId {
  return parseBrandedUuid<'TaskParticipantId'>(value, fieldName);
}

export function asTaskPauseId(value: string, fieldName = 'taskPauseId'): TaskPauseId {
  return parseBrandedUuid<'TaskPauseId'>(value, fieldName);
}

export function asTaskExecutionCycleId(
  value: string,
  fieldName = 'taskExecutionCycleId',
): TaskExecutionCycleId {
  return parseBrandedUuid<'TaskExecutionCycleId'>(value, fieldName);
}

export function asTaskCommentId(value: string, fieldName = 'taskCommentId'): TaskCommentId {
  return parseBrandedUuid<'TaskCommentId'>(value, fieldName);
}

export function asTaskDeadlineHistoryEntryId(
  value: string,
  fieldName = 'taskDeadlineHistoryEntryId',
): TaskDeadlineHistoryEntryId {
  return parseBrandedUuid<'TaskDeadlineHistoryEntryId'>(value, fieldName);
}

export const SUBTASK_STATUSES = {
  OPEN: 'OPEN',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;

export type SubtaskStatus = (typeof SUBTASK_STATUSES)[keyof typeof SUBTASK_STATUSES];

export interface Task extends OrganizationScoped, AuditableTimestamps, SoftDeletable {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly boardId: BoardId;
  readonly columnId: BoardColumnId;
  readonly title: string;
  readonly description?: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly assigneeId?: UserId;
  readonly dueDate?: IsoDateTime;
  readonly order: number;
  readonly tagIds: readonly TagId[];
  /** Timestamp of the last Kanban column/card movement (kept distinct from lastActivityAt — PRD.md §12.1). */
  readonly lastMovedAt: IsoDateTime;
  /** Timestamp of the last operational activity (comments, edits, subtasks, etc.). */
  readonly lastActivityAt: IsoDateTime;
  readonly startedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly cancelledAt?: IsoDateTime;
  readonly cancellationReason?: string;
  readonly createdByUserId: UserId;
}

export interface TaskParticipant extends OrganizationScoped {
  readonly id: TaskParticipantId;
  readonly taskId: TaskId;
  readonly userId: UserId;
  readonly addedByUserId: UserId;
  readonly joinedAt: IsoDateTime;
  readonly removedAt?: IsoDateTime;
}

/**
 * Single-level subtask (PRD.md §10): intentionally omits any parentSubtaskId
 * because subtasks cannot contain nested child subtasks.
 */
export interface Subtask extends OrganizationScoped, AuditableTimestamps {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly title: string;
  readonly required: boolean;
  readonly status: SubtaskStatus;
  readonly assigneeId?: UserId;
  readonly order: number;
  readonly completedAt?: IsoDateTime;
}

export interface TaskPause extends OrganizationScoped {
  readonly id: TaskPauseId;
  readonly taskId: TaskId;
  readonly cycleId: TaskExecutionCycleId;
  readonly startedAt: IsoDateTime;
  readonly startedByUserId: UserId;
  readonly reason: string;
  readonly endedAt?: IsoDateTime;
  readonly endedByUserId?: UserId;
}

export interface TaskExecutionCycle extends OrganizationScoped {
  readonly id: TaskExecutionCycleId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly cycleNumber: number;
  readonly startedAt: IsoDateTime;
  readonly effectiveStartedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly reopenedFromCycleId?: TaskExecutionCycleId;
  readonly reopenReason?: string;
}

export interface TaskComment extends OrganizationScoped, AuditableTimestamps, SoftDeletable {
  readonly id: TaskCommentId;
  readonly taskId: TaskId;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly isSystem: boolean;
  readonly editedAt?: IsoDateTime;
}

export interface TaskAttachment extends AttachmentDescriptor {
  readonly taskId: TaskId;
}

export interface Tag extends OrganizationScoped, AuditableTimestamps {
  readonly id: TagId;
  readonly name: string;
  readonly colorToken?: string;
}

export interface TaskDeadlineHistoryEntry extends OrganizationScoped {
  readonly id: TaskDeadlineHistoryEntryId;
  readonly taskId: TaskId;
  readonly previousDueDate?: IsoDateTime;
  readonly newDueDate?: IsoDateTime;
  readonly changedByUserId: UserId;
  readonly changedAt: IsoDateTime;
  readonly justification?: string;
}
