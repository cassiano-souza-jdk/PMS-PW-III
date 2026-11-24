import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { ProjectBoardView } from '@/modules/kanban';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { ProjectDetails } from '@/modules/projects';
import {
  createDefaultOrganizationSettings,
  toAuthorizationPolicyConfig,
  type OrganizationSettings,
} from '@/modules/settings';
import type {
  CreateTagInput,
  CreateTaskInput,
  Tag,
  TagId,
  Task,
  UpdateTagInput,
} from '@/modules/tasks';
import { ProjectTasksPanel, type TaskPanelFeedback } from '@/modules/tasks/presentation';
import type { MessageId } from '@/shared/i18n';
import { asEntityId, asIsoDateTime, asProjectId, isUuid, type ProjectId } from '@/shared/kernel';
import {
  buildProjectAbacResource,
  buildTaskUsersDirectory,
  resolveTaskPageErrorMessageId,
} from './task-page-helpers';
import { TaskPageStatusView } from './task-page-status-view';

interface LoadedProjectTasksState {
  readonly contextKey: string | null;
  readonly boardView: ProjectBoardView | null;
  readonly tasks: readonly Task[];
  readonly tags: readonly Tag[];
  readonly projectDetails: ProjectDetails | null;
  readonly orgMembers: readonly OrganizationMemberDetails[];
  readonly settings: OrganizationSettings | null;
  readonly errorMessageId: MessageId | null;
}

const INITIAL_PROJECT_TASKS_STATE: LoadedProjectTasksState = {
  contextKey: null,
  boardView: null,
  tasks: [],
  tags: [],
  projectDetails: null,
  orgMembers: [],
  settings: null,
  errorMessageId: null,
};

export function ProjectTasksPage() {
  const intl = useIntl();
  const { projectId } = useParams<{ readonly projectId: string }>();
  const { services, repositories } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can } = usePermission();

  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [state, setState] = useState<LoadedProjectTasksState>(INITIAL_PROJECT_TASKS_STATE);
  const [feedback, setFeedback] = useState<TaskPanelFeedback | null>(null);

  const validProjectId: ProjectId | null =
    projectId !== undefined && isUuid(projectId) ? asProjectId(projectId, 'projectId') : null;

  const canViewOrgMembers = can(PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW);

  const contextKey =
    user !== null && activeOrganization !== null && validProjectId !== null
      ? `${user.id}:${activeOrganization.id}:${validProjectId}`
      : null;

  const fetchProjectTasksBundle = useCallback(
    async (nextIncludeDeleted: boolean) => {
      if (
        user === null ||
        activeOrganization === null ||
        validProjectId === null ||
        contextKey === null
      ) {
        return;
      }

      const actorUserId = user.id;
      const targetOrgId = activeOrganization.id;
      const targetProjectId = validProjectId;

      const [boardView, tasks, tags, projectDetails, orgMembers, persistedSettings] =
        await Promise.all([
          services.kanban.getProjectBoard(actorUserId, targetOrgId, targetProjectId),
          services.tasks.listProjectTasks(actorUserId, targetOrgId, targetProjectId, {
            includeDeleted: nextIncludeDeleted,
          }),
          services.tasks.listTags(actorUserId, targetOrgId).catch(() => []),
          services.projects
            .getProjectDetails(actorUserId, targetOrgId, targetProjectId)
            .catch(() => null),
          canViewOrgMembers
            ? services.organizations
                .listOrganizationMembers(actorUserId, targetOrgId)
                .catch(() => [])
            : Promise.resolve([]),
          repositories.settings.organizationSettings
            .findByOrganization(targetOrgId)
            .catch(() => null),
        ]);

      const nowIso = asIsoDateTime(new Date().toISOString());
      const effectiveSettings =
        persistedSettings ?? createDefaultOrganizationSettings(targetOrgId, nowIso);

      setState({
        contextKey,
        boardView,
        tasks,
        tags,
        projectDetails,
        orgMembers,
        settings: effectiveSettings,
        errorMessageId: null,
      });
    },
    [
      activeOrganization,
      canViewOrgMembers,
      contextKey,
      repositories.settings.organizationSettings,
      services.kanban,
      services.organizations,
      services.projects,
      services.tasks,
      user,
      validProjectId,
    ],
  );

  useEffect(() => {
    if (
      user === null ||
      activeOrganization === null ||
      validProjectId === null ||
      contextKey === null
    ) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetProjectId = validProjectId;
    const targetKey = contextKey;

    async function loadInitial() {
      try {
        const [boardView, tasks, tags, projectDetails, orgMembers, persistedSettings] =
          await Promise.all([
            services.kanban.getProjectBoard(actorUserId, targetOrgId, targetProjectId),
            services.tasks.listProjectTasks(actorUserId, targetOrgId, targetProjectId, {
              includeDeleted,
            }),
            services.tasks.listTags(actorUserId, targetOrgId).catch(() => []),
            services.projects
              .getProjectDetails(actorUserId, targetOrgId, targetProjectId)
              .catch(() => null),
            canViewOrgMembers
              ? services.organizations
                  .listOrganizationMembers(actorUserId, targetOrgId)
                  .catch(() => [])
              : Promise.resolve([]),
            repositories.settings.organizationSettings
              .findByOrganization(targetOrgId)
              .catch(() => null),
          ]);

        if (!isActive) {
          return;
        }

        const nowIso = asIsoDateTime(new Date().toISOString());
        const effectiveSettings =
          persistedSettings ?? createDefaultOrganizationSettings(targetOrgId, nowIso);

        setState({
          contextKey: targetKey,
          boardView,
          tasks,
          tags,
          projectDetails,
          orgMembers,
          settings: effectiveSettings,
          errorMessageId: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        setState({
          contextKey: targetKey,
          boardView: null,
          tasks: [],
          tags: [],
          projectDetails: null,
          orgMembers: [],
          settings: null,
          errorMessageId: resolveTaskPageErrorMessageId(error),
        });
      }
    }

    void loadInitial();

    return () => {
      isActive = false;
    };
  }, [
    activeOrganization,
    canViewOrgMembers,
    contextKey,
    includeDeleted,
    repositories.settings.organizationSettings,
    services.kanban,
    services.organizations,
    services.projects,
    services.tasks,
    user,
    validProjectId,
  ]);

  const isCurrentContext = contextKey !== null && state.contextKey === contextKey;
  const isInitialLoading = contextKey !== null && !isCurrentContext;
  const boardView = isCurrentContext ? state.boardView : null;
  const loadErrorMessageId = isCurrentContext ? state.errorMessageId : null;

  useEffect(() => {
    const shortName = intl.formatMessage({ id: 'app.shortName' });
    if (activeOrganization === null) {
      document.title = `${intl.formatMessage({ id: 'organizations.title' })} | ${shortName}`;
      return;
    }
    if (validProjectId === null) {
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
    if (boardView !== null) {
      document.title = intl.formatMessage(
        { id: 'tasks.list.pageTitle' },
        { name: boardView.project.name },
      );
      return;
    }
    document.title = intl.formatMessage({ id: 'app.name' });
  }, [activeOrganization, boardView, intl, loadErrorMessageId, validProjectId]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return <TaskPageStatusView kind="no-org" headingId="tasks-no-org-heading" headingText="" />;
  }

  if (validProjectId === null) {
    return (
      <TaskPageStatusView
        kind="error"
        headingId="project-tasks-error-heading"
        headingText={intl.formatMessage({ id: 'errors.NOT_FOUND' })}
        descriptionText={intl.formatMessage({ id: 'validation.uuidInvalid' })}
      />
    );
  }

  if (isInitialLoading) {
    return (
      <TaskPageStatusView
        kind="loading"
        headingId="project-tasks-loading-heading"
        headingText={intl.formatMessage({ id: 'nav.projects' })}
      />
    );
  }

  if (loadErrorMessageId !== null || boardView === null || state.settings === null) {
    const resolvedErrorId = loadErrorMessageId ?? 'errors.NOT_FOUND';
    const isUnauthorized = resolvedErrorId === 'errors.AUTHORIZATION_ERROR';
    return (
      <TaskPageStatusView
        kind="error"
        headingId="project-tasks-error-heading"
        headingText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedTitle' : resolvedErrorId,
        })}
        descriptionText={intl.formatMessage({
          id: isUnauthorized ? 'feedback.unauthorizedDescription' : resolvedErrorId,
        })}
      />
    );
  }

  const policyConfig = toAuthorizationPolicyConfig(state.settings);
  const projectResource = buildProjectAbacResource(boardView.project);

  const canViewBoard = can(
    PERMISSION_CODES.BOARD_VIEW,
    {
      ...projectResource,
      kind: 'BOARD',
    },
    policyConfig,
  );
  const canCreateTask = can(PERMISSION_CODES.TASK_CREATE, projectResource, policyConfig);
  const canAssignTask = can(PERMISSION_CODES.TASK_ASSIGN, projectResource, policyConfig);
  const canIncludeDeleted = can(
    PERMISSION_CODES.TRASH_VIEW,
    {
      ...projectResource,
      kind: 'TRASH',
      createdBy: user.id,
    },
    policyConfig,
  );
  const canManageTagCatalog = can(
    PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
    {
      kind: 'ORGANIZATION',
      id: asEntityId(activeOrganization.id),
      exists: true,
      organizationId: activeOrganization.id,
    },
    policyConfig,
  );

  const { projectMembers, usersById } = buildTaskUsersDirectory({
    currentUser: {
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
    },
    orgMembers: state.orgMembers,
    projectDetails: state.projectDetails,
  });

  const handleToggleIncludeDeleted = (next: boolean) => {
    setFeedback(null);
    setIncludeDeleted(next);
  };

  const handleCreateTask = async (input: CreateTaskInput) => {
    setFeedback(null);
    setIsRefreshing(true);
    try {
      const created = await services.tasks.createTask(
        user.id,
        activeOrganization.id,
        validProjectId,
        input,
      );
      await fetchProjectTasksBundle(includeDeleted);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'tasks.create.success' }, { title: created.title }),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateTag = async (input: CreateTagInput) => {
    setFeedback(null);
    setIsRefreshing(true);
    try {
      const created = await services.tasks.createTag(user.id, activeOrganization.id, input);
      await fetchProjectTasksBundle(includeDeleted);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'tags.catalog.createSuccess' }, { name: created.name }),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleUpdateTag = async (tagId: TagId, input: UpdateTagInput) => {
    setFeedback(null);
    setIsRefreshing(true);
    try {
      const updated = await services.tasks.updateTag(user.id, activeOrganization.id, tagId, input);
      await fetchProjectTasksBundle(includeDeleted);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'tags.catalog.saveSuccess' }, { name: updated.name }),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteTag = async (tagId: TagId, name: string) => {
    setFeedback(null);
    setIsRefreshing(true);
    try {
      await services.tasks.deleteTag(user.id, activeOrganization.id, tagId);
      await fetchProjectTasksBundle(includeDeleted);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'tags.catalog.deleteSuccess' }, { name }),
      });
    } catch (error) {
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: resolveTaskPageErrorMessageId(error) }),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ProjectTasksPanel
      project={boardView.project}
      tasks={state.tasks}
      columns={boardView.columns}
      tags={state.tags}
      projectMembers={projectMembers}
      usersById={usersById}
      includeDeleted={includeDeleted}
      isLoading={isRefreshing}
      canViewBoard={canViewBoard}
      canCreateTask={canCreateTask}
      canAssignTask={canAssignTask}
      canIncludeDeleted={canIncludeDeleted}
      canManageTagCatalog={canManageTagCatalog}
      feedback={feedback}
      onToggleIncludeDeleted={handleToggleIncludeDeleted}
      onCreateTask={handleCreateTask}
      onCreateTag={handleCreateTag}
      onUpdateTag={handleUpdateTag}
      onDeleteTag={handleDeleteTag}
    />
  );
}

export default ProjectTasksPage;
