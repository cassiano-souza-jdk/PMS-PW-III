import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_COLUMN_IDS,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  DEMO_TASK_IDS,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { ptBRMessages } from '@/shared/i18n';
import { asEntityId } from '@/shared/kernel';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import { appRoutes } from './routes';

describe('Projects, Participants & Kanban Presentation + Routing + Accessibility (vitest-axe)', () => {
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

  async function createIsolatedContainer(): Promise<AppCompositionContainer> {
    const sink = createMemoryLogSink();
    const logger = createLogger({ minLevel: 'warn', sink });
    const container = createAppContainer({
      logger,
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_f06_presentation_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
    activeContainer = container;
    return container;
  }

  async function renderIsolatedApp(
    initialPath: string,
    existingContainer?: AppCompositionContainer,
  ) {
    const container = existingContainer ?? (await createIsolatedContainer());

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
    'autenticado como ADMIN da Demo, navega para /projects, valida formulário, trata remoção bloqueada por tarefas pendentes, exporta JSON e opera o quadro Kanban com WIP override e zero violações vitest-axe',
    { timeout: 30_000 },
    async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');
      const originalCreateObjectUrl = URL.createObjectURL;
      const originalRevokeObjectUrl = URL.revokeObjectURL;
      const createObjectUrlMock = vi.fn(() => 'blob:pms-export-test');
      const revokeObjectUrlMock = vi.fn();
      URL.createObjectURL = createObjectUrlMock;
      URL.revokeObjectURL = revokeObjectUrlMock;
      const anchorClickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      try {
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
        expect(
          within(primaryNav).getByRole('link', { name: ptBRMessages['nav.focus'] }),
        ).toHaveAttribute('href', '/focus');
        expect(
          within(primaryNav).getByRole('link', { name: ptBRMessages['nav.bottlenecks'] }),
        ).toHaveAttribute('href', '/bottlenecks');

        // 1. Navega para /projects
        await user.click(
          within(primaryNav).getByRole('link', { name: ptBRMessages['nav.projects'] }),
        );
        await screen.findByRole('heading', {
          level: 1,
          name: ptBRMessages['projects.title'],
        });
        await screen.findByText('Lancamento Plataforma PMS v1');
        expect(await axe(container)).toHaveNoViolations();

        // 2. Validação inline em criação de projeto (nome curto)
        const createNameInput = screen.getByPlaceholderText(
          ptBRMessages['projects.create.namePlaceholder'],
        );
        await user.type(createNameInput, 'A');
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['projects.create.submit'] }),
        );
        expect(await screen.findByText(ptBRMessages['validation.displayNameMin'])).toHaveAttribute(
          'role',
          'alert',
        );
        expect(createNameInput).toHaveAttribute('aria-invalid', 'true');

        // 3. Tenta remover participante com tarefas pendentes e verifica erro específico
        const removeButtons = await screen.findAllByRole('button', {
          name: ptBRMessages['projects.members.removeAction'],
        });
        await user.click(removeButtons[0]!);
        const confirmRemoveButtons = screen.getAllByRole('button', {
          name: ptBRMessages['projects.members.removeAction'],
        });
        await user.click(confirmRemoveButtons[confirmRemoveButtons.length - 1]!);

        expect(
          await screen.findByText(ptBRMessages['projects.members.removePendingTasksError']),
        ).toBeInTheDocument();

        // 4. Exporta JSON local seguro
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['projects.exportAction'] }),
        );
        await waitFor(() => {
          expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
          expect(anchorClickSpy).toHaveBeenCalledTimes(1);
          expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:pms-export-test');
        });
        expect(
          await screen.findByText(
            'Dados do projeto "Lancamento Plataforma PMS v1" exportados com sucesso.',
          ),
        ).toBeInTheDocument();

        // 5. Abre quadro Kanban do projeto demo
        const openBoardButtons = screen.getAllByRole('button', {
          name: ptBRMessages['projects.openBoardAction'],
        });
        await user.click(openBoardButtons[0]!);

        await screen.findByRole('heading', {
          level: 1,
          name: 'Quadro Kanban — Lancamento Plataforma PMS v1',
        });
        expect(await axe(container)).toHaveNoViolations();

        // 6. Cria coluna operacional com WIP = 1
        await user.type(
          screen.getByLabelText(ptBRMessages['kanban.column.nameLabel'], { exact: false }),
          'Homologação',
        );
        await user.type(
          screen.getByLabelText(ptBRMessages['kanban.column.wipLimitLabel'], { exact: false }),
          '1',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['kanban.column.createAction'] }),
        );

        await screen.findByRole('heading', { level: 2, name: 'Homologação' });
        expect(await axe(container)).toHaveNoViolations();

        // 7. Cria cartão rápido e move 2 cartões para "Homologação" testando Exceção WIP inline
        await user.type(
          screen.getByLabelText(ptBRMessages['kanban.quickCard.titleLabel'], { exact: false }),
          'Cartão Rápido Teste',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['kanban.quickCard.submit'] }),
        );
        await screen.findByRole('heading', { level: 3, name: 'Cartão Rápido Teste' });

        // Move o 1º cartão para Homologação via select acessível (ocupa WIP 1/1)
        const cardArticle = screen
          .getByRole('heading', { level: 3, name: 'Cartão Rápido Teste' })
          .closest('article')!;
        const cardSelect = within(cardArticle).getByLabelText(
          ptBRMessages['kanban.card.moveToColumnLabel'],
        );
        const homologacaoOption = Array.from((cardSelect as HTMLSelectElement).options).find(
          (opt) => opt.textContent === 'Homologação',
        );
        expect(homologacaoOption).toBeDefined();
        await user.selectOptions(cardSelect, homologacaoOption!.value);

        const homologacaoSection = screen
          .getByRole('heading', { level: 2, name: 'Homologação' })
          .closest('section')!;
        await within(homologacaoSection).findByText('WIP: 1/1');

        const liveRegion = screen.getByRole('status', {
          name: ptBRMessages['kanban.liveRegionLabel'],
        });
        expect(liveRegion).toHaveTextContent(
          'Cartão "Cartão Rápido Teste" movido para a coluna "Homologação".',
        );

        // Move 2º cartão para Homologação via select acessível -> abre diálogo WIP Override
        const existingCardArticle = screen
          .getByRole('heading', {
            level: 3,
            name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
          })
          .closest('article')!;
        const existingCardSelect = within(existingCardArticle).getByLabelText(
          ptBRMessages['kanban.card.moveToColumnLabel'],
        );
        await user.selectOptions(existingCardSelect, homologacaoOption!.value);

        await screen.findByRole('heading', {
          name: ptBRMessages['kanban.wipOverride.title'],
        });
        expect(await axe(container)).toHaveNoViolations();

        await user.type(
          screen.getByLabelText(ptBRMessages['kanban.wipOverride.justificationLabel'], {
            exact: false,
          }),
          'Liberação emergencial para homologação simultânea',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['kanban.wipOverride.confirmAction'] }),
        );

        await screen.findByText(ptBRMessages['kanban.wipExceededBadge']);
        expect(liveRegion).toHaveTextContent(
          'Cartão "Validar persistencia local Dexie e isolamento multi-organizacao" movido para a coluna "Homologação".',
        );
        expect(await axe(container)).toHaveNoViolations();

        // 8. Reordena coluna via botão acessível e verifica anúncio na região viva
        const homologacaoBeforeReorder = screen
          .getByRole('heading', { level: 2, name: 'Homologação' })
          .closest('section')!;
        await user.click(
          within(homologacaoBeforeReorder).getByRole('button', {
            name: ptBRMessages['kanban.column.moveLeftAction'],
          }),
        );
        await waitFor(() => {
          expect(liveRegion).toHaveTextContent('Coluna "Homologação" movida para a posição 4.');
        });
        expect(
          screen
            .getAllByRole('heading', { level: 2 })
            .slice(0, 5)
            .map((heading) => heading.textContent),
        ).toEqual(['A Fazer', 'Em Execucao', 'Em Revisao', 'Homologação', 'Concluido']);

        // 9. Exclusão inline de coluna com migração obrigatória de cartões
        const homologacaoForDelete = screen
          .getByRole('heading', { level: 2, name: 'Homologação' })
          .closest('section')!;
        await user.click(
          within(homologacaoForDelete).getByRole('button', {
            name: ptBRMessages['kanban.column.deleteAction'],
          }),
        );
        const migrationSelect = within(homologacaoForDelete).getByLabelText(
          ptBRMessages['kanban.column.deleteTargetLabel'],
          { exact: false },
        );
        const todoOption = Array.from((migrationSelect as HTMLSelectElement).options).find(
          (opt) => opt.textContent === 'A Fazer',
        );
        expect(todoOption).toBeDefined();
        await user.selectOptions(migrationSelect, todoOption!.value);
        expect(await axe(container)).toHaveNoViolations();

        await user.click(
          within(homologacaoForDelete).getByRole('button', {
            name: ptBRMessages['kanban.column.deleteConfirmAction'],
          }),
        );
        expect(
          await screen.findByText('Coluna "Homologação" excluída com sucesso.'),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole('heading', { level: 2, name: 'Homologação' }),
        ).not.toBeInTheDocument();

        const todoSection = screen
          .getByRole('heading', { level: 2, name: 'A Fazer' })
          .closest('section')!;
        expect(
          within(todoSection).getByRole('heading', { level: 3, name: 'Cartão Rápido Teste' }),
        ).toBeInTheDocument();
        expect(
          within(todoSection).getByRole('heading', {
            level: 3,
            name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
          }),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        const domNestingWarnings = consoleErrorSpy.mock.calls.filter((args) =>
          args.some((arg) => typeof arg === 'string' && arg.includes('validateDOMNesting')),
        );
        expect(domNestingWarnings).toHaveLength(0);
      } finally {
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
      }
    },
  );

  it(
    'como MEMBER sem permissão WIP override exibe kanban.wipOverride.noPermissionError e respeita bloqueio de projeto arquivado',
    { timeout: 25_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      // Configura WIP = 1 na coluna "Em Revisao" e coloca 1 cartão nela
      await appContainer.services.kanban.updateColumn(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        DEMO_COLUMN_IDS.REVIEW,
        { wipLimit: 1 },
      );
      await appContainer.services.kanban.createQuickCard(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        {
          title: 'Cartao ocupando WIP de Revisao',
          columnId: DEMO_COLUMN_IDS.REVIEW,
        },
      );

      // Entra via /demo como MEMBER (tem FOUNDATION_TASK em Em Execucao)
      const { container, unmount } = await renderIsolatedApp('/demo', appContainer);
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
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.projects'] }),
      );
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['projects.title'],
      });

      expect(
        screen.getByText(
          'Seu papel atual (Membro) permite apenas visualizar os projetos em que você participa.',
        ),
      ).toBeInTheDocument();

      const openBoardButtons = screen.getAllByRole('button', {
        name: ptBRMessages['projects.openBoardAction'],
      });
      await user.click(openBoardButtons[0]!);

      await screen.findByRole('heading', {
        level: 1,
        name: 'Quadro Kanban — Lancamento Plataforma PMS v1',
      });

      // Visão restrita de MEMBER: sem gestão de colunas/WIP, sem criação de cartão rápido e sem ver cartões alheios
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.column.createAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.column.editAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.column.archiveAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.column.deleteAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.column.moveLeftAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.column.moveRightAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['kanban.quickCard.submit'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          level: 3,
          name: 'Revisar limites de WIP e fluxo operacional do quadro Kanban',
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          level: 3,
          name: 'Cartao ocupando WIP de Revisao',
        }),
      ).not.toBeInTheDocument();
      const reviewSection = screen
        .getByRole('heading', { level: 2, name: 'Em Revisao' })
        .closest('section')!;
      expect(within(reviewSection).getByText('WIP: 1/1')).toBeInTheDocument();

      // Tenta mover FOUNDATION_TASK de "Em Execucao" para "Em Revisao" (WIP 1/1) sem permissão de override
      const cardArticle = screen
        .getByRole('heading', {
          level: 3,
          name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
        })
        .closest('article')!;
      await user.click(
        within(cardArticle).getByRole('button', {
          name: ptBRMessages['kanban.card.moveRightAction'],
        }),
      );

      const wipAlert = await screen.findByRole('alert');
      expect(wipAlert).toHaveTextContent(ptBRMessages['kanban.wipOverride.noPermissionError']);
      expect(
        screen.getByRole('status', { name: ptBRMessages['kanban.liveRegionLabel'] }),
      ).toHaveTextContent(ptBRMessages['kanban.wipOverride.noPermissionError']);
      expect(await axe(container)).toHaveNoViolations();
      unmount();

      // Verifica rota inválida (/projects/nao-uuid/board) amigável
      const invalidRouteView = await renderIsolatedApp('/projects/nao-uuid/board', appContainer);
      expect(
        await within(invalidRouteView.container).findByText(ptBRMessages['validation.uuidInvalid']),
      ).toBeInTheDocument();
      expect(await axe(invalidRouteView.container)).toHaveNoViolations();
      invalidRouteView.unmount();

      // Arquiva o projeto via serviço e confirma banner de bloqueio na tela do quadro (MEMBER e ADMIN)
      await appContainer.services.projects.archiveProject(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );

      const archivedBoardView = await renderIsolatedApp(
        `/projects/${DEMO_PROJECT_ID}/board`,
        appContainer,
      );
      expect(
        await within(archivedBoardView.container).findByText(
          ptBRMessages['kanban.archivedLockBanner'],
        ),
      ).toBeInTheDocument();
      expect(
        within(archivedBoardView.container).queryByRole('button', {
          name: ptBRMessages['kanban.card.moveRightAction'],
        }),
      ).not.toBeInTheDocument();
      expect(
        within(archivedBoardView.container).queryByLabelText(
          ptBRMessages['kanban.card.moveToColumnLabel'],
        ),
      ).not.toBeInTheDocument();
      expect(await axe(archivedBoardView.container)).toHaveNoViolations();
      archivedBoardView.unmount();

      // Autentica como ADMIN no mesmo container arquivado e confirma bloqueio operacional também para ADMIN
      const archivedAdminDemoView = await renderIsolatedApp('/demo', appContainer);
      await within(archivedAdminDemoView.container).findByRole('heading', {
        level: 1,
        name: ptBRMessages['auth.demo.title'],
      });
      await user.click(
        within(archivedAdminDemoView.container).getByRole('button', {
          name: 'Entrar como Administrador',
        }),
      );
      await within(archivedAdminDemoView.container).findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });
      await archivedAdminDemoView.router.navigate(`/projects/${DEMO_PROJECT_ID}/board`);
      expect(
        await within(archivedAdminDemoView.container).findByText(
          ptBRMessages['kanban.archivedLockBanner'],
        ),
      ).toBeInTheDocument();
      expect(
        within(archivedAdminDemoView.container).queryByRole('button', {
          name: ptBRMessages['kanban.column.createAction'],
        }),
      ).not.toBeInTheDocument();
      expect(
        within(archivedAdminDemoView.container).queryByRole('button', {
          name: ptBRMessages['kanban.quickCard.submit'],
        }),
      ).not.toBeInTheDocument();
      expect(
        within(archivedAdminDemoView.container).queryByRole('button', {
          name: ptBRMessages['kanban.column.deleteAction'],
        }),
      ).not.toBeInTheDocument();
      expect(
        within(archivedAdminDemoView.container).queryByRole('button', {
          name: ptBRMessages['kanban.card.moveRightAction'],
        }),
      ).not.toBeInTheDocument();
      expect(await axe(archivedAdminDemoView.container)).toHaveNoViolations();
      archivedAdminDemoView.unmount();

      // Garante que DEMO_MEMBER_USER_ID existe no escopo usado
      expect(DEMO_MEMBER_USER_ID).toBeDefined();
    },
  );

  it(
    'exibe cópia distinta para PAUSED_OVERRIDE e DEPENDENCY_OVERRIDE e renderiza links acessíveis de lista/detalhes fora da alça de arrasto com 0 violações vitest-axe',
    { timeout: 25_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      // Pausa a tarefa existente e cria par com dependência obrigatória pendente
      await appContainer.services.tasks.pauseTask(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_TASK_IDS.FOUNDATION_TASK,
        { reason: 'Aguardando definição de infraestrutura' },
      );

      const prereqTask = await appContainer.services.tasks.createTask(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        {
          title: 'Tarefa Pré-Requisito',
          columnId: DEMO_COLUMN_IDS.TODO,
        },
      );
      const dependentTask = await appContainer.services.tasks.createTask(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        {
          title: 'Tarefa Dependente Pendente',
          columnId: DEMO_COLUMN_IDS.REVIEW,
        },
      );
      await appContainer.services.dependencies.addDependency(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        dependentTask.id,
        { dependsOnTaskId: prereqTask.id, required: true },
      );

      const { container } = await renderIsolatedApp('/demo', appContainer);
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
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.projects'] }),
      );
      await screen.findByRole('button', { name: /Lancamento Plataforma PMS v1/ });

      const projectsTasksLink = await screen.findByRole('link', {
        name: ptBRMessages['projects.openTasksAction'],
      });
      expect(projectsTasksLink).toHaveAttribute('href', `/projects/${DEMO_PROJECT_ID}/tasks`);
      const projectsBottlenecksLinks = await screen.findAllByRole('link', {
        name: ptBRMessages['projects.openBottlenecksAction'],
      });
      expect(projectsBottlenecksLinks[0]).toHaveAttribute(
        'href',
        `/projects/${DEMO_PROJECT_ID}/bottlenecks`,
      );

      const openBoardButtons = screen.getAllByRole('button', {
        name: ptBRMessages['projects.openBoardAction'],
      });
      await user.click(openBoardButtons[0]!);

      await screen.findByRole('heading', {
        level: 1,
        name: 'Quadro Kanban — Lancamento Plataforma PMS v1',
      });

      // Link de Lista de tarefas e Gargalos do projeto no cabeçalho do quadro Kanban
      const boardTaskListLink = screen.getByRole('link', {
        name: ptBRMessages['kanban.openTaskListAction'],
      });
      expect(boardTaskListLink).toHaveAttribute('href', `/projects/${DEMO_PROJECT_ID}/tasks`);
      const boardBottlenecksLink = screen.getByRole('link', {
        name: ptBRMessages['kanban.openBottlenecksAction'],
      });
      expect(boardBottlenecksLink).toHaveAttribute(
        'href',
        `/projects/${DEMO_PROJECT_ID}/bottlenecks`,
      );

      // Link de detalhes no cartão Kanban estritamente fora da alça de arrasto do @dnd-kit
      const pausedTitle = 'Validar persistencia local Dexie e isolamento multi-organizacao';
      const pausedArticle = screen
        .getByRole('heading', { level: 3, name: pausedTitle })
        .closest('article')!;
      const dragHandle = within(pausedArticle).getByRole('button', { name: pausedTitle });
      const detailsLink = within(pausedArticle).getByRole('link', {
        name: `Abrir detalhes de ${pausedTitle}`,
      });
      expect(detailsLink).toHaveAttribute(
        'href',
        `/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
      );
      expect(dragHandle.contains(detailsLink)).toBe(false);
      expect(detailsLink.closest('[aria-roledescription="sortable"]')).toBeNull();
      expect(await axe(container)).toHaveNoViolations();

      // 1. Dispara PAUSED_OVERRIDE e valida cópia distinta do diálogo (sem título de WIP)
      const pausedSelect = within(pausedArticle).getByLabelText(
        ptBRMessages['kanban.card.moveToColumnLabel'],
      );
      const reviewOption = Array.from((pausedSelect as HTMLSelectElement).options).find(
        (opt) => opt.textContent === 'Em Revisao',
      );
      expect(reviewOption).toBeDefined();
      await user.selectOptions(pausedSelect, reviewOption!.value);

      const pausedHeading = await screen.findByRole('heading', {
        name: ptBRMessages['kanban.pausedOverride.title'],
      });
      expect(pausedHeading).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: ptBRMessages['kanban.wipOverride.title'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(ptBRMessages['kanban.pausedOverride.description']),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(ptBRMessages['kanban.pausedOverride.justificationLabel'], {
          exact: false,
        }),
      ).toHaveFocus();
      expect(await axe(container)).toHaveNoViolations();

      // Fecha diálogo de pausa com Escape e verifica retorno de foco para o controle disparador
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(pausedSelect).toHaveFocus();

      // 2. Move cartão com dependência obrigatória pendente para "Concluido" -> DEPENDENCY_OVERRIDE
      const dependentArticle = screen
        .getByRole('heading', { level: 3, name: 'Tarefa Dependente Pendente' })
        .closest('article')!;
      const dependentSelect = within(dependentArticle).getByLabelText(
        ptBRMessages['kanban.card.moveToColumnLabel'],
      );
      const doneOption = Array.from((dependentSelect as HTMLSelectElement).options).find(
        (opt) => opt.textContent === 'Concluido',
      );
      expect(doneOption).toBeDefined();
      await user.selectOptions(dependentSelect, doneOption!.value);

      const dependencyHeading = await screen.findByRole('heading', {
        name: ptBRMessages['kanban.dependencyOverride.title'],
      });
      expect(dependencyHeading).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: ptBRMessages['kanban.wipOverride.title'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(ptBRMessages['kanban.dependencyOverride.description']),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      await user.type(
        screen.getByLabelText(ptBRMessages['kanban.dependencyOverride.justificationLabel'], {
          exact: false,
        }),
        'Dependência validada fora do fluxo principal',
      );
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['kanban.wipOverride.confirmAction'] }),
      );

      const doneSection = screen
        .getByRole('heading', { level: 2, name: 'Concluido' })
        .closest('section')!;
      await within(doneSection).findByRole('heading', {
        level: 3,
        name: 'Tarefa Dependente Pendente',
      });
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'aplica simetria de BOARD_VIEW no botão "Abrir quadro Kanban" da lista e detalhe de projetos quando ExplicitDenyRule bloqueia o quadro (0 violações vitest-axe)',
    { timeout: 25_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      // Cria segundo projeto onde MEMBER participa normalmente e bloqueia apenas BOARD_VIEW no projeto demo
      const allowedProject = await appContainer.services.projects.createProject(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          name: 'Projeto Secundário Com Quadro',
        },
      );
      await appContainer.services.projects.addProjectParticipant(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        allowedProject.id,
        DEMO_MEMBER_USER_ID,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );
      await appContainer.services.authorization.createExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          targetUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.BOARD_VIEW,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Teste de simetria BOARD_VIEW na lista lateral e detalhe',
        },
      );

      const { container } = await renderIsolatedApp('/demo', appContainer);
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
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.projects'] }),
      );

      await screen.findByRole('button', { name: /Lancamento Plataforma PMS v1/ });
      await screen.findByRole('button', { name: /Projeto Secundário Com Quadro/ });

      const deniedListItem = screen
        .getByRole('button', { name: /Lancamento Plataforma PMS v1/ })
        .closest('li')!;
      const allowedListItem = screen
        .getByRole('button', { name: /Projeto Secundário Com Quadro/ })
        .closest('li')!;

      // Projeto com BOARD_VIEW negado NÃO exibe "Abrir quadro Kanban" na lista lateral nem no detalhe
      expect(
        within(deniedListItem).queryByRole('button', {
          name: ptBRMessages['projects.openBoardAction'],
        }),
      ).not.toBeInTheDocument();
      expect(
        within(allowedListItem).getByRole('button', {
          name: ptBRMessages['projects.openBoardAction'],
        }),
      ).toBeInTheDocument();

      // Seleciona o projeto negado (ou garante seleção) -> apenas o item permitido exibe o botão na tela
      await user.click(
        within(deniedListItem).getByRole('button', { name: /Lancamento Plataforma PMS v1/ }),
      );
      await waitFor(() => {
        expect(
          screen.getAllByRole('button', { name: ptBRMessages['projects.openBoardAction'] }),
        ).toHaveLength(1);
      });
      expect(
        screen.queryByRole('link', { name: ptBRMessages['projects.openTasksAction'] }),
      ).not.toBeInTheDocument();

      // Seleciona o projeto permitido -> exibe botão na lista lateral e no painel de detalhe + link de tarefas
      await user.click(
        within(allowedListItem).getByRole('button', { name: /Projeto Secundário Com Quadro/ }),
      );
      await waitFor(() => {
        expect(
          screen.getAllByRole('button', { name: ptBRMessages['projects.openBoardAction'] }),
        ).toHaveLength(2);
      });
      expect(
        screen.getByRole('link', { name: ptBRMessages['projects.openTasksAction'] }),
      ).toHaveAttribute('href', `/projects/${allowedProject.id}/tasks`);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'aplica simetria de BOTTLENECK_VIEW nos links contextuais de gargalos (lista/detalhe de projetos e cabeçalho do Kanban) quando ExplicitDenyRule bloqueia o projeto demo (0 violações vitest-axe)',
    { timeout: 25_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      const allowedProject = await appContainer.services.projects.createProject(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          name: 'Projeto Secundário Com Gargalos',
        },
      );
      await appContainer.services.projects.addProjectParticipant(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        allowedProject.id,
        DEMO_MEMBER_USER_ID,
        PROJECT_MEMBER_ROLES.PARTICIPANT,
      );
      await appContainer.services.authorization.createExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          targetUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.BOTTLENECK_VIEW,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Teste de simetria BOTTLENECK_VIEW em Projetos e Kanban',
        },
      );

      const { container, router } = await renderIsolatedApp('/demo', appContainer);
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
      expect(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.focus'] }),
      ).toHaveAttribute('href', '/focus');
      expect(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.bottlenecks'] }),
      ).toHaveAttribute('href', '/bottlenecks');

      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.projects'] }),
      );

      await screen.findByRole('button', { name: /Lancamento Plataforma PMS v1/ });
      await screen.findByRole('button', { name: /Projeto Secundário Com Gargalos/ });

      const deniedListItem = screen
        .getByRole('button', { name: /Lancamento Plataforma PMS v1/ })
        .closest('li')!;
      const allowedListItem = screen
        .getByRole('button', { name: /Projeto Secundário Com Gargalos/ })
        .closest('li')!;

      // Projeto com BOTTLENECK_VIEW negado NÃO exibe link de gargalos na lista lateral
      expect(
        within(deniedListItem).queryByRole('link', {
          name: ptBRMessages['projects.openBottlenecksAction'],
        }),
      ).not.toBeInTheDocument();
      expect(
        within(allowedListItem).getByRole('link', {
          name: ptBRMessages['projects.openBottlenecksAction'],
        }),
      ).toHaveAttribute('href', `/projects/${allowedProject.id}/bottlenecks`);

      // Seleciona o projeto negado -> detalhe também oculta link de gargalos (apenas o item permitido permanece visível)
      await user.click(
        within(deniedListItem).getByRole('button', { name: /Lancamento Plataforma PMS v1/ }),
      );
      await waitFor(() => {
        expect(
          screen.getAllByRole('link', { name: ptBRMessages['projects.openBottlenecksAction'] }),
        ).toHaveLength(1);
      });

      // Seleciona o projeto permitido -> exibe link na lista lateral e no painel de detalhe
      await user.click(
        within(allowedListItem).getByRole('button', { name: /Projeto Secundário Com Gargalos/ }),
      );
      await waitFor(() => {
        expect(
          screen.getAllByRole('link', { name: ptBRMessages['projects.openBottlenecksAction'] }),
        ).toHaveLength(2);
      });
      expect(await axe(container)).toHaveNoViolations();

      // No quadro Kanban do projeto negado, cabeçalho oculta link de gargalos
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/board`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Quadro Kanban — Lancamento Plataforma PMS v1',
      });
      expect(
        screen.queryByRole('link', { name: ptBRMessages['kanban.openBottlenecksAction'] }),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // No quadro Kanban do projeto permitido, cabeçalho exibe link de gargalos
      await router.navigate(`/projects/${allowedProject.id}/board`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Quadro Kanban — Projeto Secundário Com Gargalos',
      });
      expect(
        screen.getByRole('link', { name: ptBRMessages['kanban.openBottlenecksAction'] }),
      ).toHaveAttribute('href', `/projects/${allowedProject.id}/bottlenecks`);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
