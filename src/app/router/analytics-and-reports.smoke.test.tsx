import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('Phase 10 — Analytics & Reports Routing, Accessible Charts, Customization, Calibration & Preview/Export Smoke', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_f10_smoke_${crypto.randomUUID()}`,
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

  it('redirects unauthenticated requests from /analytics and /reports to /login', async () => {
    const analyticsView = await renderIsolatedApp('/analytics');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.login.title'] }),
    ).toBeInTheDocument();
    expect(analyticsView.router.state.location.pathname).toBe('/login');
    analyticsView.unmount();
    await cleanupActiveContainer();

    const reportsView = await renderIsolatedApp('/reports');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.login.title'] }),
    ).toBeInTheDocument();
    expect(reportsView.router.state.location.pathname).toBe('/login');
  });

  it('renders /analytics, /projects/:projectId/analytics and /reports with accessible charts, widget draft, calibration tab and preview/export parity', async () => {
    const user = userEvent.setup();
    const { container, router } = await renderIsolatedApp('/demo');
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });

    await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['organizations.title'] });

    await router.navigate('/analytics');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['analytics.title'] },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    // Switch to ORGANIZATION scope so seeded tasks/impediments/bottlenecks/feedbacks populate charts & tables
    const orgScopeButton = await screen.findByRole(
      'button',
      { name: ptBRMessages['analytics.scope.ORGANIZATION'] },
      { timeout: 5000 },
    );
    await user.click(orgScopeButton);

    // Accessible tables paired with Recharts visualizations
    const tables = await screen.findAllByRole('table', {}, { timeout: 5000 });
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole('tab', { name: ptBRMessages['analytics.tabs.calibration'] }),
    ).toBeInTheDocument();

    // Edit dashboard preference draft + unsaved warning + save
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.dashboard.editAction'] }),
    );
    const widgetToggle = screen.getAllByRole('checkbox', { name: /Exibir widget/i })[0];
    expect(widgetToggle).toBeDefined();
    if (widgetToggle !== undefined) {
      await user.click(widgetToggle);
    }
    expect(
      screen.getByText(ptBRMessages['analytics.dashboard.unsavedChangesWarning']),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.dashboard.saveAction'] }),
    );
    const savedMessages = await screen.findAllByText(
      ptBRMessages['analytics.dashboard.saveSuccess'],
    );
    expect(savedMessages.length).toBeGreaterThanOrEqual(1);

    // Calibration tab (ADMIN)
    await user.click(screen.getByRole('tab', { name: ptBRMessages['analytics.tabs.calibration'] }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: ptBRMessages['analytics.calibration.title'],
      }),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();

    // Project-scoped analytics route
    await router.navigate(`/projects/${DEMO_PROJECT_ID}/analytics`);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Analytics do projeto/i }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Reports route: catalog, preview and secure Blob export
    await router.navigate('/reports');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: ptBRMessages['reports.title'] },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    expect(
      await screen.findByRole(
        'heading',
        { level: 3, name: ptBRMessages['reports.kind.PROJECT_DELIVERY_FLOW.title'] },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: ptBRMessages['reports.kind.ORGANIZATION_EXECUTIVE_SUMMARY.title'],
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: ptBRMessages['reports.filters.previewAction'] }),
    );
    expect(
      await screen.findByText(ptBRMessages['reports.preview.parityNotice']),
    ).toBeInTheDocument();

    const origCreateUrl = URL.createObjectURL;
    const origRevokeUrl = URL.revokeObjectURL;
    const createUrlMock = vi.fn(() => 'blob:report-export-test');
    const revokeUrlMock = vi.fn();
    URL.createObjectURL = createUrlMock;
    URL.revokeObjectURL = revokeUrlMock;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    try {
      await user.click(
        screen.getByRole('button', { name: ptBRMessages['reports.export.format.JSON'] }),
      );
      await waitFor(() => {
        expect(createUrlMock).toHaveBeenCalledTimes(1);
        expect(revokeUrlMock).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      URL.createObjectURL = origCreateUrl;
      URL.revokeObjectURL = origRevokeUrl;
    }

    expect(await axe(container)).toHaveNoViolations();
  }, 20000);
});
