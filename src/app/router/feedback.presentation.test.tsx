import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import {
  DEMO_FEEDBACK_IDS,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { ptBRMessages } from '@/shared/i18n';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import { appRoutes } from './routes';

describe('Feedbacks, SLA, Contestation & Governance Presentation + Routing + ABAC + Accessibility (vitest-axe)', () => {
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
    vi.restoreAllMocks();
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
        databaseName: `${PMS_DATABASE_NAME}_f09_presentation_${crypto.randomUUID()}`,
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

  it('redireciona usuário não autenticado das rotas /feedback* para /login e trata UUID inválido em /feedback/:feedbackId', async () => {
    for (const protectedPath of [
      '/feedback',
      `/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`,
      '/feedback/governance',
    ]) {
      const view = await renderIsolatedApp(protectedPath);
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: ptBRMessages['auth.login.title'] },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(view.router.state.location.pathname).toBe('/login');
      view.unmount();
      await cleanupActiveContainer();
    }

    const user = userEvent.setup();
    const { container, router } = await renderIsolatedApp('/demo');
    await screen.findByRole(
      'heading',
      { level: 1, name: ptBRMessages['auth.demo.title'] },
      { timeout: 5000 },
    );
    await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
    await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['organizations.title'],
    });

    await router.navigate('/feedback/not-a-uuid');
    const invalidHeading = await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['feedbacks.detail.invalidIdError'],
    });
    expect(invalidHeading).toHaveAttribute('tabindex', '-1');
    expect(document.title).toContain(ptBRMessages['feedbacks.detail.invalidIdError']);
    expect(await axe(container)).toHaveNoViolations();
  });

  it(
    'como ADMIN da Demo, opera /feedback (criação em modal, avaliação SLA e exportação), /feedback/:feedbackId (detalhe e notas internas) e /feedback/governance (catálogos e SLA) sem MISSING_TRANSLATION e com 0 violações vitest-axe',
    { timeout: 30_000 },
    async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const user = userEvent.setup();
      const { container, router } = await renderIsolatedApp('/demo');

      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.demo.title'] },
        { timeout: 5000 },
      );
      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      const primaryNav = screen.getByRole('navigation', {
        name: ptBRMessages['nav.primaryLabel'],
      });
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.feedback'] }),
      );

      const queueHeading = await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['feedbacks.queue.title'],
        },
        { timeout: 5000 },
      );
      expect(queueHeading).toHaveAttribute('tabindex', '-1');
      await waitFor(() => {
        expect(document.title).toBe(ptBRMessages['feedbacks.queue.pageTitle']);
      });
      expect(await axe(container)).toHaveNoViolations();

      // Criação de novo feedback via ModalDialog acessível
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.create.openAction'] }),
      );
      const dialog = await screen.findByRole('dialog');
      await user.type(
        within(dialog).getByLabelText(ptBRMessages['feedbacks.create.titleLabel']),
        'Melhorar contraste de alertas na fila',
      );
      await user.type(
        within(dialog).getByLabelText(ptBRMessages['feedbacks.create.descriptionLabel']),
        'Garantir leitura clara dos badges preventivos em tema claro e escuro.',
      );
      await user.click(
        within(dialog).getByRole('button', { name: ptBRMessages['feedbacks.create.submitAction'] }),
      );

      expect(await screen.findByText('Melhorar contraste de alertas na fila')).toBeInTheDocument();

      // Avaliação explícita de SLAs (DN-05)
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.slaEvaluation.action'] }),
      );
      const evalResults = await screen.findAllByText(/Avaliação concluída:/i);
      expect(evalResults.length).toBeGreaterThanOrEqual(1);

      // Navegação para detalhe de feedback seedado com nota interna
      await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`);
      const detailHeading = await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Ajustar indicacao visual de limite WIP no quadro Kanban/,
        },
        { timeout: 5000 },
      );
      expect(detailHeading).toHaveAttribute('tabindex', '-1');
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: ptBRMessages['feedbacks.internalNotes.title'],
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Nota interna de triagem: alinhar tokens WCAG AA com o time de apresentacao.',
        ),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Navegação para governança ADMIN-only
      await router.navigate('/feedback/governance');
      const governanceHeading = await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['feedbacks.governance.title'],
        },
        { timeout: 5000 },
      );
      expect(governanceHeading).toHaveAttribute('tabindex', '-1');
      await waitFor(() => {
        expect(document.title).toBe(ptBRMessages['feedbacks.governance.pageTitle']);
      });
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: ptBRMessages['feedbacks.governance.catalog.categoriesTitle'],
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: ptBRMessages['feedbacks.governance.sla.title'],
        }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      const loggedErrorsAndWarnings = [
        ...errorSpy.mock.calls.flat().map(String),
        ...warnSpy.mock.calls.flat().map(String),
      ].join('\n');
      expect(loggedErrorsAndWarnings).not.toContain('MISSING_TRANSLATION');
      expect(container.textContent).not.toContain('feedbacks.');
    },
  );

  it(
    'como MEMBER da Demo, segrega notas internas em /feedback/:feedbackId e bloqueia /feedback/governance com 0 violações vitest-axe',
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      const { container, router } = await renderIsolatedApp('/demo');

      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.demo.title'] },
        { timeout: 5000 },
      );
      await user.click(screen.getByRole('button', { name: 'Entrar como Membro' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      await router.navigate('/feedback');
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['feedbacks.queue.title'],
      });
      expect(
        screen.queryByRole('link', { name: ptBRMessages['feedbacks.nav.governanceShortcut'] }),
      ).not.toBeInTheDocument();

      // Detalhe como MEMBER (autor do feedback): notas internas estritamente segregadas (DN-04)
      await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`);
      await screen.findByRole('heading', {
        level: 1,
        name: /Ajustar indicacao visual de limite WIP no quadro Kanban/,
      });
      expect(
        screen.queryByRole('heading', { name: ptBRMessages['feedbacks.internalNotes.title'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'Nota interna de triagem: alinhar tokens WCAG AA com o time de apresentacao.',
        ),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Governança bloqueada para MEMBER
      await router.navigate('/feedback/governance');
      const unauthorizedHeading = await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['feedback.unauthorizedTitle'],
      });
      expect(unauthorizedHeading).toHaveAttribute('tabindex', '-1');
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
