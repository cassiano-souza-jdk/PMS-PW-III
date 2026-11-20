import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { Organization, OrganizationMemberDetails } from '@/modules/organizations';
import {
  OrganizationSettingsPanel,
  type OrganizationSettingsFeedback,
  type UpdateOrganizationFormValues,
} from '@/modules/organizations/presentation/organization-settings-panel';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';
import { MEMBERSHIP_STATUSES, type OrganizationRole, type UserId } from '@/shared/kernel';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui';

const ROLE_LABEL_ID_BY_CODE: Readonly<Record<OrganizationRole, MessageId>> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

interface LoadedOrgData {
  readonly orgId: string | null;
  readonly details: Organization | null;
  readonly members: readonly OrganizationMemberDetails[];
}

const INITIAL_LOADED_DATA: LoadedOrgData = {
  orgId: null,
  details: null,
  members: [],
};

export function OrganizationSettingsPage() {
  const intl = useIntl();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization, refreshOrganizations } = useOrganization();
  const { can } = usePermission();

  const [loadedData, setLoadedData] = useState<LoadedOrgData>(INITIAL_LOADED_DATA);
  const [detailsFeedback, setDetailsFeedback] = useState<OrganizationSettingsFeedback | null>(null);
  const [membersFeedback, setMembersFeedback] = useState<OrganizationSettingsFeedback | null>(null);

  const canViewDetails = can(PERMISSION_CODES.ORGANIZATION_VIEW);
  const canUpdateDetails = can(PERMISSION_CODES.ORGANIZATION_UPDATE);
  const canViewMembers = can(PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW);
  const canManageRoles = can(PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE);
  const canManageMembers = can(PERMISSION_CODES.ORGANIZATION_MEMBERS_MANAGE);

  useEffect(() => {
    if (user === null || activeOrganization === null) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;

    async function loadOrganizationData() {
      const [detailsResult, membersResult] = await Promise.all([
        canViewDetails
          ? services.organizations
              .getOrganizationDetails(actorUserId, targetOrgId)
              .catch(() => null)
          : Promise.resolve(null),
        canViewMembers
          ? services.organizations.listOrganizationMembers(actorUserId, targetOrgId).catch(() => [])
          : Promise.resolve([]),
      ]);

      if (!isActive) {
        return;
      }

      setLoadedData({
        orgId: targetOrgId,
        details: detailsResult,
        members: membersResult,
      });
    }

    void loadOrganizationData();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, canViewDetails, canViewMembers, services.organizations, user]);

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

  const isCurrentOrgLoaded = loadedData.orgId === activeOrganization.id;
  const currentDetails = isCurrentOrgLoaded ? loadedData.details : null;
  const currentMembers = isCurrentOrgLoaded ? loadedData.members : [];

  const handleUpdateOrganization = async (values: UpdateOrganizationFormValues) => {
    setDetailsFeedback(null);
    try {
      const updated = await services.organizations.updateOrganization(
        user.id,
        activeOrganization.id,
        {
          name: values.name,
          description: values.description.trim() === '' ? null : values.description.trim(),
        },
      );
      setLoadedData((current) => ({
        ...current,
        orgId: activeOrganization.id,
        details: updated,
      }));
      await refreshOrganizations();
      setDetailsFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'organizations.details.saveSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setDetailsFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleChangeMemberRole = async (targetUserId: UserId, role: OrganizationRole) => {
    setMembersFeedback(null);
    const targetMember = currentMembers.find((member) => member.userId === targetUserId);
    try {
      await services.organizations.changeMemberRole(
        user.id,
        activeOrganization.id,
        targetUserId,
        role,
      );
      const updatedMembers = await services.organizations.listOrganizationMembers(
        user.id,
        activeOrganization.id,
      );
      setLoadedData((current) => ({
        ...current,
        orgId: activeOrganization.id,
        members: updatedMembers,
      }));
      await refreshOrganizations();
      setMembersFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'organizations.members.changeRoleSuccess' },
          {
            name: targetMember?.displayName ?? '',
            role: intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[role] }),
          },
        ),
      });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setMembersFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'organizations.leave.lastAdminError' }),
        });
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setMembersFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleToggleMemberStatus = async (
    targetUserId: UserId,
    nextStatus: 'ACTIVE' | 'SUSPENDED',
  ) => {
    setMembersFeedback(null);
    const targetMember = currentMembers.find((member) => member.userId === targetUserId);
    try {
      await services.organizations.suspendOrReactivateMember(
        user.id,
        activeOrganization.id,
        targetUserId,
        nextStatus,
      );
      const updatedMembers = await services.organizations.listOrganizationMembers(
        user.id,
        activeOrganization.id,
      );
      setLoadedData((current) => ({
        ...current,
        orgId: activeOrganization.id,
        members: updatedMembers,
      }));
      setMembersFeedback({
        type: 'success',
        message: intl.formatMessage(
          {
            id:
              nextStatus === MEMBERSHIP_STATUSES.SUSPENDED
                ? 'organizations.members.suspendSuccess'
                : 'organizations.members.reactivateSuccess',
          },
          { name: targetMember?.displayName ?? '' },
        ),
      });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setMembersFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'organizations.leave.lastAdminError' }),
        });
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setMembersFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  return (
    <OrganizationSettingsPanel
      organizationName={currentDetails?.name ?? activeOrganization.name}
      organizationSlug={currentDetails?.slug ?? activeOrganization.slug}
      {...(currentDetails?.description !== undefined
        ? { organizationDescription: currentDetails.description }
        : {})}
      isDemo={activeOrganization.isDemo}
      actorRole={activeOrganization.role}
      currentUserId={user.id}
      canViewDetails={canViewDetails}
      canUpdateDetails={canUpdateDetails}
      canViewMembers={canViewMembers}
      canManageRoles={canManageRoles}
      canManageMembers={canManageMembers}
      members={currentMembers}
      isLoadingDetails={canViewDetails && !isCurrentOrgLoaded}
      isLoadingMembers={canViewMembers && !isCurrentOrgLoaded}
      detailsFeedback={detailsFeedback}
      membersFeedback={membersFeedback}
      onUpdateOrganization={handleUpdateOrganization}
      onChangeMemberRole={handleChangeMemberRole}
      onToggleMemberStatus={handleToggleMemberStatus}
    />
  );
}

export default OrganizationSettingsPage;
