import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useOrganization } from '@/app/providers';
import type { CreateOrganizationInput } from '@/modules/organizations';
import {
  OrganizationsPanel,
  type OrganizationPanelFeedback,
} from '@/modules/organizations/presentation/organizations-panel';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';
import type { OrganizationId } from '@/shared/kernel';

export function OrganizationsPage() {
  const intl = useIntl();
  const {
    organizations,
    activeOrganizationId,
    isLoading,
    selectOrganization,
    createOrganization,
    leaveOrganization,
  } = useOrganization();
  const [feedback, setFeedback] = useState<OrganizationPanelFeedback | null>(null);

  const handleCreateOrganization = async (input: CreateOrganizationInput) => {
    setFeedback(null);
    try {
      const result = await createOrganization(input);
      setFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'organizations.create.success' },
          { name: result.organization.name },
        ),
      });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'organizations.create.slugConflict' }),
        });
        throw error;
      }
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

  const handleLeaveOrganization = async (organizationId: OrganizationId) => {
    setFeedback(null);
    const targetOrg = organizations.find((org) => org.id === organizationId);
    try {
      await leaveOrganization(organizationId);
      setFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'organizations.leave.success' },
          { name: targetOrg?.name ?? '' },
        ),
      });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'organizations.leave.lastAdminError' }),
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
    <OrganizationsPanel
      organizations={organizations}
      activeOrganizationId={activeOrganizationId}
      isLoading={isLoading}
      feedback={feedback}
      onSelectOrganization={selectOrganization}
      onCreateOrganization={handleCreateOrganization}
      onLeaveOrganization={handleLeaveOrganization}
    />
  );
}

export default OrganizationsPage;
