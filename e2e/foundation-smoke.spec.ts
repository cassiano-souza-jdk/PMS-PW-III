import { expect, test } from '@playwright/test';

test.describe('PMS Phase 01 Foundation Smoke', () => {
  test('loads foundation shell in pt-BR, toggles themes and handles 404 route recovery', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page).toHaveTitle('PMS — Project Management System');

    const skipLink = page.getByRole('link', { name: 'Pular para o conteúdo principal' });
    await expect(skipLink).toHaveAttribute('href', '#main-content');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Fundação técnica — Fase 01' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Protótipo frontend local em execução no navegador, sem backend remoto nem sincronização entre dispositivos.',
      ),
    ).toBeVisible();

    const themeGroup = page.getByRole('group', { name: 'Selecionar tema da interface' });
    const darkButton = themeGroup.getByRole('button', { name: 'Escuro' });
    const lightButton = themeGroup.getByRole('button', { name: 'Claro' });

    await darkButton.click();
    await expect(darkButton).toHaveAttribute('aria-pressed', 'true');
    await expect(lightButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    await lightButton.click();
    await expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    await expect(darkButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    await page.goto('/pagina-inexistente');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeVisible();
    await expect(page.getByText('404', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Voltar para o início' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fundação técnica — Fase 01' }),
    ).toBeVisible();
  });
});
