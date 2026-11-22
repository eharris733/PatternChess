import { expect, test } from '@playwright/test';
import { stubRpc, stubSession } from './helpers/api';

// Signed out, with no API server: get-session answers null and RPCs get the
// empty defaults.
test.beforeEach(async ({ page }) => {
  await stubSession(page, null);
  await stubRpc(page);
});

test('login route renders and offers Google sign-in', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('img', { name: 'PatternChess' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
});

test('protected route redirects to /login when signed out', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});
