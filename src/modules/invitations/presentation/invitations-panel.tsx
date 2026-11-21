import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconCheck,
  IconCopy,
  IconLink,
  IconMailPlus,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import { ORGANIZATION_ROLES, type OrganizationRole } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui';
import type {
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationListItem,
  InvitationPreview,
} from '../application/use-cases/invitation-service';

const createInvitationSchema = z.object({
  email: z.string().trim().min(1, 'validation.required').email('validation.emailInvalid'),
  initialRole: z.enum([
    ORGANIZATION_ROLES.ADMIN,
    ORGANIZATION_ROLES.MANAGER,
    ORGANIZATION_ROLES.MEMBER,
  ]),
  expiresInDays: z.coerce.number().int().min(1).max(90),
});

export type CreateInvitationFormValues = z.infer<typeof createInvitationSchema>;

export interface InvitationPanelFeedback {
  readonly type: 'success' | 'destructive' | 'info';
  readonly message: string;
}

export interface InvitationsPanelProps {
  readonly activeOrganizationName: string | null;
  readonly actorRole: OrganizationRole | null;
  readonly canCreateInvitations: boolean;
  readonly canRevokeInvitations: boolean;
  readonly invitations: readonly InvitationListItem[];
  readonly isLoadingInvitations: boolean;
  readonly initialCode?: string;
  readonly preview: InvitationPreview | null;
  readonly isLoadingPreview: boolean;
  readonly isAccepting: boolean;
  readonly acceptFeedback?: InvitationPanelFeedback | null;
  readonly manageFeedback?: InvitationPanelFeedback | null;
  readonly lastCreatedInvitation?: CreateInvitationResult | null;
  readonly onPreviewCode: (code: string) => Promise<void>;
  readonly onAcceptCode: (code: string) => Promise<void>;
  readonly onCreateInvitation: (input: CreateInvitationInput) => Promise<void>;
  readonly onRevokeInvitation: (
    invitationId: InvitationListItem['id'],
    email: string,
  ) => Promise<void>;
}

const ROLE_OPTIONS: readonly OrganizationRole[] = [
  ORGANIZATION_ROLES.MEMBER,
  ORGANIZATION_ROLES.MANAGER,
  ORGANIZATION_ROLES.ADMIN,
];

const ROLE_LABEL_ID_BY_CODE: Readonly<Record<OrganizationRole, MessageId>> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

const STATUS_LABEL_ID_BY_CODE: Readonly<Record<InvitationListItem['derivedStatus'], MessageId>> = {
  PENDING: 'invitations.status.PENDING',
  ACCEPTED: 'invitations.status.ACCEPTED',
  EXPIRED: 'invitations.status.EXPIRED',
  REVOKED: 'invitations.status.REVOKED',
};

export function InvitationsPanel({
  activeOrganizationName,
  actorRole,
  canCreateInvitations,
  canRevokeInvitations,
  invitations,
  isLoadingInvitations,
  initialCode = '',
  preview,
  isLoadingPreview,
  isAccepting,
  acceptFeedback = null,
  manageFeedback = null,
  lastCreatedInvitation = null,
  onPreviewCode,
  onAcceptCode,
  onCreateInvitation,
  onRevokeInvitation,
}: InvitationsPanelProps) {
  const intl = useIntl();
  const [codeInput, setCodeInput] = useState(initialCode);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<InvitationListItem['id'] | null>(null);
  const [revokingId, setRevokingId] = useState<InvitationListItem['id'] | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationFormValues>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: {
      email: '',
      initialRole: ORGANIZATION_ROLES.MEMBER,
      expiresInDays: 15,
    },
  });

  const handleCopy = async (text: string, marker: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedId(marker);
      window.setTimeout(() => {
        setCopiedId((current) => (current === marker ? null : current));
      }, 2500);
    } catch {
      // Fallback silencioso quando clipboard API não está disponível
    }
  };

  const handlePreviewSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeInput.trim().length === 0) {
      return;
    }
    await onPreviewCode(codeInput.trim());
  };

  const handleCreateSubmit = async (values: CreateInvitationFormValues) => {
    await onCreateInvitation({
      email: values.email,
      initialRole: values.initialRole,
      expiresInDays: values.expiresInDays,
    });
    reset({
      email: '',
      initialRole: ORGANIZATION_ROLES.MEMBER,
      expiresInDays: 15,
    });
  };

  const handleConfirmRevoke = async (invitation: InvitationListItem) => {
    setRevokingId(invitation.id);
    try {
      await onRevokeInvitation(invitation.id, invitation.email);
      setConfirmRevokeId(null);
    } finally {
      setRevokingId(null);
    }
  };

  const buildAbsoluteLink = (relativeLink: string): string => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${relativeLink}`;
    }
    return relativeLink;
  };

  const actorRoleLabel =
    actorRole !== null ? intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[actorRole] }) : '';

  return (
    <section aria-labelledby="invitations-heading" className="mx-auto w-full max-w-5xl space-y-8">
      <div className="space-y-2">
        <h1
          id="invitations-heading"
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          {intl.formatMessage({ id: 'invitations.title' })}
        </h1>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'invitations.subtitle' })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'invitations.accept.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'invitations.accept.description' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {acceptFeedback !== null ? (
            <Alert variant={acceptFeedback.type}>
              <AlertDescription>{acceptFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={(event) => void handlePreviewSubmit(event)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="accept-invitation-code" required>
                {intl.formatMessage({ id: 'invitations.accept.codeLabel' })}
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="accept-invitation-code"
                  type="text"
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  placeholder={intl.formatMessage({ id: 'invitations.accept.codePlaceholder' })}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={isLoadingPreview || codeInput.trim().length === 0}
                  className="shrink-0"
                >
                  <IconSearch className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {intl.formatMessage({
                      id: isLoadingPreview
                        ? 'auth.common.submitting'
                        : 'invitations.accept.previewAction',
                    })}
                  </span>
                </Button>
              </div>
            </div>
          </form>

          {preview !== null ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-foreground">
                  {intl.formatMessage(
                    { id: 'invitations.accept.organizationLabel' },
                    { name: preview.organizationName },
                  )}
                </p>
                <Badge
                  variant={
                    preview.status === 'PENDING'
                      ? 'default'
                      : preview.status === 'ACCEPTED'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {intl.formatMessage({ id: STATUS_LABEL_ID_BY_CODE[preview.status] })}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {intl.formatMessage(
                    { id: 'invitations.accept.roleLabel' },
                    {
                      role: intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[preview.initialRole] }),
                    },
                  )}
                </span>
                <span>
                  {intl.formatMessage(
                    { id: 'invitations.accept.expiresLabel' },
                    {
                      date: intl.formatDate(preview.expiresAt, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }),
                    },
                  )}
                </span>
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
                onClick={() => void onAcceptCode(preview.code)}
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
      </Card>

      {activeOrganizationName !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {intl.formatMessage({ id: 'invitations.manage.title' })} — {activeOrganizationName}
            </CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'invitations.manage.description' })}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {manageFeedback !== null ? (
              <Alert variant={manageFeedback.type}>
                <AlertDescription>{manageFeedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {!canCreateInvitations ? (
              <Alert variant="info">
                <AlertDescription>
                  {intl.formatMessage(
                    { id: 'invitations.manage.noPermission' },
                    { role: actorRoleLabel },
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <form onSubmit={handleSubmit(handleCreateSubmit)} noValidate className="space-y-4">
                  <Alert variant="info">
                    <AlertDescription>
                      {intl.formatMessage({ id: 'auth.common.localAuthNotice' })}
                    </AlertDescription>
                  </Alert>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-1">
                      <Label htmlFor="invite-email" required>
                        {intl.formatMessage({ id: 'invitations.manage.emailLabel' })}
                      </Label>
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder={intl.formatMessage({
                          id: 'invitations.manage.emailPlaceholder',
                        })}
                        aria-invalid={errors.email !== undefined}
                        aria-describedby={
                          errors.email !== undefined ? 'invite-email-error' : undefined
                        }
                        {...register('email')}
                      />
                      {errors.email !== undefined ? (
                        <p
                          id="invite-email-error"
                          role="alert"
                          className="text-xs font-medium text-destructive"
                        >
                          {intl.formatMessage({
                            id:
                              errors.email.message === 'validation.emailInvalid'
                                ? 'validation.emailInvalid'
                                : 'validation.required',
                          })}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="invite-role" required>
                        {intl.formatMessage({ id: 'invitations.manage.roleLabel' })}
                      </Label>
                      <select
                        id="invite-role"
                        className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...register('initialRole')}
                      >
                        {ROLE_OPTIONS.map((roleOption) => (
                          <option key={roleOption} value={roleOption}>
                            {intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[roleOption] })}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="invite-expiry-days" required>
                        {intl.formatMessage({ id: 'invitations.manage.expiresInDaysLabel' })}
                      </Label>
                      <Input
                        id="invite-expiry-days"
                        type="number"
                        min={1}
                        max={90}
                        aria-invalid={errors.expiresInDays !== undefined}
                        {...register('expiresInDays')}
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={isSubmitting}>
                    <IconMailPlus className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {intl.formatMessage({
                        id: isSubmitting
                          ? 'auth.common.submitting'
                          : 'invitations.manage.createAction',
                      })}
                    </span>
                  </Button>
                </form>

                {lastCreatedInvitation !== null ? (
                  <Alert variant="success">
                    <AlertTitle>
                      {intl.formatMessage(
                        { id: 'invitations.manage.createSuccess' },
                        { email: lastCreatedInvitation.invitation.email },
                      )}
                    </AlertTitle>
                    <AlertDescription className="mt-2 space-y-2">
                      <p className="font-mono text-xs">
                        {intl.formatMessage({ id: 'invitations.accept.codeLabel' })}:{' '}
                        <strong>{lastCreatedInvitation.invitation.code}</strong>
                      </p>
                      <p className="break-all font-mono text-xs">
                        {buildAbsoluteLink(lastCreatedInvitation.inviteLink)}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void handleCopy(lastCreatedInvitation.invitation.code, 'latest-code')
                          }
                        >
                          <IconCopy className="h-4 w-4" aria-hidden="true" />
                          <span>
                            {copiedId === 'latest-code'
                              ? intl.formatMessage({ id: 'invitations.manage.copiedFeedback' })
                              : intl.formatMessage({ id: 'invitations.manage.copyCodeAction' })}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void handleCopy(
                              buildAbsoluteLink(lastCreatedInvitation.inviteLink),
                              'latest-link',
                            )
                          }
                        >
                          <IconLink className="h-4 w-4" aria-hidden="true" />
                          <span>
                            {copiedId === 'latest-link'
                              ? intl.formatMessage({ id: 'invitations.manage.copiedFeedback' })
                              : intl.formatMessage({ id: 'invitations.manage.copyLinkAction' })}
                          </span>
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {isLoadingInvitations ? (
                  <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'app.loading' })}
                  </p>
                ) : invitations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'invitations.manage.empty' })}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {invitations.map((invitation) => {
                      const isPending = invitation.derivedStatus === 'PENDING';
                      const isConfirming = confirmRevokeId === invitation.id;
                      const isRevoking = revokingId === invitation.id;

                      return (
                        <li key={invitation.id} className="space-y-3 rounded-lg border p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-foreground">
                                  {invitation.email}
                                </span>
                                <Badge
                                  variant={
                                    isPending
                                      ? 'default'
                                      : invitation.derivedStatus === 'ACCEPTED'
                                        ? 'secondary'
                                        : 'destructive'
                                  }
                                >
                                  {intl.formatMessage({
                                    id: STATUS_LABEL_ID_BY_CODE[invitation.derivedStatus],
                                  })}
                                </Badge>
                                <Badge variant="outline">
                                  {intl.formatMessage({
                                    id: ROLE_LABEL_ID_BY_CODE[invitation.initialRole],
                                  })}
                                </Badge>
                              </div>
                              <p className="font-mono text-xs text-muted-foreground">
                                {invitation.code} ·{' '}
                                {intl.formatMessage(
                                  { id: 'invitations.accept.expiresLabel' },
                                  {
                                    date: intl.formatDate(invitation.expiresAt, {
                                      dateStyle: 'short',
                                      timeStyle: 'short',
                                    }),
                                  },
                                )}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void handleCopy(invitation.code, `code-${invitation.id}`)
                                }
                              >
                                <IconCopy className="h-4 w-4" aria-hidden="true" />
                                <span>
                                  {copiedId === `code-${invitation.id}`
                                    ? intl.formatMessage({
                                        id: 'invitations.manage.copiedFeedback',
                                      })
                                    : intl.formatMessage({
                                        id: 'invitations.manage.copyCodeAction',
                                      })}
                                </span>
                              </Button>

                              {canRevokeInvitations && isPending && !isConfirming ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setConfirmRevokeId(invitation.id)}
                                >
                                  <IconTrash className="h-4 w-4" aria-hidden="true" />
                                  <span>
                                    {intl.formatMessage({ id: 'invitations.manage.revokeAction' })}
                                  </span>
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          {isConfirming ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                              <span className="text-xs font-medium text-foreground">
                                Confirmar revogação do convite para {invitation.email}?
                              </span>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  disabled={isRevoking}
                                  onClick={() => void handleConfirmRevoke(invitation)}
                                >
                                  {intl.formatMessage({
                                    id: isRevoking
                                      ? 'auth.common.submitting'
                                      : 'invitations.manage.revokeAction',
                                  })}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={isRevoking}
                                  onClick={() => setConfirmRevokeId(null)}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
