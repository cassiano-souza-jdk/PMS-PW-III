import { render, screen, within } from '@testing-library/react';
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

describe('Invitations, Teams & Permissions Presentation + Routing + Accessibility (vitest-axe)', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_f05_presentation_${crypto.randomUUID()}`,
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
    };
  }

  it(
    'autenticado como ADMIN da Demo, navega e renderiza /invitations, /teams e /permissions com zero violações vitest-axe',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      const { container } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['auth.demo.title'],
      });

      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      const primaryNav = screen.getByRole('navigation', {
        name: ptBRMessages['nav.primaryLabel'],
      });

      // 1. /invitations
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.invitations'] }),
      );
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['invitations.title'],
      });
      await screen.findByText(ptBRMessages['invitations.manage.title'], { exact: false });
      expect(await axe(container)).toHaveNoViolations();

      // 2. /teams
      await user.click(within(primaryNav).getByRole('link', { name: ptBRMessages['nav.teams'] }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['teams.title'],
      });
      await screen.findByText('Equipe de Produto e Engenharia');
      expect(await axe(container)).toHaveNoViolations();

      // 3. /permissions
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.permissions'] }),
      );
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['permissions.title'],
      });
      await screen.findByText(ptBRMessages['permissions.grants.title']);
      await screen.findByText(ptBRMessages['permissions.denies.title']);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'autenticado como MEMBER da Demo, /permissions exibe orientação clara de quem pode conceder permissões adicionais sem quebrar e com zero violações vitest-axe',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      const { container } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['auth.demo.title'],
      });

      await user.click(screen.getByRole('button', { name: 'Entrar como Membro' }));

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      const primaryNav = screen.getByRole('navigation', {
        name: ptBRMessages['nav.primaryLabel'],
      });

      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.permissions'] }),
      );

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['permissions.title'],
      });

      // Orientação clara de quem pode conceder permissões adicionais (§6 regra 9)
      expect(
        screen.getByText(ptBRMessages['permissions.delegationGuide.title']),
      ).toBeInTheDocument();
      expect(
        screen.getByText(ptBRMessages['permissions.delegationGuide.description']),
      ).toBeInTheDocument();
      expect(screen.getByText(ptBRMessages['permissions.denies.adminOnly'])).toBeInTheDocument();

      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
