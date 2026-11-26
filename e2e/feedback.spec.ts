import { expect, test } from '@playwright/test';

test.describe('PMS Phase 09 — Feedbacks, SLA, Segregation, Governance & Contestation E2E', () => {
  test('MEMBER creates feedback with attachment (internal notes hidden) -> ADMIN checks governance & creates internal note + WAITING_INFO -> MEMBER replies to auto-resume -> ADMIN resolves -> MEMBER contests -> ADMIN delegates -> MANAGER analyzes -> ADMIN accepts & spawns Cycle #2 with zero native dialogs or console/page errors', async ({
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

    async function switchDemoRole(
      buttonName: 'Entrar como Membro' | 'Entrar como Administrador' | 'Entrar como Gestor',
    ): Promise<void> {
      await page.getByRole('button', { name: 'Sair' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto('/demo');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
      ).toBeVisible();
      await page.getByRole('button', { name: buttonName }).click();
      await expect(page).toHaveURL(/\/organizations$/);
    }

    // 1. MEMBER entra pela Demo, acessa /feedback, verifica ausência de atalho de governança e cria novo feedback
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Membro' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await primaryNav.getByRole('link', { name: 'Feedbacks' }).click();
    await expect(page).toHaveURL(/\/feedback$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Feedbacks e suporte organizacional' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Governança de feedbacks' })).toBeHidden();

    await page.getByRole('button', { name: 'Novo feedback' }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Título').fill('Erro E2E no filtro de tarefas');
    await createDialog.getByLabel('Módulo relacionado').selectOption('tasks');
    await createDialog.getByLabel('Prioridade inicial').selectOption('HIGH');
    await createDialog
      .getByLabel('Descrição detalhada')
      .fill('Ao filtrar por prioridade no módulo de tarefas, o contador não atualiza.');
    await createDialog.getByRole('button', { name: 'Enviar feedback' }).click();
    await expect(page.getByText('Feedback registrado com sucesso.').first()).toBeVisible();

    const createdItem = page.locator('li', { hasText: 'Erro E2E no filtro de tarefas' });
    await createdItem.getByRole('link', { name: 'Abrir detalhes' }).click();
    await expect(page).toHaveURL(/\/feedback\/[0-9a-f-]+$/);
    const feedbackUrl = page.url();

    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notas internas restritas' })).toBeHidden();

    // MEMBER envia anexo público válido + realiza download
    await page.getByLabel('Selecionar arquivo').setInputFiles({
      name: 'evidencia-member.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Evidencia binaria E2E enviada pelo autor', 'utf-8'),
    });
    await page.getByRole('button', { name: 'Anexar arquivo' }).click();
    await expect(
      page.getByText('Anexo "evidencia-member.txt" enviado com sucesso.').first(),
    ).toBeVisible();
    await expect(page.getByText(/SHA-256: [0-9a-f]{64}/)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Baixar anexo' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('evidencia-member.txt');

    // 2. ADMIN acessa governança (/feedback/governance), dispara evaluate-sla e atende o feedback
    await switchDemoRole('Entrar como Administrador');
    await primaryNav.getByRole('link', { name: 'Feedbacks' }).click();
    await expect(page).toHaveURL(/\/feedback$/);

    await page.getByRole('link', { name: 'Governança de feedbacks' }).click();
    await expect(page).toHaveURL(/\/feedback\/governance$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Governança de feedbacks, catálogos e SLA' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Avaliar SLAs e prazos agora' }).click();
    await expect(page.getByText(/Avaliação concluída:/).first()).toBeVisible();

    // ADMIN abre o feedback do MEMBER, atribui ao MANAGER, registra nota interna e coloca em WAITING_INFO
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();

    const assignSelect = page.getByLabel('Responsável pelo atendimento');
    const managerAssignValue = await assignSelect
      .locator('option', { hasText: 'Bruno Gestor' })
      .getAttribute('value');
    expect(managerAssignValue).toBeTruthy();
    await assignSelect.selectOption(managerAssignValue ?? '');
    await page.getByRole('button', { name: 'Atribuir responsável' }).click();
    await expect(
      page.getByText('Responsável atribuído ao feedback com sucesso.').first(),
    ).toBeVisible();

    await page
      .getByLabel('Nova nota interna')
      .fill('Nota interna E2E: reproduzido no filtro de prioridade.');
    await page.getByRole('button', { name: 'Registrar nota interna' }).click();
    await expect(page.getByText('Nota interna registrada com sucesso.').first()).toBeVisible();

    await page.getByLabel('Próximo estado').selectOption('WAITING_INFO');
    await page.getByRole('button', { name: 'Atualizar estado' }).click();
    await expect(
      page.getByText('Estado do feedback atualizado para Aguardando informações.').first(),
    ).toBeVisible();
    await expect(page.getByText(/Pausado \(Aguardando informações\)/).first()).toBeVisible();

    // 3. MEMBER abre o feedback, confirma que a nota interna segue oculta e envia resposta retomando IN_PROGRESS
    await switchDemoRole('Entrar como Membro');
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notas internas restritas' })).toBeHidden();
    await expect(
      page.getByText('Nota interna E2E: reproduzido no filtro de prioridade.'),
    ).toBeHidden();

    await page
      .getByLabel('Nova mensagem formal')
      .fill('Segue contexto adicional: ocorre ao limpar filtros.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(
      page
        .getByText(
          'A resposta do autor retomou automaticamente o feedback de "Aguardando informações" para "Em atendimento", encerrando a pausa de SLA.',
        )
        .first(),
    ).toBeVisible();

    // 4. ADMIN resolve o feedback com descrição obrigatória
    await switchDemoRole('Entrar como Administrador');
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();

    await page.getByLabel('Próximo estado').selectOption('RESOLVED');
    await page
      .getByLabel('Descrição da resolução')
      .fill('Filtro de prioridade corrigido na listagem de tarefas.');
    await page.getByRole('button', { name: 'Atualizar estado' }).click();
    await expect(
      page.getByText('Estado do feedback atualizado para Resolvido.').first(),
    ).toBeVisible();

    // 5. MEMBER abre contestação
    await switchDemoRole('Entrar como Membro');
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();

    await page
      .getByLabel('Justificativa da contestação')
      .fill('O contador voltou a falhar após recarregar a fila.');
    await page.getByRole('button', { name: 'Abrir contestação' }).click();
    await expect(page.getByText('Contestação aberta com sucesso.').first()).toBeVisible();

    // 6. ADMIN delega análise para MANAGER -> MANAGER envia parecer -> ADMIN decide ACCEPT reabrindo Ciclo #2
    await switchDemoRole('Entrar como Administrador');
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();

    const delegateSelect = page.getByLabel('Analista delegado');
    const managerDelegateValue = await delegateSelect
      .locator('option', { hasText: 'Bruno Gestor' })
      .getAttribute('value');
    expect(managerDelegateValue).toBeTruthy();
    await delegateSelect.selectOption(managerDelegateValue ?? '');
    await page.getByRole('button', { name: 'Delegar análise' }).click();
    await expect(
      page.getByText('Análise delegada com sincronização atômica de permissão de análise.').first(),
    ).toBeVisible();

    await switchDemoRole('Entrar como Gestor');
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();

    await page
      .getByLabel('Fundamentação técnica do parecer')
      .fill('Comportamento verificado localmente sem reprodução da falha.');
    await page.getByRole('button', { name: 'Registrar parecer técnico' }).click();
    await expect(page.getByText('Parecer técnico registrado com sucesso.').first()).toBeVisible();

    await switchDemoRole('Entrar como Administrador');
    await page.goto(feedbackUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: /Erro E2E no filtro de tarefas/ }),
    ).toBeVisible();

    await page.getByLabel('Decisão final').selectOption('RESUME_SERVICE');
    await page
      .getByLabel('Justificativa da decisão administrativa')
      .fill('Evidência de regressão intermitente exige novo ciclo de atendimento.');
    await page.getByRole('button', { name: 'Decidir contestação' }).click();
    await expect(
      page.getByText('Decisão da contestação registrada com sucesso.').first(),
    ).toBeVisible();
    await expect(page.getByText('Decisão divergiu do parecer técnico')).toBeVisible();
    await expect(page.getByText('Ciclo #2')).toBeVisible();
    await expect(page.getByText('Reabertura por contestação')).toBeVisible();

    // 7. Invariantes finais: 0 diálogos nativos, 0 console.error, 0 MISSING_TRANSLATION, 0 pageerror
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
});
