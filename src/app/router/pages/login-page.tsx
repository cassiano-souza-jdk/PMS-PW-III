import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/app/providers';
import { LoginForm, type LoginFormValues } from '@/modules/authentication/presentation/login-form';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';

interface RedirectState {
  readonly from?: {
    readonly pathname?: string;
  };
}

function resolvePostLoginPath(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const candidate = (state as RedirectState).from?.pathname;
    if (
      typeof candidate === 'string' &&
      candidate.startsWith('/') &&
      candidate !== '/login' &&
      candidate !== '/register'
    ) {
      return candidate;
    }
  }
  return '/organizations';
}

export function LoginPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const redirectTo = resolvePostLoginPath(location.state);

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleLogin = async (values: LoginFormValues) => {
    setErrorMessage(null);
    try {
      await login({
        email: values.email,
        password: values.password,
        persistent: values.persistent,
      });
      await navigate(redirectTo, { replace: true });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.AUTHENTICATION_ERROR) {
        setErrorMessage(intl.formatMessage({ id: 'auth.login.invalidCredentials' }));
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setErrorMessage(intl.formatMessage({ id: messageId }));
    }
  };

  return <LoginForm onSubmit={handleLogin} errorMessage={errorMessage} />;
}

export default LoginPage;
