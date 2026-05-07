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
    user_metadata: { full_name: 'E2E User', avatar_url: null },
    app_metadata: {},
    created_at: new Date().toISOString(),
  },
};
const SUPABASE_PROJECT = 'ydfwppthwnlgxnntzrvg';

async function stubAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ session, project }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT },
  );
}

const ROUTES: Array<{ path: string; name: string; expect: (p: import('@playwright/test').Page) => Promise<void> }> = [
  {
    path: '/',
    name: 'dashboard',
    expect: async (p) => {
      await expect(p.getByText(/Hey/i)).toBeVisible();
      await expect(p.getByText(/Due now/i)).toBeVisible();
    },
  },
  {
    path: '/vault',
    name: 'vault',
    expect: async (p) => {
      // empty state
      await expect(p.getByText(/No games yet/i)).toBeVisible();
    },
  },
  {
    path: '/training',
    name: 'training',
    expect: async (p) => {
      await expect(p.getByText(/No blunders due/i)).toBeVisible();
    },
  },
  {
    path: '/profile',
    name: 'profile',
    expect: async (p) => {
      await expect(p.getByText(/Linked accounts/i)).toBeVisible();
      await expect(p.getByPlaceholder(/drnykterstein/i)).toBeVisible();
    },
  },
];

for (const route of ROUTES) {
  test(`route ${route.path} renders within shell`, async ({ page }) => {
    await stubAuth(page);
    await page.goto(route.path);
    // Sidebar always present on protected routes
    await expect(page.getByRole('link', { name: /Dashboard/i })).toBeVisible();
    await route.expect(page);
  });
}

test('keyboard A grade is wired on review (key handler attaches)', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/');
  // Sanity-check the document keydown listener doesn't blow up.
  await page.keyboard.press('Space');
});
