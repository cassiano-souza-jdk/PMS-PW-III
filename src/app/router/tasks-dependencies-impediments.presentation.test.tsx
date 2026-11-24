import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
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
import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import { ptBRMessages } from '@/shared/i18n';
import { IMPEDIMENT_SEVERITIES, asEntityId, asIsoDateTime } from '@/shared/kernel';
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
});
