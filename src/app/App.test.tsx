import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { createAppContainer } from '@/app/composition';
import { appRoutes } from '@/app/router/routes';
import { ptBRMessages } from '@/shared/i18n';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { App } from './App';

function renderAppAt(initialPath: string) {
  const sink = createMemoryLogSink();
  const logger = createLogger({ minLevel: 'debug', sink });
  const container = createAppContainer({ logger });
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialPath],
  });

  const view = render(<App container={container} router={router} />);

  return {
    ...view,
    sink,
    router,
  };
}

describe('App foundation shell, routing, theme and accessibility', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
  });

  it('renders foundation home route with landmarks, skip-link, pt-BR copy, theme switcher and zero axe violations', async () => {
    const user = userEvent.setup();
    const { container, sink } = renderAppAt('/');

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['foundation.title'],
    });
    expect(heading).toBeInTheDocument();

    const skipLink = screen.getByRole('link', { name: ptBRMessages['app.skipToMain'] });
    expect(skipLink).toHaveAttribute('href', '#main-content');

    expect(screen.getByRole('banner')).toBeInTheDocument();
    const primaryNav = screen.getByRole('navigation', { name: ptBRMessages['nav.primaryLabel'] });
    expect(primaryNav).toBeInTheDocument();
    expect(
      within(primaryNav).queryByRole('link', { name: ptBRMessages['nav.feedback'] }),
    ).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(ptBRMessages['footer.prototypeNotice'])).toBeInTheDocument();

    const themeGroup = screen.getByRole('group', { name: ptBRMessages['theme.switcherLabel'] });
    const lightButton = within(themeGroup).getByRole('button', {
      name: ptBRMessages['theme.light'],
    });
    const darkButton = within(themeGroup).getByRole('button', {
      name: ptBRMessages['theme.dark'],
    });
    const systemButton = within(themeGroup).getByRole('button', {
      name: ptBRMessages['theme.system'],
    });

    expect(systemButton).toHaveAttribute('aria-pressed', 'true');
    expect(lightButton).toHaveAttribute('aria-pressed', 'false');
    expect(darkButton).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(darkButton);
    expect(darkButton).toHaveAttribute('aria-pressed', 'true');
    expect(lightButton).toHaveAttribute('aria-pressed', 'false');
    expect(systemButton).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(lightButton);
    expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    expect(darkButton).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(systemButton);
    expect(systemButton).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');

    expect(sink.entries).toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders accessible 404 page on unknown route and navigates back to home', async () => {
    const user = userEvent.setup();
    const { container } = renderAppAt('/rota-inexistente');

    const notFoundHeading = await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['notFound.title'],
    });
    expect(notFoundHeading).toBeInTheDocument();
    expect(screen.getByText(ptBRMessages['notFound.code'])).toBeInTheDocument();
    expect(screen.getByText(ptBRMessages['notFound.description'])).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();

    const backHomeLink = screen.getByRole('link', { name: ptBRMessages['notFound.backHome'] });
    await user.click(backHomeLink);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['foundation.title'],
      }),
    ).toBeInTheDocument();
  });
});
