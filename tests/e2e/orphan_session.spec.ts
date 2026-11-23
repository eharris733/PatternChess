import { expect, test } from '@playwright/test';
import { rpcError, stubRpc, stubSession } from './helpers/api';

// A session that outlived its account (the user row was deleted from D1 while
// the KV session stayed valid) can never load a profile. The app signs it out
// and lands on /login instead of an empty signed-in shell.
test('a session whose account is gone is signed out to /login', async ({ page }) => {
  await stubSession(page, { id: 'orphan-user', email: 'orphan@example.com', name: 'Orphan' });
  const rpc = await stubRpc(page, {
    'profile.getOrCreate': () => rpcError(400, 'No account for this session', 'no_user'),
  });
  let signOuts = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/auth/sign-out')) signOuts++;
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  expect(signOuts).toBe(1);
  expect(rpc.callsTo('profile.getOrCreate').length).toBeGreaterThan(0);
});

test('any other profile failure keeps the session (the next emission retries)', async ({ page }) => {
  await stubSession(page, { id: 'flaky-user', email: 'flaky@example.com', name: 'Flaky' });
  await stubRpc(page, { 'profile.getOrCreate': () => rpcError(500) });
  let signOuts = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/auth/sign-out')) signOuts++;
  });
  await page.goto('/dashboard');
  await page.waitForTimeout(1500);
  expect(signOuts).toBe(0);
  await expect(page).not.toHaveURL(/\/login/);
});
