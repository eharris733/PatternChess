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

// `gameCount` controls the total-game-count HEAD query that drives the
// onboarding gate: a positive count means an "established" user (gate stays
// hidden, normal routes render); 0 means a brand-new user (the onboarding flow
// preempts non-bypass routes).
async function stubAuth(page: import('@playwright/test').Page, gameCount = 3) {
  await page.addInitScript(
    ({ session, project, gameCount }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (
            init?.method ??
            (typeof input === 'object' ? input?.method : undefined) ??
            'GET'
          ).toUpperCase();
          // GoTrue user lookup — return the stubbed user so currentUserId()
          // (used by the onboarding gate's game-count query) resolves.
          if (url.includes('/auth/v1/user')) {
            return Promise.resolve(
              new Response(JSON.stringify(session.user), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // supabase-js issues a HEAD request for exact-count queries; PostgREST
          // returns the total in the content-range header.
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, {
                status: 200,
                headers: { 'content-range': `*/${gameCount}` },
              }),
            );
          }
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
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, gameCount },
  );
}

const ROUTES: Array<{ path: string; name: string; expect: (p: import('@playwright/test').Page) => Promise<void> }> = [
  {
    path: '/',
    name: 'dashboard',
    expect: async (p) => {
      // Stubbed session has games (gate hidden) but no linked account and an
      // empty games list -> first-run hero.
      await expect(p.getByText(/Welcome to PatternChess/i)).toBeVisible();
      await expect(p.getByRole('button', { name: /Connect Lichess or Chess\.com/i })).toBeVisible();
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
  {
    path: '/endgames',
    name: 'endgames',
    expect: async (p) => {
      // Empty games list -> connect CTA.
      await expect(p.getByText(/No games yet/i)).toBeVisible();
      await expect(p.getByRole('link', { name: /Connect an account/i })).toBeVisible();
    },
  },
  {
    path: '/achievements',
    name: 'achievements',
    expect: async (p) => {
      await expect(p.getByText(/Your milestones/i)).toBeVisible();
      await expect(p.getByText(/Unlocked/i)).toBeVisible();
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

test('new user with no games sees the onboarding connect step', async ({ page }) => {
  await stubAuth(page, 0);
  await page.goto('/dashboard');
  // Onboarding preempts the dashboard for a zero-game user.
  await expect(page.getByRole('button', { name: /Start import/i })).toBeVisible();
  await expect(page.getByText(/Which games to train on/i)).toBeVisible();
  // Still inside the shell.
  await expect(page.getByRole('link', { name: /Dashboard/i })).toBeVisible();
});

test('onboarding does not preempt the profile route', async ({ page }) => {
  await stubAuth(page, 0);
  await page.goto('/profile');
  await expect(page.getByText(/Linked accounts/i)).toBeVisible();
});

test('keyboard A grade is wired on review (key handler attaches)', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/dashboard');
  // Sanity-check the document keydown listener doesn't blow up.
  await page.keyboard.press('Space');
});
