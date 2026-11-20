import { zodResolver } from '@hookform/resolvers/zod';
import { IconLogin, IconSparkles } from '@tabler/icons-react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
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

const loginFormSchema = z.object({
  email: z.string().trim().min(1, 'validation.required').email('validation.emailInvalid'),
  password: z.string().min(1, 'validation.required'),
  persistent: z.boolean(),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export interface LoginFormProps {
  readonly onSubmit: (values: LoginFormValues) => Promise<void>;
  readonly errorMessage?: string | null;
}

export function LoginForm({ onSubmit, errorMessage = null }: LoginFormProps) {
  const intl = useIntl();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: '',
      password: '',
      persistent: true,
    },
  });

  const emailErrorId = 'login-email-error';
  const passwordErrorId = 'login-password-error';
  const persistentHintId = 'login-persistent-hint';

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {intl.formatMessage({ id: 'auth.login.title' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'auth.login.subtitle' })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {intl.formatMessage({ id: 'auth.login.submit' })}
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
              <Label htmlFor="login-email" required>
                {intl.formatMessage({ id: 'auth.common.emailLabel' })}
              </Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder={intl.formatMessage({ id: 'auth.common.emailPlaceholder' })}
                aria-invalid={errors.email !== undefined}
                aria-describedby={errors.email !== undefined ? emailErrorId : undefined}
                {...register('email')}
              />
              {errors.email?.message !== undefined ? (
                <p id={emailErrorId} role="alert" className="text-xs font-medium text-destructive">
                  {intl.formatMessage({
                    id:
                      errors.email.message === 'validation.emailInvalid'
                        ? 'validation.emailInvalid'
                        : 'validation.required',
                  })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="login-password" required>
                  {intl.formatMessage({ id: 'auth.common.passwordLabel' })}
                </Label>
                <Link
                  to="/recover-password"
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {intl.formatMessage({ id: 'auth.login.forgotPassword' })}
                </Link>
              </div>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder={intl.formatMessage({ id: 'auth.common.passwordPlaceholder' })}
                aria-invalid={errors.password !== undefined}
                aria-describedby={errors.password !== undefined ? passwordErrorId : undefined}
                {...register('password')}
              />
              {errors.password?.message !== undefined ? (
                <p
                  id={passwordErrorId}
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: 'validation.required' })}
                </p>
              ) : null}
            </div>

            <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
              <input
                id="login-persistent"
                type="checkbox"
                aria-describedby={persistentHintId}
                className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                {...register('persistent')}
              />
              <div className="space-y-0.5">
                <label
                  htmlFor="login-persistent"
                  className="block cursor-pointer text-sm font-medium text-foreground"
                >
                  {intl.formatMessage({ id: 'auth.common.persistentLabel' })}
                </label>
                <p id={persistentHintId} className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: 'auth.common.persistentHint' })}
                </p>
              </div>
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              <IconLogin className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isSubmitting ? 'auth.common.submitting' : 'auth.login.submit',
                })}
              </span>
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
          <Button asChild variant="secondary" className="w-full">
            <Link to="/demo">
              <IconSparkles className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'auth.login.demoShortcut' })}</span>
            </Link>
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'auth.login.noAccount' })}{' '}
            <Link
              to="/register"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {intl.formatMessage({ id: 'auth.login.createAccount' })}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
