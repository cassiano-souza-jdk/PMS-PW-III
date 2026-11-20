import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { ptBRMessages } from '@/shared/i18n';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import { appRoutes } from './routes';

describe('Auth, Demo Mode, Profile & Organizations Routing + Presentation + Accessibility (vitest-axe)', () => {
  let activeContainer: AppCompositionContainer | null = null;

  async function cleanupActiveContainer(): Promise<void> {
    if (activeContainer !== null) {
      if (activeContainer.db.isOpen()) {
        activeContainer.db.close();
      }
      await activeContainer.db.delete();
      activeContainer = null;
    }
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(async () => {
    await cleanupActiveContainer();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  async function renderIsolatedApp(initialPath: string) {
    const sink = createMemoryLogSink();
    const logger = createLogger({ minLevel: 'warn', sink });
    const container = createAppContainer({
      logger,
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_presentation_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
    activeContainer = container;

    const router = createMemoryRouter(appRoutes, {
      initialEntries: [initialPath],
    });

    const view = render(<App container={container} router={router} />);

    return {
      ...view,
      appContainer: container,
      router,
      sink,
    };
  }

  it('redireciona usuário não autenticado da rota protegida /organizations para /login', async () => {
    const { container, router } = await renderIsolatedApp('/organizations');

    const loginHeading = await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['auth.login.title'],
    });
    expect(loginHeading).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renderiza /login, /register e /demo de forma acessível com zero violações vitest-axe', async () => {
    const loginView = await renderIsolatedApp('/login');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.login.title'] }),
    ).toBeInTheDocument();
    expect(await axe(loginView.container)).toHaveNoViolations();
    loginView.unmount();
    await cleanupActiveContainer();

    const registerView = await renderIsolatedApp('/register');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.register.title'] }),
    ).toBeInTheDocument();
    expect(await axe(registerView.container)).toHaveNoViolations();
    registerView.unmount();
    await cleanupActiveContainer();

    const demoView = await renderIsolatedApp('/demo');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] }),
    ).toBeInTheDocument();
    expect(await axe(demoView.container)).toHaveNoViolations();
  });

  it(
    'entra no Modo Demo como ADMIN, exibe banner permanente MODO DEMONSTRATIVO, habilita seletor de organização e navega para /organizations, /profile e /settings com zero violações vitest-axe',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      const { container } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['auth.demo.title'],
      });

      const enterAdminButton = screen.getByRole('button', {
        name: 'Entrar como Administrador',
      });
      await user.click(enterAdminButton);

      // Após entrar no Modo Demo ADMIN, deve redirecionar para /organizations com banner permanente
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      const demoBanner = await screen.findByRole('region', {
        name: ptBRMessages['demoBanner.regionLabel'],
      });
      expect(within(demoBanner).getByText(ptBRMessages['demoBanner.badge'])).toBeInTheDocument();

      // Seletor de organização no cabeçalho habilitado com organização demo ativa
      const orgSwitcher = screen.getByLabelText<HTMLSelectElement>(
        ptBRMessages['orgSwitcher.label'],
      );
      await waitFor(() => {
        expect(orgSwitcher).not.toBeDisabled();
      });
      expect(orgSwitcher.options.length).toBeGreaterThanOrEqual(1);
      expect(orgSwitcher.selectedOptions[0]?.textContent).toContain('(Demo)');

      // Acessibilidade em /organizations
      expect(await axe(container)).toHaveNoViolations();

      // Navega para /profile
      const primaryNav = screen.getByRole('navigation', {
        name: ptBRMessages['nav.primaryLabel'],
      });
      await user.click(within(primaryNav).getByRole('link', { name: ptBRMessages['nav.profile'] }));

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['profile.title'],
      });
      expect(
        screen.getByRole('region', { name: ptBRMessages['demoBanner.regionLabel'] }),
      ).toBeInTheDocument();
      expect(await screen.findByText(ptBRMessages['profile.sessions.title'])).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Navega para /settings (visível e acessível para ADMIN)
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.settings'] }),
      );

      await screen.findByText(ptBRMessages['organizations.details.title']);
      await screen.findByText(ptBRMessages['organizations.members.title']);
      expect(
        screen.getByRole('region', { name: ptBRMessages['demoBanner.regionLabel'] }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
