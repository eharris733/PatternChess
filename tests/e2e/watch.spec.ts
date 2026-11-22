import { expect, test } from '@playwright/test';
import { stubRpc, stubSession } from './helpers/api';

// Signed out, with no API server: get-session answers null and RPCs get the
// empty defaults.
test.beforeEach(async ({ page }) => {
  await stubSession(page, null);
  await stubRpc(page);
});

test('/watch plays the tour from its own page and preloads nothing', async ({ page }) => {
  const videoRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/video/') && r.url().endsWith('.mp4')) videoRequests.push(r.url());
  });
  await page.goto('/watch');
  await expect(page.getByRole('heading', { name: 'PatternChess in a minute' })).toBeVisible();
  const video = page.getByTestId('tour-video');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveAttribute('poster', /poster\.jpg$/);
  expect(videoRequests).toEqual([]);
  // The file is served same-origin, so COEP doesn't block it.
  const res = await page.request.get('/video/patternchess-tour-v1.mp4', { headers: { Range: 'bytes=0-99' } });
  expect([200, 206]).toContain(res.status());
});

test('the landing page links to /watch without loading the video', async ({ page }) => {
  const videoRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/video/')) videoRequests.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: /Watch the 1-minute video/ }).click();
  await expect(page).toHaveURL(/\/watch$/);
  expect(videoRequests.filter((u) => u.endsWith('.mp4'))).toEqual([]);
});

test('the sign-in page says Google sign-in turns on reminders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('google-email-notice')).toContainText('turns on training reminders by email');
});
