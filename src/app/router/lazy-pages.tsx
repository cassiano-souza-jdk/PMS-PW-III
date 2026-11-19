import { lazy } from 'react';
import { RouteSuspense } from './route-suspense';

const FoundationHomePage = lazy(() => import('./pages/foundation-home-page'));
const NotFoundPage = lazy(() => import('./pages/not-found-page'));

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
