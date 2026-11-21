import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/app/layout/app-shell';
import {
  LazyAcceptInvitationPage,
  LazyDemoPage,
  LazyFoundationHomePage,
  LazyInvitationsPage,
  LazyLoginPage,
  LazyNotFoundPage,
  LazyOrganizationSettingsPage,
  LazyOrganizationsPage,
  LazyPermissionsPage,
  LazyProfilePage,
  LazyRecoverPasswordPage,
  LazyRegisterPage,
  LazyTeamsPage,
} from './lazy-pages';
import { RequireAuth } from './require-auth';

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
        path: 'login',
        element: <LazyLoginPage />,
      },
      {
        path: 'register',
        element: <LazyRegisterPage />,
      },
      {
        path: 'recover-password',
        element: <LazyRecoverPasswordPage />,
      },
      {
        path: 'demo',
        element: <LazyDemoPage />,
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: 'organizations',
            element: <LazyOrganizationsPage />,
          },
          {
            path: 'teams',
            element: <LazyTeamsPage />,
          },
          {
            path: 'invitations',
            element: <LazyInvitationsPage />,
          },
          {
            path: 'invitations/accept',
            element: <LazyAcceptInvitationPage />,
          },
          {
            path: 'permissions',
            element: <LazyPermissionsPage />,
          },
          {
            path: 'profile',
            element: <LazyProfilePage />,
          },
          {
            path: 'settings',
            element: <LazyOrganizationSettingsPage />,
          },
        ],
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
