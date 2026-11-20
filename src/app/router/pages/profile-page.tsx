import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization } from '@/app/providers';
import type { SessionId, UserSession } from '@/modules/authentication';
import {
  ProfilePanel,
  type PanelFeedback,
  type ProfileFormValues,
} from '@/modules/users/presentation/profile-panel';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';

export function ProfilePage() {
  const intl = useIntl();
  const { services } = useComposition();
  const {
    user,
    session,
    refreshProfile,
    listSessions,
    revokeSession,
    revokeAllSessions,
    simulateEmailVerification,
  } = useAuth();
  const { activeOrganizationId } = useOrganization();

  const [sessions, setSessions] = useState<readonly UserSession[]>([]);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [profileFeedback, setProfileFeedback] = useState<PanelFeedback | null>(null);
  const [sessionsFeedback, setSessionsFeedback] = useState<PanelFeedback | null>(null);

  const reloadSessions = useCallback(async () => {
    const list = await listSessions();
    setSessions(list);
  }, [listSessions]);

  useEffect(() => {
    if (user === null) {
      return;
    }

    let isActive = true;
    const targetUserId = user.id;

    async function loadInitialSessions() {
      try {
        const list = await listSessions();
        if (!isActive) {
          return;
        }
        setSessions(list);
        setLoadedUserId(targetUserId);
      } catch (error) {
        if (!isActive) {
          return;
        }
        const messageId = isAppError(error)
          ? getErrorMessageId(error.code)
          : 'errors.UNEXPECTED_ERROR';
        setSessionsFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: messageId }),
        });
        setLoadedUserId(targetUserId);
      }
    }

    void loadInitialSessions();

    return () => {
      isActive = false;
    };
  }, [intl, listSessions, user]);

  if (user === null) {
    return null;
  }

  const handleUpdateProfile = async (values: ProfileFormValues) => {
    setProfileFeedback(null);
    try {
      await services.users.updateMyProfile(user.id, {
        displayName: values.displayName,
        avatarUrl: values.avatarUrl.trim() === '' ? null : values.avatarUrl.trim(),
        ...(activeOrganizationId !== null ? { activeOrganizationId } : {}),
      });
      await refreshProfile();
      setProfileFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'profile.account.saveSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setProfileFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleVerifyEmail = async () => {
    setProfileFeedback(null);
    try {
      await simulateEmailVerification();
      setProfileFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'profile.account.verifyEmailSuccess' }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setProfileFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleRevokeSession = async (sessionId: SessionId) => {
    setSessionsFeedback(null);
    try {
      await revokeSession(sessionId, {
        ...(activeOrganizationId !== null ? { activeOrganizationId } : {}),
      });
      if (session?.id !== sessionId) {
        await reloadSessions();
        setSessionsFeedback({
          type: 'success',
          message: intl.formatMessage({ id: 'profile.sessions.revokeSuccess' }),
        });
      }
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setSessionsFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  const handleRevokeAllSessions = async () => {
    setSessionsFeedback(null);
    try {
      await revokeAllSessions({
        ...(activeOrganizationId !== null ? { activeOrganizationId } : {}),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setSessionsFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  return (
    <ProfilePanel
      displayName={user.displayName}
      email={user.email}
      {...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {})}
      emailVerifiedSimulated={user.emailVerifiedSimulated}
      sessions={sessions}
      currentSessionId={session?.id ?? null}
      isLoadingSessions={loadedUserId !== user.id}
      profileFeedback={profileFeedback}
      sessionsFeedback={sessionsFeedback}
      onUpdateProfile={handleUpdateProfile}
      onVerifyEmail={handleVerifyEmail}
      onRevokeSession={handleRevokeSession}
      onRevokeAllSessions={handleRevokeAllSessions}
    />
  );
}

export default ProfilePage;
