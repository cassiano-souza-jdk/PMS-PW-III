import type {
  AttachmentId,
  BoardColumnId,
  OrganizationId,
  ProjectId,
  SubtaskId,
  TaskId,
  UserId,
} from '@/shared/kernel';
import type {
  Subtask,
  Tag,
  TagId,
  Task,
  TaskAttachment,
  TaskComment,
  TaskCommentId,
  TaskDeadlineHistoryEntry,
  TaskExecutionCycle,
  TaskParticipant,
  TaskPause,
} from '../../domain/task';

export interface TaskRepositoryPort {
  findById(organizationId: OrganizationId, taskId: TaskId): Promise<Task | null>;
  listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly Task[]>;
  listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly Task[]>;
  listByColumn(
    organizationId: OrganizationId,
    columnId: BoardColumnId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly Task[]>;
  listByAssignee(organizationId: OrganizationId, assigneeId: UserId): Promise<readonly Task[]>;
  save(task: Task): Promise<void>;
  saveMany(organizationId: OrganizationId, tasks: readonly Task[]): Promise<void>;
}

export interface TaskParticipantRepositoryPort {
  findByTaskAndUser(
    organizationId: OrganizationId,
    taskId: TaskId,
    userId: UserId,
  ): Promise<TaskParticipant | null>;
  listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskParticipant[]>;
  listByUser(organizationId: OrganizationId, userId: UserId): Promise<readonly TaskParticipant[]>;
  save(participant: TaskParticipant): Promise<void>;
}

export interface SubtaskRepositoryPort {
  findById(organizationId: OrganizationId, subtaskId: SubtaskId): Promise<Subtask | null>;
  listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly Subtask[]>;
  save(subtask: Subtask): Promise<void>;
  saveMany(organizationId: OrganizationId, subtasks: readonly Subtask[]): Promise<void>;
  delete(organizationId: OrganizationId, subtaskId: SubtaskId): Promise<void>;
}

export interface TaskPauseRepositoryPort {
  listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskPause[]>;
  save(pause: TaskPause): Promise<void>;
}

export interface TaskExecutionCycleRepositoryPort {
  listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskExecutionCycle[]>;
  listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly TaskExecutionCycle[]>;
  save(cycle: TaskExecutionCycle): Promise<void>;
}

export interface TaskCommentRepositoryPort {
  findById(organizationId: OrganizationId, commentId: TaskCommentId): Promise<TaskComment | null>;
  listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly TaskComment[]>;
  save(comment: TaskComment): Promise<void>;
}

export interface TaskAttachmentRepositoryPort {
  findById(
    organizationId: OrganizationId,
    attachmentId: AttachmentId,
  ): Promise<TaskAttachment | null>;
  listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskAttachment[]>;
  save(attachment: TaskAttachment): Promise<void>;
  delete(organizationId: OrganizationId, attachmentId: AttachmentId): Promise<void>;
}

export interface TagRepositoryPort {
  findById(organizationId: OrganizationId, tagId: TagId): Promise<Tag | null>;
  findByNormalizedName(organizationId: OrganizationId, name: string): Promise<Tag | null>;
  listByOrganization(organizationId: OrganizationId): Promise<readonly Tag[]>;
  save(tag: Tag): Promise<void>;
  delete(organizationId: OrganizationId, tagId: TagId): Promise<void>;
}

export interface TaskDeadlineHistoryRepositoryPort {
  listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskDeadlineHistoryEntry[]>;
  append(entry: TaskDeadlineHistoryEntry): Promise<void>;
}
