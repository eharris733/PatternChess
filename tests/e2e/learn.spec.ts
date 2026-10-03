import { expect, test } from '@playwright/test';

const SUPABASE_PROJECT = 'ydfwppthwnlgxnntzrvg';
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
    user_metadata: { full_name: 'E2E User', avatar_url: null },
    app_metadata: {},
    created_at: new Date().toISOString(),
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ session, project }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          if (url.includes('/auth/v1/user')) {
            return Promise.resolve(new Response(JSON.stringify(session.user), { status: 200 }));
          }
          if ((init?.method ?? 'GET').toUpperCase() === 'HEAD') {
            return Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': '*/3' } }));
          }
          return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT },
  );
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
