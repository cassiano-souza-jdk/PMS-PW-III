import { useIntl } from 'react-intl';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/app/providers';

export function RequireAuth() {
  const intl = useIntl();
  const location = useLocation();
  const { status, isAuthenticated } = useAuth();

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-muted-foreground"
      >
        {intl.formatMessage({ id: 'feedback.sessionRestoring' })}
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
