import { expect, test } from '@playwright/test';

test.describe('PMS Phase 07 — Tasks, Dependencies & Impediments E2E', () => {
  test('ADMIN navigates to project task list, creates task, manages dependencies, opens and resolves blocking impediment without auto-completing, and completes/reopens task', async ({
    page,
  }) => {
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Administrador' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);

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

    // Inicia execução
    await page.getByRole('button', { name: 'Iniciar execução' }).click();
    await expect(page.getByText('Execução da tarefa iniciada com sucesso.')).toBeVisible();

    // Registra dependência obrigatória
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

    // Conclui tarefa após desbloqueio e reabre verificando Ciclo #2
    await page.getByRole('button', { name: 'Concluir tarefa' }).click();
    await expect(page.getByText('Tarefa concluída com sucesso.')).toBeVisible();

    await page.getByRole('button', { name: 'Reabrir tarefa' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar reabertura' }).click();
    await expect(page.getByText('Tarefa reaberta em um novo ciclo de execução.')).toBeVisible();

    await page.getByRole('tab', { name: 'Ciclos e prazos' }).click();
    await expect(page.getByText('Ciclo #1')).toBeVisible();
    await expect(page.getByText('Ciclo #2')).toBeVisible();
  });
});
