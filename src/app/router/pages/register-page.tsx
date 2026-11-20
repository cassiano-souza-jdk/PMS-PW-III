import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '@/app/providers';
import {
  RegisterForm,
  type RegisterFormValues,
} from '@/modules/authentication/presentation/register-form';
import { APP_ERROR_CODES, isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';

export function RegisterPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { isAuthenticated, register: registerAccount } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isAuthenticated) {
    return <Navigate to="/organizations" replace />;
  }

  const handleRegister = async (values: RegisterFormValues) => {
    setErrorMessage(null);
    try {
      await registerAccount({
        displayName: values.displayName,
        email: values.email,
        password: values.password,
        acceptTerms: true,
        persistent: values.persistent,
      });
      await navigate('/organizations', { replace: true });
    } catch (error) {
      if (isAppError(error) && error.code === APP_ERROR_CODES.CONFLICT) {
        setErrorMessage(intl.formatMessage({ id: 'auth.register.emailConflict' }));
        return;
      }
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setErrorMessage(intl.formatMessage({ id: messageId }));
    }
  };

  return <RegisterForm onSubmit={handleRegister} errorMessage={errorMessage} />;
}

export default RegisterPage;
