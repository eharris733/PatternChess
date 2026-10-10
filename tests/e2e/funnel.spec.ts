import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

const SUPA = 'https://ydfwppthwnlgxnntzrvg.supabase.co';

// Capture every POST to funnel_events and parse its JSON body.
function captureFunnelInserts(page: Page): Array<Record<string, unknown>> {
  const inserts: Array<Record<string, unknown>> = [];
  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/funnel_events')) {
      try {
        const body = req.postDataJSON();
        if (Array.isArray(body)) inserts.push(...body);
        else if (body) inserts.push(body);
      } catch {
        // ignore non-JSON
      }
    }
  });
  return inserts;
}

async function stubFunnelEndpoint(page: Page): Promise<void> {
  // funnel_events insert returns 201; chess APIs can fail (we only assert the
  // tracking call fired, not the demo result).
  await page.route(`${SUPA}/rest/v1/funnel_events*`, async (route) => {
    await route.fulfill({ status: 201, json: [] });
  });
}

test('landing_view fires after a human interaction signal', async ({ page }) => {
  const inserts = captureFunnelInserts(page);
  await stubFunnelEndpoint(page);

  await page.goto('/');
  await expect(page.getByPlaceholder(/ENTER USERNAME/i)).toBeVisible();

  // No interaction yet → no landing_view (human-signal gate).
  expect(inserts.find((e) => e.type === 'landing_view')).toBeUndefined();

  // A real pointer move is the human signal.
  await page.mouse.move(200, 200);
  await page.mouse.move(400, 300);

  await expect
    .poll(() => inserts.some((e) => e.type === 'landing_view'))
    .toBe(true);

  const view = inserts.find((e) => e.type === 'landing_view')!;
  expect(view.anon_id).toBeTruthy();
});

test('demo_submit fires with the entered username + platform', async ({ page }) => {
  const inserts = captureFunnelInserts(page);
  await stubFunnelEndpoint(page);

  await page.goto('/');
  const input = page.getByPlaceholder(/ENTER USERNAME/i);
  await input.fill('magnuscarlsen');
  await page.getByRole('button', { name: /Analyze Blunders/i }).click();

  await expect
    .poll(() => inserts.some((e) => e.type === 'demo_submit'))
    .toBe(true);

  const submit = inserts.find((e) => e.type === 'demo_submit')!;
  expect(submit.username).toBe('magnuscarlsen');
  expect(submit.platform).toBe('lichess'); // default platform
  expect(submit.anon_id).toBeTruthy();
});

test('anon_id is stable across the two events', async ({ page }) => {
  const inserts = captureFunnelInserts(page);
  await stubFunnelEndpoint(page);

  await page.goto('/');
  await page.mouse.move(150, 150);
  await page.getByPlaceholder(/ENTER USERNAME/i).fill('player1');
  await page.getByRole('button', { name: /Analyze Blunders/i }).click();

  await expect.poll(() => inserts.length >= 2).toBe(true);
  const ids = new Set(inserts.map((e) => e.anon_id));
  expect(ids.size).toBe(1);
});

test('win-back link prefills the username, re-runs the demo once and cleans the URL', async ({ page }) => {
  const inserts = captureFunnelInserts(page);
  await stubFunnelEndpoint(page);

  await page.goto('/?u=player1&p=chesscom&src=wb');
  await expect(page.locator('#demo-username')).toHaveValue('player1');
  await expect.poll(() => inserts.some((e) => e.type === 'demo_submit')).toBe(true);
  await expect.poll(() => new URL(page.url()).search).toBe('');

  const ret = inserts.filter((e) => e.type === 'lead_return');
  expect(ret).toHaveLength(1);
  expect(ret[0]).toMatchObject({ source: 'wb', platform: 'chesscom', username: 'player1' });
  expect(inserts.filter((e) => e.type === 'demo_submit')).toHaveLength(1);
});

test('landing sign-up CTAs record cta_click with their section', async ({ page }) => {
  const inserts = captureFunnelInserts(page);
  await stubFunnelEndpoint(page);

  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect
    .poll(() => inserts.find((e) => e.type === 'cta_click')?.source)
    .toBe('topbar_signup');
});

test('testimonials are on the landing page', async ({ page }) => {
  await stubFunnelEndpoint(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What players say' })).toBeVisible();
  await expect(page.getByText('DrG00se')).toBeVisible();
});
