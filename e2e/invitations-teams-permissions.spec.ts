import { expect, test } from '@playwright/test';

test.describe('PMS Phase 05 — Invitations, Teams & Permissions E2E', () => {
  test('ADMIN creates nominal invitation, creates team, grants permission, logs out, and invited 2nd user registers and accepts invitation via /invitations/accept', async ({
    page,
  }) => {
    const invitedEmail = 'convidado.e2e@pms.local';

    // 1. Entra como ADMIN da organização demonstrativa via /demo
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Administrador' }).click();
    await expect(page).toHaveURL(/\/organizations$/);

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });

    // 2. Navega para /invitations e cria convite nominal
    await primaryNav.getByRole('link', { name: 'Convites' }).click();
    await expect(page).toHaveURL(/\/invitations$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Convites organizacionais' }),
    ).toBeVisible();

    await page.locator('#invite-email').fill(invitedEmail);
    await page.locator('#invite-role').selectOption('MEMBER');
    await page.locator('#invite-expiry-days').fill('15');
    await page.getByRole('button', { name: 'Criar convite' }).click();

    await expect(
      page.getByText(`Convite criado com sucesso para ${invitedEmail}.`).first(),
    ).toBeVisible();

    // Extrai o código gerado (PMS-XXXX-XXXX-XXXX) exibido no banner de sucesso
    const codeLocator = page
      .locator('strong', { hasText: /^PMS-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/ })
      .first();
    await expect(codeLocator).toBeVisible();
    const inviteCode = (await codeLocator.textContent())?.trim() ?? '';
    expect(inviteCode).toMatch(/^PMS-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);

    // 3. Navega para /teams e cria uma nova equipe
    await primaryNav.getByRole('link', { name: 'Equipes' }).click();
    await expect(page).toHaveURL(/\/teams$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Equipes da organização' }),
    ).toBeVisible();

    await page.locator('#create-team-name').fill('Squad Qualidade E2E');
    await page
      .locator('#create-team-description')
      .fill('Equipe criada durante o fluxo E2E da Fase 05');
    await page.getByRole('button', { name: 'Criar equipe' }).click();

    await expect(page.getByText('Equipe "Squad Qualidade E2E" criada com sucesso.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Squad Qualidade E2E/ })).toBeVisible();

    // 4. Navega para /permissions e concede uma permissão adicional verificando a listagem
    await primaryNav.getByRole('link', { name: 'Permissões' }).click();
    await expect(page).toHaveURL(/\/permissions$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Permissões e regras de acesso' }),
    ).toBeVisible();

    const granteeSelect = page.locator('#grant-grantee');
    await expect(granteeSelect.locator('option')).toHaveCount(4); // placeholder + 3 membros demo
    const memberOptionValue = await granteeSelect
      .locator('option', { hasText: 'membro.demo@pms.local' })
      .getAttribute('value');
    expect(memberOptionValue).toBeTruthy();

    await granteeSelect.selectOption(memberOptionValue ?? '');
    await page.locator('#grant-permission').selectOption('team.create');
    await page.locator('#grant-scope-type').selectOption('ORGANIZATION');
    await page
      .locator('#grant-reason')
      .fill('Delegacao temporaria para criacao de equipes no teste E2E');
    await page.getByRole('button', { name: 'Conceder permissão' }).click();

    await expect(page.getByText('Concessão de permissão registrada com sucesso.')).toBeVisible();
    await expect(
      page.getByText('Delegacao temporaria para criacao de equipes no teste E2E'),
    ).toBeVisible();

    // 5. Faz logout do ADMIN
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // 6. Cadastra o 2º usuário com o e-mail convidado em /register
    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta local' })).toBeVisible();

    await page.getByLabel(/Nome completo/i).fill('Lucas Convidado E2E');
    await page.getByLabel(/E-mail/i).fill(invitedEmail);
    await page.getByLabel(/^Senha/i).fill('SenhaConvidado!2026');
    await page.getByLabel(/Confirmar senha/i).fill('SenhaConvidado!2026');
    await page
      .getByLabel(/Li e aceito os termos de uso do protótipo local do Project Management System/i)
      .check();
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page).toHaveURL(/\/organizations$/);
    await expect(page.getByText('Lucas Convidado E2E')).toBeVisible();

    // 7. Aceita o convite em /invitations/accept?code=... e confirma ingresso no seletor do cabeçalho
    await page.goto(`/invitations/accept?code=${encodeURIComponent(inviteCode)}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Aceitar convite por código' }),
    ).toBeVisible();
    await expect(page.getByText(/Organizacao Demonstrativa PMS/)).toBeVisible();

    const acceptButton = page.getByRole('button', { name: 'Aceitar convite' });
    await expect(acceptButton).toBeEnabled();
    await acceptButton.click();

    await expect(page).toHaveURL(/\/organizations$/);

    const orgSwitcher = page.getByLabel('Organização ativa', { exact: true });
    await expect(orgSwitcher).toBeEnabled();
    await expect(orgSwitcher.locator('option:checked')).toContainText(
      'Organizacao Demonstrativa PMS',
    );
  });
});
