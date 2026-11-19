import type { ReactNode } from 'react';
import {
  CompositionProvider,
  useComposition,
  type AppCompositionContainer,
} from '@/app/composition';
import { ErrorBoundary } from '@/shared/ui';
import { AppIntlProvider } from './intl-provider';
import { ThemeProvider } from './theme-provider';

export interface AppProvidersProps {
  readonly children: ReactNode;
  readonly container?: AppCompositionContainer;
}

function ProvidersWithComposition({ children }: { readonly children: ReactNode }) {
  const { logger } = useComposition();

  return (
    <ThemeProvider>
      <AppIntlProvider>
        <ErrorBoundary logger={logger}>{children}</ErrorBoundary>
      </AppIntlProvider>
    </ThemeProvider>
  );
}

export function AppProviders({ children, container }: AppProvidersProps) {
  return (
    <CompositionProvider container={container}>
      <ProvidersWithComposition>{children}</ProvidersWithComposition>
    </CompositionProvider>
  );
}
