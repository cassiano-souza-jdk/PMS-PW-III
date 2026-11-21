import { IconArrowLeft } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import type { InvitationPreview } from '@/modules/invitations';
import { AcceptInvitationPanel } from '@/modules/invitations/presentation/accept-invitation-panel';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';
import { Button } from '@/shared/ui';
import { resolveAcceptInvitationErrorMessageId } from './invitation-accept-error';

interface LoadedPreviewState {
  readonly loadedCode: string | null;
  readonly preview: InvitationPreview | null;
  readonly errorMessage: string | null;
}

const INITIAL_PREVIEW_STATE: LoadedPreviewState = {
  loadedCode: null,
  preview: null,
  errorMessage: null,
};

export function AcceptInvitationPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { services } = useComposition();
  const { user } = useAuth();
  const { refreshOrganizations, selectOrganization } = useOrganization();
  const { refreshPermissions } = usePermission();

  const codeParam = searchParams.get('code')?.trim() ?? '';
  const [state, setState] = useState<LoadedPreviewState>(INITIAL_PREVIEW_STATE);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null || codeParam.length === 0) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetCode = codeParam;

    async function loadPreview() {
      try {
        const preview = await services.invitations.previewInvitationByCode(actorUserId, targetCode);
        if (!isActive) {
          return;
        }
        setState({
          loadedCode: targetCode,
          preview,
          errorMessage: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }
        const messageId = isAppError(error)
          ? getErrorMessageId(error.code)
          : 'errors.UNEXPECTED_ERROR';
        setState({
          loadedCode: targetCode,
          preview: null,
          errorMessage: intl.formatMessage({ id: messageId }),
        });
      }
    }

    void loadPreview();

    return () => {
      isActive = false;
    };
  }, [codeParam, intl, services.invitations, user]);

  if (user === null) {
    return null;
  }

  const isLoading = codeParam.length > 0 && state.loadedCode !== codeParam;
  const preview = state.loadedCode === codeParam ? state.preview : null;
  const loadError = state.loadedCode === codeParam ? state.errorMessage : null;

  const handleAccept = async () => {
    if (preview === null) {
      return;
    }
    setAcceptError(null);
    setIsAccepting(true);
    try {
      const result = await services.invitations.acceptInvitation(user.id, preview.code);
      await refreshOrganizations();
      selectOrganization(result.organization.id);
      await refreshPermissions();
      await navigate('/organizations', { replace: true });
    } catch (error) {
      const messageId = resolveAcceptInvitationErrorMessageId(error);
      setAcceptError(intl.formatMessage({ id: messageId }));
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <AcceptInvitationPanel
      codeParam={codeParam}
      isLoading={isLoading}
      loadError={loadError}
      preview={preview}
      isAccepting={isAccepting}
      acceptError={acceptError}
      onAccept={handleAccept}
      footerSlot={
        <Button asChild variant="ghost" size="sm">
          <Link to="/invitations">
            <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'nav.invitations' })}</span>
          </Link>
        </Button>
      }
    />
  );
}

export default AcceptInvitationPage;
