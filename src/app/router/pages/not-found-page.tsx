import { IconArrowLeft, IconError404 } from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { Button, Card, CardDescription, CardFooter, CardHeader } from '@/shared/ui';

export function NotFoundPage() {
  const intl = useIntl();

  return (
    <section
      aria-labelledby="not-found-heading"
      className="flex min-h-[50vh] items-center justify-center"
    >
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center space-y-3">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground"
            aria-hidden="true"
          >
            <IconError404 className="h-7 w-7" />
          </span>
          <p className="text-sm font-semibold text-primary">
            {intl.formatMessage({ id: 'notFound.code' })}
          </p>
          <h1 id="not-found-heading" className="text-2xl font-bold tracking-tight text-foreground">
            {intl.formatMessage({ id: 'notFound.title' })}
          </h1>
          <CardDescription>{intl.formatMessage({ id: 'notFound.description' })}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button asChild>
            <Link to="/">
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              {intl.formatMessage({ id: 'notFound.backHome' })}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

export default NotFoundPage;
