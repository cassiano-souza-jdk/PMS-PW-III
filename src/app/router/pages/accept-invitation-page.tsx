import { IconArrowLeft, IconCheck } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import type { InvitationPreview } from '@/modules/invitations';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';
import type { OrganizationRole } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui';

const ROLE_LABEL_ID_BY_CODE: Readonly<Record<OrganizationRole, MessageId>> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

const STATUS_LABEL_ID_BY_CODE: Readonly<Record<InvitationPreview['status'], MessageId>> = {
  PENDING: 'invitations.status.PENDING',
  ACCEPTED: 'invitations.status.ACCEPTED',
  EXPIRED: 'invitations.status.EXPIRED',
  REVOKED: 'invitations.status.REVOKED',
};

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
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setAcceptError(intl.formatMessage({ id: 'invitations.accept.alreadyMemberError' }));
        return;
      }
      if (isAppError(error) && error.code === APP_ERROR_CODES.AUTHORIZATION_ERROR) {
        setAcceptError(intl.formatMessage({ id: 'invitations.accept.emailMismatchWarning' }));
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setAcceptError(intl.formatMessage({ id: messageId }));
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <section
      aria-labelledby="accept-invitation-heading"
      className="mx-auto w-full max-w-xl space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 id="accept-invitation-heading" className="text-2xl font-bold tracking-tight">
              {intl.formatMessage({ id: 'invitations.accept.title' })}
            </h1>
          </CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'invitations.accept.description' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {codeParam.length === 0 ? (
            <Alert variant="warning">
              <AlertDescription>
                Nenhum código de convite foi informado na URL. Utilize a página de Convites para
                digitar um código manualmente.
              </AlertDescription>
            </Alert>
          ) : isLoading ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'app.loading' })}
            </p>
          ) : loadError !== null ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : preview !== null ? (
            <div className="space-y-4">
              {acceptError !== null ? (
                <Alert variant="destructive">
                  <AlertDescription>{acceptError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    {intl.formatMessage(
                      { id: 'invitations.accept.organizationLabel' },
                      { name: preview.organizationName },
                    )}
                  </p>
                  <Badge variant={preview.status === 'PENDING' ? 'default' : 'destructive'}>
                    {intl.formatMessage({ id: STATUS_LABEL_ID_BY_CODE[preview.status] })}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'invitations.accept.roleLabel' },
                    {
                      role: intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[preview.initialRole] }),
                    },
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'invitations.accept.expiresLabel' },
                    {
                      date: intl.formatDate(preview.expiresAt, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }),
                    },
                  )}
                </p>
              </div>

              {!preview.emailMatchesActor ? (
                <Alert variant="warning">
                  <AlertDescription>
                    {intl.formatMessage({ id: 'invitations.accept.emailMismatchWarning' })}
                  </AlertDescription>
                </Alert>
              ) : null}

              <Button
                type="button"
                disabled={isAccepting || preview.status !== 'PENDING' || !preview.emailMatchesActor}
                onClick={() => void handleAccept()}
                className="w-full"
              >
                <IconCheck className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({
                    id: isAccepting ? 'auth.common.submitting' : 'invitations.accept.acceptAction',
                  })}
                </span>
              </Button>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="border-t pt-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/invitations">
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'nav.invitations' })}</span>
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

export default AcceptInvitationPage;
