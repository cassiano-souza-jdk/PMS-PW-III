import { expect, test } from '@playwright/test';

test.describe('PMS Phase 10 — Analytics, Dashboards Customization, Calibration & Reports E2E', () => {
  test('ADMIN navigates via AppShell to /analytics (PERSONAL/ORGANIZATION), accesses /projects/:id/analytics via Kanban shortcut, customizes widgets (Discard/Save/Restore), calibrates rules, previews & downloads reports with zero native dialogs or console/page errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];
    const nativeDialogs: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      } else if (message.type() === 'warning') {
        consoleWarnings.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('dialog', async (dialog) => {
      nativeDialogs.push(`${dialog.type()}:${dialog.message()}`);
      await dialog.dismiss();
    });

    await page.addInitScript(() => {
      Reflect.set(window, '__pmsNativeConfirmCount', 0);
      Reflect.set(window, '__pmsNativeAlertCount', 0);
      window.confirm = () => {
        const current = Number(Reflect.get(window, '__pmsNativeConfirmCount') ?? 0);
        Reflect.set(window, '__pmsNativeConfirmCount', current + 1);
        return false;
      };
      window.alert = () => {
        const current = Number(Reflect.get(window, '__pmsNativeAlertCount') ?? 0);
        Reflect.set(window, '__pmsNativeAlertCount', current + 1);
      };
    });

    // 1. /demo -> Autenticação como ADMIN
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Administrador' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });

    // 2. Navegação via AppShell para /analytics (PERSONAL -> ORGANIZATION)
    await primaryNav.getByRole('link', { name: 'Analytics e Dashboards' }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Analytics e Dashboards' }),
    ).toBeVisible();

    const personalScopeBtn = page.getByRole('button', { name: 'Pessoal', exact: true });
    const orgScopeBtn = page.getByRole('button', { name: 'Organização', exact: true });
    await expect(personalScopeBtn).toHaveAttribute('aria-pressed', 'true');

    await orgScopeBtn.click();
    await expect(orgScopeBtn).toHaveAttribute('aria-pressed', 'true');

    // Alternar tabela de dados acessível pareada com gráfico Recharts
    const hideTableBtn = page
      .getByRole('button', { name: 'Ocultar tabela de dados equivalente' })
      .first();
    await expect(hideTableBtn).toBeVisible();
    await hideTableBtn.click();
    const showTableBtn = page
      .getByRole('button', { name: 'Exibir tabela de dados equivalente' })
      .first();
    await expect(showTableBtn).toHaveAttribute('aria-expanded', 'false');
    await showTableBtn.click();

    // 3. Personalização de widgets: Descartar -> Salvar -> Restaurar padrão
    await page.getByRole('button', { name: 'Editar dashboard' }).click();
    await page
      .getByRole('checkbox', { name: /Exibir widget/i })
      .first()
      .click();
    await expect(
      page.getByText(
        'Existem alterações não salvas no layout deste dashboard. Clique em "Salvar" ou "Descartar" antes de sair.',
      ),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByText('Alterações do rascunho descartadas.').first()).toBeVisible();
    await expect(page.getByText('Layout padrão', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Editar dashboard' }).click();
    await page
      .getByRole('checkbox', { name: /Exibir widget/i })
      .first()
      .click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(
      page.getByText('Preferências do dashboard salvas com sucesso.').first(),
    ).toBeVisible();
    await expect(page.getByText('Layout personalizado', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Restaurar padrão' }).click();
    await expect(
      page.getByText('Layout padrão do dashboard restaurado com sucesso.').first(),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Indicadores oficiais de fluxo e entregas' }),
    ).toBeVisible();

    // 4. Aba de Calibração (ADMIN): erro soma != 100% e gravação válida soma = 100%
    await page.getByRole('tab', { name: 'Calibração (ADMIN)' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Calibração de regras e pesos de Analytics' }),
    ).toBeVisible();

    await page.getByLabel('Peso de prioridade', { exact: true }).fill('0.9');
    await expect(
      page.getByText('A soma dos pesos do grupo deve ser exatamente 100% (1,00).').first(),
    ).toBeVisible();
    const saveCalBtn = page.getByRole('button', { name: 'Salvar calibração' });
    await expect(saveCalBtn).toBeDisabled();

    await page.getByLabel('Peso de prioridade', { exact: true }).fill('0.4');
    await page.getByLabel('Peso de atraso e prazo').fill('0.25');
    await page.getByLabel('Peso de impedimentos').fill('0.2');
    await page.getByLabel('Peso de estado operacional').fill('0.15');
    await expect(saveCalBtn).toBeEnabled();

    await page.getByLabel('Justificativa da calibração (opcional)').fill('Calibracao E2E Fase 10');
    await saveCalBtn.click();
    await expect(
      page
        .getByText('Pesos de calibração salvos com sucesso e registrados na trilha de auditoria.')
        .first(),
    ).toBeVisible();

    // 5. Acessar /projects/:projectId/analytics via atalho no Quadro Kanban
    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('button', { name: 'Abrir quadro Kanban' }).last().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);

    await page.getByRole('link', { name: 'Ver analytics do projeto' }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/analytics$/);
    await expect(
      page.getByRole('heading', { level: 1, name: /Analytics do projeto/ }),
    ).toBeVisible();

    // 6. Navegar via AppShell para /reports, gerar prévia e baixar exportação
    await primaryNav.getByRole('link', { name: 'Relatórios' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeVisible();

    await page.getByRole('button', { name: 'Resumo Executivo Organizacional' }).click();
    await page.getByRole('button', { name: 'Gerar pré-visualização' }).click();
    await expect(
      page.getByText(
        'Paridade pré-visualização ↔ exportação: o arquivo baixado é gerado exatamente a partir do mesmo snapshot, filtros e decisões de autorização desta pré-visualização.',
      ),
    ).toBeVisible();

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar JSON' }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toMatch(
      /^organization-executive-summary-[0-9a-f-]+\.json$/,
    );

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar XLSX' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(
      /^organization-executive-summary-[0-9a-f-]+\.xlsx$/,
    );

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar PDF' }).click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toMatch(
      /^organization-executive-summary-[0-9a-f-]+\.pdf$/,
    );

    // 7. Invariantes finais
    const nativeDialogCounters = await page.evaluate(() => ({
      confirmCalls: Number(Reflect.get(window, '__pmsNativeConfirmCount') ?? 0),
      alertCalls: Number(Reflect.get(window, '__pmsNativeAlertCount') ?? 0),
    }));
    expect(nativeDialogCounters.confirmCalls).toBe(0);
    expect(nativeDialogCounters.alertCalls).toBe(0);
    expect(nativeDialogs).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect([...consoleErrors, ...consoleWarnings].join('\n')).not.toContain('MISSING_TRANSLATION');
    expect(pageErrors).toEqual([]);
  });

  test('MEMBER visualiza isolamento RBAC/Default Deny em /analytics, /projects/:id/analytics (via atalho em /projects) e /reports', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      } else if (message.type() === 'warning') {
        consoleWarnings.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto('/demo');
    await page.getByRole('button', { name: 'Entrar como Membro' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await primaryNav.getByRole('link', { name: 'Analytics e Dashboards' }).click();
    await expect(page).toHaveURL(/\/analytics$/);

    await expect(page.getByRole('button', { name: 'Organização', exact: true })).toBeDisabled();
    await expect(page.getByRole('tab', { name: 'Calibração (ADMIN)' })).toHaveCount(0);

    // Acesso via atalho na página de Projetos
    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('link', { name: 'Ver analytics do projeto' }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/analytics$/);
    await expect(
      page.getByText(
        'Política de privacidade (Default Deny): métricas individuais nominais de terceiros permanecem ocultas quando allowManagerViewIndividualProductivity está desativada.',
      ),
    ).toBeVisible();

    // Relatórios como MEMBER: prévia de Produtividade oculta dados nominais de terceiros + exportação CSV funciona
    await primaryNav.getByRole('link', { name: 'Relatórios' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await page.getByRole('button', { name: 'Produtividade e Carga' }).click();
    await page.getByRole('button', { name: 'Gerar pré-visualização' }).click();
    await expect(
      page.getByText(
        'Privacidade ativa (allowManagerViewIndividualProductivity / Default Deny): métricas nominais individuais de terceiros foram omitidas deste relatório.',
      ),
    ).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/^productivity-workload-[0-9a-f-]+\.csv$/);

    expect(consoleErrors).toEqual([]);
    expect([...consoleErrors, ...consoleWarnings].join('\n')).not.toContain('MISSING_TRANSLATION');
    expect(pageErrors).toEqual([]);
  });
});
