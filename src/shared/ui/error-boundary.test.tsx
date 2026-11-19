import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { APP_ERROR_CODES, AuthorizationError } from '@/shared/errors';
import { ptBRMessages } from '@/shared/i18n';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { ErrorBoundary } from './error-boundary';

interface ThrowingChildProps {
  readonly shouldThrow: boolean;
  readonly errorToThrow: Error;
}

function ThrowingChild({ shouldThrow, errorToThrow }: ThrowingChildProps) {
  if (shouldThrow) {
    throw errorToThrow;
  }

  return <div>Conteúdo saudável renderizado</div>;
}

describe('ErrorBoundary', () => {
  it('captures AppError, renders localized pt-BR alert fallback without leaking secrets, logs structured error and passes axe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = createMemoryLogSink();
    const logger = createLogger({ minLevel: 'debug', sink });

    const authzError = new AuthorizationError('SECRET_STACK_DETAIL_DO_NOT_EXPOSE', {
      details: { secretToken: 'tok-999' },
    });

    const { container } = render(
      <IntlProvider locale="pt-BR" messages={ptBRMessages}>
        <ErrorBoundary logger={logger}>
          <ThrowingChild shouldThrow errorToThrow={authzError} />
        </ErrorBoundary>
      </IntlProvider>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText(ptBRMessages['errorBoundary.title'])).toBeInTheDocument();
    expect(screen.getByText(ptBRMessages['errors.AUTHORIZATION_ERROR'])).toBeInTheDocument();
    expect(
      screen.getByText(`Código de referência: ${APP_ERROR_CODES.AUTHORIZATION_ERROR}`),
    ).toBeInTheDocument();

    expect(container.textContent).not.toContain('SECRET_STACK_DETAIL_DO_NOT_EXPOSE');
    expect(container.textContent).not.toContain('tok-999');

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      level: 'error',
      message: 'Unhandled UI error captured by ErrorBoundary',
      context: {
        code: APP_ERROR_CODES.AUTHORIZATION_ERROR,
        errorName: 'AuthorizationError',
        hasComponentStack: true,
      },
    });
    expect(JSON.stringify(sink.entries[0])).not.toContain('SECRET_STACK_DETAIL_DO_NOT_EXPOSE');
    expect(JSON.stringify(sink.entries[0])).not.toContain('tok-999');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('captures generic Error, normalizes to UNEXPECTED_ERROR without leaking message/stack and passes axe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = createMemoryLogSink();
    const logger = createLogger({ minLevel: 'debug', sink });

    const genericError = new Error('Sensitive internal failure password=super-secret');

    const { container } = render(
      <IntlProvider locale="pt-BR" messages={ptBRMessages}>
        <ErrorBoundary logger={logger}>
          <ThrowingChild shouldThrow errorToThrow={genericError} />
        </ErrorBoundary>
      </IntlProvider>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(ptBRMessages['errors.UNEXPECTED_ERROR'])).toBeInTheDocument();
    expect(
      screen.getByText(`Código de referência: ${APP_ERROR_CODES.UNEXPECTED_ERROR}`),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain('super-secret');
    expect(container.textContent).not.toContain('Sensitive internal failure');

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      level: 'error',
      context: {
        code: APP_ERROR_CODES.UNEXPECTED_ERROR,
        errorName: 'AppError',
        hasComponentStack: true,
      },
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it('allows recovery via retry button and triggers onReset callback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const onReset = vi.fn();

    let shouldThrow = true;
    function RecoverableChild() {
      if (shouldThrow) {
        throw new Error('Transient render error');
      }
      return <div>Recuperado com sucesso</div>;
    }

    render(
      <IntlProvider locale="pt-BR" messages={ptBRMessages}>
        <ErrorBoundary onReset={onReset}>
          <RecoverableChild />
        </ErrorBoundary>
      </IntlProvider>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: ptBRMessages['errorBoundary.retry'] }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Recuperado com sucesso')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
