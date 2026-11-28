import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/app/layout/app-shell';
import {
  LazyAcceptInvitationPage,
  LazyAnalyticsPage,
  LazyBottlenecksPage,
  LazyDemoPage,
  LazyFeedbackDetailPage,
  LazyFeedbackGovernancePage,
  LazyFeedbackPage,
  LazyFocusPage,
  LazyFoundationHomePage,
  LazyInvitationsPage,
  LazyLoginPage,
  LazyNotFoundPage,
  LazyOrganizationSettingsPage,
  LazyOrganizationsPage,
  LazyPermissionsPage,
  LazyProfilePage,
  LazyProjectBoardPage,
  LazyProjectTasksPage,
  LazyProjectsPage,
  LazyRecoverPasswordPage,
  LazyRegisterPage,
  LazyReportsPage,
  LazyTaskDetailPage,
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
            path: 'projects',
            element: <LazyProjectsPage />,
          },
          {
            path: 'projects/:projectId/board',
            element: <LazyProjectBoardPage />,
          },
          {
            path: 'projects/:projectId/tasks',
            element: <LazyProjectTasksPage />,
          },
          {
            path: 'projects/:projectId/tasks/:taskId',
            element: <LazyTaskDetailPage />,
          },
          {
            path: 'focus',
            element: <LazyFocusPage />,
          },
          {
            path: 'bottlenecks',
            element: <LazyBottlenecksPage />,
          },
          {
            path: 'projects/:projectId/bottlenecks',
            element: <LazyBottlenecksPage />,
          },
          {
            path: 'feedback',
            element: <LazyFeedbackPage />,
          },
          {
            path: 'feedback/governance',
            element: <LazyFeedbackGovernancePage />,
          },
          {
            path: 'feedback/:feedbackId',
            element: <LazyFeedbackDetailPage />,
          },
          {
            path: 'analytics',
            element: <LazyAnalyticsPage />,
          },
          {
            path: 'projects/:projectId/analytics',
            element: <LazyAnalyticsPage />,
          },
          {
            path: 'reports',
            element: <LazyReportsPage />,
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
