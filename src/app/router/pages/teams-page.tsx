import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { CreateTeamInput, Team, TeamDetails, UpdateTeamInput } from '@/modules/teams';
import {
  TeamsPanel,
  type TeamListItemSummary,
  type TeamPanelFeedback,
} from '@/modules/teams/presentation/teams-panel';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';
import { asEntityId, type TeamId, type UserId } from '@/shared/kernel';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui';

interface LoadedTeamsState {
  readonly contextKey: string | null;
  readonly teams: readonly Team[];
  readonly orgMembers: readonly OrganizationMemberDetails[];
}

interface LoadedDetailsState {
  readonly teamKey: string | null;
  readonly details: TeamDetails | null;
}

const INITIAL_TEAMS_STATE: LoadedTeamsState = {
  contextKey: null,
  teams: [],
  orgMembers: [],
};

const INITIAL_DETAILS_STATE: LoadedDetailsState = {
  teamKey: null,
  details: null,
};

export function TeamsPage() {
  const intl = useIntl();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { can, refreshPermissions } = usePermission();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<TeamId | null>(null);
  const [teamsState, setTeamsState] = useState<LoadedTeamsState>(INITIAL_TEAMS_STATE);
  const [detailsState, setDetailsState] = useState<LoadedDetailsState>(INITIAL_DETAILS_STATE);
  const [feedback, setFeedback] = useState<TeamPanelFeedback | null>(null);

  const canViewOrgMembers = can(PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW);

  const contextKey =
    user !== null && activeOrganization !== null
      ? `${user.id}:${activeOrganization.id}:${includeArchived ? 'all' : 'active'}`
      : null;

  const reloadTeamsList = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }
    const [teams, orgMembers] = await Promise.all([
      services.teams.listTeams(user.id, activeOrganization.id, { includeArchived }),
      canViewOrgMembers
        ? services.organizations
            .listOrganizationMembers(user.id, activeOrganization.id)
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    setTeamsState({
      contextKey,
      teams,
      orgMembers,
    });
  }, [
    activeOrganization,
    canViewOrgMembers,
    contextKey,
    includeArchived,
    services.organizations,
    services.teams,
    user,
  ]);

  const reloadSelectedTeamDetails = useCallback(
    async (teamId: TeamId) => {
      if (user === null || activeOrganization === null) {
        return;
      }
      const details = await services.teams.getTeamDetails(user.id, activeOrganization.id, teamId);
      setDetailsState({
        teamKey: `${activeOrganization.id}:${teamId}`,
        details,
      });
    },
    [activeOrganization, services.teams, user],
  );

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetKey = contextKey;

    async function loadTeams() {
      try {
        const [teams, orgMembers] = await Promise.all([
          services.teams.listTeams(actorUserId, targetOrgId, { includeArchived }),
          canViewOrgMembers
            ? services.organizations
                .listOrganizationMembers(actorUserId, targetOrgId)
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!isActive) {
          return;
        }
        setTeamsState({
          contextKey: targetKey,
          teams,
          orgMembers,
        });
      } catch {
        if (!isActive) {
          return;
        }
        setTeamsState({
          contextKey: targetKey,
          teams: [],
          orgMembers: [],
        });
      }
    }

    void loadTeams();

    return () => {
      isActive = false;
    };
  }, [
    activeOrganization,
    canViewOrgMembers,
    contextKey,
    includeArchived,
    services.organizations,
    services.teams,
    user,
  ]);

  const teams = contextKey !== null && teamsState.contextKey === contextKey ? teamsState.teams : [];
  const orgMembers =
    contextKey !== null && teamsState.contextKey === contextKey ? teamsState.orgMembers : [];
  const isLoadingTeams = contextKey !== null && teamsState.contextKey !== contextKey;

  const effectiveSelectedTeamId: TeamId | null =
    selectedTeamId !== null && teams.some((team) => team.id === selectedTeamId)
      ? selectedTeamId
      : (teams[0]?.id ?? null);

  const selectedTeamKey =
    activeOrganization !== null && effectiveSelectedTeamId !== null
      ? `${activeOrganization.id}:${effectiveSelectedTeamId}`
      : null;

  useEffect(() => {
    if (
      user === null ||
      activeOrganization === null ||
      effectiveSelectedTeamId === null ||
      selectedTeamKey === null
    ) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetTeamId = effectiveSelectedTeamId;
    const targetTeamKey = selectedTeamKey;

    async function loadDetails() {
      try {
        const details = await services.teams.getTeamDetails(actorUserId, targetOrgId, targetTeamId);
        if (!isActive) {
          return;
        }
        setDetailsState({
          teamKey: targetTeamKey,
          details,
        });
      } catch {
        if (!isActive) {
          return;
        }
        setDetailsState({
          teamKey: targetTeamKey,
          details: null,
        });
      }
    }

    void loadDetails();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, effectiveSelectedTeamId, selectedTeamKey, services.teams, user]);

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
          <Button asChild>
            <Link to="/organizations">{intl.formatMessage({ id: 'nav.organizations' })}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selectedTeamDetails =
    selectedTeamKey !== null && detailsState.teamKey === selectedTeamKey
      ? detailsState.details
      : null;
  const isLoadingDetails = selectedTeamKey !== null && detailsState.teamKey !== selectedTeamKey;

  const selectedTeamResource =
    effectiveSelectedTeamId !== null
      ? {
          kind: 'TEAM' as const,
          id: asEntityId(effectiveSelectedTeamId),
          teamId: effectiveSelectedTeamId,
          organizationId: activeOrganization.id,
          ...(selectedTeamDetails?.team.archivedAt !== undefined
            ? { archivedAt: selectedTeamDetails.team.archivedAt }
            : {}),
        }
      : undefined;

  const canCreateTeam = can(PERMISSION_CODES.TEAM_CREATE, {
    kind: 'TEAM',
    organizationId: activeOrganization.id,
  });
  const canUpdateSelectedTeam =
    selectedTeamResource !== undefined && can(PERMISSION_CODES.TEAM_UPDATE, selectedTeamResource);
  const canArchiveSelectedTeam =
    selectedTeamResource !== undefined && can(PERMISSION_CODES.TEAM_ARCHIVE, selectedTeamResource);
  const canDeleteSelectedTeam =
    selectedTeamResource !== undefined && can(PERMISSION_CODES.TEAM_DELETE, selectedTeamResource);
  const canManageSelectedTeamMembers =
    selectedTeamResource !== undefined &&
    can(PERMISSION_CODES.TEAM_MEMBERS_MANAGE, selectedTeamResource);

  const teamSummaries: TeamListItemSummary[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    ...(team.description !== undefined ? { description: team.description } : {}),
    isArchived: team.archivedAt !== undefined,
    managerCount: team.managerUserIds.length,
  }));

  const handleCreateTeam = async (input: CreateTeamInput) => {
    setFeedback(null);
    try {
      const created = await services.teams.createTeam(user.id, activeOrganization.id, input);
      await reloadTeamsList();
      await refreshPermissions();
      setSelectedTeamId(created.id);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.create.success' }, { name: created.name }),
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

  const handleUpdateTeam = async (teamId: TeamId, input: UpdateTeamInput) => {
    setFeedback(null);
    try {
      const updated = await services.teams.updateTeam(
        user.id,
        activeOrganization.id,
        teamId,
        input,
      );
      await reloadTeamsList();
      await reloadSelectedTeamDetails(teamId);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.edit.saveSuccess' }, { name: updated.name }),
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

  const handleArchiveTeam = async (teamId: TeamId, name: string) => {
    setFeedback(null);
    try {
      await services.teams.archiveTeam(user.id, activeOrganization.id, teamId);
      await reloadTeamsList();
      await reloadSelectedTeamDetails(teamId);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.archiveSuccess' }, { name }),
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

  const handleRestoreTeam = async (teamId: TeamId, name: string) => {
    setFeedback(null);
    try {
      await services.teams.restoreTeam(user.id, activeOrganization.id, teamId);
      await reloadTeamsList();
      await reloadSelectedTeamDetails(teamId);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.restoreSuccess' }, { name }),
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

  const handleDeleteTeam = async (teamId: TeamId, name: string, reason?: string) => {
    setFeedback(null);
    try {
      await services.teams.deleteTeam(
        user.id,
        activeOrganization.id,
        teamId,
        reason !== undefined ? { reason } : {},
      );
      await reloadTeamsList();
      await refreshPermissions();
      setSelectedTeamId(null);
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.deleteSuccess' }, { name }),
      });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'teams.deleteProjectsConflict' }),
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

  const handleAddTeamMember = async (teamId: TeamId, targetUserId: UserId) => {
    setFeedback(null);
    try {
      await services.teams.addTeamMember(user.id, activeOrganization.id, teamId, targetUserId);
      await reloadSelectedTeamDetails(teamId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.members.addSuccess' }),
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

  const handleRemoveTeamMember = async (teamId: TeamId, targetUserId: UserId) => {
    setFeedback(null);
    try {
      await services.teams.removeTeamMember(user.id, activeOrganization.id, teamId, targetUserId);
      await reloadSelectedTeamDetails(teamId);
      await refreshPermissions();
      setFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'teams.members.removeSuccess' }),
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

  return (
    <TeamsPanel
      organizationName={activeOrganization.name}
      teams={teamSummaries}
      selectedTeamId={effectiveSelectedTeamId}
      selectedTeamDetails={selectedTeamDetails}
      organizationMembers={orgMembers}
      includeArchived={includeArchived}
      isLoadingTeams={isLoadingTeams}
      isLoadingDetails={isLoadingDetails}
      canCreateTeam={canCreateTeam}
      canUpdateSelectedTeam={canUpdateSelectedTeam}
      canArchiveSelectedTeam={canArchiveSelectedTeam}
      canDeleteSelectedTeam={canDeleteSelectedTeam}
      canManageSelectedTeamMembers={canManageSelectedTeamMembers}
      feedback={feedback}
      onToggleIncludeArchived={setIncludeArchived}
      onSelectTeam={setSelectedTeamId}
      onCreateTeam={handleCreateTeam}
      onUpdateTeam={handleUpdateTeam}
      onArchiveTeam={handleArchiveTeam}
      onRestoreTeam={handleRestoreTeam}
      onDeleteTeam={handleDeleteTeam}
      onAddTeamMember={handleAddTeamMember}
      onRemoveTeamMember={handleRemoveTeamMember}
    />
  );
}

export default TeamsPage;
