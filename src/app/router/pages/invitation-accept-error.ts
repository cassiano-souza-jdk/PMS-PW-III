import { INVITATION_ERROR_REASONS } from '@/modules/invitations';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';

const CONFLICT_REASON_MESSAGE_IDS: Readonly<Record<string, MessageId>> = {
  [INVITATION_ERROR_REASONS.MEMBER_ALREADY_ACTIVE]: 'invitations.accept.alreadyMemberError',
  [INVITATION_ERROR_REASONS.INVITATION_NOT_PENDING]: 'invitations.accept.invalidOrExpiredError',
};

const AUTHORIZATION_REASON_MESSAGE_IDS: Readonly<Record<string, MessageId>> = {
  [INVITATION_ERROR_REASONS.MEMBER_SUSPENDED]: 'invitations.accept.suspendedError',
  [INVITATION_ERROR_REASONS.EMAIL_MISMATCH]: 'invitations.accept.emailMismatchWarning',
};

export function resolveAcceptInvitationErrorMessageId(error: unknown): MessageId {
  if (!isAppError(error)) {
    return 'errors.UNEXPECTED_ERROR';
  }

  const reason = error.details?.['reason'];

  if (typeof reason === 'string') {
    if (error.code === APP_ERROR_CODES.CONFLICT) {
      return CONFLICT_REASON_MESSAGE_IDS[reason] ?? getErrorMessageId(error.code);
    }

    if (error.code === APP_ERROR_CODES.AUTHORIZATION_ERROR) {
      return AUTHORIZATION_REASON_MESSAGE_IDS[reason] ?? getErrorMessageId(error.code);
    }
  }

  return getErrorMessageId(error.code);
}
