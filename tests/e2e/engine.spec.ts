import { expect, test } from '@playwright/test';

const FAKE_SESSION = {
  access_token: 'fake',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fake-refresh',
  user: {
    id: 'e2e-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'e2e@example.com',
    user_metadata: { full_name: 'E2E User' },
    app_metadata: {},
    created_at: new Date().toISOString(),
  },
};
const SUPABASE_PROJECT = 'ydfwppthwnlgxnntzrvg';

async function stubAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ session, project }) => {
      try {
        const origFetch = window.fetch.bind(window);
        window.fetch = (input: any, init?: any) => {
          const url = typeof input === 'string' ? input : input?.url ?? '';
          if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
            return Promise.resolve(
              new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
            );
          }
          return origFetch(input, init);
        };
        localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
      } catch {}
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT },
  );
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
