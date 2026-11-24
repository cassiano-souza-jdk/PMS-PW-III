import { IconArrowLeft } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui';

export interface TaskPageStatusViewProps {
  readonly kind: 'no-org' | 'loading' | 'error';
  readonly headingId: string;
  readonly headingText: string;
  readonly descriptionText?: string;
  readonly backToPath?: string;
  readonly backLabelId?: MessageId;
}

export function TaskPageStatusView({
  kind,
  headingId,
  headingText,
  descriptionText,
  backToPath = '/projects',
  backLabelId = 'tasks.list.backToProjects',
}: TaskPageStatusViewProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (kind === 'error') {
      headingRef.current?.focus();
    }
  }, [headingText, kind]);

  if (kind === 'no-org') {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'organizations.emptyTitle' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'organizations.emptyDescription' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="min-h-[44px]">
            <Link to="/organizations">{intl.formatMessage({ id: 'nav.organizations' })}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (kind === 'loading') {
    return (
      <section aria-labelledby={headingId} className="mx-auto max-w-2xl space-y-4">
        <h1 id={headingId} tabIndex={-1} className="sr-only">
          {headingText}
        </h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'app.loading' })}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-2xl space-y-4">
      <h1
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="text-2xl font-bold text-foreground focus:outline-none"
      >
        {headingText}
      </h1>
      <Alert variant="destructive" role="alert">
        <AlertDescription>{descriptionText ?? headingText}</AlertDescription>
      </Alert>
      <Button asChild variant="outline" className="min-h-[44px]">
        <Link to={backToPath}>
          <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{intl.formatMessage({ id: backLabelId })}</span>
        </Link>
      </Button>
    </section>
  );
}
