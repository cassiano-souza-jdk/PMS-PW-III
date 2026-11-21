import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import {
  MANAGER_DELEGABLE_PERMISSIONS,
  PERMISSION_CODE_LIST,
  PERMISSION_SCOPE_TYPES,
  type CreateExplicitDenyRuleInput,
  type DenyRuleId,
  type ExplicitDenyRuleWithActiveFlag,
  type GrantPermissionInput,
  type PermissionCode,
  type PermissionGrantWithDerivedStatus,
  type PermissionScopeType,
} from '@/modules/authorization';
import {
  PermissionsPanel,
  type PermissionMemberOption,
  type PermissionPanelFeedback,
  type PermissionScopeOption,
} from '@/modules/authorization/presentation/permissions-panel';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';
import { ORGANIZATION_ROLES, type GrantId } from '@/shared/kernel';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui';

interface LoadedPermissionsData {
  readonly contextKey: string | null;
  readonly grants: readonly PermissionGrantWithDerivedStatus[];
  readonly denies: readonly ExplicitDenyRuleWithActiveFlag[];
  readonly members: readonly PermissionMemberOption[];
  readonly teamScopes: readonly PermissionScopeOption[];
}

const INITIAL_DATA: LoadedPermissionsData = {
  contextKey: null,
  grants: [],
  denies: [],
  members: [],
  teamScopes: [],
};

const MANAGER_DELEGABLE_LIST: readonly PermissionCode[] = PERMISSION_CODE_LIST.filter((code) =>
  MANAGER_DELEGABLE_PERMISSIONS.has(code),
);

export function PermissionsPage() {
  const intl = useIntl();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization } = useOrganization();
  const { activeGrants, activeDenyRules, scopeSummary, refreshPermissions } = usePermission();

  const [loadedData, setLoadedData] = useState<LoadedPermissionsData>(INITIAL_DATA);
  const [grantsFeedback, setGrantsFeedback] = useState<PermissionPanelFeedback | null>(null);
  const [deniesFeedback, setDeniesFeedback] = useState<PermissionPanelFeedback | null>(null);

  const isAdmin = activeOrganization?.role === ORGANIZATION_ROLES.ADMIN;
  const isManager = activeOrganization?.role === ORGANIZATION_ROLES.MANAGER;
  const canManageGrants =
    isAdmin ||
    (isManager &&
      (scopeSummary.managedTeamIds.length > 0 || scopeSummary.managedProjectIds.length > 0));
  const canManageDenies = isAdmin;

  const contextKey =
    user !== null && activeOrganization !== null && (isAdmin || isManager)
      ? `${user.id}:${activeOrganization.id}`
      : null;

  const reloadRules = useCallback(async () => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }
    const [grants, denies, rawMembers, rawTeams] = await Promise.all([
      services.authorization.listOrganizationGrants(user.id, activeOrganization.id).catch(() => []),
      services.authorization
        .listOrganizationDenyRules(user.id, activeOrganization.id)
        .catch(() => []),
      services.organizations
        .listOrganizationMembers(user.id, activeOrganization.id)
        .catch(() => []),
      services.teams
        .listTeams(user.id, activeOrganization.id, { includeArchived: false })
        .catch(() => []),
    ]);

    setLoadedData({
      contextKey,
      grants,
      denies,
      members: rawMembers
        .filter((member) => member.status === 'ACTIVE')
        .map((member) => ({
          userId: member.userId,
          displayName: member.displayName,
          email: member.email,
          role: member.role,
        })),
      teamScopes: rawTeams.map((team) => ({
        id: team.id,
        label: team.name,
      })),
    });
  }, [
    activeOrganization,
    contextKey,
    services.authorization,
    services.organizations,
    services.teams,
    user,
  ]);

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetKey = contextKey;

    async function loadRules() {
      const [grants, denies, rawMembers, rawTeams] = await Promise.all([
        services.authorization.listOrganizationGrants(actorUserId, targetOrgId).catch(() => []),
        services.authorization.listOrganizationDenyRules(actorUserId, targetOrgId).catch(() => []),
        services.organizations.listOrganizationMembers(actorUserId, targetOrgId).catch(() => []),
        services.teams
          .listTeams(actorUserId, targetOrgId, { includeArchived: false })
          .catch(() => []),
      ]);

      if (!isActive) {
        return;
      }

      setLoadedData({
        contextKey: targetKey,
        grants,
        denies,
        members: rawMembers
          .filter((member) => member.status === 'ACTIVE')
          .map((member) => ({
            userId: member.userId,
            displayName: member.displayName,
            email: member.email,
            role: member.role,
          })),
        teamScopes: rawTeams.map((team) => ({
          id: team.id,
          label: team.name,
        })),
      });
    }

    void loadRules();

    return () => {
      isActive = false;
    };
  }, [
    activeOrganization,
    contextKey,
    services.authorization,
    services.organizations,
    services.teams,
    user,
  ]);

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

  const isCurrentLoaded = contextKey !== null && loadedData.contextKey === contextKey;
  const isLoadingRules = contextKey !== null && !isCurrentLoaded;

  const allowedGrantScopeTypes: readonly PermissionScopeType[] = isAdmin
    ? [
        PERMISSION_SCOPE_TYPES.ORGANIZATION,
        PERMISSION_SCOPE_TYPES.TEAM,
        PERMISSION_SCOPE_TYPES.PROJECT,
      ]
    : [PERMISSION_SCOPE_TYPES.TEAM, PERMISSION_SCOPE_TYPES.PROJECT];

  const delegablePermissions = isAdmin ? PERMISSION_CODE_LIST : MANAGER_DELEGABLE_LIST;

  const handleCreateGrant = async (input: GrantPermissionInput) => {
    setGrantsFeedback(null);
    try {
      await services.authorization.grantPermission(user.id, activeOrganization.id, input);
      await reloadRules();
      await refreshPermissions();
      setGrantsFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'permissions.grants.createSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setGrantsFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleRevokeGrant = async (grantId: GrantId) => {
    setGrantsFeedback(null);
    try {
      await services.authorization.revokePermissionGrant(user.id, activeOrganization.id, grantId);
      await reloadRules();
      await refreshPermissions();
      setGrantsFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'permissions.grants.revokeSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setGrantsFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleCreateDenyRule = async (input: CreateExplicitDenyRuleInput) => {
    setDeniesFeedback(null);
    try {
      await services.authorization.createExplicitDenyRule(user.id, activeOrganization.id, input);
      await reloadRules();
      await refreshPermissions();
      setDeniesFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'permissions.denies.createSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setDeniesFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleRevokeDenyRule = async (denyRuleId: DenyRuleId) => {
    setDeniesFeedback(null);
    try {
      await services.authorization.revokeExplicitDenyRule(
        user.id,
        activeOrganization.id,
        denyRuleId,
      );
      await reloadRules();
      await refreshPermissions();
      setDeniesFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'permissions.denies.revokeSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setDeniesFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  return (
    <PermissionsPanel
      organizationName={activeOrganization.name}
      actorRole={activeOrganization.role}
      scopeSummary={scopeSummary}
      myActiveGrants={activeGrants}
      myActiveDenies={activeDenyRules}
      canManageGrants={canManageGrants}
      canManageDenies={canManageDenies}
      allowedGrantScopeTypes={allowedGrantScopeTypes}
      delegablePermissions={delegablePermissions}
      allPermissions={PERMISSION_CODE_LIST}
      members={isCurrentLoaded ? loadedData.members : []}
      teamScopes={isCurrentLoaded ? loadedData.teamScopes : []}
      organizationGrants={isCurrentLoaded ? loadedData.grants : []}
      organizationDenies={isCurrentLoaded ? loadedData.denies : []}
      isLoadingRules={isLoadingRules}
      grantsFeedback={grantsFeedback}
      deniesFeedback={deniesFeedback}
      onCreateGrant={handleCreateGrant}
      onRevokeGrant={handleRevokeGrant}
      onCreateDenyRule={handleCreateDenyRule}
      onRevokeDenyRule={handleRevokeDenyRule}
    />
  );
}

export default PermissionsPage;
