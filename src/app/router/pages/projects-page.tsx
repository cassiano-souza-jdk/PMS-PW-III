import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type {
  CreateProjectInput,
  ProjectDetails,
  ProjectListItem,
  ProjectMemberRole,
  TransferProjectTeamInput,
  UpdateProjectInput,
} from '@/modules/projects';
import {
  ProjectsPanel,
  type ProjectPanelFeedback,
  type ProjectTeamScopeOption,
} from '@/modules/projects/presentation/projects-panel';
import type { Team } from '@/modules/teams';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';
import { ORGANIZATION_ROLES, asEntityId, type ProjectId, type UserId } from '@/shared/kernel';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui';

interface LoadedProjectsState {
  readonly contextKey: string | null;
  readonly projects: readonly ProjectListItem[];
  readonly teams: readonly Team[];
  readonly orgMembers: readonly OrganizationMemberDetails[];
}

interface LoadedProjectDetailsState {
  readonly projectKey: string | null;
  readonly details: ProjectDetails | null;
}

const INITIAL_PROJECTS_STATE: LoadedProjectsState = {
  contextKey: null,
  projects: [],
  teams: [],
  orgMembers: [],
};

const INITIAL_DETAILS_STATE: LoadedProjectDetailsState = {
  projectKey: null,
  details: null,
};

function isPendingTasksRemovalConflict(error: unknown): boolean {
  if (!isAppError(error) || error.code !== APP_ERROR_CODES.CONFLICT) {
    return false;
  }
  return (
    error.details?.pendingTaskCount !== undefined ||
    error.message.toLowerCase().includes('pending task')
  );
}

export function ProjectsPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can, scopeSummary, refreshPermissions } = usePermission();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const [projectsState, setProjectsState] = useState<LoadedProjectsState>(INITIAL_PROJECTS_STATE);
  const [detailsState, setDetailsState] =
    useState<LoadedProjectDetailsState>(INITIAL_DETAILS_STATE);
  const [feedback, setFeedback] = useState<ProjectPanelFeedback | null>(null);

  const canViewOrgMembers = can(PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW);

  const contextKey =
    user !== null && activeOrganization !== null
      ? `${user.id}:${activeOrganization.id}:${includeArchived ? 'all' : 'active'}`
      : null;

  const reloadProjectsList = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    const [projects, teams, orgMembers] = await Promise.all([
      services.projects.listProjects(user.id, activeOrganization.id, { includeArchived }),
      services.teams
        .listTeams(user.id, activeOrganization.id, { includeArchived: false })
        .catch(() => []),
      canViewOrgMembers
        ? services.organizations
            .listOrganizationMembers(user.id, activeOrganization.id)
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    setProjectsState({
      contextKey,
      projects,
      teams,
      orgMembers,
    });
  }, [
    activeOrganization,
    canViewOrgMembers,
    contextKey,
    includeArchived,
    services.organizations,
    services.projects,
    services.teams,
    user,
  ]);

  const reloadSelectedProjectDetails = useCallback(
    async (projectId: ProjectId) => {
      if (user === null || activeOrganization === null) {
        return;
      }
      const details = await services.projects.getProjectDetails(
        user.id,
        activeOrganization.id,
        projectId,
      );
      setDetailsState({
        projectKey: `${activeOrganization.id}:${projectId}`,
        details,
      });
    },
    [activeOrganization, services.projects, user],
  );

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetKey = contextKey;

    async function loadProjects() {
      try {
        const [projects, teams, orgMembers] = await Promise.all([
          services.projects.listProjects(actorUserId, targetOrgId, { includeArchived }),
          services.teams
            .listTeams(actorUserId, targetOrgId, { includeArchived: false })
            .catch(() => []),
          canViewOrgMembers
            ? services.organizations
                .listOrganizationMembers(actorUserId, targetOrgId)
                .catch(() => [])
            : Promise.resolve([]),
        ]);

        if (!isActive) {
          return;
        }

        setProjectsState({
          contextKey: targetKey,
          projects,
          teams,
          orgMembers,
        });
      } catch {
        if (!isActive) {
          return;
        }
        setProjectsState({
          contextKey: targetKey,
          projects: [],
          teams: [],
          orgMembers: [],
        });
      }
    }

    void loadProjects();

    return () => {
      isActive = false;
    };
  }, [
    activeOrganization,
    canViewOrgMembers,
    contextKey,
    includeArchived,
    services.organizations,
    services.projects,
    services.teams,
    user,
  ]);

  const projects =
    contextKey !== null && projectsState.contextKey === contextKey ? projectsState.projects : [];
  const teams =
    contextKey !== null && projectsState.contextKey === contextKey ? projectsState.teams : [];
  const orgMembers =
    contextKey !== null && projectsState.contextKey === contextKey ? projectsState.orgMembers : [];
  const isLoadingProjects = contextKey !== null && projectsState.contextKey !== contextKey;

  const effectiveSelectedProjectId: ProjectId | null =
    selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId
      : (projects[0]?.id ?? null);

  const selectedProjectKey =
    activeOrganization !== null && effectiveSelectedProjectId !== null
      ? `${activeOrganization.id}:${effectiveSelectedProjectId}`
      : null;

  useEffect(() => {
    if (
      user === null ||
      activeOrganization === null ||
      effectiveSelectedProjectId === null ||
      selectedProjectKey === null
    ) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetProjectId = effectiveSelectedProjectId;
    const targetProjectKey = selectedProjectKey;

    async function loadDetails() {
      try {
        const details = await services.projects.getProjectDetails(
          actorUserId,
          targetOrgId,
          targetProjectId,
        );
        if (!isActive) {
          return;
        }
        setDetailsState({
          projectKey: targetProjectKey,
          details,
        });
      } catch {
        if (!isActive) {
          return;
        }
        setDetailsState({
          projectKey: targetProjectKey,
          details: null,
        });
      }
    }

    void loadDetails();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, effectiveSelectedProjectId, selectedProjectKey, services.projects, user]);

  if (user === null) {
    return null;
  }

  if (activeOrganization === null) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'organizations.emptyTitle' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'organizations.emptyDescription' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="min-h-[44px]">
            <Link to="/organizations">{intl.formatMessage({ id: 'nav.organizations' })}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selectedProjectDetails =
    selectedProjectKey !== null && detailsState.projectKey === selectedProjectKey
      ? detailsState.details
      : null;
  const isLoadingDetails =
    selectedProjectKey !== null && detailsState.projectKey !== selectedProjectKey;

  const selectedProjectSummary =
    selectedProjectDetails?.project ??
    projects.find((project) => project.id === effectiveSelectedProjectId) ??
    null;

  const selectedProjectResource =
    selectedProjectSummary !== null
      ? {
          kind: 'PROJECT' as const,
          id: asEntityId(selectedProjectSummary.id),
          exists: true,
          organizationId: selectedProjectSummary.organizationId,
          projectId: selectedProjectSummary.id,
          teamId: selectedProjectSummary.teamId,
          ownerUserId: selectedProjectSummary.ownerUserId,
          deletedAt: selectedProjectSummary.deletedAt,
          archivedAt: selectedProjectSummary.archivedAt,
        }
      : undefined;

  const canCreateProject = can(PERMISSION_CODES.PROJECT_CREATE, {
    kind: 'PROJECT',
    exists: true,
    organizationId: activeOrganization.id,
  });

  const canUpdateSelectedProject =
    selectedProjectResource !== undefined &&
    can(PERMISSION_CODES.PROJECT_UPDATE, selectedProjectResource);
  const canArchiveSelectedProject =
    selectedProjectResource !== undefined &&
    can(PERMISSION_CODES.PROJECT_ARCHIVE, selectedProjectResource);
  const canRestoreSelectedProject =
    selectedProjectResource !== undefined &&
    can(PERMISSION_CODES.PROJECT_RESTORE, selectedProjectResource);
  const canDeleteSelectedProject =
    selectedProjectResource !== undefined &&
    can(PERMISSION_CODES.PROJECT_DELETE, selectedProjectResource);
  const canManageSelectedProjectMembers =
    selectedProjectResource !== undefined &&
    can(PERMISSION_CODES.PROJECT_MEMBERS_MANAGE, selectedProjectResource);
  const canViewProjectBoard = (
    project: Pick<
      ProjectListItem,
      'id' | 'organizationId' | 'teamId' | 'ownerUserId' | 'deletedAt' | 'archivedAt'
    >,
  ): boolean =>
    can(PERMISSION_CODES.BOARD_VIEW, {
      kind: 'BOARD',
      id: asEntityId(project.id),
      exists: true,
      organizationId: project.organizationId,
      projectId: project.id,
      teamId: project.teamId,
      ownerUserId: project.ownerUserId,
      deletedAt: project.deletedAt,
      archivedAt: project.archivedAt,
      projectArchivedAt: project.archivedAt,
    });

  const canViewProjectBottlenecks = (
    project: Pick<
      ProjectListItem,
      'id' | 'organizationId' | 'teamId' | 'ownerUserId' | 'deletedAt' | 'archivedAt'
    >,
  ): boolean =>
    can(PERMISSION_CODES.BOTTLENECK_VIEW, {
      kind: 'BOTTLENECK',
      id: asEntityId(project.id),
      exists: true,
      organizationId: project.organizationId,
      projectId: project.id,
      teamId: project.teamId,
      ownerUserId: project.ownerUserId,
      deletedAt: project.deletedAt,
      archivedAt: project.archivedAt,
      projectArchivedAt: project.archivedAt,
    });

  const canViewProjectAnalytics = (
    project: Pick<
      ProjectListItem,
      'id' | 'organizationId' | 'teamId' | 'ownerUserId' | 'deletedAt' | 'archivedAt'
    >,
  ): boolean =>
    can(PERMISSION_CODES.ANALYTICS_PROJECT_VIEW, {
      kind: 'ANALYTICS',
      id: asEntityId(project.id),
      exists: true,
      organizationId: project.organizationId,
      projectId: project.id,
      teamId: project.teamId,
      ownerUserId: project.ownerUserId,
      deletedAt: project.deletedAt,
      archivedAt: project.archivedAt,
      projectArchivedAt: project.archivedAt,
      includesThirdPartyIndividualMetrics: false,
    });

  const canOpenSelectedProjectBoard =
    selectedProjectSummary !== null && canViewProjectBoard(selectedProjectSummary);
  const canOpenSelectedProjectBottlenecks =
    selectedProjectSummary !== null && canViewProjectBottlenecks(selectedProjectSummary);
  const canOpenSelectedProjectAnalytics =
    selectedProjectSummary !== null && canViewProjectAnalytics(selectedProjectSummary);

  const canOpenBoardByProjectId: Record<string, boolean> = {};
  const canOpenBottlenecksByProjectId: Record<string, boolean> = {};
  const canOpenAnalyticsByProjectId: Record<string, boolean> = {};
  for (const project of projects) {
    const targetProject =
      selectedProjectSummary !== null && selectedProjectSummary.id === project.id
        ? selectedProjectSummary
        : project;
    canOpenBoardByProjectId[project.id] = canViewProjectBoard(targetProject);
    canOpenBottlenecksByProjectId[project.id] = canViewProjectBottlenecks(targetProject);
    canOpenAnalyticsByProjectId[project.id] = canViewProjectAnalytics(targetProject);
  }

  const canUnlinkTeam =
    selectedProjectResource !== undefined &&
    activeOrganization.role === ORGANIZATION_ROLES.ADMIN &&
    can(PERMISSION_CODES.PROJECT_TRANSFER, selectedProjectResource);

  const activeTeams = teams.filter((team) => team.archivedAt === undefined);

  const creatableTeamScopes: ProjectTeamScopeOption[] = activeTeams
    .filter(
      (team) =>
        activeOrganization.role === ORGANIZATION_ROLES.ADMIN ||
        scopeSummary.managedTeamIds.includes(team.id),
    )
    .map((team) => ({
      id: team.id,
      name: team.name,
    }));

  const transferableTeamScopes: ProjectTeamScopeOption[] =
    selectedProjectResource !== undefined
      ? activeTeams
          .filter((team) =>
            can(PERMISSION_CODES.PROJECT_TRANSFER, {
              ...selectedProjectResource,
              targetTeamId: team.id,
            }),
          )
          .map((team) => ({
            id: team.id,
            name: team.name,
          }))
      : [];

  const canTransferSelectedProject = canUnlinkTeam || transferableTeamScopes.length > 0;

  const handleOpenBoard = (projectId: ProjectId) => {
    void navigate(`/projects/${projectId}/board`);
  };

  const handleCreateProject = async (input: CreateProjectInput) => {
    setFeedback(null);
    try {
      const created = await services.projects.createProject(user.id, activeOrganization.id, input);
      await reloadProjectsList();
      await refreshPermissions();
      setSelectedProjectId(created.id);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.create.success' }, { name: created.name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleUpdateProject = async (projectId: ProjectId, input: UpdateProjectInput) => {
    setFeedback(null);
    try {
      const updated = await services.projects.updateProject(
        user.id,
        activeOrganization.id,
        projectId,
        input,
      );
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.edit.saveSuccess' }, { name: updated.name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleTransferProjectTeam = async (
    projectId: ProjectId,
    input: TransferProjectTeamInput,
  ) => {
    setFeedback(null);
    try {
      const updated = await services.projects.transferProjectTeam(
        user.id,
        activeOrganization.id,
        projectId,
        input,
      );
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.transfer.success' }, { name: updated.name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleArchiveProject = async (projectId: ProjectId, name: string) => {
    setFeedback(null);
    try {
      await services.projects.archiveProject(user.id, activeOrganization.id, projectId);
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.archiveSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleRestoreProject = async (projectId: ProjectId, name: string) => {
    setFeedback(null);
    try {
      await services.projects.restoreProject(user.id, activeOrganization.id, projectId);
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.restoreSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleDeleteProject = async (projectId: ProjectId, name: string, reason?: string) => {
    setFeedback(null);
    try {
      await services.projects.deleteProject(
        user.id,
        activeOrganization.id,
        projectId,
        reason !== undefined ? { reason } : {},
      );
      await reloadProjectsList();
      await refreshPermissions();
      setSelectedProjectId(null);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.deleteSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleExportProject = async (projectId: ProjectId, name: string) => {
    setFeedback(null);
    try {
      const exportData = await services.projects.exportProjectData(
        user.id,
        activeOrganization.id,
        projectId,
      );
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `pms-projeto-${projectId}.json`;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.exportSuccess' }, { name }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleAddParticipant = async (
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
  ) => {
    setFeedback(null);
    try {
      await services.projects.addProjectParticipant(
        user.id,
        activeOrganization.id,
        projectId,
        targetUserId,
        role,
      );
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.members.addSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleUpdateParticipantRole = async (
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
  ) => {
    setFeedback(null);
    try {
      await services.projects.updateProjectParticipantRole(
        user.id,
        activeOrganization.id,
        projectId,
        targetUserId,
        role,
      );
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.members.roleUpdateSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleRemoveParticipant = async (
    projectId: ProjectId,
    targetUserId: UserId,
    reason?: string,
  ) => {
    setFeedback(null);
    try {
      await services.projects.removeProjectParticipant(
        user.id,
        activeOrganization.id,
        projectId,
        targetUserId,
        reason !== undefined ? { reason } : {},
      );
      await reloadProjectsList();
      await reloadSelectedProjectDetails(projectId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'projects.members.removeSuccess' }),
      });
    } catch (error) {
      if (isPendingTasksRemovalConflict(error)) {
        setFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'projects.members.removePendingTasksError' }),
        });
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  return (
    <ProjectsPanel
      organizationName={activeOrganization.name}
      actorRole={activeOrganization.role}
      actorUserId={user.id}
      projects={projects}
      selectedProjectId={effectiveSelectedProjectId}
      selectedProjectDetails={selectedProjectDetails}
      creatableTeamScopes={creatableTeamScopes}
      transferableTeamScopes={transferableTeamScopes}
      organizationMembers={orgMembers}
      includeArchived={includeArchived}
      isLoadingProjects={isLoadingProjects}
      isLoadingDetails={isLoadingDetails}
      canCreateProject={canCreateProject}
      canUpdateSelectedProject={canUpdateSelectedProject}
      canTransferSelectedProject={canTransferSelectedProject}
      canUnlinkTeam={canUnlinkTeam}
      canArchiveSelectedProject={canArchiveSelectedProject}
      canRestoreSelectedProject={canRestoreSelectedProject}
      canDeleteSelectedProject={canDeleteSelectedProject}
      canManageSelectedProjectMembers={canManageSelectedProjectMembers}
      canOpenSelectedProjectBoard={canOpenSelectedProjectBoard}
      canOpenBoardByProjectId={canOpenBoardByProjectId}
      canOpenSelectedProjectBottlenecks={canOpenSelectedProjectBottlenecks}
      canOpenBottlenecksByProjectId={canOpenBottlenecksByProjectId}
      canOpenSelectedProjectAnalytics={canOpenSelectedProjectAnalytics}
      canOpenAnalyticsByProjectId={canOpenAnalyticsByProjectId}
      feedback={feedback}
      onToggleIncludeArchived={setIncludeArchived}
      onSelectProject={setSelectedProjectId}
      onOpenBoard={handleOpenBoard}
      onCreateProject={handleCreateProject}
      onUpdateProject={handleUpdateProject}
      onTransferProjectTeam={handleTransferProjectTeam}
      onArchiveProject={handleArchiveProject}
      onRestoreProject={handleRestoreProject}
      onDeleteProject={handleDeleteProject}
      onExportProject={handleExportProject}
      onAddParticipant={handleAddParticipant}
      onUpdateParticipantRole={handleUpdateParticipantRole}
      onRemoveParticipant={handleRemoveParticipant}
    />
  );
}

export default ProjectsPage;
