import { expect, test } from '@playwright/test';
import { stubApp } from './helpers/api';

// Signed-in shell with an empty account, so loaders settle.
async function stubAuth(page: import('@playwright/test').Page) {
  await stubApp(page);
}

test('engine boots in MT or ST mode and evaluates the start position', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/__engine-test');

  const isolated = page.locator('[data-testid="isolated"]');
  await expect(isolated).toHaveText('true', { timeout: 5_000 });

  const status = page.locator('[data-testid="engine-status"]');
  await expect(status).toHaveText('ready', { timeout: 30_000 });

  const mode = page.locator('[data-testid="engine-mode"]');
  await expect(mode).toHaveText(/^(mt|st)$/);

  const evalBox = page.locator('[data-testid="engine-eval"]');
  await expect(evalBox).not.toHaveText('—', { timeout: 30_000 });

  const bestMove = page.locator('[data-testid="engine-bestmove"]');
  await expect(bestMove).not.toHaveText('—', { timeout: 30_000 });
});
