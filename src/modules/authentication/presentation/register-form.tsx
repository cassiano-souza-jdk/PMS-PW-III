import { zodResolver } from '@hookform/resolvers/zod';
import { IconUserPlus } from '@tabler/icons-react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui';

const registerFormSchema = z
  .object({
    displayName: z.string().trim().min(2, 'validation.displayNameMin').max(120),
    email: z.string().trim().min(1, 'validation.required').email('validation.emailInvalid'),
    password: z.string().min(8, 'validation.passwordMin').max(128),
    confirmPassword: z.string().min(1, 'validation.required'),
    acceptTerms: z.boolean().refine((value) => value === true, {
      message: 'validation.termsRequired',
    }),
    persistent: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordMismatch',
  });

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

export interface RegisterFormProps {
  readonly onSubmit: (values: RegisterFormValues) => Promise<void>;
  readonly errorMessage?: string | null;
}

const VALIDATION_ERROR_IDS: Readonly<Record<string, MessageId>> = {
  'validation.required': 'validation.required',
  'validation.emailInvalid': 'validation.emailInvalid',
  'validation.passwordMin': 'validation.passwordMin',
  'validation.passwordMismatch': 'validation.passwordMismatch',
  'validation.displayNameMin': 'validation.displayNameMin',
  'validation.termsRequired': 'validation.termsRequired',
};

function resolveValidationMessageId(code: string | undefined): MessageId {
  if (code !== undefined && code in VALIDATION_ERROR_IDS) {
    return VALIDATION_ERROR_IDS[code] ?? 'validation.required';
  }
  return 'validation.required';
}

export function RegisterForm({ onSubmit, errorMessage = null }: RegisterFormProps) {
  const intl = useIntl();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
      persistent: true,
    },
  });

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {intl.formatMessage({ id: 'auth.register.title' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'auth.register.subtitle' })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {intl.formatMessage({ id: 'auth.register.submit' })}
          </CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'auth.common.localAuthNotice' })}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {errorMessage !== null ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="register-display-name" required>
                {intl.formatMessage({ id: 'auth.common.displayNameLabel' })}
              </Label>
              <Input
                id="register-display-name"
                type="text"
                autoComplete="name"
                placeholder={intl.formatMessage({ id: 'auth.common.displayNamePlaceholder' })}
                aria-invalid={errors.displayName !== undefined}
                aria-describedby={
                  errors.displayName !== undefined ? 'register-display-name-error' : undefined
                }
                {...register('displayName')}
              />
              {errors.displayName !== undefined ? (
                <p
                  id="register-display-name-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id: resolveValidationMessageId(errors.displayName.message),
                  })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="register-email" required>
                {intl.formatMessage({ id: 'auth.common.emailLabel' })}
              </Label>
              <Input
                id="register-email"
                type="email"
                autoComplete="email"
                placeholder={intl.formatMessage({ id: 'auth.common.emailPlaceholder' })}
                aria-invalid={errors.email !== undefined}
                aria-describedby={errors.email !== undefined ? 'register-email-error' : undefined}
                {...register('email')}
              />
              {errors.email !== undefined ? (
                <p
                  id="register-email-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: resolveValidationMessageId(errors.email.message) })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="register-password" required>
                {intl.formatMessage({ id: 'auth.common.passwordLabel' })}
              </Label>
              <Input
                id="register-password"
                type="password"
                autoComplete="new-password"
                placeholder={intl.formatMessage({ id: 'auth.common.passwordPlaceholder' })}
                aria-invalid={errors.password !== undefined}
                aria-describedby={
                  errors.password !== undefined ? 'register-password-error' : undefined
                }
                {...register('password')}
              />
              {errors.password !== undefined ? (
                <p
                  id="register-password-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: resolveValidationMessageId(errors.password.message) })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="register-confirm-password" required>
                {intl.formatMessage({ id: 'auth.common.confirmPasswordLabel' })}
              </Label>
              <Input
                id="register-confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder={intl.formatMessage({ id: 'auth.common.confirmPasswordPlaceholder' })}
                aria-invalid={errors.confirmPassword !== undefined}
                aria-describedby={
                  errors.confirmPassword !== undefined
                    ? 'register-confirm-password-error'
                    : undefined
                }
                {...register('confirmPassword')}
              />
              {errors.confirmPassword !== undefined ? (
                <p
                  id="register-confirm-password-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id: resolveValidationMessageId(errors.confirmPassword.message),
                  })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
                <input
                  id="register-accept-terms"
                  type="checkbox"
                  aria-invalid={errors.acceptTerms !== undefined}
                  aria-describedby={
                    errors.acceptTerms !== undefined ? 'register-terms-error' : undefined
                  }
                  className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  {...register('acceptTerms')}
                />
                <label
                  htmlFor="register-accept-terms"
                  className="cursor-pointer text-sm text-foreground"
                >
                  {intl.formatMessage({ id: 'auth.register.acceptTerms' })}
                </label>
              </div>
              {errors.acceptTerms !== undefined ? (
                <p
                  id="register-terms-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id: resolveValidationMessageId(errors.acceptTerms.message),
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
              <input
                id="register-persistent"
                type="checkbox"
                aria-describedby="register-persistent-hint"
                className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                {...register('persistent')}
              />
              <div className="space-y-0.5">
                <label
                  htmlFor="register-persistent"
                  className="block cursor-pointer text-sm font-medium text-foreground"
                >
                  {intl.formatMessage({ id: 'auth.common.persistentLabel' })}
                </label>
                <p id="register-persistent-hint" className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: 'auth.common.persistentHint' })}
                </p>
              </div>
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              <IconUserPlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isSubmitting ? 'auth.common.submitting' : 'auth.register.submit',
                })}
              </span>
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'auth.register.hasAccount' })}{' '}
            <Link
              to="/login"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {intl.formatMessage({ id: 'auth.register.signIn' })}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
