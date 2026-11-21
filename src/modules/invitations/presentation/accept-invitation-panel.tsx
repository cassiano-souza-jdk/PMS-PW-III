import { IconCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import type { MessageId } from '@/shared/i18n';
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
} from '@/shared/ui';
import type { InvitationPreview } from '../application/use-cases/invitation-service';

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

export interface AcceptInvitationPanelProps {
  readonly codeParam: string;
  readonly isLoading: boolean;
  readonly loadError: string | null;
  readonly preview: InvitationPreview | null;
  readonly isAccepting: boolean;
  readonly acceptError: string | null;
  readonly onAccept: () => Promise<void> | void;
  readonly footerSlot?: ReactNode;
}

export function AcceptInvitationPanel({
  codeParam,
  isLoading,
  loadError,
  preview,
  isAccepting,
  acceptError,
  onAccept,
  footerSlot,
}: AcceptInvitationPanelProps) {
  const intl = useIntl();

  return (
    <section
      aria-labelledby="accept-invitation-heading"
      className="mx-auto w-full max-w-xl space-y-6"
    >
      <Card>
        <CardHeader>
          <h1
            id="accept-invitation-heading"
            className="text-2xl font-bold leading-none tracking-tight"
          >
            {intl.formatMessage({ id: 'invitations.accept.title' })}
          </h1>
          <CardDescription>
            {intl.formatMessage({ id: 'invitations.accept.description' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {codeParam.length === 0 ? (
            <Alert variant="warning">
              <AlertDescription>
                {intl.formatMessage({ id: 'invitations.accept.missingCodeWarning' })}
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
                onClick={() => void onAccept()}
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

        {footerSlot !== undefined && footerSlot !== null ? (
          <CardFooter className="border-t pt-4">{footerSlot}</CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
