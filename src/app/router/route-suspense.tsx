import { Suspense, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

export interface RouteSuspenseProps {
  readonly children: ReactNode;
}

function RouteLoadingFallback() {
  const intl = useIntl();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-muted-foreground"
    >
      {intl.formatMessage({ id: 'app.loading' })}
    </div>
  );
}

export function RouteSuspense({ children }: RouteSuspenseProps) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
}
