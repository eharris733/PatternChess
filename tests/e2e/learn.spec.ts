import { expect, test } from '@playwright/test';
import { stubApp } from './helpers/api';

test.beforeEach(async ({ page }) => {
  await stubApp(page);
});

test('library tabs switch category via ?tab=', async ({ page }) => {
  await page.goto('/learn');
  await expect(page.getByRole('heading', { name: /Study library/i })).toBeVisible();
  await expect(page.getByTestId('tab-openings')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('tab-endgames').click();
  await expect(page).toHaveURL(/tab=endgames/);
  await expect(page.getByTestId('tab-endgames')).toHaveAttribute('aria-selected', 'true');
  // Either studies or the empty state — never a blank panel.
  await expect(page.getByTestId('study-card').first().or(page.getByTestId('learn-empty'))).toBeVisible();
});

test('unknown study slug shows a way back', async ({ page }) => {
  await page.goto('/learn/does-not-exist');
  await expect(page.getByText(/Study not found/i)).toBeVisible();
  await page.getByRole('link', { name: /Back to the library/i }).click();
  await expect(page).toHaveURL(/\/learn$/);
});
