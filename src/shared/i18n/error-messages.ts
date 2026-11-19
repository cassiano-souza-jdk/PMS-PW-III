import { APP_ERROR_CODES, type AppErrorCode } from '@/shared/errors';
import { ptBRMessages, type MessageId } from './messages/pt-BR';

export const APP_ERROR_MESSAGE_IDS: Readonly<Record<AppErrorCode, MessageId>> = {
  [APP_ERROR_CODES.AUTHENTICATION_ERROR]: 'errors.AUTHENTICATION_ERROR',
  [APP_ERROR_CODES.AUTHORIZATION_ERROR]: 'errors.AUTHORIZATION_ERROR',
  [APP_ERROR_CODES.NOT_FOUND]: 'errors.NOT_FOUND',
  [APP_ERROR_CODES.CONFLICT]: 'errors.CONFLICT',
  [APP_ERROR_CODES.VALIDATION_ERROR]: 'errors.VALIDATION_ERROR',
  [APP_ERROR_CODES.INFRASTRUCTURE_ERROR]: 'errors.INFRASTRUCTURE_ERROR',
  [APP_ERROR_CODES.UNEXPECTED_ERROR]: 'errors.UNEXPECTED_ERROR',
};

export function getErrorMessageId(code: AppErrorCode): MessageId {
  return APP_ERROR_MESSAGE_IDS[code];
}

export function getFallbackErrorMessage(code: AppErrorCode): string {
  return ptBRMessages[APP_ERROR_MESSAGE_IDS[code]];
}
