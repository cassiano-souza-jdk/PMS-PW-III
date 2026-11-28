import { Dexie } from 'dexie';
import { ConflictError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  parseIsoDateTimeMs,
  type AttachmentId,
  type BoardColumnId,
  type OrganizationId,
  type ProjectId,
  type SubtaskId,
  type TaskId,
  type UserId,
} from '@/shared/kernel';
import {
  appendImmutableEntity,
  deleteOrganizationScopedById,
  filterSoftDeleted,
  findOrganizationScopedById,
  saveManyOrganizationScopedEntities,
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type {
  SubtaskRepositoryPort,
  TagRepositoryPort,
  TaskAttachmentRepositoryPort,
  TaskCommentRepositoryPort,
  TaskDeadlineHistoryRepositoryPort,
  TaskExecutionCycleRepositoryPort,
  TaskParticipantRepositoryPort,
  TaskPauseRepositoryPort,
  TaskRepositoryPort,
} from '../../application/ports/task-repository.port';
import type {
  Subtask,
  Tag,
  TagId,
  Task,
  TaskAttachment,
  TaskComment,
  TaskCommentId,
  TaskDeadlineHistoryEntry,
  TaskDeadlineHistoryEntryId,
  TaskExecutionCycle,
  TaskExecutionCycleId,
  TaskParticipant,
  TaskParticipantId,
  TaskPause,
  TaskPauseId,
} from '../../domain/task';
import { normalizeTagName } from '../../domain/task-policies';

export class DexieTaskRepository implements TaskRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Task, TaskId>(TRANSACTION_RESOURCES.TASKS);
  }

  async findById(organizationId: OrganizationId, taskId: TaskId): Promise<Task | null> {
    return findOrganizationScopedById(this.table, organizationId, taskId, 'Task');
  }

  async listByOrganization(
    organizationId: OrganizationId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly Task[]> {
    return withPersistenceErrorHandling('Task.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();
      const filtered = filterSoftDeleted(records, options?.includeDeleted);
      return filtered.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }

  async listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly Task[]> {
    return withPersistenceErrorHandling('Task.listByProject', async () => {
      const records = await this.table
        .where('[organizationId+projectId]')
        .equals([organizationId, projectId])
        .toArray();

      const filtered = filterSoftDeleted(records, options?.includeDeleted);
      return filtered.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }

  async listByColumn(
    organizationId: OrganizationId,
    columnId: BoardColumnId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly Task[]> {
    return withPersistenceErrorHandling('Task.listByColumn', async () => {
      const records = await this.table
        .where('[organizationId+columnId]')
        .equals([organizationId, columnId])
        .toArray();

      const filtered = filterSoftDeleted(records, options?.includeDeleted);
      return filtered.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }

  async listByAssignee(
    organizationId: OrganizationId,
    assigneeId: UserId,
  ): Promise<readonly Task[]> {
    return withPersistenceErrorHandling('Task.listByAssignee', async () => {
      const records = await this.table
        .where('[organizationId+assigneeId]')
        .equals([organizationId, assigneeId])
        .toArray();

      const filtered = filterSoftDeleted(records);
      return filtered.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }

  async save(task: Task): Promise<void> {
    await saveOrganizationScopedEntity(this.table, task, 'Task');
  }

  async saveMany(organizationId: OrganizationId, tasks: readonly Task[]): Promise<void> {
    await saveManyOrganizationScopedEntities(this.table, organizationId, tasks, 'Task');
  }
}

export class DexieTaskParticipantRepository implements TaskParticipantRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskParticipant, TaskParticipantId>(
      TRANSACTION_RESOURCES.TASK_PARTICIPANTS,
    );
  }

  async findByTaskAndUser(
    organizationId: OrganizationId,
    taskId: TaskId,
    userId: UserId,
  ): Promise<TaskParticipant | null> {
    return withPersistenceErrorHandling('TaskParticipant.findByTaskAndUser', async () => {
      const record = await this.table
        .where('[organizationId+taskId+userId]')
        .equals([organizationId, taskId, userId])
        .first();
      return record ?? null;
    });
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly TaskParticipant[]> {
    return withPersistenceErrorHandling('TaskParticipant.listByOrganization', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .between([organizationId, Dexie.minKey], [organizationId, Dexie.maxKey])
        .toArray();
      return records.sort(
        (a, b) =>
          a.taskId.localeCompare(b.taskId) ||
          a.userId.localeCompare(b.userId) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskParticipant[]> {
    return withPersistenceErrorHandling('TaskParticipant.listByTask', async () => {
      return this.table.where('[organizationId+taskId]').equals([organizationId, taskId]).toArray();
    });
  }

  async listByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly TaskParticipant[]> {
    return withPersistenceErrorHandling('TaskParticipant.listByUser', async () => {
      return this.table.where('[organizationId+userId]').equals([organizationId, userId]).toArray();
    });
  }

  async save(participant: TaskParticipant): Promise<void> {
    await saveOrganizationScopedEntity(this.table, participant, 'TaskParticipant');
  }
}

export class DexieSubtaskRepository implements SubtaskRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Subtask, SubtaskId>(TRANSACTION_RESOURCES.SUBTASKS);
  }

  async findById(organizationId: OrganizationId, subtaskId: SubtaskId): Promise<Subtask | null> {
    return findOrganizationScopedById(this.table, organizationId, subtaskId, 'Subtask');
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly Subtask[]> {
    return withPersistenceErrorHandling('Subtask.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();
      return records.sort(
        (a, b) => a.taskId.localeCompare(b.taskId) || a.order - b.order || a.id.localeCompare(b.id),
      );
    });
  }

  async listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly Subtask[]> {
    return withPersistenceErrorHandling('Subtask.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      return records.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }

  async save(subtask: Subtask): Promise<void> {
    await saveOrganizationScopedEntity(this.table, subtask, 'Subtask');
  }

  async saveMany(organizationId: OrganizationId, subtasks: readonly Subtask[]): Promise<void> {
    await saveManyOrganizationScopedEntities(this.table, organizationId, subtasks, 'Subtask');
  }

  async delete(organizationId: OrganizationId, subtaskId: SubtaskId): Promise<void> {
    await deleteOrganizationScopedById(this.table, organizationId, subtaskId, 'Subtask');
  }
}

export class DexieTaskPauseRepository implements TaskPauseRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskPause, TaskPauseId>(TRANSACTION_RESOURCES.TASK_PAUSES);
  }

  async listByTask(organizationId: OrganizationId, taskId: TaskId): Promise<readonly TaskPause[]> {
    return withPersistenceErrorHandling('TaskPause.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      return records.sort(
        (a, b) => parseIsoDateTimeMs(a.startedAt) - parseIsoDateTimeMs(b.startedAt),
      );
    });
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly TaskPause[]> {
    return withPersistenceErrorHandling('TaskPause.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.startedAt) - parseIsoDateTimeMs(b.startedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(pause: TaskPause): Promise<void> {
    await saveOrganizationScopedEntity(this.table, pause, 'TaskPause');
  }
}

export class DexieTaskExecutionCycleRepository implements TaskExecutionCycleRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskExecutionCycle, TaskExecutionCycleId>(
      TRANSACTION_RESOURCES.TASK_EXECUTION_CYCLES,
    );
  }

  async listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskExecutionCycle[]> {
    return withPersistenceErrorHandling('TaskExecutionCycle.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      return records.sort((a, b) => a.cycleNumber - b.cycleNumber);
    });
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly TaskExecutionCycle[]> {
    return withPersistenceErrorHandling('TaskExecutionCycle.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.startedAt) - parseIsoDateTimeMs(b.startedAt) ||
          a.cycleNumber - b.cycleNumber,
      );
    });
  }

  async listByProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<readonly TaskExecutionCycle[]> {
    return withPersistenceErrorHandling('TaskExecutionCycle.listByProject', async () => {
      const records = await this.table
        .where('[organizationId+projectId]')
        .equals([organizationId, projectId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.startedAt) - parseIsoDateTimeMs(b.startedAt) ||
          a.cycleNumber - b.cycleNumber,
      );
    });
  }

  async save(cycle: TaskExecutionCycle): Promise<void> {
    await saveOrganizationScopedEntity(this.table, cycle, 'TaskExecutionCycle');
  }
}

export class DexieTaskCommentRepository implements TaskCommentRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskComment, TaskCommentId>(TRANSACTION_RESOURCES.TASK_COMMENTS);
  }

  async findById(
    organizationId: OrganizationId,
    commentId: TaskCommentId,
  ): Promise<TaskComment | null> {
    return findOrganizationScopedById(this.table, organizationId, commentId, 'TaskComment');
  }

  async listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly TaskComment[]> {
    return withPersistenceErrorHandling('TaskComment.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      const filtered = filterSoftDeleted(records, options?.includeDeleted);
      return filtered.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.createdAt) - parseIsoDateTimeMs(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(comment: TaskComment): Promise<void> {
    await saveOrganizationScopedEntity(this.table, comment, 'TaskComment');
  }
}

export class DexieTaskAttachmentRepository implements TaskAttachmentRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskAttachment, AttachmentId>(TRANSACTION_RESOURCES.TASK_ATTACHMENTS);
  }

  async findById(
    organizationId: OrganizationId,
    attachmentId: AttachmentId,
  ): Promise<TaskAttachment | null> {
    return findOrganizationScopedById(this.table, organizationId, attachmentId, 'TaskAttachment');
  }

  async listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskAttachment[]> {
    return withPersistenceErrorHandling('TaskAttachment.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.uploadedAt) - parseIsoDateTimeMs(b.uploadedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async save(attachment: TaskAttachment): Promise<void> {
    await saveOrganizationScopedEntity(this.table, attachment, 'TaskAttachment');
  }

  async delete(organizationId: OrganizationId, attachmentId: AttachmentId): Promise<void> {
    await deleteOrganizationScopedById(this.table, organizationId, attachmentId, 'TaskAttachment');
  }
}

export class DexieTagRepository implements TagRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<Tag, TagId>(TRANSACTION_RESOURCES.TAGS);
  }

  async findById(organizationId: OrganizationId, tagId: TagId): Promise<Tag | null> {
    return findOrganizationScopedById(this.table, organizationId, tagId, 'Tag');
  }

  async findByNormalizedName(organizationId: OrganizationId, name: string): Promise<Tag | null> {
    const normalized = normalizeTagName(name);
    return withPersistenceErrorHandling('Tag.findByNormalizedName', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();
      return records.find((record) => normalizeTagName(record.name) === normalized) ?? null;
    });
  }

  async listByOrganization(organizationId: OrganizationId): Promise<readonly Tag[]> {
    return withPersistenceErrorHandling('Tag.listByOrganization', async () => {
      const records = await this.table.where('organizationId').equals(organizationId).toArray();

      return records.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async save(tag: Tag): Promise<void> {
    const normalized = normalizeTagName(tag.name);
    await withPersistenceErrorHandling('Tag.save', async () => {
      const orgTags = await this.table.where('organizationId').equals(tag.organizationId).toArray();
      const collision = orgTags.find(
        (existing) => existing.id !== tag.id && normalizeTagName(existing.name) === normalized,
      );
      if (collision !== undefined) {
        throw new ConflictError(`Tag "${tag.name.trim()}" already exists in this organization.`, {
          details: { organizationId: tag.organizationId, tagId: collision.id },
        });
      }
    });

    await saveOrganizationScopedEntity(this.table, tag, 'Tag');
  }

  async delete(organizationId: OrganizationId, tagId: TagId): Promise<void> {
    await deleteOrganizationScopedById(this.table, organizationId, tagId, 'Tag');
  }
}

export class DexieTaskDeadlineHistoryRepository implements TaskDeadlineHistoryRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<TaskDeadlineHistoryEntry, TaskDeadlineHistoryEntryId>(
      TRANSACTION_RESOURCES.TASK_DEADLINE_HISTORY,
    );
  }

  async listByTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<readonly TaskDeadlineHistoryEntry[]> {
    return withPersistenceErrorHandling('TaskDeadlineHistory.listByTask', async () => {
      const records = await this.table
        .where('[organizationId+taskId]')
        .equals([organizationId, taskId])
        .toArray();

      return records.sort(
        (a, b) =>
          parseIsoDateTimeMs(a.changedAt) - parseIsoDateTimeMs(b.changedAt) ||
          a.id.localeCompare(b.id),
      );
    });
  }

  async append(entry: TaskDeadlineHistoryEntry): Promise<void> {
    await appendImmutableEntity(this.table, entry, 'TaskDeadlineHistory');
  }
}
