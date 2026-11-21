import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { useAuth, useOrganization, usePermission } from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type {
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationId,
  InvitationListItem,
  InvitationPreview,
} from '@/modules/invitations';
import {
  InvitationsPanel,
  type InvitationPanelFeedback,
} from '@/modules/invitations/presentation/invitations-panel';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';

interface LoadedInvitationsState {
  readonly contextKey: string | null;
  readonly items: readonly InvitationListItem[];
}

const INITIAL_LOADED: LoadedInvitationsState = {
  contextKey: null,
  items: [],
};

export function InvitationsPage() {
  const intl = useIntl();
  const { services } = useComposition();
  const { user } = useAuth();
  const { activeOrganization, refreshOrganizations } = useOrganization();
  const { can, refreshPermissions } = usePermission();

  const [loadedInvitations, setLoadedInvitations] =
    useState<LoadedInvitationsState>(INITIAL_LOADED);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptFeedback, setAcceptFeedback] = useState<InvitationPanelFeedback | null>(null);
  const [manageFeedback, setManageFeedback] = useState<InvitationPanelFeedback | null>(null);
  const [lastCreatedInvitation, setLastCreatedInvitation] = useState<CreateInvitationResult | null>(
    null,
  );

  const canCreateInvitations =
    activeOrganization !== null && can(PERMISSION_CODES.INVITATION_CREATE);
  const canRevokeInvitations =
    activeOrganization !== null && can(PERMISSION_CODES.INVITATION_REVOKE);

  const contextKey =
    user !== null && activeOrganization !== null && canCreateInvitations
      ? `${user.id}:${activeOrganization.id}`
      : null;

  const reloadInvitations = useCallback(async () => {
    if (user === null || activeOrganization === null || !canCreateInvitations) {
      return;
    }
    const items = await services.invitations.listInvitations(user.id, activeOrganization.id);
    setLoadedInvitations({
      contextKey: `${user.id}:${activeOrganization.id}`,
      items,
    });
  }, [activeOrganization, canCreateInvitations, services.invitations, user]);

  useEffect(() => {
    if (user === null || activeOrganization === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const actorUserId = user.id;
    const targetOrgId = activeOrganization.id;
    const targetKey = contextKey;

    async function loadInvitations() {
      try {
        const items = await services.invitations.listInvitations(actorUserId, targetOrgId);
        if (!isActive) {
          return;
        }
        setLoadedInvitations({
          contextKey: targetKey,
          items,
        });
      } catch {
        if (!isActive) {
          return;
        }
        setLoadedInvitations({
          contextKey: targetKey,
          items: [],
        });
      }
    }

    void loadInvitations();

    return () => {
      isActive = false;
    };
  }, [activeOrganization, contextKey, services.invitations, user]);

  if (user === null) {
    return null;
  }

  const invitations =
    contextKey !== null && loadedInvitations.contextKey === contextKey
      ? loadedInvitations.items
      : [];
  const isLoadingInvitations = contextKey !== null && loadedInvitations.contextKey !== contextKey;

  const handlePreviewCode = async (code: string) => {
    setAcceptFeedback(null);
    setIsLoadingPreview(true);
    try {
      const result = await services.invitations.previewInvitationByCode(user.id, code);
      setPreview(result);
    } catch (error) {
      setPreview(null);
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setAcceptFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleAcceptCode = async (code: string) => {
    setAcceptFeedback(null);
    setIsAccepting(true);
    try {
      const result = await services.invitations.acceptInvitation(user.id, code);
      await refreshOrganizations();
      await refreshPermissions();
      setPreview(null);
      setAcceptFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'invitations.accept.success' },
          { name: result.organization.name },
        ),
      });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setAcceptFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'invitations.accept.alreadyMemberError' }),
        });
        return;
      }
      if (isAppError(error) && error.code === APP_ERROR_CODES.AUTHORIZATION_ERROR) {
        setAcceptFeedback({
          type: 'destructive',
          message: intl.formatMessage({ id: 'invitations.accept.emailMismatchWarning' }),
        });
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setAcceptFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleCreateInvitation = async (input: CreateInvitationInput) => {
    if (activeOrganization === null) {
      return;
    }
    setManageFeedback(null);
    try {
      const created = await services.invitations.createInvitation(
        user.id,
        activeOrganization.id,
        input,
      );
      setLastCreatedInvitation(created);
      await reloadInvitations();
      setManageFeedback({
        type: 'success',
        message: intl.formatMessage(
          { id: 'invitations.manage.createSuccess' },
          { email: created.invitation.email },
        ),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setManageFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
      throw error;
    }
  };

  const handleRevokeInvitation = async (invitationId: InvitationId, email: string) => {
    if (activeOrganization === null) {
      return;
    }
    setManageFeedback(null);
    try {
      await services.invitations.revokeInvitation(user.id, activeOrganization.id, invitationId);
      await reloadInvitations();
      setManageFeedback({
        type: 'success',
        message: intl.formatMessage({ id: 'invitations.manage.revokeSuccess' }, { email }),
      });
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setManageFeedback({
        type: 'destructive',
        message: intl.formatMessage({ id: messageId }),
      });
    }
  };

  return (
    <InvitationsPanel
      activeOrganizationName={activeOrganization?.name ?? null}
      actorRole={activeOrganization?.role ?? null}
      canCreateInvitations={canCreateInvitations}
      canRevokeInvitations={canRevokeInvitations}
      invitations={invitations}
      isLoadingInvitations={isLoadingInvitations}
      preview={preview}
      isLoadingPreview={isLoadingPreview}
      isAccepting={isAccepting}
      acceptFeedback={acceptFeedback}
      manageFeedback={manageFeedback}
      lastCreatedInvitation={lastCreatedInvitation}
      onPreviewCode={handlePreviewCode}
      onAcceptCode={handleAcceptCode}
      onCreateInvitation={handleCreateInvitation}
      onRevokeInvitation={handleRevokeInvitation}
    />
  );
}

export default InvitationsPage;
