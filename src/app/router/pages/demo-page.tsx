import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useAuth, useOrganization } from '@/app/providers';
import { DEMO_CREDENTIALS_BY_ROLE } from '@/modules/authentication';
import {
  DemoAccessPanel,
  type DemoProfileOption,
} from '@/modules/authentication/presentation/demo-access-panel';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';
import { ORGANIZATION_ROLES, type OrganizationRole } from '@/shared/kernel';

const DEMO_PROFILES: readonly DemoProfileOption[] = [
  DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.ADMIN],
  DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MANAGER],
  DEMO_CREDENTIALS_BY_ROLE[ORGANIZATION_ROLES.MEMBER],
];

export function DemoPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { enterDemoProfile } = useAuth();
  const { activeOrganization, isDemoOrganization } = useOrganization();

  const [loadingRole, setLoadingRole] = useState<OrganizationRole | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleEnterProfile = async (role: OrganizationRole) => {
    setErrorMessage(null);
    setLoadingRole(role);
    try {
      await enterDemoProfile({ role, persistent: true });
      await navigate('/organizations', { replace: true });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setErrorMessage(intl.formatMessage({ id: messageId }));
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <DemoAccessPanel
      profiles={DEMO_PROFILES}
      activeDemoRole={
        isDemoOrganization && activeOrganization !== null ? activeOrganization.role : null
      }
      loadingRole={loadingRole}
      errorMessage={errorMessage}
      onEnterProfile={handleEnterProfile}
    />
  );
}

export default DemoPage;
