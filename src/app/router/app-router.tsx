import { useMemo } from 'react';
import { RouterProvider } from 'react-router';
import { createAppRouter, type AppRouterInstance } from './routes';

export interface AppRouterProps {
  readonly router?: AppRouterInstance;
}

export function AppRouter({ router }: AppRouterProps) {
  const resolvedRouter = useMemo(() => router ?? createAppRouter(), [router]);

  return <RouterProvider router={resolvedRouter} />;
}
