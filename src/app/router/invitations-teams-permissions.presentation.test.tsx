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

  async function createIsolatedContainer(): Promise<AppCompositionContainer> {
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

  it(
    'exibe mensagem específica de convite inválido/revogado (e não de já ser membro) quando convite é revogado antes do aceite em /invitations',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();

      const admin = await appContainer.services.auth.registerUser({
        email: 'admin.revogado@pms.local',
        password: 'PasswordForte!2026',
        displayName: 'Admin Revogação',
        acceptTerms: true,
        persistent: true,
      });
      const { organization } = await appContainer.services.organizations.createOrganization(
        admin.user.id,
        { name: 'Org Revogação', slug: 'org-revogacao' },
      );
      const createdInvite = await appContainer.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: 'convidado.revogado@pms.local' },
      );

      await appContainer.services.auth.logoutCurrentSession({
        actorUserId: admin.user.id,
        sessionId: admin.session.id,
      });
      await appContainer.services.auth.registerUser({
        email: 'convidado.revogado@pms.local',
        password: 'PasswordForte!2026',
        displayName: 'Convidado Revogado',
        acceptTerms: true,
        persistent: true,
      });

      const { container } = await renderIsolatedApp('/invitations', appContainer);

      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['invitations.title'],
      });

      await user.type(
        screen.getByLabelText(ptBRMessages['invitations.accept.codeLabel'], { exact: false }),
        createdInvite.invitation.code,
      );
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['invitations.accept.previewAction'] }),
      );

      const acceptButton = await screen.findByRole('button', {
        name: ptBRMessages['invitations.accept.acceptAction'],
      });

      // Revoga o convite após a pré-visualização para simular revogação concorrente antes do aceite
      await appContainer.services.invitations.revokeInvitation(
        admin.user.id,
        organization.id,
        createdInvite.invitation.id,
      );

      await user.click(acceptButton);

      expect(
        await screen.findByText(ptBRMessages['invitations.accept.invalidOrExpiredError']),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(ptBRMessages['invitations.accept.alreadyMemberError']),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'exibe mensagem específica de vínculo suspenso (e não de e-mail divergente) quando usuário SUSPENDED tenta aceitar convite em /invitations/accept',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      const appContainer = await createIsolatedContainer();

      const admin = await appContainer.services.auth.registerUser({
        email: 'admin.suspenso@pms.local',
        password: 'PasswordForte!2026',
        displayName: 'Admin Suspensão',
        acceptTerms: true,
        persistent: true,
      });
      const { organization } = await appContainer.services.organizations.createOrganization(
        admin.user.id,
        { name: 'Org Suspensão', slug: 'org-suspensao' },
      );
      const initialInvite = await appContainer.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: 'membro.suspenso@pms.local' },
      );

      await appContainer.services.auth.logoutCurrentSession({
        actorUserId: admin.user.id,
        sessionId: admin.session.id,
      });
      const targetUser = await appContainer.services.auth.registerUser({
        email: 'membro.suspenso@pms.local',
        password: 'PasswordForte!2026',
        displayName: 'Membro Suspenso',
        acceptTerms: true,
        persistent: true,
      });
      await appContainer.services.invitations.acceptInvitation(
        targetUser.user.id,
        initialInvite.invitation.code,
      );
      await appContainer.services.organizations.suspendOrReactivateMember(
        admin.user.id,
        organization.id,
        targetUser.user.id,
        'SUSPENDED',
      );
      const newInvite = await appContainer.services.invitations.createInvitation(
        admin.user.id,
        organization.id,
        { email: 'membro.suspenso@pms.local' },
      );

      const { container } = await renderIsolatedApp(
        `/invitations/accept?code=${encodeURIComponent(newInvite.invitation.code)}`,
        appContainer,
      );

      const acceptButton = await screen.findByRole('button', {
        name: ptBRMessages['invitations.accept.acceptAction'],
      });
      await user.click(acceptButton);

      expect(
        await screen.findByText(ptBRMessages['invitations.accept.suspendedError']),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(ptBRMessages['invitations.accept.emailMismatchWarning']),
      ).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it(
    'valida UUID inválido em #grant-scope-id, validade fora do intervalo em #invite-expiry-days e nome curto em #edit-team-name com alertas inline acessíveis e zero violações vitest-axe',
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

      // 1. Validação de UUID inválido em #grant-scope-id (/permissions)
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.permissions'] }),
      );
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['permissions.title'],
      });

      const createGrantButton = await screen.findByRole('button', {
        name: ptBRMessages['permissions.grants.createAction'],
      });
      const grantForm = createGrantButton.closest('form');
      expect(grantForm).not.toBeNull();
      const scopedGrantForm = within(grantForm as HTMLFormElement);

      const granteeSelect = scopedGrantForm.getByLabelText<HTMLSelectElement>(
        ptBRMessages['permissions.grants.granteeLabel'],
        { exact: false },
      );
      await waitFor(() => {
        expect(granteeSelect.options.length).toBeGreaterThan(1);
      });

      const firstMemberValue = granteeSelect.options[1]?.value ?? '';
      await user.selectOptions(granteeSelect, firstMemberValue);
      await user.selectOptions(
        scopedGrantForm.getByLabelText(ptBRMessages['permissions.grants.scopeTypeLabel'], {
          exact: false,
        }),
        'PROJECT',
      );

      const scopeIdInput = scopedGrantForm.getByLabelText(
        ptBRMessages['permissions.grants.scopeIdLabel'],
        { exact: false },
      );
      await user.type(scopeIdInput, 'uuid-invalido');
      await user.type(
        scopedGrantForm.getByLabelText(ptBRMessages['permissions.grants.reasonLabel'], {
          exact: false,
        }),
        'Justificativa operacional de teste',
      );
      await user.click(createGrantButton);

      const uuidAlert = await scopedGrantForm.findByRole('alert');
      expect(uuidAlert).toHaveTextContent(ptBRMessages['validation.uuidInvalid']);
      expect(scopeIdInput).toHaveAttribute('aria-invalid', 'true');
      expect(await axe(container)).toHaveNoViolations();

      // 2. Validação de intervalo em #invite-expiry-days (/invitations)
      await user.click(
        within(primaryNav).getByRole('link', { name: ptBRMessages['nav.invitations'] }),
      );
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['invitations.title'],
      });

      await user.type(
        screen.getByLabelText(ptBRMessages['invitations.manage.emailLabel'], { exact: false }),
        'novo.integrante@pms.local',
      );
      const expiryInput = screen.getByLabelText(
        ptBRMessages['invitations.manage.expiresInDaysLabel'],
        { exact: false },
      );
      await user.clear(expiryInput);
      await user.type(expiryInput, '91');
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['invitations.manage.createAction'] }),
      );

      expect(await screen.findByText(ptBRMessages['validation.expiryDaysRange'])).toHaveAttribute(
        'role',
        'alert',
      );
      expect(expiryInput).toHaveAttribute('aria-invalid', 'true');
      expect(await axe(container)).toHaveNoViolations();

      // 3. Validação de nome curto em #edit-team-name (/teams)
      await user.click(within(primaryNav).getByRole('link', { name: ptBRMessages['nav.teams'] }));
      await screen.findByRole('heading', {
        level: 1,
        name: ptBRMessages['teams.title'],
      });

      const teamButton = await screen.findByRole('button', {
        name: /Equipe de Produto e Engenharia/i,
      });
      await user.click(teamButton);

      const editTeamNameInput = await screen.findByDisplayValue('Equipe de Produto e Engenharia');
      await user.clear(editTeamNameInput);
      await user.type(editTeamNameInput, 'A');
      await user.click(screen.getByRole('button', { name: ptBRMessages['teams.edit.saveAction'] }));

      expect(await screen.findByText(ptBRMessages['validation.displayNameMin'])).toHaveAttribute(
        'role',
        'alert',
      );
      expect(editTeamNameInput).toHaveAttribute('aria-invalid', 'true');
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
