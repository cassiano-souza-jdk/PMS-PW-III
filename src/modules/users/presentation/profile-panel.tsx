import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconCheck,
  IconDeviceDesktop,
  IconLogout,
  IconMailCheck,
  IconShieldOff,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import { isSessionActiveAt, type SessionId, type UserSession } from '@/modules/authentication';
import { asIsoDateTime } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
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

const profileFormSchema = z.object({
  displayName: z.string().trim().min(2, 'validation.displayNameMin').max(120),
  avatarUrl: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || value.startsWith('http://') || value.startsWith('https://'),
      'validation.urlInvalid',
    ),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export interface PanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface ProfilePanelProps {
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl?: string;
  readonly emailVerifiedSimulated: boolean;
  readonly sessions: readonly UserSession[];
  readonly currentSessionId: SessionId | null;
  readonly isLoadingSessions: boolean;
  readonly profileFeedback?: PanelFeedback | null;
  readonly sessionsFeedback?: PanelFeedback | null;
  readonly onUpdateProfile: (values: ProfileFormValues) => Promise<void>;
  readonly onVerifyEmail: () => Promise<void>;
  readonly onRevokeSession: (sessionId: SessionId) => Promise<void>;
  readonly onRevokeAllSessions: () => Promise<void>;
}

export function ProfilePanel({
  displayName,
  email,
  avatarUrl = '',
  emailVerifiedSimulated,
  sessions,
  currentSessionId,
  isLoadingSessions,
  profileFeedback = null,
  sessionsFeedback = null,
  onUpdateProfile,
  onVerifyEmail,
  onRevokeSession,
  onRevokeAllSessions,
}: ProfilePanelProps) {
  const intl = useIntl();
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<SessionId | null>(null);
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      displayName,
      avatarUrl,
    },
  });

  useEffect(() => {
    reset({
      displayName,
      avatarUrl,
    });
  }, [avatarUrl, displayName, reset]);

  const nowIso = asIsoDateTime(new Date().toISOString());

  const handleVerifyEmail = async () => {
    setIsVerifyingEmail(true);
    try {
      await onVerifyEmail();
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  const handleRevokeOne = async (sessionId: SessionId) => {
    setRevokingSessionId(sessionId);
    try {
      await onRevokeSession(sessionId);
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleRevokeAll = async () => {
    setIsRevokingAll(true);
    try {
      await onRevokeAllSessions();
    } finally {
      setIsRevokingAll(false);
    }
  };

  return (
    <section aria-labelledby="profile-heading" className="mx-auto w-full max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1
          id="profile-heading"
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          {intl.formatMessage({ id: 'profile.title' })}
        </h1>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'profile.subtitle' })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'profile.account.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'profile.account.description' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {profileFeedback !== null ? (
            <Alert variant={profileFeedback.type}>
              <AlertDescription>{profileFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {intl.formatMessage({ id: 'profile.account.emailLabel' })}
              </p>
              <p className="text-sm font-semibold text-foreground">{email}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {emailVerifiedSimulated ? (
                <Badge variant="default">
                  <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'profile.account.emailVerified' })}</span>
                </Badge>
              ) : (
                <>
                  <Badge variant="outline">
                    {intl.formatMessage({ id: 'profile.account.emailUnverified' })}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isVerifyingEmail}
                    onClick={() => void handleVerifyEmail()}
                  >
                    <IconMailCheck className="h-4 w-4" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: 'profile.account.verifyEmailAction' })}</span>
                  </Button>
                </>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit(onUpdateProfile)} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-display-name" required>
                {intl.formatMessage({ id: 'auth.common.displayNameLabel' })}
              </Label>
              <Input
                id="profile-display-name"
                type="text"
                autoComplete="name"
                aria-invalid={errors.displayName !== undefined}
                aria-describedby={
                  errors.displayName !== undefined ? 'profile-display-name-error' : undefined
                }
                {...register('displayName')}
              />
              {errors.displayName !== undefined ? (
                <p
                  id="profile-display-name-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: 'validation.displayNameMin' })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-avatar-url">
                {intl.formatMessage({ id: 'profile.account.avatarUrlLabel' })}
              </Label>
              <Input
                id="profile-avatar-url"
                type="url"
                placeholder={intl.formatMessage({ id: 'profile.account.avatarUrlPlaceholder' })}
                aria-invalid={errors.avatarUrl !== undefined}
                aria-describedby={
                  errors.avatarUrl !== undefined
                    ? 'profile-avatar-url-error profile-avatar-url-hint'
                    : 'profile-avatar-url-hint'
                }
                {...register('avatarUrl')}
              />
              <p id="profile-avatar-url-hint" className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: 'profile.account.avatarUrlHint' })}
              </p>
              {errors.avatarUrl !== undefined ? (
                <p
                  id="profile-avatar-url-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: 'validation.urlInvalid' })}
                </p>
              ) : null}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              <span>
                {intl.formatMessage({
                  id: isSubmitting ? 'auth.common.submitting' : 'profile.account.saveAction',
                })}
              </span>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{intl.formatMessage({ id: 'profile.sessions.title' })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'profile.sessions.description' })}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isRevokingAll || sessions.length === 0}
            onClick={() => void handleRevokeAll()}
          >
            <IconShieldOff className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'profile.sessions.revokeAllAction' })}</span>
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {sessionsFeedback !== null ? (
            <Alert variant={sessionsFeedback.type}>
              <AlertDescription>{sessionsFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          {isLoadingSessions ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'app.loading' })}
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'profile.sessions.empty' })}
            </p>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => {
                const isCurrent = session.id === currentSessionId;
                const isActive = isSessionActiveAt(session, nowIso);
                const isRevoked = session.revokedAt !== undefined;

                const statusBadge = isRevoked ? (
                  <Badge variant="destructive">
                    {intl.formatMessage({ id: 'profile.sessions.revokedBadge' })}
                  </Badge>
                ) : isActive ? (
                  <Badge variant="default">
                    {intl.formatMessage({ id: 'profile.sessions.activeBadge' })}
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    {intl.formatMessage({ id: 'profile.sessions.expiredBadge' })}
                  </Badge>
                );

                return (
                  <li
                    key={session.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <IconDeviceDesktop
                          className="h-4 w-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="font-semibold text-foreground">{session.deviceLabel}</span>
                        {isCurrent ? (
                          <Badge variant="secondary">
                            {intl.formatMessage({ id: 'profile.sessions.currentBadge' })}
                          </Badge>
                        ) : null}
                        {statusBadge}
                        <Badge variant="outline">
                          {intl.formatMessage({
                            id: session.persistent
                              ? 'profile.sessions.persistentBadge'
                              : 'profile.sessions.ephemeralBadge',
                          })}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {intl.formatMessage(
                            { id: 'profile.sessions.createdAt' },
                            {
                              date: intl.formatDate(session.createdAt, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }),
                            },
                          )}
                        </span>
                        <span>
                          {intl.formatMessage(
                            { id: 'profile.sessions.lastActivity' },
                            {
                              date: intl.formatDate(session.lastActivityAt, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }),
                            },
                          )}
                        </span>
                        <span>
                          {intl.formatMessage(
                            { id: 'profile.sessions.expiresAt' },
                            {
                              date: intl.formatDate(session.expiresAt, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }),
                            },
                          )}
                        </span>
                      </div>
                    </div>

                    {isActive ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={revokingSessionId === session.id || isRevokingAll}
                        onClick={() => void handleRevokeOne(session.id)}
                      >
                        <IconLogout className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'profile.sessions.revokeAction' })}</span>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
