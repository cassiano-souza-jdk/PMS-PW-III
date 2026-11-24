import { lazy } from 'react';
import { RouteSuspense } from './route-suspense';

const FoundationHomePage = lazy(() => import('./pages/foundation-home-page'));
const NotFoundPage = lazy(() => import('./pages/not-found-page'));
const LoginPage = lazy(() => import('./pages/login-page'));
const RegisterPage = lazy(() => import('./pages/register-page'));
const RecoverPasswordPage = lazy(() => import('./pages/recover-password-page'));
const DemoPage = lazy(() => import('./pages/demo-page'));
const ProfilePage = lazy(() => import('./pages/profile-page'));
const OrganizationsPage = lazy(() => import('./pages/organizations-page'));
const OrganizationSettingsPage = lazy(() => import('./pages/organization-settings-page'));
const InvitationsPage = lazy(() => import('./pages/invitations-page'));
const AcceptInvitationPage = lazy(() => import('./pages/accept-invitation-page'));
const TeamsPage = lazy(() => import('./pages/teams-page'));
const ProjectsPage = lazy(() => import('./pages/projects-page'));
const ProjectBoardPage = lazy(() => import('./pages/project-board-page'));
const ProjectTasksPage = lazy(() => import('./pages/project-tasks-page'));
const TaskDetailPage = lazy(() => import('./pages/task-detail-page'));
const PermissionsPage = lazy(() => import('./pages/permissions-page'));

export function LazyFoundationHomePage() {
  return (
    <RouteSuspense>
      <FoundationHomePage />
    </RouteSuspense>
  );
}

export function LazyNotFoundPage() {
  return (
    <RouteSuspense>
      <NotFoundPage />
    </RouteSuspense>
  );
}

export function LazyLoginPage() {
  return (
    <RouteSuspense>
      <LoginPage />
    </RouteSuspense>
  );
}

export function LazyRegisterPage() {
  return (
    <RouteSuspense>
      <RegisterPage />
    </RouteSuspense>
  );
}

export function LazyRecoverPasswordPage() {
  return (
    <RouteSuspense>
      <RecoverPasswordPage />
    </RouteSuspense>
  );
}

export function LazyDemoPage() {
  return (
    <RouteSuspense>
      <DemoPage />
    </RouteSuspense>
  );
}

export function LazyProfilePage() {
  return (
    <RouteSuspense>
      <ProfilePage />
    </RouteSuspense>
  );
}

export function LazyOrganizationsPage() {
  return (
    <RouteSuspense>
      <OrganizationsPage />
    </RouteSuspense>
  );
}

export function LazyOrganizationSettingsPage() {
  return (
    <RouteSuspense>
      <OrganizationSettingsPage />
    </RouteSuspense>
  );
}

export function LazyInvitationsPage() {
  return (
    <RouteSuspense>
      <InvitationsPage />
    </RouteSuspense>
  );
}

export function LazyAcceptInvitationPage() {
  return (
    <RouteSuspense>
      <AcceptInvitationPage />
    </RouteSuspense>
  );
}

export function LazyTeamsPage() {
  return (
    <RouteSuspense>
      <TeamsPage />
    </RouteSuspense>
  );
}

export function LazyProjectsPage() {
  return (
    <RouteSuspense>
      <ProjectsPage />
    </RouteSuspense>
  );
}

export function LazyProjectBoardPage() {
  return (
    <RouteSuspense>
      <ProjectBoardPage />
    </RouteSuspense>
  );
}

export function LazyProjectTasksPage() {
  return (
    <RouteSuspense>
      <ProjectTasksPage />
    </RouteSuspense>
  );
}

export function LazyTaskDetailPage() {
  return (
    <RouteSuspense>
      <TaskDetailPage />
    </RouteSuspense>
  );
}

export function LazyPermissionsPage() {
  return (
    <RouteSuspense>
      <PermissionsPage />
    </RouteSuspense>
  );
}
