import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IntlProvider } from 'react-intl';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  DEMO_PROJECT_ID,
  DEMO_TASK_IDS,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { PERMISSION_CODES, PERMISSION_SCOPE_TYPES } from '@/modules/authorization';
import { asTaskDependencyId } from '@/modules/dependencies';
import { TaskDependenciesPanel } from '@/modules/dependencies/presentation';
import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import { asTaskCommentId, type TaskComment } from '@/modules/tasks';
import { TaskCommentsPanel } from '@/modules/tasks/presentation';
import { AuthorizationError } from '@/shared/errors';
import { ptBRMessages } from '@/shared/i18n';
import {
  IMPEDIMENT_SEVERITIES,
  PRIORITIES,
  TASK_STATUSES,
  asEntityId,
  asIsoDateTime,
  asOrganizationId,
  asTaskId,
  asUserId,
} from '@/shared/kernel';
import { createLogger, createMemoryLogSink } from '@/shared/logging';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';
import { appRoutes } from './routes';

describe('Tasks, Subtasks, Dependencies & Impediments Presentation + Routing + ABAC + Accessibility (vitest-axe)', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_f07_presentation_${crypto.randomUUID()}`,
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
    'trata rotas inválidas, projeto inexistente e acesso negado com foco em h1, document.title e zero violações vitest-axe',
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      await appContainer.services.authorization.createExplicitDenyRule(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        {
          targetUserId: DEMO_MEMBER_USER_ID,
          permission: PERMISSION_CODES.BOARD_VIEW,
          scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
          scopeId: asEntityId(DEMO_PROJECT_ID),
          reason: 'Teste de acesso negado na rota de tarefas',
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

      // 1. UUID inválido na lista de tarefas
      await router.navigate('/projects/nao-uuid/tasks');
      const invalidHeading = await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['errors.NOT_FOUND'],
        },
        { timeout: 4000 },
      );
      await waitFor(() => {
        expect(invalidHeading).toHaveFocus();
      });
      expect(invalidHeading).toHaveAttribute('tabindex', '-1');
      expect(screen.getByText(ptBRMessages['validation.uuidInvalid'])).toBeInTheDocument();
      expect(document.title).toContain(ptBRMessages['errors.NOT_FOUND']);
      expect(await axe(container)).toHaveNoViolations();

      // 2. UUID inválido no detalhe da tarefa
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks/nao-uuid`);
      await waitFor(() => {
        const heading = document.getElementById('task-detail-error-heading');
        expect(heading).not.toBeNull();
        expect(heading).toHaveFocus();
      });
      expect(await axe(container)).toHaveNoViolations();

      // 3. Acesso negado em /projects/:projectId/tasks
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks`);
      const deniedHeading = await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['feedback.unauthorizedTitle'],
      });
      await waitFor(() => {
        expect(deniedHeading).toHaveFocus();
      });
      expect(
        screen.getByText(ptBRMessages['feedback.unauthorizedDescription']),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // 4. Projeto inexistente
      await router.navigate(`/projects/99999999-9999-4999-8999-999999999999/tasks`);
      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: ptBRMessages['errors.NOT_FOUND'],
        }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'como ADMIN, navega para lista de tarefas, cria etiqueta e tarefa, opera dependências, impedimentos (sem auto-conclusão), subtarefas, comentários, anexos, ciclos e lixeira com 0 violações vitest-axe',
    { timeout: 45_000 },
    async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');
      const originalCreateObjectUrl = URL.createObjectURL;
      const originalRevokeObjectUrl = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:pms-attachment-test');
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      try {
        const user = userEvent.setup();
        const appContainer = await createIsolatedContainer();
        await appContainer.seedDemoOrganization();

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

        // 1. Navega para /projects/:projectId/tasks via link real
        const tasksLink = await screen.findByRole('link', {
          name: ptBRMessages['projects.openTasksAction'],
        });
        await user.click(tasksLink);

        const listHeading = await screen.findByRole('heading', {
          level: 1,
          name: 'Tarefas — Lancamento Plataforma PMS v1',
        });
        expect(listHeading).toHaveAttribute('tabindex', '-1');
        expect(listHeading).toHaveFocus();
        expect(document.title).toBe('Tarefas — Lancamento Plataforma PMS v1 | PMS');
        expect(await axe(container)).toHaveNoViolations();

        // 2. Cria etiqueta no catálogo organizacional e depois cria nova tarefa
        await user.type(
          screen.getByLabelText(ptBRMessages['tags.catalog.nameLabel'], { exact: false }),
          'Backend',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['tags.catalog.createAction'] }),
        );
        expect(
          await screen.findByText('Etiqueta "Backend" criada com sucesso.'),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', { name: ptBRMessages['tasks.list.newTaskAction'] }),
        );
        const createDialog = await screen.findByRole('dialog');
        await user.type(
          within(createDialog).getByLabelText(ptBRMessages['tasks.fields.titleLabel'], {
            exact: false,
          }),
          'Configurar auditoria de tarefas',
        );
        await user.click(
          within(createDialog).getByRole('button', { name: ptBRMessages['tasks.create.submit'] }),
        );
        expect(
          await screen.findByText('Tarefa "Configurar auditoria de tarefas" criada com sucesso.'),
        ).toBeInTheDocument();

        // 3. Abre detalhes da tarefa seedada FOUNDATION_TASK
        const detailLink = screen.getByRole('link', {
          name: 'Abrir detalhes de Validar persistencia local Dexie e isolamento multi-organizacao',
        });
        await user.click(detailLink);

        const detailHeading = await screen.findByRole('heading', {
          level: 1,
          name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
        });
        expect(detailHeading).toHaveAttribute('tabindex', '-1');
        expect(detailHeading).toHaveFocus();
        expect(document.title).toBe(
          'Validar persistencia local Dexie e isolamento multi-organizacao | PMS',
        );
        expect(await axe(container)).toHaveNoViolations();

        // 4. Aba Dependências: adiciona dependência obrigatória para KANBAN_FLOW_TASK
        const depsTab = screen.getByRole('tab', { name: /Dependências/ });
        await user.click(depsTab);
        expect(depsTab).toHaveAttribute('aria-selected', 'true');

        await user.selectOptions(
          screen.getByLabelText(ptBRMessages['dependencies.add.targetLabel'], { exact: false }),
          DEMO_TASK_IDS.KANBAN_FLOW_TASK,
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['dependencies.add.submit'] }),
        );
        await waitFor(() => {
          expect(
            screen.getAllByText(ptBRMessages['dependencies.add.success']).length,
          ).toBeGreaterThanOrEqual(1);
        });
        const depsList = screen.getByRole('list', { name: ptBRMessages['dependencies.title'] });
        expect(
          within(depsList).getByText('Revisar limites de WIP e fluxo operacional do quadro Kanban'),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        // Tenta concluir tarefa com dependência obrigatória pendente -> abre modal DEPENDENCY_OVERRIDE e fecha com Escape
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['tasks.complete.action'] }),
        );
        expect(
          await screen.findByRole('heading', {
            name: ptBRMessages['tasks.complete.dependencyOverrideTitle'],
          }),
        ).toBeInTheDocument();
        await user.keyboard('{Escape}');
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        // Remove dependência via ModalDialog
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['dependencies.remove.action'] }),
        );
        const removeDepDialog = await screen.findByRole('dialog');
        await user.click(
          within(removeDepDialog).getByRole('button', {
            name: ptBRMessages['dependencies.remove.action'],
          }),
        );
        await waitFor(() => {
          expect(
            screen.getAllByText(ptBRMessages['dependencies.remove.success']).length,
          ).toBeGreaterThanOrEqual(1);
        });

        // 5. Aba Impedimentos: cria -> inicia resolução -> resolve com nota (sem auto-concluir)
        const impedimentsTab = screen.getByRole('tab', { name: /Impedimentos/ });
        await user.click(impedimentsTab);

        await user.selectOptions(
          screen.getByLabelText(ptBRMessages['impediments.create.categoryLabel'], {
            exact: false,
          }),
          IMPEDIMENT_CATEGORIES.EXTERNAL_DEPENDENCY,
        );
        await user.selectOptions(
          screen.getByLabelText(ptBRMessages['impediments.create.severityLabel'], {
            exact: false,
          }),
          IMPEDIMENT_SEVERITIES.CRITICAL,
        );
        await user.type(
          screen.getByLabelText(ptBRMessages['impediments.create.descriptionLabel'], {
            exact: false,
          }),
          'Aguardando credencial de homologação',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['impediments.create.submit'] }),
        );

        expect(
          await screen.findByText(ptBRMessages['impediments.create.success']),
        ).toBeInTheDocument();
        expect(screen.getByText(ptBRMessages['impediments.blockingBadge'])).toBeInTheDocument();
        expect(screen.getByText(ptBRMessages['tasks.status.BLOCKED'])).toBeInTheDocument();
        expect(
          screen.getByText(ptBRMessages['impediments.transition.noAutoCompleteHint']),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        await user.click(
          screen.getByRole('button', {
            name: ptBRMessages['impediments.transition.startResolutionAction'],
          }),
        );
        await waitFor(() => {
          expect(
            screen.getAllByText('Status do impedimento atualizado para Em resolução.').length,
          ).toBeGreaterThanOrEqual(1);
        });

        await user.click(
          screen.getByRole('button', {
            name: ptBRMessages['impediments.transition.resolveAction'],
          }),
        );
        const resolveDialog = await screen.findByRole('dialog');
        expect(
          within(resolveDialog).getByText(
            ptBRMessages['impediments.transition.noAutoCompleteHint'],
          ),
        ).toBeInTheDocument();
        await user.type(
          within(resolveDialog).getByLabelText(
            ptBRMessages['impediments.transition.resolutionNoteLabel'],
          ),
          'Credencial liberada pela equipe de infraestrutura',
        );
        await user.click(
          within(resolveDialog).getByRole('button', {
            name: ptBRMessages['impediments.transition.resolveAction'],
          }),
        );

        await waitFor(() => {
          expect(
            screen.getAllByText('Status do impedimento atualizado para Resolvido.').length,
          ).toBeGreaterThanOrEqual(1);
        });
        // Resolving the last blocking impediment restores IN_PROGRESS, NEVER auto-completes to DONE
        expect(screen.getByText(ptBRMessages['tasks.status.IN_PROGRESS'])).toBeInTheDocument();
        expect(screen.queryByText(ptBRMessages['tasks.status.DONE'])).not.toBeInTheDocument();

        // 6. Aba Subtarefas: cria e conclui subtarefa
        await user.click(screen.getByRole('tab', { name: /Subtarefas/ }));
        await user.type(
          screen.getByLabelText(ptBRMessages['subtasks.create.titleLabel'], { exact: false }),
          'Validar cobertura de testes',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['subtasks.create.submit'] }),
        );
        expect(
          await screen.findByText(
            'Subtarefa "Validar cobertura de testes" adicionada com sucesso.',
          ),
        ).toBeInTheDocument();
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['subtasks.complete.action'] }),
        );
        expect(
          await screen.findByText('Subtarefa "Validar cobertura de testes" concluída.'),
        ).toBeInTheDocument();

        // 7. Aba Comentários: cria comentário
        await user.click(screen.getByRole('tab', { name: /Comentários/ }));
        await user.type(
          screen.getByLabelText(ptBRMessages['comments.create.label'], { exact: false }),
          'Revisão de arquitetura aprovada',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['comments.create.submit'] }),
        );
        expect(
          await screen.findByText(ptBRMessages['comments.create.success']),
        ).toBeInTheDocument();

        // 8. Conclui tarefa -> Reabre tarefa -> Verifica 2 ciclos na aba Ciclos e prazos
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['tasks.complete.action'] }),
        );
        expect(await screen.findByText(ptBRMessages['tasks.complete.success'])).toBeInTheDocument();
        expect(
          screen.getAllByText(ptBRMessages['tasks.status.DONE']).length,
        ).toBeGreaterThanOrEqual(1);
        expect(
          screen.getByRole('button', { name: ptBRMessages['tasks.reopen.action'] }),
        ).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: ptBRMessages['tasks.reopen.action'] }));
        const reopenDialog = await screen.findByRole('dialog');
        await user.type(
          within(reopenDialog).getByLabelText(ptBRMessages['tasks.reopen.reasonLabel']),
          'Ajuste adicional solicitado',
        );
        await user.click(
          within(reopenDialog).getByRole('button', {
            name: ptBRMessages['tasks.reopen.confirmAction'],
          }),
        );
        expect(await screen.findByText(ptBRMessages['tasks.reopen.success'])).toBeInTheDocument();

        await user.click(
          screen.getByRole('tab', { name: ptBRMessages['tasks.detail.tabs.history'] }),
        );
        expect(screen.getByText('Ciclo #1')).toBeInTheDocument();
        expect(screen.getByText('Ciclo #2')).toBeInTheDocument();

        // 9. Exclusão lógica (deleteTask) + Restauração (restoreTask) + Incluir excluídas
        await user.click(screen.getByRole('button', { name: ptBRMessages['tasks.delete.action'] }));
        const deleteDialog = await screen.findByRole('dialog');
        await user.click(
          within(deleteDialog).getByRole('button', {
            name: ptBRMessages['tasks.delete.confirmAction'],
          }),
        );
        expect(
          await screen.findByText(ptBRMessages['tasks.detail.deletedBanner']),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', { name: ptBRMessages['tasks.restore.action'] }),
        );
        expect(
          await screen.findByText(
            'Tarefa "Validar persistencia local Dexie e isolamento multi-organizacao" restaurada com sucesso.',
          ),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        const severeErrors = consoleErrorSpy.mock.calls.filter((call) =>
          call.some(
            (arg) =>
              typeof arg === 'string' &&
              (arg.includes('Error') || arg.includes('Warning') || arg.includes('Uncaught')),
          ),
        );
        expect(severeErrors).toHaveLength(0);
      } finally {
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
      }
    },
  );

  it(
    'propaga atributos ABAC (requestedFields, subtaskAssigneeId, createdBy, projectArchivedAt) e toAuthorizationPolicyConfig(settings) para MEMBER na UI',
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      const nowIso = asIsoDateTime('2026-02-01T10:00:00.000Z');
      // Concede apenas TASK_VIEW em KANBAN_FLOW_TASK para testar Cenário 6 (subtaskAssigneeId sem ser ator da tarefa)
      await appContainer.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
        granteeUserId: DEMO_MEMBER_USER_ID,
        permission: PERMISSION_CODES.TASK_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
        scopeId: asEntityId(DEMO_TASK_IDS.KANBAN_FLOW_TASK),
        reason: 'Leitura da tarefa para execução exclusiva de subtarefa atribuída',
      });

      // Cria subtarefa atribuída ao MEMBER na tarefa KANBAN_FLOW_TASK (onde MEMBER NÃO é assignee/criador da tarefa — Cenário 6!)
      const createdSubtask = await appContainer.services.tasks.createSubtask(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_TASK_IDS.KANBAN_FLOW_TASK,
        {
          title: 'Subtarefa exclusiva do membro',
          required: false,
          assigneeId: DEMO_MEMBER_USER_ID,
        },
      );

      // Cria impedimento aberto pelo ADMIN na tarefa FOUNDATION_TASK (onde MEMBER é assignee)
      await appContainer.services.impediments.createImpediment(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_TASK_IDS.FOUNDATION_TASK,
        {
          category: IMPEDIMENT_CATEGORIES.MISSING_INFORMATION,
          severity: IMPEDIMENT_SEVERITIES.MEDIUM,
          description: 'Impedimento aberto pelo administrador',
        },
      );

      // Atualiza OrganizationSettings permitindo: priority/dueDate, subtask manage e resolver impedimento de terceiros
      const defaultSettings = createDefaultOrganizationSettings(DEMO_ORG_ID, nowIso);
      await appContainer.repositories.settings.organizationSettings.save({
        ...defaultSettings,
        pendingPermissionDefaults: {
          ...defaultSettings.pendingPermissionDefaults,
          allowMemberChangePriorityOrDueDateWithoutGrant: true,
          allowMemberManageSubtasksInAccessibleTask: true,
          allowMemberResolveOthersImpediment: true,
          commentEditWindowMinutes: 15,
        },
      });

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

      // 1. Cenário 6: MEMBER navega para tarefa KANBAN_FLOW_TASK (não é assignee nem criador da tarefa)
      // Pode concluir apenas a sua própria subtarefa (`subtaskAssigneeId`), mas NÃO editar prioridade da tarefa-pai!
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.KANBAN_FLOW_TASK}`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Revisar limites de WIP e fluxo operacional do quadro Kanban',
      });

      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.edit.saveAction'] }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Subtarefas/ }));
      expect(screen.getByText(createdSubtask.title)).toBeInTheDocument();
      // Botão Concluir subtarefa visível por subtaskAssigneeId === DEMO_MEMBER_USER_ID, mas formulário de criar subtarefa permanece oculto!
      expect(
        screen.getByRole('button', { name: ptBRMessages['subtasks.complete.action'] }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['subtasks.create.submit'] }),
      ).not.toBeInTheDocument();

      // 2. Na tarefa FOUNDATION_TASK (onde MEMBER é assignee), Settings liberou priority/dueDate/tags, subtask manage e resolver impedimento de terceiros!
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
      });

      const prioritySelect = screen.getByLabelText(ptBRMessages['tasks.fields.priorityLabel']);
      expect(prioritySelect).toBeEnabled();
      expect(screen.getByLabelText(ptBRMessages['tasks.fields.dueDateLabel'])).toBeEnabled();

      await user.click(screen.getByRole('tab', { name: /Subtarefas/ }));
      expect(
        screen.getByRole('button', { name: ptBRMessages['subtasks.create.submit'] }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Impedimentos/ }));
      expect(
        screen.getByRole('button', { name: ptBRMessages['impediments.transition.resolveAction'] }),
      ).toBeInTheDocument();

      // 3. Arquiva o projeto e verifica bloqueio automático via `projectArchivedAt`
      await appContainer.services.projects.archiveProject(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks`);
      expect(
        await screen.findByText(ptBRMessages['tasks.list.archivedBanner']),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.list.newTaskAction'] }),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'ADMIN opera filtros, ordenação, inclusão de excluídas e CRUD completo do catálogo de etiquetas (com modais acessíveis) e MANAGER não vê catálogo',
    { timeout: 45_000 },
    async () => {
      const user = userEvent.setup();
      const adminContainer = await createIsolatedContainer();
      await adminContainer.seedDemoOrganization();

      const { container, router, unmount } = await renderIsolatedApp('/demo', adminContainer);
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['auth.demo.title'],
      });
      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tarefas — Lancamento Plataforma PMS v1',
      });

      // Catálogo de etiquetas visível para ADMIN: cria, tenta duplicar, edita (modal com axe) e exclui
      expect(screen.getByText(ptBRMessages['tags.catalog.title'])).toBeInTheDocument();
      await user.type(
        screen.getByLabelText(ptBRMessages['tags.catalog.nameLabel'], { exact: false }),
        'Segurança',
      );
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['tags.catalog.createAction'] }),
      );
      expect(
        await screen.findByText('Etiqueta "Segurança" criada com sucesso.'),
      ).toBeInTheDocument();

      // Duplicidade case-insensitive normalizada
      const tagNameInput = screen.getByLabelText(ptBRMessages['tags.catalog.nameLabel'], {
        exact: false,
      });
      await user.clear(tagNameInput);
      await user.type(tagNameInput, '  segurança  ');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['tags.catalog.createAction'] }),
      );
      expect(
        await screen.findByText(ptBRMessages['tags.catalog.duplicateError']),
      ).toBeInTheDocument();

      // Edita etiqueta no modal e verifica vitest-axe com modal aberto
      const tagRow =
        screen
          .getAllByText('Segurança')
          .map((element) => element.closest('li'))
          .find((item) => item !== null) ?? null;
      expect(tagRow).not.toBeNull();
      if (tagRow !== null) {
        await user.click(
          within(tagRow).getByRole('button', { name: ptBRMessages['tags.catalog.editAction'] }),
        );
      }
      const editTagDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
      const editTagInput = within(editTagDialog).getByLabelText(
        ptBRMessages['tags.catalog.nameLabel'],
        { exact: false },
      );
      await user.clear(editTagInput);
      await user.type(editTagInput, 'Segurança App');
      await user.click(
        within(editTagDialog).getByRole('button', {
          name: ptBRMessages['tags.catalog.saveAction'],
        }),
      );
      expect(
        await screen.findByText('Etiqueta "Segurança App" atualizada com sucesso.'),
      ).toBeInTheDocument();

      // Abre modal Nova tarefa, valida vitest-axe com modal aberto e cria Alpha Auditoria
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['tasks.list.newTaskAction'] }),
      );
      const createDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
      await user.type(
        within(createDialog).getByLabelText(ptBRMessages['tasks.fields.titleLabel'], {
          exact: false,
        }),
        'Alpha Auditoria',
      );
      await user.selectOptions(
        within(createDialog).getByLabelText(ptBRMessages['tasks.fields.priorityLabel'], {
          exact: false,
        }),
        PRIORITIES.CRITICAL,
      );
      await user.click(
        within(createDialog).getByRole('button', { name: ptBRMessages['tasks.create.submit'] }),
      );
      expect(
        await screen.findByText('Tarefa "Alpha Auditoria" criada com sucesso.'),
      ).toBeInTheDocument();

      // Busca, filtros por status/prioridade, ordenação e limpar filtros
      await user.type(screen.getByLabelText(ptBRMessages['tasks.filters.searchLabel']), 'Alpha');
      expect(
        screen.getByRole('link', { name: 'Abrir detalhes de Alpha Auditoria' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', {
          name: 'Abrir detalhes de Validar persistencia local Dexie e isolamento multi-organizacao',
        }),
      ).not.toBeInTheDocument();

      await user.selectOptions(
        screen.getByLabelText(ptBRMessages['tasks.filters.priorityLabel']),
        PRIORITIES.CRITICAL,
      );
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['tasks.filters.clearAction'] }),
      );
      await user.selectOptions(screen.getByLabelText(ptBRMessages['tasks.sort.label']), 'titleAsc');
      expect(
        screen.getByRole('link', {
          name: 'Abrir detalhes de Validar persistencia local Dexie e isolamento multi-organizacao',
        }),
      ).toBeInTheDocument();

      // Soft-delete em Alpha Auditoria e verificação do checkbox "Incluir tarefas excluídas"
      const alphaTasks = await adminContainer.services.tasks.listProjectTasks(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      const alphaTask = alphaTasks.find((item) => item.title === 'Alpha Auditoria');
      expect(alphaTask).toBeDefined();
      if (alphaTask !== undefined) {
        await adminContainer.services.tasks.deleteTask(
          DEMO_ADMIN_USER_ID,
          DEMO_ORG_ID,
          alphaTask.id,
          { reason: 'Remoção para validar lixeira na lista' },
        );
      }

      const includeDeletedCheckbox = screen.getByLabelText(
        ptBRMessages['tasks.filters.includeDeleted'],
      );
      await user.click(includeDeletedCheckbox);
      expect(await screen.findByText(ptBRMessages['tasks.list.deletedBadge'])).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Abrir detalhes de Alpha Auditoria' }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Exclui etiqueta via modal acessível
      const updatedTagRow =
        screen
          .getAllByText('Segurança App')
          .map((element) => element.closest('li'))
          .find((item) => item !== null) ?? null;
      expect(updatedTagRow).not.toBeNull();
      if (updatedTagRow !== null) {
        await user.click(
          within(updatedTagRow).getByRole('button', {
            name: ptBRMessages['tags.catalog.deleteAction'],
          }),
        );
      }
      const deleteTagDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
      await user.click(
        within(deleteTagDialog).getByRole('button', {
          name: ptBRMessages['tags.catalog.deleteAction'],
        }),
      );
      expect(
        await screen.findByText('Etiqueta "Segurança App" excluída do catálogo.'),
      ).toBeInTheDocument();

      unmount();
      await cleanupActiveContainer();

      // Gestor (MANAGER) não vê catálogo de etiquetas ADMIN-only
      const managerContainer = await createIsolatedContainer();
      await managerContainer.seedDemoOrganization();
      const managerView = await renderIsolatedApp('/demo', managerContainer);
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['auth.demo.title'],
      });
      await user.click(screen.getByRole('button', { name: 'Entrar como Gestor' }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['organizations.title'],
      });
      await managerView.router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tarefas — Lancamento Plataforma PMS v1',
      });
      expect(screen.queryByText(ptBRMessages['tags.catalog.title'])).not.toBeInTheDocument();
      expect(await axe(managerView.container)).toHaveNoViolations();
    },
  );

  it(
    'opera pausa/retomada, subtarefas (reordenar, editar, excluir), comentários (edição/terceiro/sistema/remoção), anexos (upload, download, QuotaExceededError, exclusão), erro de ciclo em dependência e impedimentos (editar, reabrir, cancelar)',
    { timeout: 60_000 },
    async () => {
      const originalCreateObjectUrl = URL.createObjectURL;
      const originalRevokeObjectUrl = URL.revokeObjectURL;
      const createObjectUrlMock = vi.fn(() => 'blob:pms-presentation-download');
      URL.createObjectURL = createObjectUrlMock;
      URL.revokeObjectURL = vi.fn();
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      try {
        const user = userEvent.setup();
        const appContainer = await createIsolatedContainer();
        await appContainer.seedDemoOrganization();

        // Garante janela de edição de comentários de 15 minutos e cria comentário de MEMBER + solicitação de cancelamento (isSystem: true)
        const nowIso = asIsoDateTime(new Date().toISOString());
        const defaultSettings = createDefaultOrganizationSettings(DEMO_ORG_ID, nowIso);
        await appContainer.repositories.settings.organizationSettings.save({
          ...defaultSettings,
          pendingPermissionDefaults: {
            ...defaultSettings.pendingPermissionDefaults,
            commentEditWindowMinutes: 15,
          },
        });

        await appContainer.services.tasks.addTaskComment(
          DEMO_MEMBER_USER_ID,
          DEMO_ORG_ID,
          DEMO_TASK_IDS.FOUNDATION_TASK,
          { body: 'Comentário original do membro' },
        );
        await appContainer.services.tasks.requestTaskCancellation(
          DEMO_MEMBER_USER_ID,
          DEMO_ORG_ID,
          DEMO_TASK_IDS.FOUNDATION_TASK,
          { justification: 'Avaliar necessidade de cancelamento' },
        );

        // Registra dependência FOUNDATION_TASK -> KANBAN_FLOW_TASK para testar erro de ciclo ao adicionar o inverso na UI
        await appContainer.services.dependencies.addDependency(
          DEMO_ADMIN_USER_ID,
          DEMO_ORG_ID,
          DEMO_TASK_IDS.FOUNDATION_TASK,
          {
            dependsOnTaskId: DEMO_TASK_IDS.KANBAN_FLOW_TASK,
            required: true,
          },
        );

        const { container, router } = await renderIsolatedApp('/demo', appContainer);
        await screen.findByRole('heading', {
          level: 1,
          name: ptBRMessages['auth.demo.title'],
        });
        await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
        await screen.findByRole('heading', {
          level: 1,
          name: ptBRMessages['organizations.title'],
        });

        // 1. Testa erro de ciclo na UI em KANBAN_FLOW_TASK -> FOUNDATION_TASK
        await router.navigate(
          `/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.KANBAN_FLOW_TASK}`,
        );
        await screen.findByRole('heading', {
          level: 1,
          name: 'Revisar limites de WIP e fluxo operacional do quadro Kanban',
        });
        await user.click(screen.getByRole('tab', { name: /Dependências/ }));
        await user.selectOptions(
          screen.getByLabelText(ptBRMessages['dependencies.add.targetLabel'], { exact: false }),
          DEMO_TASK_IDS.FOUNDATION_TASK,
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['dependencies.add.submit'] }),
        );
        expect(
          await screen.findByText(ptBRMessages['dependencies.add.cycleError']),
        ).toBeInTheDocument();

        // 2. Navega para FOUNDATION_TASK e testa Pausar / Retomar
        await router.navigate(
          `/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`,
        );
        await screen.findByRole('heading', {
          level: 1,
          name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
        });

        await user.click(screen.getByRole('button', { name: ptBRMessages['tasks.pause.action'] }));
        const pauseDialog = await screen.findByRole('dialog');
        expect(await axe(container)).toHaveNoViolations();
        await user.type(
          within(pauseDialog).getByLabelText(ptBRMessages['tasks.pause.reasonLabel'], {
            exact: false,
          }),
          'Aguardando análise técnica',
        );
        await user.click(
          within(pauseDialog).getByRole('button', {
            name: ptBRMessages['tasks.pause.confirmAction'],
          }),
        );
        expect(await screen.findByText(ptBRMessages['tasks.pause.success'])).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: ptBRMessages['tasks.resume.action'] }));
        expect(await screen.findByText(ptBRMessages['tasks.resume.success'])).toBeInTheDocument();

        // 3. Subtarefas: criar 2, reordenar Cima/Baixo, editar e excluir via modais acessíveis
        await user.click(screen.getByRole('tab', { name: /Subtarefas/ }));
        const subtaskInput = screen.getByLabelText(ptBRMessages['subtasks.create.titleLabel'], {
          exact: false,
        });
        await user.type(subtaskInput, 'Etapa Alfa');
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['subtasks.create.submit'] }),
        );
        expect(
          await screen.findByText('Subtarefa "Etapa Alfa" adicionada com sucesso.'),
        ).toBeInTheDocument();

        await user.type(
          screen.getByLabelText(ptBRMessages['subtasks.create.titleLabel'], { exact: false }),
          'Etapa Beta',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['subtasks.create.submit'] }),
        );
        expect(
          await screen.findByText('Subtarefa "Etapa Beta" adicionada com sucesso.'),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', {
            name: `${ptBRMessages['subtasks.moveUpAction']}: Etapa Beta`,
          }),
        );
        expect(
          await screen.findByText(ptBRMessages['subtasks.reorderSuccess']),
        ).toBeInTheDocument();
        const subtasksPanel = screen.getByRole('tabpanel', { name: /Subtarefas/ });
        const subtaskItems = within(subtasksPanel).getAllByRole('listitem');
        expect(subtaskItems[0]).toHaveTextContent('Etapa Beta');
        expect(subtaskItems[1]).toHaveTextContent('Etapa Alfa');

        await user.click(
          screen.getByRole('button', {
            name: `${ptBRMessages['subtasks.edit.action']}: Etapa Beta`,
          }),
        );
        const editSubtaskDialog = await screen.findByRole('dialog');
        expect(await axe(container)).toHaveNoViolations();
        const editSubtaskInput = within(editSubtaskDialog).getByLabelText(
          ptBRMessages['subtasks.create.titleLabel'],
          { exact: false },
        );
        await user.clear(editSubtaskInput);
        await user.type(editSubtaskInput, 'Etapa Beta Revisada');
        await user.click(
          within(editSubtaskDialog).getByRole('button', {
            name: ptBRMessages['subtasks.edit.saveAction'],
          }),
        );
        expect(
          await screen.findByText(ptBRMessages['subtasks.edit.saveSuccess']),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', {
            name: `${ptBRMessages['subtasks.delete.action']}: Etapa Beta Revisada`,
          }),
        );
        const deleteSubtaskDialog = await screen.findByRole('dialog');
        expect(await axe(container)).toHaveNoViolations();
        await user.click(
          within(deleteSubtaskDialog).getByRole('button', {
            name: ptBRMessages['subtasks.delete.action'],
          }),
        );
        expect(
          await screen.findByText('Subtarefa "Etapa Beta Revisada" excluída.'),
        ).toBeInTheDocument();

        // 4. Comentários: terceiro não edita mas modera exclusão, sistema imutável, autor edita dentro da janela
        await user.click(screen.getByRole('tab', { name: /Comentários/ }));
        expect(
          screen.getByText('Edição permitida por até 15 minuto(s) após a publicação pelo autor.'),
        ).toBeInTheDocument();

        const systemCommentItem = screen
          .getByText(ptBRMessages['comments.systemBadge'])
          .closest('li');
        expect(systemCommentItem).not.toBeNull();
        if (systemCommentItem !== null) {
          expect(
            within(systemCommentItem).queryByRole('button', {
              name: ptBRMessages['comments.edit.action'],
            }),
          ).not.toBeInTheDocument();
          expect(
            within(systemCommentItem).queryByRole('button', {
              name: ptBRMessages['comments.delete.action'],
            }),
          ).not.toBeInTheDocument();
        }

        const memberCommentItem = screen.getByText('Comentário original do membro').closest('li');
        expect(memberCommentItem).not.toBeNull();
        if (memberCommentItem !== null) {
          // ADMIN não pode editar comentário de terceiro (MEMBER), mas pode moderar (excluir)
          expect(
            within(memberCommentItem).queryByRole('button', {
              name: ptBRMessages['comments.edit.action'],
            }),
          ).not.toBeInTheDocument();
          await user.click(
            within(memberCommentItem).getByRole('button', {
              name: ptBRMessages['comments.delete.action'],
            }),
          );
        }
        const deleteCommentDialog = await screen.findByRole('dialog');
        expect(await axe(container)).toHaveNoViolations();
        await user.click(
          within(deleteCommentDialog).getByRole('button', {
            name: ptBRMessages['comments.delete.confirmAction'],
          }),
        );
        expect(
          await screen.findByText(ptBRMessages['comments.delete.success']),
        ).toBeInTheDocument();
        expect(screen.queryByText('Comentário original do membro')).not.toBeInTheDocument();

        // ADMIN publica e edita seu próprio comentário dentro da janela
        await user.type(
          screen.getByLabelText(ptBRMessages['comments.create.label'], { exact: false }),
          'Comentário do administrador',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['comments.create.submit'] }),
        );
        expect(
          await screen.findByText(ptBRMessages['comments.create.success']),
        ).toBeInTheDocument();

        const adminCommentItem = screen.getByText('Comentário do administrador').closest('li');
        expect(adminCommentItem).not.toBeNull();
        if (adminCommentItem !== null) {
          await user.click(
            within(adminCommentItem).getByRole('button', {
              name: ptBRMessages['comments.edit.action'],
            }),
          );
        }
        const inlineCommentEditor = screen.getByLabelText(ptBRMessages['comments.edit.label'], {
          exact: false,
        });
        await user.clear(inlineCommentEditor);
        await user.type(inlineCommentEditor, 'Comentário editado dentro da janela');
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['comments.edit.saveAction'] }),
        );
        expect(await screen.findByText(ptBRMessages['comments.edit.success'])).toBeInTheDocument();
        expect(screen.getByText(ptBRMessages['comments.editedBadge'])).toBeInTheDocument();

        // 5. Anexos: upload + SHA-256, download, erro QuotaExceededError não-destrutivo e exclusão
        await user.click(screen.getByRole('tab', { name: /Anexos/ }));
        const validFile = new File(['Conteúdo binário de evidência F07'], 'evidencia-ui.txt', {
          type: 'text/plain',
        });
        const fileInput = screen.getByLabelText(ptBRMessages['attachments.upload.label'], {
          exact: false,
        });
        await user.upload(fileInput, validFile);
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['attachments.upload.action'] }),
        );
        expect(
          await screen.findByText('Arquivo "evidencia-ui.txt" anexado com sucesso.'),
        ).toBeInTheDocument();
        expect(screen.getByText(/SHA-256: [0-9a-f]{64}/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        await user.click(
          screen.getByRole('button', { name: ptBRMessages['attachments.download.action'] }),
        );
        await waitFor(() => {
          expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
          expect(clickSpy).toHaveBeenCalledTimes(1);
        });

        // Simula QuotaExceededError e confirma preservação do anexo válido existente
        vi.spyOn(appContainer.attachmentBlobStore, 'putBlob').mockRejectedValueOnce(
          new DOMException('Quota exceeded', 'QuotaExceededError'),
        );
        const secondFile = new File(['Segundo arquivo'], 'falha-cota.txt', { type: 'text/plain' });
        await user.upload(fileInput, secondFile);
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['attachments.upload.action'] }),
        );
        expect(
          await screen.findByText(ptBRMessages['attachments.upload.quotaExceededError']),
        ).toBeInTheDocument();
        expect(screen.getByText('evidencia-ui.txt')).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', { name: ptBRMessages['attachments.delete.action'] }),
        );
        const deleteAttachmentDialog = await screen.findByRole('dialog');
        expect(await axe(container)).toHaveNoViolations();
        await user.click(
          within(deleteAttachmentDialog).getByRole('button', {
            name: ptBRMessages['attachments.delete.confirmAction'],
          }),
        );
        expect(
          await screen.findByText('Anexo "evidencia-ui.txt" excluído com sucesso.'),
        ).toBeInTheDocument();

        // 6. Impedimentos: editar, iniciar resolução -> reabrir impedimento -> cancelar impedimento (sem auto-concluir)
        await user.click(screen.getByRole('tab', { name: /Impedimentos/ }));
        await user.type(
          screen.getByLabelText(ptBRMessages['impediments.create.descriptionLabel'], {
            exact: false,
          }),
          'Dependência externa inicial',
        );
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['impediments.create.submit'] }),
        );
        expect(
          await screen.findByText(ptBRMessages['impediments.create.success']),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', { name: ptBRMessages['impediments.edit.action'] }),
        );
        const editImpDialog = await screen.findByRole('dialog');
        expect(await axe(container)).toHaveNoViolations();
        const editImpDescription = within(editImpDialog).getByLabelText(
          ptBRMessages['impediments.create.descriptionLabel'],
          { exact: false },
        );
        await user.clear(editImpDescription);
        await user.type(editImpDescription, 'Dependência externa atualizada');
        await user.click(
          within(editImpDialog).getByRole('button', {
            name: ptBRMessages['impediments.edit.saveAction'],
          }),
        );
        expect(
          await screen.findByText(ptBRMessages['impediments.edit.saveSuccess']),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole('button', {
            name: ptBRMessages['impediments.transition.startResolutionAction'],
          }),
        );
        expect(
          await screen.findByRole('button', {
            name: ptBRMessages['impediments.transition.reopenAction'],
          }),
        ).toBeInTheDocument();
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['impediments.transition.reopenAction'] }),
        );
        await waitFor(() => {
          expect(
            screen.getAllByText('Status do impedimento atualizado para Aberto.').length,
          ).toBeGreaterThanOrEqual(1);
        });

        await user.click(
          screen.getByRole('button', { name: ptBRMessages['impediments.transition.cancelAction'] }),
        );
        const cancelImpDialog = await screen.findByRole('dialog');
        expect(
          within(cancelImpDialog).getByText(
            ptBRMessages['impediments.transition.noAutoCompleteHint'],
          ),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
        await user.click(
          within(cancelImpDialog).getByRole('button', {
            name: ptBRMessages['impediments.transition.cancelAction'],
          }),
        );
        await waitFor(() => {
          expect(
            screen.getAllByText('Status do impedimento atualizado para Cancelado.').length,
          ).toBeGreaterThanOrEqual(1);
        });
        expect(screen.getByText(ptBRMessages['tasks.status.IN_PROGRESS'])).toBeInTheDocument();
      } finally {
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
      }
    },
  );

  it(
    'valida máscara segura de dependência fora de escopo, janela 0min/expirada em comentários, Cenário 6 isolado, tags e solicitação de cancelamento por MEMBER, e bloqueio read-only no detalhe de projeto arquivado',
    { timeout: 45_000 },
    async () => {
      const user = userEvent.setup();
      const fixedTimestamp = asIsoDateTime('2026-08-01T10:00:00.000Z');
      const orgId = asOrganizationId(DEMO_ORG_ID);
      const taskId = asTaskId('11111111-1111-4111-8111-111111119101');
      const hiddenTargetId = asTaskId('11111111-1111-4111-8111-111111119102');
      const authorId = asUserId(DEMO_MEMBER_USER_ID);
      const usersById = new Map([
        [
          authorId,
          {
            userId: authorId,
            displayName: 'Membro Teste',
          },
        ],
      ]);

      // 1. Teste isolado de TaskDependenciesPanel: máscara segura quando relatedTaskAccessible === false
      const depStandalone = render(
        <IntlProvider locale="pt-BR" messages={ptBRMessages}>
          <TaskDependenciesPanel
            taskId={taskId}
            taskStatus={TASK_STATUSES.IN_PROGRESS}
            dependencies={[
              {
                id: asTaskDependencyId('11111111-1111-4111-8111-111111119201'),
                organizationId: orgId,
                projectId: DEMO_PROJECT_ID,
                taskId,
                dependsOnTaskId: hiddenTargetId,
                required: true,
                createdByUserId: authorId,
                createdAt: fixedTimestamp,
                direction: 'OUTGOING',
                relatedTask: {
                  id: hiddenTargetId,
                  title: 'Título Confidencial Fora de Escopo',
                  status: TASK_STATUSES.BLOCKED,
                },
                relatedTaskAccessible: false,
              },
            ]}
            candidateTargets={[]}
            canViewDependencies={true}
            canManageDependencies={false}
            isReadOnly={false}
            onAddDependency={async () => undefined}
            onRemoveDependency={async () => undefined}
          />
        </IntlProvider>,
      );
      expect(screen.getByText(ptBRMessages['dependencies.outOfScopeLabel'])).toBeInTheDocument();
      expect(screen.queryByText('Título Confidencial Fora de Escopo')).not.toBeInTheDocument();
      expect(screen.queryByText(/Bloqueada/)).not.toBeInTheDocument();
      expect(await axe(depStandalone.container)).toHaveNoViolations();
      depStandalone.unmount();

      // 2. Teste isolado de TaskCommentsPanel: janela 0min desabilitada vs erro de janela expirada (COMMENT_EDIT_WINDOW_EXPIRED)
      const recentCreatedAt = asIsoDateTime(new Date(Date.now() - 60_000).toISOString());
      const sampleComment: TaskComment = {
        id: asTaskCommentId('11111111-1111-4111-8111-111111119301'),
        organizationId: orgId,
        taskId,
        authorUserId: authorId,
        body: 'Comentário sujeito à expiração de janela',
        isSystem: false,
        createdAt: recentCreatedAt,
        updatedAt: recentCreatedAt,
      };
      const zeroWindowView = render(
        <IntlProvider locale="pt-BR" messages={ptBRMessages}>
          <TaskCommentsPanel
            comments={[sampleComment]}
            actorUserId={authorId}
            commentEditWindowMinutes={0}
            referenceNowMs={Date.now()}
            isReadOnly={false}
            canComment={true}
            canModerateComments={false}
            usersById={usersById}
            isMutating={false}
            onAddComment={async () => undefined}
            onUpdateComment={async () => undefined}
            onDeleteComment={async () => undefined}
          />
        </IntlProvider>,
      );
      expect(screen.getByText(ptBRMessages['comments.edit.windowDisabled'])).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['comments.edit.action'] }),
      ).not.toBeInTheDocument();
      zeroWindowView.unmount();

      const expiredWindowView = render(
        <IntlProvider locale="pt-BR" messages={ptBRMessages}>
          <TaskCommentsPanel
            comments={[sampleComment]}
            actorUserId={authorId}
            commentEditWindowMinutes={15}
            referenceNowMs={Date.now()}
            isReadOnly={false}
            canComment={true}
            canModerateComments={false}
            usersById={usersById}
            isMutating={false}
            onAddComment={async () => undefined}
            onUpdateComment={async () => {
              throw new AuthorizationError('Janela expirada', {
                details: { reasonCode: 'COMMENT_EDIT_WINDOW_EXPIRED' },
              });
            }}
            onDeleteComment={async () => undefined}
          />
        </IntlProvider>,
      );
      await user.click(screen.getByRole('button', { name: ptBRMessages['comments.edit.action'] }));
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['comments.edit.saveAction'] }),
      );
      expect(
        await screen.findByText(ptBRMessages['comments.edit.windowExpiredError']),
      ).toBeInTheDocument();
      expect(await axe(expiredWindowView.container)).toHaveNoViolations();
      expiredWindowView.unmount();

      // 3. Fluxo completo como MEMBER na App: Cenário 6 executando subtarefa sem editar tarefa-pai, tag na tarefa acessível, solicitação de cancelamento e detalhe em projeto arquivado
      const appContainer = await createIsolatedContainer();
      await appContainer.seedDemoOrganization();

      await appContainer.services.tasks.createTag(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
        name: 'Frontend',
        colorToken: 'sky',
      });
      const hiddenOutOfScopeTask = await appContainer.services.tasks.createTask(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
        {
          title: 'Tarefa Oculta Para Membro',
          priority: PRIORITIES.HIGH,
        },
      );
      await appContainer.services.dependencies.addDependency(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_TASK_IDS.FOUNDATION_TASK,
        { dependsOnTaskId: hiddenOutOfScopeTask.id, required: true },
      );
      await appContainer.services.authorization.grantPermission(DEMO_ADMIN_USER_ID, DEMO_ORG_ID, {
        granteeUserId: DEMO_MEMBER_USER_ID,
        permission: PERMISSION_CODES.TASK_VIEW,
        scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
        scopeId: asEntityId(DEMO_TASK_IDS.KANBAN_FLOW_TASK),
        reason: 'Leitura restrita para concluir subtarefa no Cenário 6',
      });
      await appContainer.services.tasks.createSubtask(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_TASK_IDS.KANBAN_FLOW_TASK,
        {
          title: 'Subtarefa Cenário 6 Executável',
          required: false,
          assigneeId: DEMO_MEMBER_USER_ID,
        },
      );

      // Mantém janela de comentários = 0 na organização
      const defaultsZero = createDefaultOrganizationSettings(DEMO_ORG_ID, fixedTimestamp);
      await appContainer.repositories.settings.organizationSettings.save({
        ...defaultsZero,
        pendingPermissionDefaults: {
          ...defaultsZero.pendingPermissionDefaults,
          commentEditWindowMinutes: 0,
        },
      });

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

      // Cenário 6 em KANBAN_FLOW_TASK: conclui apenas sua subtarefa sem ver controles da tarefa-pai
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.KANBAN_FLOW_TASK}`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Revisar limites de WIP e fluxo operacional do quadro Kanban',
      });
      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.edit.saveAction'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.actions.start'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.complete.action'] }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Subtarefas/ }));
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['subtasks.complete.action'] }),
      );
      expect(
        await screen.findByText('Subtarefa "Subtarefa Cenário 6 Executável" concluída.'),
      ).toBeInTheDocument();

      // FOUNDATION_TASK: MEMBER associa tag permitida (priority/dueDate permanecem bloqueados), não vê dependência fora de escopo, solicita cancelamento
      await router.navigate(`/projects/${DEMO_PROJECT_ID}/tasks/${DEMO_TASK_IDS.FOUNDATION_TASK}`);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
      });
      expect(
        screen.queryByLabelText(ptBRMessages['tasks.fields.priorityLabel']),
      ).not.toBeInTheDocument();
      await user.click(screen.getByLabelText('Frontend'));
      await user.click(screen.getByRole('button', { name: ptBRMessages['tasks.edit.saveAction'] }));
      expect(
        await screen.findByText(
          'Tarefa "Validar persistencia local Dexie e isolamento multi-organizacao" atualizada com sucesso.',
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Dependências/ }));
      expect(screen.queryByText('Tarefa Oculta Para Membro')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Comentários/ }));
      expect(screen.getByText(ptBRMessages['comments.edit.windowDisabled'])).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: ptBRMessages['tasks.cancelRequest.action'] }),
      );
      const cancelRequestDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
      await user.type(
        within(cancelRequestDialog).getByLabelText(
          ptBRMessages['tasks.cancelRequest.justificationLabel'],
          { exact: false },
        ),
        'Solicito revisão de prioridade pelo gestor',
      );
      await user.click(
        within(cancelRequestDialog).getByRole('button', {
          name: ptBRMessages['tasks.cancelRequest.confirmAction'],
        }),
      );
      expect(
        await screen.findByText(ptBRMessages['tasks.cancelRequest.success']),
      ).toBeInTheDocument();
      expect(screen.getByText(ptBRMessages['tasks.status.IN_PROGRESS'])).toBeInTheDocument();

      // Arquiva projeto e valida bloqueio read-only no detalhe /projects/:projectId/tasks/:taskId
      await appContainer.services.projects.archiveProject(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_PROJECT_ID,
      );
      await user.click(screen.getByRole('link', { name: ptBRMessages['tasks.detail.backToList'] }));
      expect(
        await screen.findByText(ptBRMessages['tasks.list.archivedBanner']),
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole('link', {
          name: 'Abrir detalhes de Validar persistencia local Dexie e isolamento multi-organizacao',
        }),
      );
      expect(
        await screen.findByText(ptBRMessages['tasks.detail.archivedBanner']),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.pause.action'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: ptBRMessages['tasks.cancelRequest.action'] }),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
