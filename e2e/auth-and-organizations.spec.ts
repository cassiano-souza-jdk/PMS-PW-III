import { expect, test } from '@playwright/test';

test.describe('PMS Phase 04 — Auth, Multi-Organization, Demo Mode & Sessions E2E', () => {
  test('registers user without localStorage tokens, creates organization, accesses settings, enters Demo ADMIN mode, inspects profile sessions and logs out', async ({
    page,
  }) => {
    // 1. Acessa /register e cadastra novo usuário com aceite de termos
    await page.goto('/register');

    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta local' })).toBeVisible();

    await page.getByLabel(/Nome completo/i).fill('Mariana Oliveira');
    await page.getByLabel(/E-mail/i).fill('mariana.e2e@pms.local');
    await page.getByLabel(/^Senha/i).fill('SenhaSegura!2026');
    await page.getByLabel(/Confirmar senha/i).fill('SenhaSegura!2026');
    await page
      .getByLabel(/Li e aceito os termos de uso do protótipo local do Project Management System/i)
      .check();

    await page.getByRole('button', { name: 'Criar conta' }).click();

    // Verifica redirecionamento autenticado para /organizations e presença do nome do usuário no cabeçalho
    await expect(page).toHaveURL(/\/organizations$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Minhas organizações' }),
    ).toBeVisible();
    await expect(page.getByText('Mariana Oliveira')).toBeVisible();

    // Verifica ZERO tokens ou credenciais em window.localStorage
    const localStorageSnapshot = await page.evaluate(() => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key !== null) {
          entries[key] = window.localStorage.getItem(key) ?? '';
        }
      }
      return entries;
    });

    const localStorageKeys = Object.keys(localStorageSnapshot);
    const localStorageSerialized = JSON.stringify(localStorageSnapshot).toLowerCase();

    expect(localStorageKeys).not.toContain('accessToken');
    expect(localStorageKeys).not.toContain('refreshToken');
    expect(localStorageKeys).not.toContain('token');
    expect(localStorageKeys).not.toContain('session');
    expect(localStorageKeys).not.toContain('sessionId');
    expect(localStorageSerialized).not.toContain('pms_sim_');
    expect(localStorageSerialized).not.toContain('senhasegura!2026');

    // 2. Cria uma nova organização em /organizations
    await page.getByLabel(/Nome da organização/i).fill('Vanguarda Digital');
    await expect(page.getByLabel(/Identificador \(slug\)/i)).toHaveValue('vanguarda-digital');
    await page.getByLabel(/Descrição \(opcional\)/i).fill('Espaco E2E criado na Fase 04');
    await page.getByRole('button', { name: 'Criar organização' }).click();

    await expect(
      page.getByText('Organização "Vanguarda Digital" criada e ativada com sucesso.'),
    ).toBeVisible();

    // Confirma que a nova organização aparece ativa no seletor do cabeçalho
    const orgSwitcher = page.getByLabel('Organização ativa', { exact: true });
    await expect(orgSwitcher).toBeEnabled();
    await expect(orgSwitcher.locator('option:checked')).toHaveText('Vanguarda Digital');

    // Confirma que /settings está acessível para o criador (ADMIN)
    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await primaryNav.getByRole('link', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vanguarda Digital' })).toBeVisible();
    await expect(page.getByText('Detalhes da organização ativa')).toBeVisible();
    await expect(page.getByText('Membros e papéis')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar organização' })).toBeVisible();

    // 3. Navega para /demo e entra com perfil ADMIN demonstrativo
    await page.goto('/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Acesso rápido — Ambiente Demonstrativo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como Administrador' }).click();

    await expect(page).toHaveURL(/\/organizations$/);

    // Verifica exibição do banner permanente MODO DEMONSTRATIVO
    const demoBanner = page.getByRole('region', {
      name: 'Aviso permanente do Ambiente Demonstrativo',
    });
    await expect(demoBanner).toBeVisible();
    await expect(demoBanner.getByText('MODO DEMONSTRATIVO')).toBeVisible();
    await expect(demoBanner.getByText(/Perfil ativo: Administrador \(ADMIN\)/)).toBeVisible();

    // 4. Visita /profile verificando listagem de sessão por dispositivo
    await primaryNav.getByRole('link', { name: 'Perfil' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Meu perfil e sessões' }),
    ).toBeVisible();
    await expect(demoBanner).toBeVisible();
    await expect(page.getByText('Sessões por dispositivo')).toBeVisible();
    await expect(page.getByText('Ambiente Demonstrativo (ADMIN)')).toBeVisible();
    await expect(page.getByText('Sessão atual')).toBeVisible();

    // 5. Executa logout e confirma redirecionamento / estado não autenticado
    await page.getByRole('button', { name: 'Sair' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar no PMS' })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: 'Criar conta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);
    await expect(demoBanner).toHaveCount(0);
  });
});
