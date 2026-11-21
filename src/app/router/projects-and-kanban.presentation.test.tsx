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
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { ptBRMessages } from '@/shared/i18n';
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
      expect(await axe(container)).toHaveNoViolations();
      unmount();

      // Verifica rota inválida (/projects/nao-uuid/board) amigável
      const invalidRouteView = await renderIsolatedApp('/projects/nao-uuid/board', appContainer);
      expect(
        await within(invalidRouteView.container).findByText(ptBRMessages['validation.uuidInvalid']),
      ).toBeInTheDocument();
      expect(await axe(invalidRouteView.container)).toHaveNoViolations();
      invalidRouteView.unmount();

      // Arquiva o projeto via serviço e confirma banner de bloqueio na tela do quadro
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
      expect(await axe(archivedBoardView.container)).toHaveNoViolations();

      // Garante que DEMO_MEMBER_USER_ID existe no escopo usado
      expect(DEMO_MEMBER_USER_ID).toBeDefined();
    },
  );
});
