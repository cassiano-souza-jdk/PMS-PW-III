import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_COLUMN_IDS,
  DEMO_MANAGER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';
import { ptBRMessages } from '@/shared/i18n';
import { IMPEDIMENT_SEVERITIES, PRIORITIES } from '@/shared/kernel';
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
      const { container, appContainer, router } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });
      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      // Ocupa 100% do WIP de "Em Revisao" (2/2) para garantir detecção determinística de alerta WIP
      await appContainer.services.kanban.createQuickCard(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        { title: 'Revisão WIP 1', columnId: DEMO_COLUMN_IDS.REVIEW },
      );
      await appContainer.services.kanban.createQuickCard(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        { title: 'Revisão WIP 2', columnId: DEMO_COLUMN_IDS.REVIEW },
      );

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

      // Reordenar por teclado (Descer e Subir) com >= 2 tarefas não fixadas
      const moveDownButtons = screen.getAllByRole('button', {
        name: ptBRMessages['focus.actions.moveDown'],
      });
      const enabledMoveDown = moveDownButtons.find((btn) => !btn.hasAttribute('disabled'));
      expect(enabledMoveDown).toBeDefined();
      enabledMoveDown!.focus();
      await user.keyboard('{Enter}');
      await screen.findByText(ptBRMessages['focus.mode.MANUAL']);

      const moveUpButtons = screen.getAllByRole('button', {
        name: ptBRMessages['focus.actions.moveUp'],
      });
      const enabledMoveUp = moveUpButtons.find((btn) => !btn.hasAttribute('disabled'));
      expect(enabledMoveUp).toBeDefined();
      enabledMoveUp!.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => {
        expect(
          screen.getByRole('status', { name: ptBRMessages['focus.liveRegionLabel'] }),
        ).toHaveTextContent(/movida para a posição 1/);
      });

      // Fixar, desfixar, ocultar e restaurar no Modo Foco
      const pinButtons = screen.getAllByRole('button', { name: ptBRMessages['focus.actions.pin'] });
      expect(pinButtons.length).toBeGreaterThan(0);
      await user.click(pinButtons[0]!);
      await screen.findByText(ptBRMessages['focus.actions.pinnedBadge']);
      await user.click(screen.getByRole('button', { name: ptBRMessages['focus.actions.unpin'] }));
      await waitFor(() => {
        expect(
          screen.queryByText(ptBRMessages['focus.actions.pinnedBadge']),
        ).not.toBeInTheDocument();
      });

      const hideButtons = screen.getAllByRole('button', {
        name: ptBRMessages['focus.actions.hide'],
      });
      await user.click(hideButtons[0]!);
      await screen.findByText('Tarefas ocultas (1)');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['focus.actions.restoreHidden'] }),
      );
      await screen.findByText('Tarefas ocultas (0)');

      // Resetar preferências via ModalDialog (auditado aberto com vitest-axe)
      await user.click(screen.getByRole('button', { name: ptBRMessages['focus.resetAction'] }));
      const resetDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
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

      const acknowledgeButtons = screen.getAllByRole('button', {
        name: ptBRMessages['bottlenecks.actions.acknowledge'],
      });
      expect(acknowledgeButtons.length).toBeGreaterThan(0);
      await user.click(acknowledgeButtons[0]!);
      const ackDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
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
      expect(await axe(container)).toHaveNoViolations();
      await user.click(
        within(resolveDialog).getByRole('button', {
          name: ptBRMessages['bottlenecks.actions.confirmResolve'],
        }),
      );
      expect(
        await screen.findAllByText(ptBRMessages['bottlenecks.actions.resolveSuccess']),
      ).not.toHaveLength(0);

      // Validação de limiares invertidos (warning > critical) -> invalidRangeError + axe
      const overdueWarnInput = screen.getByRole<HTMLInputElement>('spinbutton', {
        name: ptBRMessages['bottlenecks.rules.overdueWarningCountLabel'],
      });
      await user.clear(overdueWarnInput);
      await user.type(overdueWarnInput, '10');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['bottlenecks.rules.saveAction'] }),
      );
      expect(
        await screen.findByText(ptBRMessages['bottlenecks.rules.invalidRangeError']),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Corrige warning e atualiza regras válidas de gargalo
      await user.clear(overdueWarnInput);
      await user.type(overdueWarnInput, '1');
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
    'exibe seção de bloqueadas no Modo Foco (OPEN_IMPEDIMENT, PENDING_DEPENDENCY e PAUSED), restaurar todas ocultas e respeita Default Deny vs liberação ADMIN para MANAGER + modo read-only em projeto arquivado',
    { timeout: 35_000 },
    async () => {
      const user = userEvent.setup();
      const { container, appContainer, router } = await renderIsolatedApp('/demo');

      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });
      await user.click(screen.getByRole('button', { name: 'Entrar como Gestor' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });

      // Cria tarefas bloqueadas (impedimento, dependência e pausa) e ocultáveis
      const pausedTask = await appContainer.services.tasks.createTask(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        {
          title: 'Tarefa Pausada UI Foco',
          priority: PRIORITIES.HIGH,
          assigneeId: DEMO_MANAGER_USER_ID,
        },
      );
      await appContainer.services.tasks.startTask(DEMO_MANAGER_USER_ID, DEMO_ORG_ID, pausedTask.id);
      await appContainer.services.tasks.pauseTask(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        pausedTask.id,
        { reason: 'Pausa aguardando retorno' },
      );

      const impededTask = await appContainer.services.tasks.createTask(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        {
          title: 'Tarefa Impedida UI Foco',
          priority: PRIORITIES.HIGH,
          assigneeId: DEMO_MANAGER_USER_ID,
        },
      );
      await appContainer.services.impediments.createImpediment(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        impededTask.id,
        {
          category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
          severity: IMPEDIMENT_SEVERITIES.HIGH,
          description: 'Build quebrado na pipeline',
        },
      );

      const prereqTask = await appContainer.services.tasks.createTask(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        { title: 'Tarefa Predecessora UI Foco', assigneeId: DEMO_MANAGER_USER_ID },
      );
      const dependentTask = await appContainer.services.tasks.createTask(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        { title: 'Tarefa Dependente UI Foco', assigneeId: DEMO_MANAGER_USER_ID },
      );
      await appContainer.services.dependencies.addDependency(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        dependentTask.id,
        { dependsOnTaskId: prereqTask.id, required: true },
      );

      // Verifica seção de bloqueadas e restaurar todas as ocultas em /focus
      await router.navigate('/focus');
      await screen.findByText('Tarefas bloqueadas ou pausadas (3)');
      expect(screen.getByText(ptBRMessages['focus.blocked.reasonCode.PAUSED'])).toBeInTheDocument();
      expect(
        screen.getByText(ptBRMessages['focus.blocked.reasonCode.OPEN_IMPEDIMENT']),
      ).toBeInTheDocument();
      expect(
        screen.getByText(ptBRMessages['focus.blocked.reasonCode.PENDING_DEPENDENCY']),
      ).toBeInTheDocument();
      expect(screen.getAllByText(/Condição de desbloqueio:/).length).toBeGreaterThanOrEqual(3);

      const hideButtons = screen.getAllByRole('button', {
        name: ptBRMessages['focus.actions.hide'],
      });
      await user.click(hideButtons[0]!);
      await screen.findByText('Tarefas ocultas (1)');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['focus.actions.restoreAllHidden'] }),
      );
      await screen.findByText('Tarefas ocultas (0)');
      expect(await axe(container)).toHaveNoViolations();

      // MANAGER sob Default Deny: /projects/:id/bottlenecks anonimizado e /settings sem toggle
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

      await router.navigate('/settings');
      await screen.findByText(ptBRMessages['settings.productivityVisibility.adminOnlyNotice']);
      expect(
        screen.queryByRole('checkbox', {
          name: ptBRMessages['settings.productivityVisibility.toggleLabel'],
        }),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // ADMIN habilita visibilidade individual -> MANAGER passa a ver carga individual dos membros
      await appContainer.services.bottlenecks.updateIndividualProductivityVisibility(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        { allowManagerViewIndividualProductivity: true },
      );
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/bottlenecks`);
      await screen.findByRole('heading', {
        level: 2,
        name: ptBRMessages['bottlenecks.members.title'],
      });
      expect(
        screen.queryByText(ptBRMessages['bottlenecks.privacy.anonymizedNotice']),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Projeto arquivado -> modo somente leitura em /projects/:id/bottlenecks
      await appContainer.services.projects.archiveProject(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      await router.navigate('/bottlenecks');
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['bottlenecks.org.title'],
      });
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/bottlenecks`);
      expect(
        await screen.findAllByText(ptBRMessages['bottlenecks.archivedLockBanner']),
      ).not.toHaveLength(0);
      expect(
        screen.queryByRole('button', { name: ptBRMessages['bottlenecks.actions.evaluateNow'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: ptBRMessages['bottlenecks.rules.saveAction'] }),
      ).toBeDisabled();
      expect(
        screen.getByRole('spinbutton', {
          name: ptBRMessages['bottlenecks.rules.wipUtilizationPercentLabel'],
        }),
      ).toBeDisabled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
