import { expect, test } from '@playwright/test';

test.describe('PMS Phase 08 — Focus Mode, Workload 0-100, Bottlenecks & DN-06 Settings E2E', () => {
  test('ADMIN runs full Focus Mode (/focus), Project Bottlenecks (/projects/:id/bottlenecks) and DN-06 Settings (/settings) flows with zero native dialogs or console/page errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const nativeDialogs: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
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

    // 2. Navegação para /focus
    await primaryNav.getByRole('link', { name: 'Modo Foco' }).click();
    await expect(page).toHaveURL(/\/focus$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Modo Foco' })).toBeVisible();
    await expect(
      page.getByText(
        'Importante: a pontuação de 0 a 100 é um índice operacional ponderado e NÃO representa horas alocadas ou trabalhadas.',
      ),
    ).toBeVisible();

    // Alterna AUTO -> MANUAL -> AUTO
    await page.getByRole('button', { name: 'Usar ordenação manual' }).click();
    await expect(page.getByText('Manual (ordem personalizada)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Usar ordenação automática' }).click();
    await expect(
      page.getByText('Automático (ranqueamento inteligente)', { exact: true }),
    ).toBeVisible();

    // Reordena por botões Descer e Subir (com 2 tarefas não fixadas)
    await page.getByRole('button', { name: 'Descer na ordem manual' }).first().click();
    await expect(page.getByText('Manual (ordem personalizada)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Subir na ordem manual' }).nth(1).click();
    await expect(page.getByText(/movida para a posição 1/).first()).toBeVisible();

    // Fixar e Desfixar
    await page.getByRole('button', { name: 'Fixar no topo' }).first().click();
    await expect(page.getByText('Fixada', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Desfixar' }).first().click();
    await expect(page.getByText('Fixada', { exact: true })).toHaveCount(0);

    // Ocultar e Restaurar ocultas
    await page.getByRole('button', { name: 'Ocultar do foco' }).first().click();
    await expect(page.getByRole('heading', { name: 'Tarefas ocultas (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Restaurar todas as ocultas' }).click();
    await expect(page.getByRole('heading', { name: 'Tarefas ocultas (0)' })).toBeVisible();

    // Resetar preferências via ModalDialog
    await page.getByRole('button', { name: 'Resetar preferências do Modo Foco' }).click();
    const resetDialog = page.getByRole('dialog');
    await expect(resetDialog).toBeVisible();
    await resetDialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page.getByText('Preferências do Modo Foco redefinidas com sucesso.').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Automático (ranqueamento inteligente)', { exact: true }),
    ).toBeVisible();

    // 3. Navegação /projects -> /board (atinge WIP 2/2 em Em Revisao) -> /projects/:projectId/bottlenecks
    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('button', { name: 'Abrir quadro Kanban' }).last().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);

    const foundationCard = page.locator('article').filter({
      has: page.getByRole('heading', {
        level: 3,
        name: 'Validar persistencia local Dexie e isolamento multi-organizacao',
      }),
    });
    const foundationSelect = foundationCard.getByLabel('Mover para coluna');
    const reviewColValue = await foundationSelect
      .locator('option', { hasText: 'Em Revisao' })
      .getAttribute('value');
    expect(reviewColValue).toBeTruthy();
    await foundationSelect.selectOption(reviewColValue ?? '');

    const kanbanFlowCard = page.locator('article').filter({
      has: page.getByRole('heading', {
        level: 3,
        name: 'Revisar limites de WIP e fluxo operacional do quadro Kanban',
      }),
    });
    await kanbanFlowCard.getByLabel('Mover para coluna').selectOption(reviewColValue ?? '');

    const reviewColumnSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Em Revisao' }) });
    await expect(reviewColumnSection.getByText('WIP: 2/2')).toBeVisible();

    await page.getByRole('link', { name: 'Gargalos do projeto' }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/bottlenecks$/);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Gargalos — Lancamento Plataforma PMS v1' }),
    ).toBeVisible();
    await expect(page.getByText(/Membros em sobrecarga no projeto \(anonimizado\):/)).toBeVisible();

    // Analisar gargalos agora
    await page.getByRole('button', { name: 'Analisar gargalos agora' }).click();
    await expect(page.getByText(/Análise concluída:/).first()).toBeVisible();

    // Reconhecer alerta via ModalDialog
    await page.getByRole('button', { name: 'Reconhecer' }).first().click();
    const ackDialog = page.getByRole('dialog');
    await expect(ackDialog).toBeVisible();
    await ackDialog
      .getByLabel('Observação operacional (opcional)')
      .fill('Ciência registrada via E2E');
    await ackDialog.getByRole('button', { name: 'Confirmar reconhecimento' }).click();
    await expect(page.getByText('Alerta reconhecido com sucesso.').first()).toBeVisible();

    // Resolver alerta via ModalDialog
    await page.getByRole('button', { name: 'Resolver' }).first().click();
    const resolveDialog = page.getByRole('dialog');
    await expect(resolveDialog).toBeVisible();
    await resolveDialog
      .getByLabel('Observação operacional (opcional)')
      .fill('Resolvido após triagem E2E');
    await resolveDialog.getByRole('button', { name: 'Confirmar resolução' }).click();
    await expect(page.getByText('Alerta resolvido com sucesso.').first()).toBeVisible();

    // Atualiza limiares do projeto
    const wipInput = page.getByLabel(/Ocupação preventiva de WIP \(%\)/);
    await wipInput.fill('85');
    await page.getByRole('button', { name: 'Salvar regras de gargalo' }).click();
    await expect(
      page.getByText('Regras e limiares de gargalo atualizados com sucesso.').first(),
    ).toBeVisible();

    // 4. Navega para /settings como ADMIN e alterna allowManagerViewIndividualProductivity
    await primaryNav.getByRole('link', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/\/settings$/);

    const visibilityCheckbox = page.getByRole('checkbox', {
      name: 'Permitir que Gestores visualizem produtividade e sobrecarga individual de terceiros',
    });
    await expect(visibilityCheckbox).not.toBeChecked();
    await visibilityCheckbox.check();
    await page
      .getByLabel('Justificativa da política (opcional)')
      .fill('Liberação auditada via E2E');
    await page.getByRole('button', { name: 'Salvar política de visibilidade' }).click();
    await expect(
      page.getByText('Política de visibilidade individual atualizada com sucesso.').first(),
    ).toBeVisible();
    await expect(visibilityCheckbox).toBeChecked();

    const nativeDialogCounters = await page.evaluate(() => ({
      confirmCalls: Number(Reflect.get(window, '__pmsNativeConfirmCount') ?? 0),
      alertCalls: Number(Reflect.get(window, '__pmsNativeAlertCount') ?? 0),
    }));
    expect(nativeDialogCounters.confirmCalls).toBe(0);
    expect(nativeDialogCounters.alertCalls).toBe(0);
    expect(nativeDialogs).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('MANAGER visualiza Default Deny (overloadedMemberCount anonimizado sem métricas individuais de terceiros) em /projects/:id/bottlenecks e /bottlenecks', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const nativeDialogs: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
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

    await page.goto('/demo');
    await page.getByRole('button', { name: 'Entrar como Gestor' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await primaryNav.getByRole('link', { name: 'Gargalos' }).click();
    await expect(page).toHaveURL(/\/bottlenecks$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Gargalos da organização' }),
    ).toBeVisible();

    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('link', { name: 'Gargalos do projeto' }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/bottlenecks$/);

    await expect(
      page.getByText(
        'Privacidade ativa (Default Deny): alertas individuais de sobrecarga de terceiros estão ocultos; apenas a contagem agregada anonimizada é exibida.',
      ),
    ).toBeVisible();
    await expect(page.getByText(/Membros em sobrecarga no projeto \(anonimizado\):/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Carga individual dos membros' })).toHaveCount(
      0,
    );

    const nativeDialogCounters = await page.evaluate(() => ({
      confirmCalls: Number(Reflect.get(window, '__pmsNativeConfirmCount') ?? 0),
      alertCalls: Number(Reflect.get(window, '__pmsNativeAlertCount') ?? 0),
    }));
    expect(nativeDialogCounters.confirmCalls).toBe(0);
    expect(nativeDialogCounters.alertCalls).toBe(0);
    expect(nativeDialogs).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
