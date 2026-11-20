import { zodResolver } from '@hookform/resolvers/zod';
import { IconArrowLeft, IconMailForward } from '@tabler/icons-react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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

const recoverPasswordSchema = z.object({
  email: z.string().trim().min(1, 'validation.required').email('validation.emailInvalid'),
});

export type RecoverPasswordFormValues = z.infer<typeof recoverPasswordSchema>;

export interface RecoverPasswordFormProps {
  readonly onSubmit: (values: RecoverPasswordFormValues) => Promise<void>;
  readonly submitted: boolean;
  readonly errorMessage?: string | null;
}

export function RecoverPasswordForm({
  onSubmit,
  submitted,
  errorMessage = null,
}: RecoverPasswordFormProps) {
  const intl = useIntl();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoverPasswordFormValues>({
    resolver: zodResolver(recoverPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {intl.formatMessage({ id: 'auth.recovery.title' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'auth.recovery.subtitle' })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {intl.formatMessage({ id: 'auth.recovery.title' })}
          </CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'auth.common.localAuthNotice' })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {errorMessage !== null ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {submitted ? (
            <Alert variant="info">
              <AlertTitle>{intl.formatMessage({ id: 'auth.recovery.successTitle' })}</AlertTitle>
              <AlertDescription>
                {intl.formatMessage({ id: 'auth.recovery.simulatedNotice' })}
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="recovery-email" required>
                {intl.formatMessage({ id: 'auth.common.emailLabel' })}
              </Label>
              <Input
                id="recovery-email"
                type="email"
                autoComplete="email"
                placeholder={intl.formatMessage({ id: 'auth.common.emailPlaceholder' })}
                aria-invalid={errors.email !== undefined}
                aria-describedby={errors.email !== undefined ? 'recovery-email-error' : undefined}
                {...register('email')}
              />
              {errors.email !== undefined ? (
                <p
                  id="recovery-email-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({
                    id:
                      errors.email.message === 'validation.emailInvalid'
                        ? 'validation.emailInvalid'
                        : 'validation.required',
                  })}
                </p>
              ) : null}
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              <IconMailForward className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isSubmitting ? 'auth.common.submitting' : 'auth.recovery.submit',
                })}
              </span>
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center border-t pt-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'auth.recovery.backToLogin' })}</span>
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
