import { expect, test } from '@playwright/test';

test.describe('PMS Phase 07 — Tasks, Dependencies & Impediments E2E', () => {
  test('ADMIN navigates /projects -> /board -> /tasks, runs full task lifecycle (start, pause, resume, subtasks, comment, attachment upload/download, dependency, blocking impediment, complete, reopen) with zero native dialogs or console/page errors', async ({
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
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Administrador' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.getByRole('button', { name: 'Abrir quadro Kanban' }).last().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Quadro Kanban — Lancamento Plataforma PMS v1',
      }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Lista de tarefas' }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/tasks$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tarefas — Lancamento Plataforma PMS v1' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Nova tarefa' }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Título da tarefa').fill('Entrega E2E Fase 07');
    await createDialog.getByRole('button', { name: 'Criar tarefa' }).click();
    await expect(page.getByText('Tarefa "Entrega E2E Fase 07" criada com sucesso.')).toBeVisible();

    await page.getByRole('link', { name: 'Abrir detalhes de Entrega E2E Fase 07' }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/tasks\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Entrega E2E Fase 07' }),
    ).toBeVisible();

    // Inicia execução -> Pausa com justificativa -> Retoma
    await page.getByRole('button', { name: 'Iniciar execução' }).click();
    await expect(page.getByText('Execução da tarefa iniciada com sucesso.')).toBeVisible();

    await page.getByRole('button', { name: 'Pausar tarefa' }).click();
    const pauseDialog = page.getByRole('dialog');
    await pauseDialog.getByLabel('Motivo da pausa').fill('Pausa para validação E2E');
    await pauseDialog.getByRole('button', { name: 'Confirmar pausa' }).click();
    await expect(page.getByText('Tarefa pausada com sucesso.')).toBeVisible();

    await page.getByRole('button', { name: 'Retomar execução' }).click();
    await expect(page.getByText('Tarefa retomada com sucesso.')).toBeVisible();

    // Subtarefas: cria 2, reordena (Cima) e conclui ambas
    await page.getByRole('tab', { name: /Subtarefas/ }).click();
    await page.getByLabel('Título da subtarefa').fill('Subtarefa E2E 1');
    await page.getByRole('button', { name: 'Adicionar subtarefa' }).click();
    await expect(
      page.getByText('Subtarefa "Subtarefa E2E 1" adicionada com sucesso.'),
    ).toBeVisible();

    await page.getByLabel('Título da subtarefa').fill('Subtarefa E2E 2');
    await page.getByRole('button', { name: 'Adicionar subtarefa' }).click();
    await expect(
      page.getByText('Subtarefa "Subtarefa E2E 2" adicionada com sucesso.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Subir ordem da subtarefa: Subtarefa E2E 2' }).click();
    await expect(page.getByText('Ordem das subtarefas atualizada.').first()).toBeVisible();

    const subtasksPanel = page.getByRole('tabpanel', { name: /Subtarefas/ });
    await expect(subtasksPanel.getByRole('listitem').first()).toContainText('Subtarefa E2E 2');

    await subtasksPanel.getByRole('button', { name: 'Concluir subtarefa' }).first().click();
    await expect(page.getByText('Subtarefa "Subtarefa E2E 2" concluída.')).toBeVisible();

    await subtasksPanel.getByRole('button', { name: 'Concluir subtarefa' }).first().click();
    await expect(page.getByText('Subtarefa "Subtarefa E2E 1" concluída.')).toBeVisible();

    // Comentário
    await page.getByRole('tab', { name: /Comentários/ }).click();
    await page.getByLabel('Novo comentário').fill('Comentário E2E validado');
    await page.getByRole('button', { name: 'Publicar comentário' }).click();
    await expect(page.getByText('Comentário publicado com sucesso.')).toBeVisible();
    await expect(page.getByText('Comentário E2E validado')).toBeVisible();

    // Anexo: upload, checksum SHA-256 e download real
    await page.getByRole('tab', { name: /Anexos/ }).click();
    await page.getByLabel('Selecionar arquivo para anexar').setInputFiles({
      name: 'evidencia-e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Conteúdo binário E2E Fase 07', 'utf-8'),
    });
    await page.getByRole('button', { name: 'Anexar arquivo' }).click();
    await expect(page.getByText('Arquivo "evidencia-e2e.txt" anexado com sucesso.')).toBeVisible();
    await expect(page.getByText(/SHA-256: [0-9a-f]{64}/)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Baixar anexo' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('evidencia-e2e.txt');

    // Registra dependência obrigatória e remove
    await page.getByRole('tab', { name: /Dependências/ }).click();
    await page
      .getByLabel('Tarefa pré-requisito')
      .selectOption('11111111-1111-4111-8111-111111111801');
    await page.getByRole('button', { name: 'Adicionar dependência' }).click();
    await expect(page.getByText('Dependência adicionada com sucesso.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Remover dependência' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover dependência' }).click();
    await expect(page.getByText('Dependência removida com sucesso.').first()).toBeVisible();

    // Abre e resolve impedimento sem concluir tarefa automaticamente
    await page.getByRole('tab', { name: /Impedimentos/ }).click();
    await page.getByLabel('Descrição do impedimento').fill('Aguardando aprovação de segurança E2E');
    await page.getByRole('button', { name: 'Registrar impedimento' }).click();
    await expect(page.getByText('Impedimento registrado com sucesso.').first()).toBeVisible();
    await expect(
      page
        .getByRole('tabpanel', { name: /Impedimentos/ })
        .getByText('Bloqueante')
        .first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Iniciar resolução' }).click();
    await expect(
      page.getByText('Status do impedimento atualizado para Em resolução.').first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Marcar como resolvido' }).click();
    const resolveDialog = page.getByRole('dialog');
    await expect(
      resolveDialog.getByText(
        'Nota: resolver ou cancelar um impedimento desbloqueia a tarefa sem concluí-la automaticamente.',
      ),
    ).toBeVisible();
    await resolveDialog
      .getByLabel('Nota de resolução ou cancelamento (opcional)')
      .fill('Aprovação concluída');
    await resolveDialog.getByRole('button', { name: 'Marcar como resolvido' }).click();
    await expect(
      page.getByText('Status do impedimento atualizado para Resolvido.').first(),
    ).toBeVisible();
    await expect(page.getByText('Em execução').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Concluir tarefa' })).toBeVisible();

    // Conclui tarefa após desbloqueio e reabre verificando Ciclo #1, Ciclo #2 e pausa preservada
    await page.getByRole('button', { name: 'Concluir tarefa' }).click();
    await expect(page.getByText('Tarefa concluída com sucesso.')).toBeVisible();

    await page.getByRole('button', { name: 'Reabrir tarefa' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar reabertura' }).click();
    await expect(page.getByText('Tarefa reaberta em um novo ciclo de execução.')).toBeVisible();

    await page.getByRole('tab', { name: 'Ciclos e prazos' }).click();
    await expect(page.getByText('Ciclo #1')).toBeVisible();
    await expect(page.getByText('Ciclo #2')).toBeVisible();
    await expect(page.getByText(/Pausa para validação E2E/)).toBeVisible();

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
