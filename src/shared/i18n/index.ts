export const DEFAULT_LOCALE = 'pt-BR' as const;
export type SupportedLocale = typeof DEFAULT_LOCALE;

export { ptBRMessages, type AppMessages, type MessageId } from './messages/pt-BR';
export {
  APP_ERROR_MESSAGE_IDS,
  getErrorMessageId,
  getFallbackErrorMessage,
} from './error-messages';
