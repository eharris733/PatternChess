import { expect, test } from '@playwright/test';

test('cross-origin isolation headers are present and isolation is active', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response).not.toBeNull();
  expect(response!.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(response!.headers()['cross-origin-opener-policy']).toBe('same-origin');

  const isolated = await page.evaluate(() => self.crossOriginIsolated);
  expect(isolated).toBe(true);
});
