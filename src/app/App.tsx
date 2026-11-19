import type { AppCompositionContainer } from '@/app/composition';
import { AppProviders } from '@/app/providers';
import { AppRouter } from '@/app/router/app-router';
import type { AppRouterInstance } from '@/app/router/routes';

export interface AppProps {
  readonly container?: AppCompositionContainer;
  readonly router?: AppRouterInstance;
}

export function App({ container, router }: AppProps) {
  return (
    <AppProviders container={container}>
      <AppRouter router={router} />
    </AppProviders>
  );
}
