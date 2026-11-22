import { expect, test } from '@playwright/test';
import { stubRpc, stubSession } from './helpers/api';

// Public tool: signed out. The API is stubbed so the signed-out
// AuthProvider settles quickly and nothing reaches a real backend.
test.beforeEach(async ({ page }) => {
  await stubSession(page, null);
  await stubRpc(page);
});

test('moments: the example renders, a pasted PGN exports a GIF and a screenshot', async ({ page }) => {
  await page.goto('/moments');
  await expect(page.getByRole('heading', { name: 'Turn a chess moment into a GIF' })).toBeVisible();
  await expect(page.getByTestId('moments-preview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: /Train your own blunders/ })).toBeVisible();

  await page.getByTestId('moments-input').fill('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#');
  await page.getByTestId('moments-from').selectOption('0');
  await expect(page.getByText('7 moves, Start to 4. Qxf7#')).toBeVisible();

  const gif = page.waitForEvent('download');
  await page.getByTestId('moments-download-gif').click();
  expect((await gif).suggestedFilename()).toMatch(/^patternchess-moment-.*\.gif$/);

  const png = page.waitForEvent('download');
  await page.getByTestId('moments-download-png').click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
});

test('moments: an unreadable input shows an error', async ({ page }) => {
  await page.goto('/moments');
  await page.getByTestId('moments-input').fill('not a chess game');
  await expect(page.getByRole('alert')).toContainText("doesn't read as a PGN");
});

test('landing footer links the GIF maker', async ({ page }) => {
  await page.goto('/moments');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Chess GIF maker' })).toHaveAttribute(
    'href',
    '/moments',
  );
});
