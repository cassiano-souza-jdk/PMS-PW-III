import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import {
  DEFAULT_LOCALE,
  ptBRMessages,
  type AppMessages,
  type SupportedLocale,
} from '@/shared/i18n';

export interface AppIntlProviderProps {
  readonly children: ReactNode;
  readonly locale?: SupportedLocale;
  readonly messages?: AppMessages;
}

export function AppIntlProvider({
  children,
  locale = DEFAULT_LOCALE,
  messages = ptBRMessages,
}: AppIntlProviderProps) {
  return (
    <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={messages}>
      {children}
    </IntlProvider>
  );
}
