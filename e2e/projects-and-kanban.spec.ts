import { expect, test } from '@playwright/test';

test.describe('PMS Phase 06 — Projects, Participants & Kanban Board E2E', () => {
  test('ADMIN creates project, adds participant, opens Kanban board, creates column, creates quick cards, executes accessible move with WIP override, verifies archived board lock and restores project', async ({
    page,
  }) => {
    // 1. Entra como ADMIN da organização demonstrativa via /demo
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Administrador' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });

    // 2. Navega para /projects e cria novo projeto
    await primaryNav.getByRole('link', { name: 'Projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Projetos da organização' }),
    ).toBeVisible();

    await page.locator('#create-project-name').fill('Portal Clientes E2E');
    await page
      .locator('#create-project-description')
      .fill('Projeto criado no fluxo E2E da Fase 06');
    await page.getByRole('button', { name: 'Criar projeto' }).click();

    await expect(page.getByText('Projeto "Portal Clientes E2E" criado com sucesso.')).toBeVisible();

    // Adiciona participante ativo da organização ao projeto criado
    const addParticipantSelect = page.locator('#add-project-participant-select');
    await expect(addParticipantSelect).toBeVisible();
    await addParticipantSelect.selectOption('11111111-1111-4111-8111-111111111203');
    await page.getByRole('button', { name: 'Adicionar ao projeto' }).click();
    await expect(page.getByText('Participante adicionado ao projeto com sucesso.')).toBeVisible();
    await expect(page.getByText('Participantes: 2').first()).toBeVisible();

    // Abre o quadro Kanban do projeto selecionado (Portal Clientes E2E)
    const projectDetailsCard = page.getByRole('button', { name: 'Abrir quadro Kanban' }).last();
    await projectDetailsCard.click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Quadro Kanban — Portal Clientes E2E' }),
    ).toBeVisible();

    // 3. Cria nova coluna operacional com limite WIP = 1
    await page.locator('#create-column-name').fill('Homologação E2E');
    await page.locator('#create-column-role').selectOption('OPERATIONAL');
    await page.locator('#create-column-wip').fill('1');
    await page.getByRole('button', { name: 'Criar coluna' }).click();

    await expect(page.getByText('Coluna "Homologação E2E" criada com sucesso.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Homologação E2E' })).toBeVisible();

    // 4. Cria dois cartões rápidos na coluna inicial
    await page.locator('#quick-card-title').fill('Entrega 01 E2E');
    await page.getByRole('button', { name: 'Criar cartão' }).click();
    await expect(page.getByText('Cartão "Entrega 01 E2E" criado com sucesso.')).toBeVisible();

    await page.locator('#quick-card-title').fill('Entrega 02 E2E');
    await page.getByRole('button', { name: 'Criar cartão' }).click();
    await expect(page.getByText('Cartão "Entrega 02 E2E" criado com sucesso.')).toBeVisible();

    // 5. Move o 1º cartão para Homologação E2E (ocupa WIP 1/1)
    const card1 = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { level: 3, name: 'Entrega 01 E2E' }) });
    const card1Select = card1.getByLabel('Mover para coluna');
    const homologacaoValue = await card1Select
      .locator('option', { hasText: 'Homologação E2E' })
      .getAttribute('value');
    expect(homologacaoValue).toBeTruthy();
    await card1Select.selectOption(homologacaoValue ?? '');

    // Confirma WIP 1/1 na coluna
    const homologacaoColumn = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Homologação E2E' }) });
    await expect(homologacaoColumn.getByText('WIP: 1/1')).toBeVisible();

    // 6. Move o 2º cartão para Homologação E2E acionando Exceção WIP inline
    const card2 = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { level: 3, name: 'Entrega 02 E2E' }) });
    await card2.getByLabel('Mover para coluna').selectOption(homologacaoValue ?? '');

    await expect(page.getByRole('heading', { name: 'Exceção de limite WIP' })).toBeVisible();
    await page
      .locator('#kanban-exception-justification')
      .fill('Entrega prioritária validada em conjunto');
    await page.getByRole('button', { name: 'Confirmar movimentação com exceção' }).click();

    await expect(homologacaoColumn.getByText('WIP: 2/1')).toBeVisible();
    await expect(homologacaoColumn.getByText('WIP excedido')).toBeVisible();

    // 7. Volta para /projects, arquiva o projeto e valida bloqueio no quadro
    await page.getByRole('button', { name: 'Voltar para projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await page
      .getByRole('button', { name: /Portal Clientes E2E/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Arquivar projeto' }).click();
    await expect(
      page.getByText('Projeto "Portal Clientes E2E" arquivado com sucesso.'),
    ).toBeVisible();

    await page.getByLabel('Incluir projetos arquivados').check();
    await page
      .getByRole('button', { name: /Portal Clientes E2E/ })
      .first()
      .click();
    await expect(
      page.getByText(
        'Este projeto está arquivado e permanece bloqueado para alterações operacionais.',
      ),
    ).toBeVisible();

    // Abre a rota do quadro /projects/:id/board para comprovar banner kanban.archivedLockBanner e controles bloqueados em UI real
    await page.getByRole('button', { name: 'Abrir quadro Kanban' }).last().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Quadro Kanban — Portal Clientes E2E' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Este projeto está arquivado. Movimentações, criação de cartões e alterações estruturais estão bloqueadas.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar coluna' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Criar cartão' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Excluir coluna' })).toHaveCount(0);
    await expect(page.getByLabel('Mover para coluna')).toHaveCount(0);

    // Volta para /projects e restaura o projeto para confirmar ciclo completo
    await page.getByRole('button', { name: 'Voltar para projetos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByLabel('Incluir projetos arquivados').check();
    await page
      .getByRole('button', { name: /Portal Clientes E2E/ })
      .first()
      .click();
    await expect(
      page.getByText(
        'Este projeto está arquivado e permanece bloqueado para alterações operacionais.',
      ),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Restaurar projeto' }).click();
    await expect(
      page.getByText('Projeto "Portal Clientes E2E" restaurado com sucesso.'),
    ).toBeVisible();
  });
});
