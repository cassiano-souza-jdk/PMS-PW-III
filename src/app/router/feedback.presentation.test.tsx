import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '@/app/App';
import {
  DEMO_ADMIN_USER_ID,
  DEMO_FEEDBACK_IDS,
  DEMO_MANAGER_USER_ID,
  DEMO_MEMBER_USER_ID,
  DEMO_ORG_ID,
  createAppContainer,
  type AppCompositionContainer,
} from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { FEEDBACK_STATUSES } from '@/modules/feedback';
import { ptBRMessages } from '@/shared/i18n';
import { PRIORITIES } from '@/shared/kernel';
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
    await screen.findByRole(
      'heading',
      {
        level: 1,
        name: ptBRMessages['organizations.title'],
      },
      { timeout: 5000 },
    );

    await router.navigate('/feedback/not-a-uuid');
    const invalidHeading = await screen.findByRole(
      'heading',
      {
        level: 1,
        name: ptBRMessages['feedbacks.detail.invalidIdError'],
      },
      { timeout: 5000 },
    );
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
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['organizations.title'],
        },
        { timeout: 5000 },
      );

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
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['organizations.title'],
        },
        { timeout: 5000 },
      );

      await router.navigate('/feedback');
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['feedbacks.queue.title'],
        },
        { timeout: 5000 },
      );
      // Bug #4: MEMBER com feedbacks acessíveis visualiza controles de exportação na fila /feedback
      expect(
        await screen.findByRole(
          'heading',
          {
            level: 2,
            name: ptBRMessages['feedbacks.export.title'],
          },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: ptBRMessages['feedbacks.nav.governanceShortcut'] }),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // Detalhe como MEMBER (autor do feedback): notas internas estritamente segregadas (DN-04)
      await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Ajustar indicacao visual de limite WIP no quadro Kanban/,
        },
        { timeout: 5000 },
      );
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
      const unauthorizedHeading = await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['feedback.unauthorizedTitle'],
        },
        { timeout: 5000 },
      );
      expect(unauthorizedHeading).toHaveAttribute('tabindex', '-1');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'mantém hierarquia WCAG heading-order (h2 -> h3) em FeedbackContestationPanel quando canConfirmResolution e canOpenContest são false',
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      const { appContainer, container, router } = await renderIsolatedApp('/demo');

      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.demo.title'] },
        { timeout: 5000 },
      );
      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['organizations.title'],
        },
        { timeout: 5000 },
      );

      const reasons = await appContainer.services.feedback.listFeedbackContestReasons(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
      );
      const activeReason = reasons[0];
      expect(activeReason).toBeDefined();

      const contest = await appContainer.services.feedback.openFeedbackContest(
        DEMO_MEMBER_USER_ID,
        DEMO_ORG_ID,
        DEMO_FEEDBACK_IDS.RESOLVED_IMPROVEMENT,
        {
          reasonId: activeReason!.reason.id,
          justification: 'Problema ainda ocorre no fluxo de atalho.',
        },
      );
      await appContainer.services.feedback.delegateFeedbackContestAnalysis(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        DEMO_FEEDBACK_IDS.RESOLVED_IMPROVEMENT,
        contest.id,
        { analystUserId: DEMO_MANAGER_USER_ID },
      );
      await appContainer.services.feedback.submitFeedbackContestAnalysis(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        DEMO_FEEDBACK_IDS.RESOLVED_IMPROVEMENT,
        contest.id,
        {
          recommendation: 'KEEP_RESOLUTION',
          summary: 'Parecer tecnico preliminar registrado.',
        },
      );

      await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.RESOLVED_IMPROVEMENT}`);
      await screen.findByRole(
        'heading',
        {
          level: 2,
          name: ptBRMessages['feedbacks.contests.title'],
        },
        { timeout: 5000 },
      );
      expect(
        screen.getAllByRole('heading', {
          level: 3,
          name: ptBRMessages['feedbacks.contests.analysisTitle'],
        }).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: ptBRMessages['feedbacks.contests.delegateTitle'],
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: ptBRMessages['feedbacks.contests.decisionTitle'],
        }),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'valida FeedbackAttachmentsPanel (rejeição de MIME proibido, upload + SHA-256 + download, QuotaExceededError não-destrutivo e segregação de anexo interno) com 0 violações vitest-axe',
    { timeout: 45_000 },
    async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const originalCreateObjectUrl = URL.createObjectURL;
      const originalRevokeObjectUrl = URL.revokeObjectURL;
      const createObjectUrlMock = vi.fn(() => 'blob:feedback-attachment-test');
      URL.createObjectURL = createObjectUrlMock;
      URL.revokeObjectURL = vi.fn();
      const anchorClickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      try {
        const user = userEvent.setup();
        const { container, appContainer, router } = await renderIsolatedApp('/demo');

        await screen.findByRole(
          'heading',
          { level: 1, name: ptBRMessages['auth.demo.title'] },
          { timeout: 5000 },
        );
        await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
        await screen.findByRole(
          'heading',
          {
            level: 1,
            name: ptBRMessages['organizations.title'],
          },
          { timeout: 5000 },
        );

        await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`);
        await screen.findByRole(
          'heading',
          { level: 1, name: /Ajustar indicacao visual de limite WIP no quadro Kanban/ },
          { timeout: 5000 },
        );

        const attachmentsSection = screen
          .getByRole('heading', {
            level: 2,
            name: ptBRMessages['feedbacks.attachments.publicTitle'],
          })
          .closest('section, div.rounded-lg, [aria-labelledby^="feedback-attachments-heading"]')!;

        // 1. Rejeição de MIME proibido (image/svg+xml, text/html; charset=utf-8, application/x-msdownload)
        const fileInput = within(attachmentsSection as HTMLElement).getByLabelText(
          ptBRMessages['feedbacks.attachments.fileLabel'],
        );
        const submitUploadBtn = within(attachmentsSection as HTMLElement).getByRole('button', {
          name: ptBRMessages['feedbacks.attachments.submitAction'],
        });

        for (const bad of [
          { name: 'evil.svg', type: 'image/svg+xml' },
          { name: 'xss.html', type: 'text/html; charset=utf-8' },
          { name: 'payload.exe', type: 'application/x-msdownload' },
        ]) {
          const forbiddenFile = new File(['<svg/>'], bad.name, { type: bad.type });
          await user.upload(fileInput, forbiddenFile);
          expect(
            await within(attachmentsSection as HTMLElement).findByText(
              ptBRMessages['feedbacks.attachments.disallowedMimeError'],
            ),
          ).toBeInTheDocument();
          await user.click(submitUploadBtn);
          expect(
            within(attachmentsSection as HTMLElement).getByText(
              ptBRMessages['feedbacks.attachments.disallowedMimeError'],
            ),
          ).toBeInTheDocument();
        }

        // 2. Upload público válido + SHA-256 + download real
        const validPublicFile = new File(['Evidencia publica F09'], 'evidencia-publica.txt', {
          type: 'text/plain',
        });
        await user.upload(fileInput, validPublicFile);
        await user.click(submitUploadBtn);
        expect(await screen.findByText('evidencia-publica.txt')).toBeInTheDocument();
        expect(screen.getByText(/SHA-256: [0-9a-f]{64}/)).toBeInTheDocument();

        await user.click(
          within(attachmentsSection as HTMLElement).getByRole('button', {
            name: ptBRMessages['feedbacks.attachments.downloadAction'],
          }),
        );
        await waitFor(() => {
          expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
          expect(anchorClickSpy).toHaveBeenCalledTimes(1);
        });

        // 3. Upload de anexo interno vinculado à nota interna seedada
        const contextSelect = within(attachmentsSection as HTMLElement).getByLabelText(
          ptBRMessages['feedbacks.attachments.targetContextLabel'],
        );
        await user.selectOptions(contextSelect, 'INTERNAL');
        const internalFile = new File(['Log tecnico interno'], 'diagnostico-sigiloso.txt', {
          type: 'text/plain',
        });
        await user.upload(fileInput, internalFile);
        await user.click(submitUploadBtn);
        expect(await screen.findByText('diagnostico-sigiloso.txt')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        // 4. QuotaExceededError não-destrutivo preserva anexos já gravados
        vi.spyOn(appContainer.attachmentBlobStore, 'putBlob').mockRejectedValueOnce(
          Object.assign(new Error('QuotaExceededError: storage full'), {
            name: 'QuotaExceededError',
          }),
        );
        await user.selectOptions(contextSelect, 'PUBLIC');
        const quotaFile = new File(['Arquivo bloqueado por cota'], 'falha-cota.txt', {
          type: 'text/plain',
        });
        await user.upload(fileInput, quotaFile);
        await user.click(submitUploadBtn);
        expect(
          await within(attachmentsSection as HTMLElement).findByText(
            ptBRMessages['feedbacks.attachments.quotaExceededError'],
          ),
        ).toBeInTheDocument();
        expect(screen.getByText('evidencia-publica.txt')).toBeInTheDocument();
        expect(screen.getByText('diagnostico-sigiloso.txt')).toBeInTheDocument();

        // 5. Troca para MEMBER (autor): vê anexo público, NÃO vê nota interna nem anexo interno
        await user.click(screen.getByRole('button', { name: 'Sair' }));
        await screen.findByRole(
          'heading',
          { level: 1, name: ptBRMessages['auth.login.title'] },
          { timeout: 5000 },
        );
        await router.navigate('/demo');
        await user.click(
          await screen.findByRole('button', { name: 'Entrar como Membro' }, { timeout: 5000 }),
        );
        await screen.findByRole(
          'heading',
          { level: 1, name: ptBRMessages['organizations.title'] },
          { timeout: 5000 },
        );

        await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`);
        await screen.findByRole(
          'heading',
          {
            level: 1,
            name: /Ajustar indicacao visual de limite WIP no quadro Kanban/,
          },
          { timeout: 5000 },
        );
        expect(screen.getByText('evidencia-publica.txt')).toBeInTheDocument();
        expect(screen.queryByText('diagnostico-sigiloso.txt')).not.toBeInTheDocument();
        expect(
          screen.queryByRole('heading', { name: ptBRMessages['feedbacks.internalNotes.title'] }),
        ).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        const logs = [
          ...errorSpy.mock.calls.flat().map(String),
          ...warnSpy.mock.calls.flat().map(String),
        ].join('\n');
        expect(logs).not.toContain('MISSING_TRANSLATION');
        expect(container.textContent).not.toContain('feedbacks.');
      } finally {
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
      }
    },
  );

  it(
    'cobre modais abertos com vitest-axe, governança ADMIN-only (calendário/feriados/soft-delete), segregação de MANAGER (atribuído vs não-atribuído vs autor), contestação/delegação/decisão e exportação segmentada JSON/CSV sem MISSING_TRANSLATION',
    { timeout: 60_000 },
    async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const user = userEvent.setup();
      const { container, appContainer, router } = await renderIsolatedApp('/demo');

      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.demo.title'] },
        { timeout: 5000 },
      );
      await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: ptBRMessages['organizations.title'],
        },
        { timeout: 5000 },
      );

      // Seed a feedback authored by MANAGER so we verify DN-04 segregation for MANAGER author too
      const categories = await appContainer.services.feedback.listFeedbackCategories(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
      );
      const managerAuthoredFeedback = await appContainer.services.feedback.createFeedback(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        {
          moduleKey: 'analytics',
          categoryId: categories[0]!.category.id,
          title: 'Feedback aberto por Gestor (DN-04)',
          description: 'Gestor autor não pode visualizar notas internas deste item.',
          priority: PRIORITIES.MEDIUM,
        },
      );
      await appContainer.services.feedback.addFeedbackInternalNote(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        managerAuthoredFeedback.id,
        { body: 'Nota interna do ADMIN sobre feedback do Gestor.' },
      );

      // Seed an extra feedback assigned to MANAGER, resolved by MANAGER, for contestation + delegation + analysis + ADMIN decision flow
      const contestableFeedback = await appContainer.services.feedback.createFeedback(
        DEMO_MEMBER_USER_ID,
        DEMO_ORG_ID,
        {
          moduleKey: 'kanban',
          categoryId: categories[0]!.category.id,
          title: 'Feedback contestável atribuído ao Gestor',
          description: 'Gestor resolverá, Membro contestará, Gestor analisará e Admin decidirá.',
          priority: PRIORITIES.HIGH,
        },
      );
      await appContainer.services.feedback.assignFeedback(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        contestableFeedback.id,
        { assigneeId: DEMO_MANAGER_USER_ID },
      );
      await appContainer.services.feedback.transitionFeedbackStatus(
        DEMO_MANAGER_USER_ID,
        DEMO_ORG_ID,
        contestableFeedback.id,
        {
          targetStatus: FEEDBACK_STATUSES.RESOLVED,
          resolutionDescription: 'Ajuste inicial entregue pelo Gestor.',
        },
      );

      // Seed an extra RESOLVED feedback for author resolution confirmation test
      const confirmableFeedback = await appContainer.services.feedback.createFeedback(
        DEMO_MEMBER_USER_ID,
        DEMO_ORG_ID,
        {
          moduleKey: 'focus',
          categoryId: categories[0]!.category.id,
          title: 'Feedback para confirmação de resolução',
          description: 'Autor confirmará que a solução atendeu.',
          priority: PRIORITIES.LOW,
        },
      );
      await appContainer.services.feedback.transitionFeedbackStatus(
        DEMO_ADMIN_USER_ID,
        DEMO_ORG_ID,
        confirmableFeedback.id,
        {
          targetStatus: FEEDBACK_STATUSES.RESOLVED,
          resolutionDescription: 'Ajuste aplicado para confirmação.',
        },
      );

      // 1. /feedback com ModalDialog de criação ABERTO -> 0 violações vitest-axe + Exportação JSON/CSV do ADMIN
      await router.navigate('/feedback');
      await user.click(
        await screen.findByRole(
          'button',
          { name: ptBRMessages['feedbacks.create.openAction'] },
          { timeout: 5000 },
        ),
      );
      const createDialog = await screen.findByRole('dialog');
      expect(within(createDialog).getByRole('heading', { level: 2 })).toHaveTextContent(
        ptBRMessages['feedbacks.create.title'],
      );
      expect(await axe(container)).toHaveNoViolations();
      await user.click(
        within(createDialog).getByRole('button', { name: ptBRMessages['common.close'] }),
      );

      // Export preview JSON & CSV as ADMIN
      const formatSelect = screen.getByLabelText(ptBRMessages['feedbacks.export.formatLabel']);
      await user.selectOptions(formatSelect, 'CSV');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.export.previewAction'] }),
      );
      const exportTextarea = await screen.findByRole('textbox', {
        name: ptBRMessages['feedbacks.export.title'],
      });
      expect((exportTextarea as HTMLTextAreaElement).value).toContain('feedbackId,title,moduleKey');
      await user.selectOptions(formatSelect, 'JSON');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.export.previewAction'] }),
      );
      await waitFor(() => {
        expect((exportTextarea as HTMLTextAreaElement).value).toContain(
          'Nota interna de triagem: alinhar tokens WCAG AA com o time de apresentacao.',
        );
      });
      expect(await axe(container)).toHaveNoViolations();

      // 2. /feedback/governance (ADMIN-only): criar categoria, abrir modal soft-delete com vitest-axe, confirmar, editar calendário/feriado SLA
      await router.navigate('/feedback/governance');
      await screen.findByRole(
        'heading',
        {
          level: 2,
          name: ptBRMessages['feedbacks.governance.catalog.categoriesTitle'],
        },
        { timeout: 5000 },
      );

      const catSection = screen
        .getByRole('heading', {
          level: 2,
          name: ptBRMessages['feedbacks.governance.catalog.categoriesTitle'],
        })
        .closest('[aria-labelledby="feedback-catalog-category-heading"]') as HTMLElement;
      await user.type(
        within(catSection).getByLabelText(ptBRMessages['feedbacks.governance.catalog.codeLabel']),
        'GOV_TEMP',
      );
      await user.type(
        within(catSection).getByLabelText(ptBRMessages['feedbacks.governance.catalog.nameLabel']),
        'Categoria Temporária UI',
      );
      await user.click(
        within(catSection).getByRole('button', {
          name: ptBRMessages['feedbacks.governance.catalog.createCategoryAction'],
        }),
      );
      expect(await screen.findByText('Categoria Temporária UI')).toBeInTheDocument();

      // Abrir modal de confirmação de soft-delete e auditar com vitest-axe
      const tempRow = within(catSection).getByText('Categoria Temporária UI').closest('li')!;
      await user.click(
        within(tempRow).getByRole('button', {
          name: ptBRMessages['feedbacks.governance.catalog.deleteAction'],
        }),
      );
      const deleteDialog = await screen.findByRole('dialog');
      expect(await axe(container)).toHaveNoViolations();
      await user.click(
        within(deleteDialog).getByRole('button', { name: ptBRMessages['common.confirm'] }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.governance.catalog.deletedSuccess']))
          .length,
      ).toBeGreaterThanOrEqual(1);

      // Adicionar feriado e salvar configurações SLA
      await user.type(
        screen.getByLabelText(ptBRMessages['feedbacks.governance.sla.holidayDateLabel']),
        '2026-12-25',
      );
      await user.click(
        screen.getByRole('button', {
          name: ptBRMessages['feedbacks.governance.sla.addHolidayAction'],
        }),
      );
      expect(screen.getByText('2026-12-25')).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.governance.sla.saveAction'] }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.governance.sla.saveSuccess'])).length,
      ).toBeGreaterThanOrEqual(1);
      expect(await axe(container)).toHaveNoViolations();

      // 3. Fluxo completo de contestação (MEMBER abre -> ADMIN delega -> MANAGER analisa -> ADMIN decide divergir + confirmação de resolução)
      await user.click(screen.getByRole('button', { name: 'Sair' }));
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.login.title'] },
        { timeout: 5000 },
      );
      await router.navigate('/demo');
      await user.click(
        await screen.findByRole('button', { name: 'Entrar como Membro' }, { timeout: 5000 }),
      );
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['organizations.title'] },
        { timeout: 5000 },
      );

      // Bug #4: Exportação segmentada na fila /feedback para MEMBER (sem notas internas e apenas feedbacks autorais) + exportação unitária no detalhe /feedback/:id
      await router.navigate('/feedback');
      await screen.findByRole(
        'button',
        { name: ptBRMessages['feedbacks.create.openAction'] },
        { timeout: 5000 },
      );
      await user.click(
        await screen.findByRole(
          'button',
          { name: ptBRMessages['feedbacks.export.previewAction'] },
          { timeout: 5000 },
        ),
      );
      const memberQueueExportTextarea = await screen.findByRole('textbox', {
        name: ptBRMessages['feedbacks.export.title'],
      });
      await waitFor(() => {
        expect((memberQueueExportTextarea as HTMLTextAreaElement).value).toContain(
          confirmableFeedback.id,
        );
      });
      expect((memberQueueExportTextarea as HTMLTextAreaElement).value).not.toContain(
        managerAuthoredFeedback.id,
      );
      expect((memberQueueExportTextarea as HTMLTextAreaElement).value).not.toContain(
        'Nota interna',
      );

      // MEMBER confirma resolução no confirmableFeedback (e valida exportação unitária no detalhe)
      await router.navigate(`/feedback/${confirmableFeedback.id}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Feedback para confirmação de resolução/,
        },
        { timeout: 5000 },
      );
      const origCreateUrl = URL.createObjectURL;
      const origRevokeUrl = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:member-single-export');
      URL.revokeObjectURL = vi.fn();
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      try {
        await user.click(
          screen.getByRole('button', { name: ptBRMessages['feedbacks.export.formatJson'] }),
        );
        expect(
          (await screen.findAllByText(/Exportação "feedbacks-export-.*json" gerada com 1 registro/))
            .length,
        ).toBeGreaterThanOrEqual(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
      } finally {
        URL.createObjectURL = origCreateUrl;
        URL.revokeObjectURL = origRevokeUrl;
      }
      await user.click(
        screen.getByRole('button', {
          name: ptBRMessages['feedbacks.contests.confirmResolutionAction'],
        }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.contests.confirmResolutionSuccess']))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText(ptBRMessages['feedbacks.detail.authorConfirmedBadge']),
      ).toBeInTheDocument();

      // MEMBER abre contestação em contestableFeedback (atribuído ao Gestor)
      await router.navigate(`/feedback/${contestableFeedback.id}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Feedback contestável atribuído ao Gestor/,
        },
        { timeout: 5000 },
      );
      await user.type(
        screen.getByLabelText(ptBRMessages['feedbacks.contests.justificationLabel']),
        'O problema ainda ocorre após a correção inicial.',
      );
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.contests.openAction'] }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.contests.openSuccess'])).length,
      ).toBeGreaterThanOrEqual(1);
      expect(await axe(container)).toHaveNoViolations();

      // ADMIN delega para Gestor
      await user.click(screen.getByRole('button', { name: 'Sair' }));
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.login.title'] },
        { timeout: 5000 },
      );
      await router.navigate('/demo');
      await user.click(
        await screen.findByRole('button', { name: 'Entrar como Administrador' }, { timeout: 5000 }),
      );
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['organizations.title'] },
        { timeout: 5000 },
      );

      await router.navigate(`/feedback/${contestableFeedback.id}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Feedback contestável atribuído ao Gestor/,
        },
        { timeout: 5000 },
      );
      await user.selectOptions(
        screen.getByLabelText(ptBRMessages['feedbacks.contests.delegateAnalystLabel']),
        DEMO_MANAGER_USER_ID,
      );
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['feedbacks.contests.delegateAction'] }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.contests.delegateSuccess'])).length,
      ).toBeGreaterThanOrEqual(1);

      // MANAGER: 1) bloqueado de /feedback/governance; 2) vê notas internas do atribuído; 3) bloqueado das notas internas do feedback de sua autoria (DN-04); 4) bloqueado em feedback não atribuído; 5) registra parecer técnico
      await user.click(screen.getByRole('button', { name: 'Sair' }));
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.login.title'] },
        { timeout: 5000 },
      );
      await router.navigate('/demo');
      await user.click(
        await screen.findByRole('button', { name: 'Entrar como Gestor' }, { timeout: 5000 }),
      );
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['organizations.title'] },
        { timeout: 5000 },
      );

      // MANAGER bloqueado em /feedback/governance
      await router.navigate('/feedback/governance');
      expect(
        await screen.findByRole(
          'heading',
          {
            level: 1,
            name: ptBRMessages['feedback.unauthorizedTitle'],
          },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // MANAGER vê notas internas do feedback atribuído a ele
      await router.navigate(`/feedback/${DEMO_FEEDBACK_IDS.IN_PROGRESS_BUG}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Ajustar indicacao visual de limite WIP no quadro Kanban/,
        },
        { timeout: 5000 },
      );
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: ptBRMessages['feedbacks.internalNotes.title'],
        }),
      ).toBeInTheDocument();

      // MANAGER autor de managerAuthoredFeedback NÃO vê notas internas (DN-04)
      await router.navigate(`/feedback/${managerAuthoredFeedback.id}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Feedback aberto por Gestor \(DN-04\)/,
        },
        { timeout: 5000 },
      );
      expect(
        screen.queryByRole('heading', { name: ptBRMessages['feedbacks.internalNotes.title'] }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Nota interna do ADMIN sobre feedback do Gestor.'),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      // MANAGER também é bloqueado em feedback não atribuído a ele (confirmableFeedback)
      await router.navigate(`/feedback/${confirmableFeedback.id}`);
      expect(
        await screen.findByRole(
          'heading',
          {
            level: 1,
            name: ptBRMessages['feedback.unauthorizedTitle'],
          },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();

      // MANAGER envia parecer técnico KEEP_RESOLUTION na contestação delegada
      await router.navigate(`/feedback/${contestableFeedback.id}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Feedback contestável atribuído ao Gestor/,
        },
        { timeout: 5000 },
      );
      await user.type(
        screen.getByLabelText(ptBRMessages['feedbacks.contests.analysisSummaryLabel']),
        'Nos testes locais o fluxo funcionou conforme especificação.',
      );
      await user.click(
        screen.getByRole('button', {
          name: ptBRMessages['feedbacks.contests.submitAnalysisAction'],
        }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.contests.submitAnalysisSuccess']))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(await axe(container)).toHaveNoViolations();

      // ADMIN decide RESUME_SERVICE divergindo do parecer -> cria Ciclo #2 CONTESTATION_REOPEN
      await user.click(screen.getByRole('button', { name: 'Sair' }));
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['auth.login.title'] },
        { timeout: 5000 },
      );
      await router.navigate('/demo');
      await user.click(
        await screen.findByRole('button', { name: 'Entrar como Administrador' }, { timeout: 5000 }),
      );
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['organizations.title'] },
        { timeout: 5000 },
      );

      await router.navigate(`/feedback/${contestableFeedback.id}`);
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: /Feedback contestável atribuído ao Gestor/,
        },
        { timeout: 5000 },
      );
      await user.selectOptions(
        screen.getByLabelText(ptBRMessages['feedbacks.contests.decisionOutcomeLabel']),
        'RESUME_SERVICE',
      );
      await user.type(
        screen.getByLabelText(ptBRMessages['feedbacks.contests.decisionJustificationLabel']),
        'Evidência de regressão intermitente justifica reabrir atendimento.',
      );
      await user.click(
        screen.getByRole('button', {
          name: ptBRMessages['feedbacks.contests.submitDecisionAction'],
        }),
      );
      expect(
        (await screen.findAllByText(ptBRMessages['feedbacks.contests.submitDecisionSuccess']))
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText(ptBRMessages['feedbacks.contests.decisionDivergedBadge']),
      ).toBeInTheDocument();
      expect(screen.getByText('Ciclo #2')).toBeInTheDocument();
      expect(
        screen.getByText(ptBRMessages['feedbacks.cycles.origin.CONTESTATION_REOPEN']),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      const logs = [
        ...errorSpy.mock.calls.flat().map(String),
        ...warnSpy.mock.calls.flat().map(String),
      ].join('\n');
      expect(logs).not.toContain('MISSING_TRANSLATION');
      expect(container.textContent).not.toContain('feedbacks.');
    },
  );
});
