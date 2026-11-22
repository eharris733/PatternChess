import { expect, test, type Page } from '@playwright/test';

// $5/month supporter tier: /supporter hands off to Stripe Checkout through
// /api/stripe/checkout, shows the thank-you state for active supporters,
// /profile carries "Manage subscription", and the dashboard ask appears from
// the 4th open after a finished session.

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

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');
}

const BASE_PROFILE = {
  id: 'e2e-user',
  display_name: 'E2E User',
  avatar_url: null,
  lichess_username: 'tester',
  chesscom_username: null,
  preferred_rated_only: false,
  preferred_time_controls: [],
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: new Date().toISOString(),
  current_streak_days: 9,
  longest_streak_days: 9,
  last_drill_local_date: daysAgo(1),
  timezone: null,
  board_theme: 'default',
  commitment_level: 'regular',
  daily_positions_goal: 10,
  daily_games_goal: 1,
  streak_freezes: 0,
};



async function stub(
  page: Page,
  opts: { signedIn?: boolean; supporter?: Record<string, unknown> | null; opens?: number; profile?: Record<string, unknown> } = {},
) {
  await page.addInitScript(
    ({ session, project, profile, supporter, opens, signedIn }) => {
      (window as any).__rpcs = [];
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET').toUpperCase();
          const json = (body: unknown) =>
            Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (url.includes('/rest/v1/rpc/')) {
            const name = url.split('/rest/v1/rpc/')[1].split('?')[0];
            (window as any).__rpcs.push({ name, body: init?.body ? JSON.parse(init.body) : null });
            if (name === 'bump_app_open') return json(opens);
            return json(null);
          }
          if (method === 'HEAD') {
            return Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': '*/1' } }));
          }
          if (method === 'PATCH') return json([]);
          if (url.includes('/rest/v1/supporters')) return json(supporter ? [supporter] : []);
          if (url.includes('/rest/v1/profiles')) return json(profile);
          return json([]);
        }
        return origFetch(input, init);
      };
      if (signedIn) localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
      sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
    },
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile: { ...BASE_PROFILE, email_opt_in: true, app_opens: (opts.opens ?? 1) - 1, ...opts.profile },
      supporter: opts.supporter ?? null,
      opens: opts.opens ?? 1,
      signedIn: opts.signedIn ?? true,
    },
  );
}

const ACTIVE = {
  status: 'active',
  current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  cancel_at_period_end: false,
  first_supported_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
};

test('signed out, /supporter asks to sign up first', async ({ page }) => {
  await stub(page, { signedIn: false });
  await page.goto('/supporter');
  await expect(page.getByRole('heading', { name: "Back the thing that's backing your chess." })).toBeVisible();
  await expect(page.getByTestId('supporter-cta').getByRole('link', { name: 'Sign up free' })).toBeVisible();
  await expect(page.getByText('First in line for the beta when it opens.')).toBeVisible();
});

test('"Become a supporter" posts to /api/stripe/checkout and goes to Stripe', async ({ page }) => {
  await stub(page);
  let auth: string | null = null;
  await page.route('**/api/stripe/checkout', async (route) => {
    auth = route.request().headers()['authorization'] ?? null;
    await route.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/cs_test_e2e' } });
  });
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ body: '<h1>Stripe Checkout</h1>', contentType: 'text/html' }));
  await page.goto('/supporter');
  await page.getByTestId('supporter-checkout').click();
  await page.waitForURL('https://checkout.stripe.com/**');
  expect(auth).toBe('Bearer fake');
});

test('an active supporter sees thanks, and /profile offers "Manage subscription"', async ({ page }) => {
  await stub(page, { supporter: ACTIVE });
  await page.goto('/supporter');
  await expect(page.getByText("You're a supporter. Thank you.")).toBeVisible();
  await page.goto('/profile');
  const section = page.getByTestId('supporter-setting');
  await expect(section.getByText(/Thank you for supporting PatternChess/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Manage subscription' })).toBeVisible();
});

test('the dashboard asks for support from the 4th open after a finished session', async ({ page }) => {
  await stub(page, { opens: 4 });
  await page.goto('/dashboard');
  const card = page.getByTestId('supporter-ask');
  await expect(card.getByText('Enjoying the plan? Help keep it running.')).toBeVisible();
  await card.getByRole('button', { name: 'Maybe later' }).first().click();
  await expect(card).toHaveCount(0);
  const rpcs = await page.evaluate(() => (window as any).__rpcs);
  expect(rpcs.find((r: any) => r.name === 'mark_ask_prompted')?.body).toEqual({ p_ask: 'supporter' });
});

test('supporters are never asked for support', async ({ page }) => {
  await stub(page, { opens: 6, supporter: ACTIVE });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  await expect(page.getByTestId('supporter-ask')).toHaveCount(0);
});
