import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  AddTaskDependencyInput,
  TaskDependencyId,
  TaskDependencyListItem,
} from '@/modules/dependencies';
import {
  TaskDependenciesPanel,
  type DependencyTargetOption,
} from '@/modules/dependencies/presentation';
import type {
  CreateImpedimentInput,
  Impediment,
  TransitionImpedimentInput,
  UpdateImpedimentInput,
} from '@/modules/impediments';
import { TaskImpedimentsPanel } from '@/modules/impediments/presentation';
import type { ProjectBoardView } from '@/modules/kanban';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { ProjectDetails } from '@/modules/projects';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type {
  AssignSubtaskInput,
  AssignTaskInput,
  CompleteTaskInput,
  CreateSubtaskInput,
  ReopenTaskInput,
  Tag,
  Task,
  TaskAttachment,
  TaskCommentId,
  TaskCommentInput,
  TaskDetail,
  UpdateSubtaskInput,
  UpdateTaskInput,
} from '@/modules/tasks';
import { TaskDetailPanel, type TaskPanelFeedback } from '@/modules/tasks/presentation';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import type { MessageId } from '@/shared/i18n';
import {
  asIsoDateTime,
  asProjectId,
  asTaskId,
  isSoftDeleted,
  isUuid,
  type AttachmentId,
  type ImpedimentId,
  type IsoDateTime,
  type ProjectId,
  type SubtaskId,
  type TaskId,
  type UserId,
} from '@/shared/kernel';
import {
  buildTaskDetailCapabilities,
  buildTaskUsersDirectory,
  resolveTaskPageErrorMessageId,
} from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedTaskDetailState {
  readonly contextKey: string | null;
  readonly detail: TaskDetail | null;
  readonly boardView: ProjectBoardView | null;
  readonly orgTags: readonly Tag[];
  readonly projectTasks: readonly Task[];
  readonly projectDetails: ProjectDetails | null;
  readonly orgMembers: readonly OrganizationMemberDetails[];
  readonly dependencies: readonly TaskDependencyListItem[];
  readonly dependenciesDenied: boolean;
  readonly impediments: readonly Impediment[];
  readonly impedimentsDenied: boolean;
  readonly settings: OrganizationSettings | null;
  readonly referenceNowIso: IsoDateTime | null;
  readonly referenceNowMs: number;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_TASK_DETAIL_STATE: LoadedTaskDetailState = {
  contextKey: null,
  detail: null,
  boardView: null,
  orgTags: [],
  projectTasks: [],
  projectDetails: null,
  orgMembers: [],
  dependencies: [],
  dependenciesDenied: false,
  impediments: [],
  impedimentsDenied: false,
  settings: null,
  referenceNowIso: null,
  referenceNowMs: 0,
  errorMessageId: null,
};

function isAuthorizationFailure(error: unknown): boolean {
  return isAppError(error) && error.code === APP_ERROR_CODES.AUTHORIZATION_ERROR;
}

export function TaskDetailPage() {
  const intl = useIntl();
  const { projectId, taskId } = useParams<{
    readonly projectId: string;
    readonly taskId: string;
  }>();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can, scopeSummary, refreshPermissions } = usePermission();

  const [state, setState] = useState<LoadedTaskDetailState>(INITIAL_TASK_DETAIL_STATE);
  const [feedback, setFeedback] = useState<TaskPanelFeedback | null>(null);
  const [isSubpanelMutating, setIsSubpanelMutating] = useState(false);

  const validProjectId: ProjectId | null =
    projectId !== undefined && isUuid(projectId) ? asProjectId(projectId, 'projectId') : null;
  const validTaskId: TaskId | null =
    taskId !== undefined && isUuid(taskId) ? asTaskId(taskId, 'taskId') : null;

  const canViewOrgMembers = can(PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW);

  const contextKey =
    user !== null && activeOrganization !== null && validProjectId !== null && validTaskId !== null
      ? `${user.id}:${activeOrganization.id}:${validProjectId}:${validTaskId}`
      : null;

  const loadTaskDetailBundle = useCallback(
    async (
      actorUserId: UserId,
      targetOrgId: typeof activeOrganization extends null
        ? never
        : NonNullable<typeof activeOrganization>['id'],
      targetProjectId: ProjectId,
      targetTaskId: TaskId,
    ): Promise<Omit<LoadedTaskDetailState, 'contextKey'>> => {
      const detail = await services.tasks.getTaskDetail(actorUserId, targetOrgId, targetTaskId);

      if (detail.task.projectId !== targetProjectId) {
        return {
          detail: null,
          boardView: null,
          orgTags: [],
          projectTasks: [],
          projectDetails: null,
          orgMembers: [],
          dependencies: [],
          dependenciesDenied: false,
          impediments: [],
          impedimentsDenied: false,
          settings: null,
          referenceNowIso: null,
          referenceNowMs: 0,
          errorMessageId: 'errors.NOT_FOUND',
        };
      }

      let dependenciesDenied = false;
      let impedimentsDenied = false;

      const [
        boardView,
        orgTags,
        projectTasks,
        projectDetails,
        orgMembers,
        dependencies,
        impediments,
        persistedSettings,
      ] = await Promise.all([
        services.kanban
          .getProjectBoard(actorUserId, targetOrgId, targetProjectId)
          .catch(() => null),
        services.tasks.listTags(actorUserId, targetOrgId).catch(() => []),
        services.tasks.listProjectTasks(actorUserId, targetOrgId, targetProjectId).catch(() => []),
        services.projects
          .getProjectDetails(actorUserId, targetOrgId, targetProjectId)
          .catch(() => null),
        canViewOrgMembers
          ? services.organizations.listOrganizationMembers(actorUserId, targetOrgId).catch(() => [])
          : Promise.resolve([]),
        services.dependencies
          .listTaskDependencies(actorUserId, targetOrgId, targetTaskId)
          .catch((error: unknown) => {
            if (isAuthorizationFailure(error)) {
              dependenciesDenied = true;
            }
            return [];
          }),
        services.impediments
          .listTaskImpediments(actorUserId, targetOrgId, targetTaskId)
          .catch((error: unknown) => {
            if (isAuthorizationFailure(error)) {
              impedimentsDenied = true;
            }
            return [];
          }),
        repositories.settings.organizationSettings
          .findByOrganization(targetOrgId)
          .catch(() => null),
      ]);

      const nowDate = new Date();
      const nowIso = asIsoDateTime(nowDate.toISOString());
      const effectiveSettings =
        persistedSettings ?? createDefaultOrganizationSettings(targetOrgId, nowIso);

      return {
        detail,
        boardView,
        orgTags,
        projectTasks,
        projectDetails,
        orgMembers,
        dependencies,
        dependenciesDenied,
        impediments,
        impedimentsDenied,
        settings: effectiveSettings,
        referenceNowIso: nowIso,
        referenceNowMs: nowDate.getTime(),
        errorMessageId: null,
      };
    },
    [
      canViewOrgMembers,
      repositories.settings.organizationSettings,
      services.dependencies,
      services.impediments,
      services.kanban,
      services.organizations,
      services.projects,
      services.tasks,
    ],
  );

  const reloadDetail = useCallback(async () => {
    if (
      user === null ||
      activeOrganization === null ||
      validProjectId === null ||
      validTaskId === null ||
      contextKey === null
    ) {
      return;
    }

    const next = await loadTaskDetailBundle(
      user.id,
      activeOrganization.id,
      validProjectId,
      validTaskId,
    );
    setState({
      contextKey,
      ...next,
    });
  }, [activeOrganization, contextKey, loadTaskDetailBundle, user, validProjectId, validTaskId]);

  useEffect(() => {
    if (
      user === null ||
      activeOrganization === null ||
      validProjectId === null ||
      validTaskId === null ||
      contextKey === null
    ) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetProjectId = validProjectId;
    const targetTaskId = validTaskId;
    const targetKey = contextKey;

    async function load() {
      try {
        const next = await loadTaskDetailBundle(
          actorUserId,
          targetOrgId,
          targetProjectId,
          targetTaskId,
        );
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          ...next,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          ...INITIAL_TASK_DETAIL_STATE,
          contextKey: targetKey,
          errorMessageId: resolveTaskPageErrorMessageId(error),
        });
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, contextKey, loadTaskDetailBundle, user, validProjectId, validTaskId]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const detail = isCurrentContext ? state.detail : null;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (activeOrganization === null) {
      document.title = `${intl.formatMessage({ id: 'organizations.title' })} | ${shortName}`;
      return;
    }
    if (validProjectId === null || validTaskId === null) {
      document.title = `${intl.formatMessage({ id: 'errors.NOT_FOUND' })} | ${shortName}`;
      return;
    }
    if (loadErrorMessageId !== null) {
      const errorTitleId: MessageId =
        loadErrorMessageId === 'errors.AUTHORIZATION_ERROR'
          ? 'feedback.unauthorizedTitle'
          : loadErrorMessageId;
      document.title = `${intl.formatMessage({ id: errorTitleId })} | ${shortName}`;
      return;
    }
    if (detail !== null) {
      document.title = intl.formatMessage(
        { id: 'tasks.detail.pageTitle' },
        { title: detail.task.title },
      );
      return;
    }
    document.title = intl.formatMessage({ id: 'app.name' });
  }, [activeOrganization, detail, intl, loadErrorMessageId, validProjectId, validTaskId]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return (
      <TaskPageStatusView kind="no-org" headingId="task-detail-no-org-heading" headingText="" />
    );
  }

  if (validProjectId === null || validTaskId === null) {
    return (
      <TaskPageStatusView
        kind="error"
        headingId="task-detail-error-heading"
        headingText={intl.formatMessage({ id: 'errors.NOT_FOUND' })}
        descriptionText={intl.formatMessage({ id: 'validation.uuidInvalid' })}
      />
    );
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="task-detail-loading-heading"
        headingText={intl.formatMessage({ id: 'tasks.detail.title' })}
      />
    );
  }

  if (
    loadErrorMessageId !== null ||
    detail === null ||
    state.settings === null ||
    state.referenceNowIso === null
  ) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="task-detail-error-heading"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
        backToPath={`/projects/${validProjectId}/tasks`}
        backLabelId="tasks.detail.backToList"
      />
    );
  }

  const policyConfig = toAuthorizationPolicyConfig(state.settings);
  const {
    permissions,
    canViewDependencies,
    canViewImpediments,
    canCreateImpediment,
    canResolveByImpedimentId,
  } = buildTaskDetailCapabilities({
    detail,
    actorRole: activeOrganization.role,
    managedProjectIds: scopeSummary.managedProjectIds,
    impediments: state.impediments,
    can,
    policyConfig,
  });

  const { projectMembers, usersById } = buildTaskUsersDirectory({
    currentUser: {
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
    },
    orgMembers: state.orgMembers,
    projectDetails: state.projectDetails,
  });

  const boardColumns =
    state.boardView?.columns ?? (detail.column !== undefined ? [detail.column] : []);

  const isReadOnlyContext =
    isSoftDeleted(detail.task) ||
    isSoftDeleted(detail.project) ||
    detail.project.archivedAt !== undefined ||
    detail.project.status === 'ARCHIVED';

  const runSoftAction = async (
    action: () => Promise<void>,
    successMessageId: MessageId,
    successValues?: Record<string, string | number>,
    shouldRefreshPermissions = false,
  ): Promise<void> => {
    setFeedback(null);
    try {
      await action();
      await reloadDetail();
      if (shouldRefreshPermissions) {
        await refreshPermissions();
      }
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: successMessageId }, successValues),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    }
  };

  const runThrowingAction = async (
    action: () => Promise<void>,
    successMessageId: MessageId,
    successValues?: Record<string, string | number>,
    shouldRefreshPermissions = false,
  ): Promise<void> => {
    setFeedback(null);
    try {
      await action();
      await reloadDetail();
      if (shouldRefreshPermissions) {
        await refreshPermissions();
      }
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: successMessageId }, successValues),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
      throw error;
    }
  };

  const handleUpdateTask = async (input: UpdateTaskInput) => {
    setFeedback(null);
    try {
      const updated = await services.tasks.updateTask(
        user.id,
        activeOrganization.id,
        validTaskId,
        input,
      );
      await reloadDetail();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'tasks.edit.saveSuccess' }, { title: updated.title }),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    }
  };

  const handleAssignTask = (input: AssignTaskInput) =>
    runSoftAction(
      () =>
        services.tasks
          .assignTask(user.id, activeOrganization.id, validTaskId, input)
          .then(() => undefined),
      'tasks.assign.saveSuccess',
      undefined,
      true,
    );

  const handleAddParticipant = (targetUserId: UserId) =>
    runSoftAction(
      () =>
        services.tasks
          .addTaskParticipant(user.id, activeOrganization.id, validTaskId, { userId: targetUserId })
          .then(() => undefined),
      'tasks.participants.addSuccess',
      undefined,
      true,
    );

  const handleRemoveParticipant = (targetUserId: UserId) =>
    runSoftAction(
      () =>
        services.tasks
          .removeTaskParticipant(user.id, activeOrganization.id, validTaskId, targetUserId)
          .then(() => undefined),
      'tasks.participants.removeSuccess',
      undefined,
      true,
    );

  const handleStartTask = () =>
    runSoftAction(
      () =>
        services.tasks.startTask(user.id, activeOrganization.id, validTaskId).then(() => undefined),
      'tasks.actions.startSuccess',
    );

  const handlePauseTask = (reason: string) =>
    runThrowingAction(
      () =>
        services.tasks
          .pauseTask(user.id, activeOrganization.id, validTaskId, { reason })
          .then(() => undefined),
      'tasks.pause.success',
    );

  const handleResumeTask = () =>
    runSoftAction(
      () =>
        services.tasks
          .resumeTask(user.id, activeOrganization.id, validTaskId)
          .then(() => undefined),
      'tasks.resume.success',
    );

  const handleCompleteTask = async (input?: CompleteTaskInput) => {
    setFeedback(null);
    await services.tasks.completeTask(user.id, activeOrganization.id, validTaskId, input);
    await reloadDetail();
    setFeedback({
      type: 'success',
      message: intl.formatMessage({ id: 'tasks.complete.success' }),
    });
  };

  const handleCancelTask = (justification: string) =>
    runThrowingAction(
      () =>
        services.tasks
          .cancelTask(user.id, activeOrganization.id, validTaskId, { justification })
          .then(() => undefined),
      'tasks.cancel.success',
    );

  const handleRequestTaskCancellation = (justification: string) =>
    runThrowingAction(
      () =>
        services.tasks
          .requestTaskCancellation(user.id, activeOrganization.id, validTaskId, { justification })
          .then(() => undefined),
      'tasks.cancelRequest.success',
    );

  const handleReopenTask = (input: ReopenTaskInput) =>
    runThrowingAction(
      () =>
        services.tasks
          .reopenTask(user.id, activeOrganization.id, validTaskId, input)
          .then(() => undefined),
      'tasks.reopen.success',
    );

  const handleDeleteTask = (reason?: string) =>
    runThrowingAction(
      () =>
        services.tasks
          .deleteTask(
            user.id,
            activeOrganization.id,
            validTaskId,
            reason !== undefined ? { reason } : {},
          )
          .then(() => undefined),
      'tasks.delete.success',
      { title: detail.task.title },
      true,
    );

  const handleRestoreTask = async () => {
    setFeedback(null);
    try {
      const restored = await services.tasks.restoreTask(
        user.id,
        activeOrganization.id,
        validTaskId,
      );
      await reloadDetail();
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'tasks.restore.success' }, { title: restored.title }),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    }
  };

  const handleCreateSubtask = (input: CreateSubtaskInput) =>
    runSoftAction(
      () =>
        services.tasks
          .createSubtask(user.id, activeOrganization.id, validTaskId, input)
          .then(() => undefined),
      'subtasks.create.success',
      { title: input.title },
    );

  const handleUpdateSubtask = (subtaskId: SubtaskId, input: UpdateSubtaskInput) =>
    runSoftAction(
      () =>
        services.tasks
          .updateSubtask(user.id, activeOrganization.id, validTaskId, subtaskId, input)
          .then(() => undefined),
      'subtasks.edit.saveSuccess',
    );

  const handleAssignSubtask = (subtaskId: SubtaskId, input: AssignSubtaskInput) =>
    runSoftAction(
      () =>
        services.tasks
          .assignSubtask(user.id, activeOrganization.id, validTaskId, subtaskId, input)
          .then(() => undefined),
      'subtasks.assign.success',
    );

  const handleCompleteSubtask = (subtaskId: SubtaskId, title: string) =>
    runSoftAction(
      () =>
        services.tasks
          .completeSubtask(user.id, activeOrganization.id, validTaskId, subtaskId)
          .then(() => undefined),
      'subtasks.complete.success',
      { title },
    );

  const handleReorderSubtasks = (orderedSubtaskIds: readonly SubtaskId[]) =>
    runSoftAction(
      () =>
        services.tasks
          .reorderSubtasks(user.id, activeOrganization.id, validTaskId, orderedSubtaskIds)
          .then(() => undefined),
      'subtasks.reorderSuccess',
    );

  const handleDeleteSubtask = (subtaskId: SubtaskId, title: string) =>
    runSoftAction(
      () =>
        services.tasks
          .deleteSubtask(user.id, activeOrganization.id, validTaskId, subtaskId)
          .then(() => undefined),
      'subtasks.delete.success',
      { title },
    );

  const handleAddComment = (input: TaskCommentInput) =>
    runSoftAction(
      () =>
        services.tasks
          .addTaskComment(user.id, activeOrganization.id, validTaskId, input)
          .then(() => undefined),
      'comments.create.success',
    );

  const handleUpdateComment = (commentId: TaskCommentId, input: TaskCommentInput) =>
    runThrowingAction(
      () =>
        services.tasks
          .updateTaskComment(user.id, activeOrganization.id, validTaskId, commentId, input)
          .then(() => undefined),
      'comments.edit.success',
    );

  const handleDeleteComment = (commentId: TaskCommentId, reason?: string) =>
    runSoftAction(
      () =>
        services.tasks
          .deleteTaskComment(
            user.id,
            activeOrganization.id,
            validTaskId,
            commentId,
            reason !== undefined ? { reason } : {},
          )
          .then(() => undefined),
      'comments.delete.success',
    );

  const handleUploadAttachment = async (file: File) => {
    setFeedback(null);
    const arrayBuffer = await file.arrayBuffer();
    await services.tasks.uploadTaskAttachment(user.id, activeOrganization.id, validTaskId, {
      fileName: file.name,
      mimeType: file.type.trim() || 'application/octet-stream',
      bytes: new Uint8Array(arrayBuffer),
    });
    await reloadDetail();
    setFeedback({
      type: 'success',
      message: intl.formatMessage({ id: 'attachments.upload.success' }, { fileName: file.name }),
    });
  };

  const handleDownloadAttachment = async (attachment: TaskAttachment) => {
    setFeedback(null);
    try {
      const content = await services.tasks.getTaskAttachmentContent(
        user.id,
        activeOrganization.id,
        validTaskId,
        attachment.id,
      );
      const copiedBytes = new Uint8Array(content.bytes.byteLength);
      copiedBytes.set(content.bytes);
      const blob = new Blob([copiedBytes], { type: content.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = content.attachment.fileName;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'attachments.download.success' },
          { fileName: content.attachment.fileName },
        ),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    }
  };

  const handleDeleteAttachment = (attachmentId: AttachmentId, fileName: string) =>
    runSoftAction(
      () =>
        services.tasks
          .deleteTaskAttachment(user.id, activeOrganization.id, validTaskId, attachmentId)
          .then(() => undefined),
      'attachments.delete.success',
      { fileName },
    );

  const handleAddDependency = async (input: AddTaskDependencyInput) => {
    setFeedback(null);
    setIsSubpanelMutating(true);
    try {
      await services.dependencies.addDependency(user.id, activeOrganization.id, validTaskId, input);
      await reloadDetail();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'dependencies.add.success' }),
      });
    } finally {
      setIsSubpanelMutating(false);
    }
  };

  const handleRemoveDependency = async (dependencyId: TaskDependencyId) => {
    setFeedback(null);
    setIsSubpanelMutating(true);
    try {
      await services.dependencies.removeDependency(
        user.id,
        activeOrganization.id,
        validTaskId,
        dependencyId,
      );
      await reloadDetail();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'dependencies.remove.success' }),
      });
    } finally {
      setIsSubpanelMutating(false);
    }
  };

  const handleCreateImpediment = async (input: CreateImpedimentInput) => {
    setFeedback(null);
    setIsSubpanelMutating(true);
    try {
      await services.impediments.createImpediment(
        user.id,
        activeOrganization.id,
        validTaskId,
        input,
      );
      await reloadDetail();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'impediments.create.success' }),
      });
    } finally {
      setIsSubpanelMutating(false);
    }
  };

  const handleUpdateImpediment = async (
    impedimentId: ImpedimentId,
    input: UpdateImpedimentInput,
  ) => {
    setFeedback(null);
    setIsSubpanelMutating(true);
    try {
      await services.impediments.updateImpediment(
        user.id,
        activeOrganization.id,
        validTaskId,
        impedimentId,
        input,
      );
      await reloadDetail();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'impediments.edit.saveSuccess' }),
      });
    } finally {
      setIsSubpanelMutating(false);
    }
  };

  const handleTransitionImpediment = async (
    impedimentId: ImpedimentId,
    input: TransitionImpedimentInput,
  ) => {
    setFeedback(null);
    setIsSubpanelMutating(true);
    try {
      await services.impediments.transitionImpediment(
        user.id,
        activeOrganization.id,
        validTaskId,
        impedimentId,
        input,
      );
      await reloadDetail();
      setFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'impediments.transition.success' },
          { status: intl.formatMessage({ id: `impediments.status.${input.targetStatus}` }) },
        ),
      });
    } finally {
      setIsSubpanelMutating(false);
    }
  };

  const candidateTargets: DependencyTargetOption[] = state.projectTasks.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    status: candidate.status,
  }));

  const dependencyItems = state.dependencies.map((dependency) => ({
    ...dependency,
    relatedTaskAccessible: true,
  }));

  const impedimentOwnerOptions = projectMembers.map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
  }));

  return (
    <TaskDetailPanel
      detail={detail}
      actorUserId={user.id}
      orgTags={state.orgTags}
      boardColumns={boardColumns}
      projectMembers={projectMembers}
      usersById={usersById}
      permissions={permissions}
      commentEditWindowMinutes={state.settings.pendingPermissionDefaults.commentEditWindowMinutes}
      maxAttachmentSizeBytes={state.settings.pendingPermissionDefaults.maxAttachmentSizeBytes}
      maxContextAttachmentsSizeBytes={
        state.settings.pendingPermissionDefaults.maxContextAttachmentsSizeBytes
      }
      maxAttachmentsPerContext={state.settings.pendingPermissionDefaults.maxAttachmentsPerContext}
      referenceNowIso={state.referenceNowIso}
      referenceNowMs={state.referenceNowMs}
      dependenciesCount={state.dependencies.length}
      impedimentsCount={state.impediments.length}
      dependenciesContent={
        <TaskDependenciesPanel
          taskId={detail.task.id}
          taskStatus={detail.task.status}
          dependencies={dependencyItems}
          candidateTargets={candidateTargets}
          canViewDependencies={canViewDependencies && !state.dependenciesDenied}
          canManageDependencies={permissions.canManageDependencies}
          isReadOnly={isReadOnlyContext}
          isMutating={isSubpanelMutating}
          onAddDependency={handleAddDependency}
          onRemoveDependency={handleRemoveDependency}
        />
      }
      impedimentsContent={
        <TaskImpedimentsPanel
          taskStatus={detail.task.status}
          impediments={state.impediments}
          ownerOptions={impedimentOwnerOptions}
          usersById={usersById}
          canViewImpediments={canViewImpediments && !state.impedimentsDenied}
          canCreateImpediment={canCreateImpediment}
          canResolveByImpedimentId={canResolveByImpedimentId}
          isReadOnly={isReadOnlyContext}
          isMutating={isSubpanelMutating}
          onCreateImpediment={handleCreateImpediment}
          onUpdateImpediment={handleUpdateImpediment}
          onTransitionImpediment={handleTransitionImpediment}
        />
      }
      feedback={feedback}
      onUpdateTask={handleUpdateTask}
      onAssignTask={handleAssignTask}
      onAddParticipant={handleAddParticipant}
      onRemoveParticipant={handleRemoveParticipant}
      onStartTask={handleStartTask}
      onPauseTask={handlePauseTask}
      onResumeTask={handleResumeTask}
      onCompleteTask={handleCompleteTask}
      onCancelTask={handleCancelTask}
      onRequestTaskCancellation={handleRequestTaskCancellation}
      onReopenTask={handleReopenTask}
      onDeleteTask={handleDeleteTask}
      onRestoreTask={handleRestoreTask}
      onCreateSubtask={handleCreateSubtask}
      onUpdateSubtask={handleUpdateSubtask}
      onAssignSubtask={handleAssignSubtask}
      onCompleteSubtask={handleCompleteSubtask}
      onReorderSubtasks={handleReorderSubtasks}
      onDeleteSubtask={handleDeleteSubtask}
      onAddComment={handleAddComment}
      onUpdateComment={handleUpdateComment}
      onDeleteComment={handleDeleteComment}
      onUploadAttachment={handleUploadAttachment}
      onDownloadAttachment={handleDownloadAttachment}
      onDeleteAttachment={handleDeleteAttachment}
    />
  );
}

export default TaskDetailPage;
