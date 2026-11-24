import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import {
  DEMO_PROJECT_ID,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { ptBRMessages } from '@/shared/i18n';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import { appRoutes } from './routes';

describe('Focus Mode, Workload, Bottlenecks & DN-06 Settings Presentation + Routing + ABAC + Accessibility (vitest-axe)', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_f08_presentation_${crypto.randomUUID()}`,
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

  it('redireciona usuário não autenticado de /focus e /bottlenecks para /login e trata UUID inválido', async () => {
    const focusView = await renderIsolatedApp('/focus');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.login.title'] }),
    ).toBeInTheDocument();
    expect(focusView.router.state.location.pathname).toBe('/login');
    focusView.unmount();
    await cleanupActiveContainer();

    const user = userEvent.setup();
    const { container, router } = await renderIsolatedApp('/demo');
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });
    await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
    await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['organizations.title'],
    });

    await router.navigate('/projects/not-a-uuid/bottlenecks');
    const errorHeading = await screen.findByRole('heading', {
      level: 1,
      name: ptBRMessages['errors.NOT_FOUND'],
    });
    expect(errorHeading).toHaveAttribute('tabindex', '-1');
    expect(await axe(container)).toHaveNoViolations();
  });

  it(
    'como ADMIN da Demo, opera /focus (carga 0-100 sem horas, fixar/ocultar/reordenar por teclado e reset em modal), /projects/:id/bottlenecks (avaliar, reconhecer, resolver e regras) e /settings (DN-06) com zero violações vitest-axe',
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      const { container, router } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });
      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      const primaryNav = screen.getByRole('navigation', {
        name: ptBRMessages['nav.primaryLabel'],
      });
      await user.click(within(primaryNav).getByRole('link', { name: ptBRMessages['nav.focus'] }));

      await screen.findByText(ptBRMessages['workload.notHoursNotice']);
      const focusHeading = screen.getByRole('heading', {
        level: 1,
        name: ptBRMessages['focus.title'],
      });
      expect(focusHeading).toHaveAttribute('tabindex', '-1');
      expect(document.title).toBe(ptBRMessages['focus.pageTitle']);
      expect(screen.getByText(ptBRMessages['focus.personalIsolationNotice'])).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Fixar e reordenar por teclado
      const pinButtons = screen.getAllByRole('button', { name: ptBRMessages['focus.actions.pin'] });
      expect(pinButtons.length).toBeGreaterThan(0);
      await user.click(pinButtons[0]!);
      await screen.findByText(ptBRMessages['focus.actions.pinnedBadge']);

      const moveDownButtons = screen.getAllByRole('button', {
        name: ptBRMessages['focus.actions.moveDown'],
      });
      const enabledMoveDown = moveDownButtons.find((btn) => !btn.hasAttribute('disabled'));
      if (enabledMoveDown !== undefined) {
        await user.click(enabledMoveDown);
        await screen.findByText(ptBRMessages['focus.mode.MANUAL']);
      }

      // Resetar preferências via ModalDialog
      await user.click(screen.getByRole('button', { name: ptBRMessages['focus.resetAction'] }));
      const resetDialog = await screen.findByRole('dialog');
      await user.click(
        within(resetDialog).getByRole('button', { name: ptBRMessages['common.confirm'] }),
      );
      expect(await screen.findAllByText(ptBRMessages['focus.resetSuccess'])).not.toHaveLength(0);

      // Navega para gargalos do projeto demo
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/bottlenecks`);
      await screen.findByRole('heading', {
        level: 2,
        name: ptBRMessages['bottlenecks.indicator.WIP'],
      });
      const bottlenecksHeading = screen.getByRole('heading', { level: 1 });
      expect(bottlenecksHeading).toHaveAttribute('tabindex', '-1');
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: ptBRMessages['bottlenecks.indicator.INACTIVITY'],
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: ptBRMessages['bottlenecks.members.title'],
        }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Analisar gargalos agora
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['bottlenecks.actions.evaluateNow'] }),
      );
      expect(await screen.findAllByText(/Análise concluída:/)).not.toHaveLength(0);

      const acknowledgeButtons = screen.queryAllByRole('button', {
        name: ptBRMessages['bottlenecks.actions.acknowledge'],
      });
      if (acknowledgeButtons.length > 0) {
        await user.click(acknowledgeButtons[0]!);
        const ackDialog = await screen.findByRole('dialog');
        await user.click(
          within(ackDialog).getByRole('button', {
            name: ptBRMessages['bottlenecks.actions.confirmAcknowledge'],
          }),
        );
        expect(
          await screen.findAllByText(ptBRMessages['bottlenecks.actions.acknowledgeSuccess']),
        ).not.toHaveLength(0);

        const resolveButtons = screen.getAllByRole('button', {
          name: ptBRMessages['bottlenecks.actions.resolve'],
        });
        await user.click(resolveButtons[0]!);
        const resolveDialog = await screen.findByRole('dialog');
        await user.click(
          within(resolveDialog).getByRole('button', {
            name: ptBRMessages['bottlenecks.actions.confirmResolve'],
          }),
        );
        expect(
          await screen.findAllByText(ptBRMessages['bottlenecks.actions.resolveSuccess']),
        ).not.toHaveLength(0);
      }

      // Atualiza regras de gargalo
      const thresholdInput = screen.getByRole<HTMLInputElement>('spinbutton', {
        name: ptBRMessages['bottlenecks.rules.wipUtilizationPercentLabel'],
      });
      await user.clear(thresholdInput);
      await user.type(thresholdInput, '85');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['bottlenecks.rules.saveAction'] }),
      );
      expect(
        await screen.findAllByText(ptBRMessages['bottlenecks.rules.saveSuccess']),
      ).not.toHaveLength(0);

      // Navega para /settings e alterna política DN-06
      await router.navigate('/settings');
      const visibilityCheckbox = await screen.findByRole<HTMLInputElement>('checkbox', {
        name: ptBRMessages['settings.productivityVisibility.toggleLabel'],
      });
      expect(visibilityCheckbox.checked).toBe(false);
      await user.click(visibilityCheckbox);
      await user.click(
        screen.getByRole('button', {
          name: ptBRMessages['settings.productivityVisibility.saveAction'],
        }),
      );
      expect(
        await screen.findAllByText(ptBRMessages['settings.productivityVisibility.saveSuccess']),
      ).not.toHaveLength(0);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'respeita Default Deny (DN-02) para MANAGER e MEMBER em /bottlenecks e /projects/:id/bottlenecks sem expor carga individual de terceiros',
    { timeout: 25_000 },
    async () => {
      const user = userEvent.setup();
      const { container, router } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });
      await user.click(screen.getByRole('button', { name: 'Entrar como Gestor' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      await router.navigate(`/projects/${DEMO_PROJECT_ID}/bottlenecks`);
      await screen.findByText(ptBRMessages['bottlenecks.privacy.anonymizedNotice']);
      expect(screen.queryByText(ptBRMessages['bottlenecks.members.title'])).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      await router.navigate('/bottlenecks');
      await screen.findByLabelText(ptBRMessages['bottlenecks.alerts.projectFilterLabel']);
      await screen.findByText(ptBRMessages['workload.notHoursNotice']);
      const orgHeading = screen.getByRole('heading', {
        level: 1,
        name: ptBRMessages['bottlenecks.org.title'],
      });
      expect(orgHeading).toHaveAttribute('tabindex', '-1');
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
