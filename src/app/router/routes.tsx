import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/app/layout/app-shell';
import { LazyFoundationHomePage, LazyNotFoundPage } from './lazy-pages';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <LazyFoundationHomePage />,
      },
      {
        path: '*',
        element: <LazyNotFoundPage />,
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}

export type AppRouterInstance = ReturnType<typeof createAppRouter>;
