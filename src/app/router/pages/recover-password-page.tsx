import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useAuth } from '@/app/providers';
import {
  RecoverPasswordForm,
  type RecoverPasswordFormValues,
} from '@/modules/authentication/presentation/recover-password-form';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId } from '@/shared/i18n';

export function RecoverPasswordPage() {
  const intl = useIntl();
  const { simulatePasswordRecovery } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (values: RecoverPasswordFormValues) => {
    setErrorMessage(null);
    try {
      await simulatePasswordRecovery({ email: values.email });
      setSubmitted(true);
    } catch (error) {
      const messageId = isAppError(error)
        ? getErrorMessageId(error.code)
        : 'errors.UNEXPECTED_ERROR';
      setErrorMessage(intl.formatMessage({ id: messageId }));
    }
  };

  return (
    <RecoverPasswordForm
      onSubmit={handleSubmit}
      submitted={submitted}
      errorMessage={errorMessage}
    />
  );
}

export default RecoverPasswordPage;
