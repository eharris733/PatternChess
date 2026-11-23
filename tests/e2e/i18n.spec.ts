import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { stubApp, stubRpc, stubSession } from './helpers/api';

// Translation smoke: the app follows the browser language by default, the
// /profile picker switches it (remembered per device), and the dashboard plan
// renders from the chosen catalog with no missing-key warnings.

const PROFILE = {
  id: 'e2e-user',
  display_name: 'E2E User',
  lichess_username: 'tester',
  chesscom_username: null,
  commitment_level: 'regular',
  daily_positions_goal: 10,
  daily_games_goal: 1,
};

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if (text.includes('[i18n]')) problems.push(text);
  });
  return problems;
}

async function stub(page: Page) {
  await stubApp(page, { profile: PROFILE, gameCount: 1 });
  await page.addInitScript(() => {
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
}

test('picking Español and Português on /profile switches the dashboard plan', async ({ page }) => {
  const problems = watchConsole(page);
  await stub(page);

  await page.goto('/dashboard');
  const plan = page.getByTestId('daily-plan');
  await expect(plan.getByText("Today's plan")).toBeVisible();
  await expect(plan.getByText('Train 10 positions')).toBeVisible();

  await page.goto('/profile#language');
  await page.getByTestId('language-es').click();
  await expect(page.getByTestId('language-es')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'Idioma' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.goto('/dashboard');
  await expect(plan.getByText('Plan de hoy')).toBeVisible();
  await expect(plan.getByText('Entrena 10 posiciones')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bóveda' })).toBeVisible();

  // The choice survives a reload (per-device).
  await page.reload();
  await expect(plan.getByText('Plan de hoy')).toBeVisible();

  await page.goto('/profile#language');
  await page.getByTestId('language-pt').click();
  await page.goto('/dashboard');
  await expect(plan.getByText('Plano de hoje')).toBeVisible();
  await expect(plan.getByText('Treine 10 posições')).toBeVisible();

  await page.goto('/profile#language');
  await page.getByTestId('language-en').click();
  await page.goto('/dashboard');
  await expect(plan.getByText("Today's plan")).toBeVisible();

  expect(problems).toEqual([]);
});

test.describe('with a Brazilian browser', () => {
  test.use({ locale: 'pt-BR' });

  test('defaults to Portuguese with no stored choice', async ({ page }) => {
    const problems = watchConsole(page);
    await stub(page);
    await page.goto('/dashboard');
    await expect(page.getByTestId('daily-plan').getByText('Plano de hoje')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
    expect(problems).toEqual([]);
  });
});

test('signed-out visitors switch the landing page from the footer', async ({ page }) => {
  const problems = watchConsole(page);
  await stubSession(page, null);
  await stubRpc(page);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText(/Stop procrastinating your improvement/i);
  await page.getByTestId('footer-language').selectOption('es');
  await expect(page.locator('h1')).toHaveText(/Deja de posponer tu mejora/i);
  await expect(page.getByRole('button', { name: /Quiero mi plan/i })).toBeVisible();
  await page.getByTestId('footer-language').selectOption('pt');
  await expect(page.locator('h1')).toHaveText(/Pare de adiar a sua evolução/i);
  expect(problems).toEqual([]);
});
