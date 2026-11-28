import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('Phase 10 — Analytics & Reports Presentation, Interactive Flows & WCAG 2.2 AA (vitest-axe)', () => {
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
        databaseName: `${PMS_DATABASE_NAME}_f10_pres_${crypto.randomUUID()}`,
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

  it('exercises full interactive Analytics flows (scopes, presets, UNAVAILABLE, comparison toggle, Recharts accessible table toggle, widget draft discard/save/restore, ADMIN calibration validation/save) with 0 axe violations', async () => {
    const user = userEvent.setup();
    const { container, router } = await renderIsolatedApp('/demo');
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });

    await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['organizations.title'] });

    await router.navigate('/analytics');
    const personalBtn = await screen.findByRole(
      'button',
      { name: ptBRMessages['analytics.scope.PERSONAL'] },
      { timeout: 5000 },
    );

    // 1. Scope switching: PERSONAL -> PROJECT -> ORGANIZATION
    expect(personalBtn).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: ptBRMessages['analytics.scope.PROJECT'] }));
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: ptBRMessages['analytics.scope.PROJECT'] }),
        ).toHaveAttribute('aria-pressed', 'true'),
      { timeout: 5000 },
    );
    expect(
      screen.getByLabelText(ptBRMessages['analytics.projectSelector.label']),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.scope.ORGANIZATION'] }),
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: ptBRMessages['analytics.scope.ORGANIZATION'] }),
        ).toHaveAttribute('aria-pressed', 'true'),
      { timeout: 5000 },
    );

    // 2. Recharts paired accessible data table toggle (Hide -> Show)
    const hideTableButtons = await screen.findAllByRole('button', {
      name: ptBRMessages['analytics.a11y.chartDataTableToggleHide'],
    });
    expect(hideTableButtons.length).toBeGreaterThanOrEqual(1);
    const initialTablesCount = screen.getAllByRole('table').length;

    await user.click(hideTableButtons[0]!);
    expect(
      screen.getByRole('button', { name: ptBRMessages['analytics.a11y.chartDataTableToggleShow'] }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('table').length).toBe(initialTablesCount - 1);

    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.a11y.chartDataTableToggleShow'] }),
    );
    expect(screen.getAllByRole('table').length).toBe(initialTablesCount);

    // 3. Comparison toggle on/off
    expect(
      screen.getByRole('checkbox', { name: ptBRMessages['analytics.period.compareLabel'] }),
    ).toBeChecked();
    expect(screen.getAllByText(/Período anterior:/).length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole('checkbox', { name: ptBRMessages['analytics.period.compareLabel'] }),
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole('checkbox', { name: ptBRMessages['analytics.period.compareLabel'] }),
        ).not.toBeChecked(),
      { timeout: 5000 },
    );
    expect(screen.queryByText(/Período anterior:/)).toBeNull();

    await user.click(
      screen.getByRole('checkbox', { name: ptBRMessages['analytics.period.compareLabel'] }),
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole('checkbox', { name: ptBRMessages['analytics.period.compareLabel'] }),
        ).toBeChecked(),
      { timeout: 5000 },
    );
    expect(screen.getAllByText(/Período anterior:/).length).toBeGreaterThan(0);

    // 4. Period preset switching + CUSTOM invalid range + CUSTOM future range rendering UNAVAILABLE (never implicit 0)
    await user.selectOptions(
      screen.getByLabelText(ptBRMessages['analytics.period.presetLabel']),
      'LAST_7_DAYS',
    );
    await waitFor(
      () =>
        expect(screen.getByLabelText(ptBRMessages['analytics.period.presetLabel'])).toHaveValue(
          'LAST_7_DAYS',
        ),
      { timeout: 5000 },
    );

    await user.selectOptions(
      screen.getByLabelText(ptBRMessages['analytics.period.presetLabel']),
      'CUSTOM',
    );
    const startInput = await screen.findByLabelText(
      ptBRMessages['analytics.period.customStartLabel'],
      {},
      { timeout: 5000 },
    );
    const endInput = screen.getByLabelText(ptBRMessages['analytics.period.customEndLabel']);

    // Invalid range (start > end) shows validation alert
    fireEvent.change(startInput, { target: { value: '2030-05-10' } });
    fireEvent.change(endInput, { target: { value: '2030-05-01' } });
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.period.applyAction'] }),
    );
    expect(
      await screen.findByText(ptBRMessages['analytics.period.invalidRangeError']),
    ).toBeInTheDocument();

    // Valid empty future range triggers UNAVAILABLE badges & explicit reasons
    fireEvent.change(screen.getByLabelText(ptBRMessages['analytics.period.customStartLabel']), {
      target: { value: '2030-01-01' },
    });
    fireEvent.change(screen.getByLabelText(ptBRMessages['analytics.period.customEndLabel']), {
      target: { value: '2030-01-31' },
    });
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.period.applyAction'] }),
    );

    const unavailableBadges = await screen.findAllByText(
      /Indisponível \(UNAVAILABLE\)/,
      {},
      { timeout: 5000 },
    );
    expect(unavailableBadges.length).toBeGreaterThanOrEqual(3);
    expect(
      screen.getAllByText(ptBRMessages['analytics.metric.unavailableNotice']).length,
    ).toBeGreaterThanOrEqual(3);
    expect(await axe(container)).toHaveNoViolations();

    // Restore LAST_30_DAYS for populated charts/widgets
    await user.selectOptions(
      screen.getByLabelText(ptBRMessages['analytics.period.presetLabel']),
      'LAST_30_DAYS',
    );
    await waitFor(
      () =>
        expect(screen.getByLabelText(ptBRMessages['analytics.period.presetLabel'])).toHaveValue(
          'LAST_30_DAYS',
        ),
      { timeout: 5000 },
    );

    // 5. Widget customization draft: move + hide -> unsaved warning -> Discard -> Edit -> Save -> Restore default
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.dashboard.editAction'] }),
    );
    expect(await axe(container)).toHaveNoViolations();

    const moveDownBtns = screen.getAllByRole('button', { name: /Mover widget .* para baixo/i });
    expect(moveDownBtns.length).toBeGreaterThan(0);
    await user.click(moveDownBtns[0]!);

    const widgetCheckboxes = screen.getAllByRole('checkbox', { name: /Exibir widget/i });
    await user.click(widgetCheckboxes[0]!);
    expect(
      screen.getByText(ptBRMessages['analytics.dashboard.unsavedChangesWarning']),
    ).toBeInTheDocument();

    // Discard restores original without saving
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.dashboard.discardAction'] }),
    );
    expect(
      screen.getByText(ptBRMessages['analytics.dashboard.discardedNotice']),
    ).toBeInTheDocument();
    expect(screen.getByText(ptBRMessages['analytics.dashboard.defaultBadge'])).toBeInTheDocument();

    // Edit again and Save
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.dashboard.editAction'] }),
    );
    await user.click(screen.getAllByRole('checkbox', { name: /Exibir widget/i })[0]!);
    await user.click(
      screen.getByRole('button', { name: ptBRMessages['analytics.dashboard.saveAction'] }),
    );
    expect(
      (await screen.findAllByText(ptBRMessages['analytics.dashboard.saveSuccess'])).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(ptBRMessages['analytics.dashboard.customBadge'])).toBeInTheDocument();

    // Restore default
    await user.click(
      screen.getByRole('button', {
        name: ptBRMessages['analytics.dashboard.restoreDefaultAction'],
      }),
    );
    expect(
      (await screen.findAllByText(ptBRMessages['analytics.dashboard.restoreSuccess'])).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole('heading', { level: 2, name: ptBRMessages['analytics.flow.title'] }),
    ).toBeInTheDocument();

    // 6. Navigate across tabs (including Feedbacks & Workload/Bottlenecks & ADMIN Calibration)
    await user.click(screen.getByRole('tab', { name: ptBRMessages['analytics.tabs.feedback'] }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: ptBRMessages['analytics.feedback.title'],
      }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(
      screen.getByRole('tab', { name: ptBRMessages['analytics.tabs.workloadBottlenecks'] }),
    );
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: ptBRMessages['analytics.workload.title'],
      }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // 7. Calibration tab (ADMIN): sum != 100% error -> valid sum = 100% save
    await user.click(screen.getByRole('tab', { name: ptBRMessages['analytics.tabs.calibration'] }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: ptBRMessages['analytics.calibration.title'],
      }),
    ).toBeInTheDocument();

    const priorityInput = screen.getByLabelText(
      ptBRMessages['analytics.calibration.workloadPriorityWeightLabel'],
    );
    const delayInput = screen.getByLabelText(
      ptBRMessages['analytics.calibration.workloadDelayWeightLabel'],
    );
    const impedimentsInput = screen.getByLabelText(
      ptBRMessages['analytics.calibration.workloadImpedimentsWeightLabel'],
    );
    const stateInput = screen.getByLabelText(
      ptBRMessages['analytics.calibration.workloadOperationalStateWeightLabel'],
    );
    const saveCalBtn = screen.getByRole('button', {
      name: ptBRMessages['analytics.calibration.saveAction'],
    });

    // Invalid sum != 100%
    fireEvent.change(priorityInput, { target: { value: '0.9' } });
    expect(
      await screen.findByText(ptBRMessages['analytics.calibration.sumMismatchError']),
    ).toBeInTheDocument();
    expect(saveCalBtn).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();

    // Valid sum = 100% (0.4 + 0.25 + 0.2 + 0.15 = 1.0)
    fireEvent.change(priorityInput, { target: { value: '0.4' } });
    fireEvent.change(delayInput, { target: { value: '0.25' } });
    fireEvent.change(impedimentsInput, { target: { value: '0.2' } });
    fireEvent.change(stateInput, { target: { value: '0.15' } });
    await waitFor(() => expect(saveCalBtn).toBeEnabled());

    const thresholdInput = screen.getByLabelText(
      ptBRMessages['analytics.calibration.inactivityThresholdLabel'],
    );
    fireEvent.change(thresholdInput, { target: { value: '14' } });
    await user.type(
      screen.getByLabelText(ptBRMessages['analytics.calibration.justificationLabel']),
      'Ajuste trimestral UI',
    );
    await user.click(saveCalBtn);

    expect(
      (await screen.findAllByText(ptBRMessages['analytics.calibration.saveSuccess'])).length,
    ).toBeGreaterThanOrEqual(1);
    expect(await axe(container)).toHaveNoViolations();
  }, 30000);

  it('exercises /reports catalog, filters, preview and Blob exports across JSON, CSV, PDF and XLSX with 0 axe violations, plus MEMBER privacy restrictions on /projects/:projectId/analytics', async () => {
    const user = userEvent.setup();
    const { container, router } = await renderIsolatedApp('/demo');
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });

    // 1. Enter as ADMIN -> /reports full catalog, filters, preview and 4 Blob exports
    await user.click(screen.getByRole('button', { name: 'Entrar como Administrador' }));
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['organizations.title'] });

    await router.navigate('/reports');
    // Empty preview state passes axe (wait for loaded ReportsPanel instead of loading h1)
    expect(
      await screen.findByText(ptBRMessages['reports.preview.emptyTitle'], {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Switch catalog model to ORGANIZATION_EXECUTIVE_SUMMARY, change preset & compare toggle, preview
    await user.click(
      screen.getByRole('button', {
        name: ptBRMessages['reports.kind.ORGANIZATION_EXECUTIVE_SUMMARY.title'],
      }),
    );
    const scopeSelect = screen.getByLabelText(ptBRMessages['reports.filters.scopeLabel']);
    expect(scopeSelect).toHaveValue('ORGANIZATION');

    const presetSelect = screen.getByLabelText(ptBRMessages['reports.filters.presetLabel']);
    await user.selectOptions(presetSelect, 'LAST_90_DAYS');
    expect(presetSelect).toHaveValue('LAST_90_DAYS');

    await user.click(
      screen.getByRole('button', { name: ptBRMessages['reports.filters.previewAction'] }),
    );
    expect(
      await screen.findByText(ptBRMessages['reports.preview.parityNotice']),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Export all 4 formats (JSON, CSV, PDF, XLSX) and inspect generated Blobs
    const capturedBlobs: Blob[] = [];
    const origCreateUrl = URL.createObjectURL;
    const origRevokeUrl = URL.revokeObjectURL;
    const createUrlMock = vi.fn((obj: Blob | MediaSource) => {
      if (obj instanceof Blob) {
        capturedBlobs.push(obj);
      }
      return `blob:test-${capturedBlobs.length}`;
    });
    const revokeUrlMock = vi.fn();
    URL.createObjectURL = createUrlMock;
    URL.revokeObjectURL = revokeUrlMock;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    try {
      const formatButtons = [
        {
          label: ptBRMessages['reports.export.format.JSON'],
          mime: 'application/json',
        },
        {
          label: ptBRMessages['reports.export.format.CSV'],
          mime: 'text/csv',
        },
        {
          label: ptBRMessages['reports.export.format.PDF'],
          mime: 'application/pdf',
        },
        {
          label: ptBRMessages['reports.export.format.XLSX'],
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ] as const;

      for (let i = 0; i < formatButtons.length; i += 1) {
        const fmt = formatButtons[i]!;
        await user.click(screen.getByRole('button', { name: fmt.label }));
        await waitFor(() => expect(createUrlMock).toHaveBeenCalledTimes(i + 1));
        expect(capturedBlobs[i]?.type).toBe(fmt.mime);
        expect(capturedBlobs[i]?.size).toBeGreaterThan(0);
      }

      expect(revokeUrlMock).toHaveBeenCalledTimes(4);
      expect(clickSpy).toHaveBeenCalledTimes(4);
    } finally {
      URL.createObjectURL = origCreateUrl;
      URL.revokeObjectURL = origRevokeUrl;
    }

    expect(await axe(container)).toHaveNoViolations();

    // 2. Switch to MEMBER and verify RBAC restrictions + 0 axe violations on /projects/:projectId/analytics
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.login.title'] });
    await router.navigate('/demo');
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['auth.demo.title'] });
    await user.click(screen.getByRole('button', { name: 'Entrar como Membro' }));
    await screen.findByRole('heading', { level: 1, name: ptBRMessages['organizations.title'] });

    await router.navigate('/analytics');
    const memberOrgBtn = await screen.findByRole(
      'button',
      { name: ptBRMessages['analytics.scope.ORGANIZATION'] },
      { timeout: 5000 },
    );
    expect(memberOrgBtn).toBeDisabled();
    expect(
      screen.queryByRole('tab', { name: ptBRMessages['analytics.tabs.calibration'] }),
    ).toBeNull();

    await router.navigate(`/projects/${DEMO_PROJECT_ID}/analytics`);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Analytics do projeto/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(ptBRMessages['analytics.workload.privacyNotice']),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  }, 30000);
});
