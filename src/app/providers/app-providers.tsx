import type { ReactNode } from 'react';
import {
  CompositionProvider,
  useComposition,
  type AppCompositionContainer,
} from '@/app/composition';
import { ErrorBoundary } from '@/shared/ui';
import { AuthProvider } from './auth-provider';
import { AppIntlProvider } from './intl-provider';
import { OrganizationProvider } from './organization-provider';
import { PermissionProvider } from './permission-provider';
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
        <ErrorBoundary logger={logger}>
          <AuthProvider>
            <OrganizationProvider>
              <PermissionProvider>{children}</PermissionProvider>
            </OrganizationProvider>
          </AuthProvider>
        </ErrorBoundary>
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
