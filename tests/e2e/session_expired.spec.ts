import { expect, test, type Page } from '@playwright/test';
import { E2E_USER, rpcError, sessionBody, stubApp } from './helpers/api';

// The session can end outside this tab (expiry, a sign-out elsewhere, a
// revoked session). The first RPC that answers 401 makes the app re-read the
// session; a dead one signs the app out to /login instead of leaving every
// request (and the background openings scan) failing on.

interface ServerState {
  /** get-session still returns the user. */
  alive: boolean;
  /** Every RPC answers 401. */
  rejecting: boolean;
  sessionReads: number;
}

async function setup(page: Page): Promise<ServerState> {
  const state: ServerState = { alive: true, rejecting: false, sessionReads: 0 };
  await stubApp(page);
  // Registered after stubApp, so these answer first.
  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith('/get-session')) return route.fallback();
    state.sessionReads++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionBody(state.alive ? E2E_USER : null)),
    });
  });
  await page.route('**/api/rpc/*', async (route) => {
    if (!state.rejecting) return route.fallback();
    const res = rpcError(401, 'Sign in required', 'unauthorized');
    return route.fulfill({ status: 401, contentType: 'application/json', body: await res.text() });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: /^leaderboards$/i }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  return state;
}

test('a 401 from the API re-reads the session and signs out to /login', async ({ page }) => {
  const state = await setup(page);
  const readsBefore = state.sessionReads;

  // The session dies on the server; this tab still thinks it's signed in.
  state.alive = false;
  state.rejecting = true;
  await page.getByRole('link', { name: /^leaderboards$/i }).first().click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  expect(state.sessionReads).toBeGreaterThan(readsBefore);
});

test('a 401 while the session is still valid keeps the user signed in', async ({ page }) => {
  const state = await setup(page);
  const readsBefore = state.sessionReads;

  state.rejecting = true;
  await page.getByRole('link', { name: /^leaderboards$/i }).first().click();
  await expect.poll(() => state.sessionReads, { timeout: 10_000 }).toBeGreaterThan(readsBefore);
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/leaderboards/);
});
