import { IconAlertTriangle, IconHome, IconRefresh } from '@tabler/icons-react';
import { Component, useContext, type ErrorInfo, type ReactNode } from 'react';
import { IntlContext } from 'react-intl';
import { normalizeError, type AppError } from '@/shared/errors';
import { getErrorMessageId, getFallbackErrorMessage, ptBRMessages } from '@/shared/i18n';
import type { Logger } from '@/shared/logging';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

export interface ErrorBoundaryFallbackRenderProps {
  readonly error: AppError;
  readonly reset: () => void;
}

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly logger?: Logger;
  readonly onReset?: () => void;
  readonly fallback?: (props: ErrorBoundaryFallbackRenderProps) => ReactNode;
}

interface ErrorBoundaryState {
  readonly error: AppError | null;
}

function DefaultErrorFallback({ error, reset }: ErrorBoundaryFallbackRenderProps) {
  const intl = useContext(IntlContext);

  const title = intl
    ? intl.formatMessage({ id: 'errorBoundary.title' })
    : ptBRMessages['errorBoundary.title'];
  const description = intl
    ? intl.formatMessage({ id: 'errorBoundary.description' })
    : ptBRMessages['errorBoundary.description'];
  const localizedErrorMessage = intl
    ? intl.formatMessage({ id: getErrorMessageId(error.code) })
    : getFallbackErrorMessage(error.code);
  const codeLabel = intl
    ? intl.formatMessage({ id: 'errorBoundary.codeLabel' }, { code: error.code })
    : ptBRMessages['errorBoundary.codeLabel'].replace('{code}', error.code);
  const retryLabel = intl
    ? intl.formatMessage({ id: 'errorBoundary.retry' })
    : ptBRMessages['errorBoundary.retry'];
  const backHomeLabel = intl
    ? intl.formatMessage({ id: 'errorBoundary.backHome' })
    : ptBRMessages['errorBoundary.backHome'];

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card
        role="alert"
        aria-live="assertive"
        className="w-full max-w-lg border-destructive/50 bg-card"
      >
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15 text-destructive"
              aria-hidden="true"
            >
              <IconAlertTriangle className="h-5 w-5" />
            </span>
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium text-foreground">{localizedErrorMessage}</p>
          <p className="text-xs text-muted-foreground">{codeLabel}</p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button onClick={reset}>
            <IconRefresh className="h-4 w-4" aria-hidden="true" />
            {retryLabel}
          </Button>
          <Button variant="outline" asChild>
            <a href="/">
              <IconHome className="h-4 w-4" aria-hidden="true" />
              {backHomeLabel}
            </a>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: normalizeError(error),
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const normalized = normalizeError(error);
    this.props.logger?.error('Unhandled UI error captured by ErrorBoundary', {
      code: normalized.code,
      errorName: normalized.name,
      hasComponentStack: Boolean(errorInfo.componentStack),
    });
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      if (this.props.fallback) {
        return this.props.fallback({ error, reset: this.handleReset });
      }
      return <DefaultErrorFallback error={error} reset={this.handleReset} />;
    }

    return this.props.children;
  }
}
