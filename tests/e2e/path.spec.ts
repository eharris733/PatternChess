import { expect, test, type Page } from '@playwright/test';

// The progression ladder: /path counts lifetime positions trained, the daily
// plan shows the next unlock, and supporters can open every rung.

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
  opts: { signedIn?: boolean; supporter?: Record<string, unknown> | null; opens?: number; profile?: Record<string, unknown>; solved?: number } = {},
) {
  // One row carrying all the first-attempt solves: BlunderStats.reviewed = sum(times_correct).
  await page.addInitScript((solved) => {
    (window as any).__blunders = solved
      ? [{ id: 'b1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', kind: 'tactic', times_correct: solved, times_attempted: solved, cycle_number: 1, last_drilled_at: new Date().toISOString(), next_drill_at: new Date(Date.now() + 86_400_000).toISOString() }]
      : [];
  }, opts.solved ?? 0);
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
          if (url.includes('/rest/v1/blunders')) return json((window as any).__blunders ?? []);
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

const ACTIVE = { status: 'active', current_period_end: null, cancel_at_period_end: false, first_supported_at: new Date().toISOString() };

test('/path counts positions trained and marks reached, next and locked rungs', async ({ page }) => {
  await stub(page, { solved: 30 });
  await page.goto('/path');
  await expect(page.getByRole('heading', { name: '30 positions trained' })).toBeVisible();
  await expect(page.getByText('Next unlock in')).toContainText('20');
  const rungs = page.getByTestId('path-rung');
  await expect(rungs).toHaveCount(9);
  await expect(rungs.nth(0)).toHaveAttribute('data-state', 'reached');
  await expect(rungs.nth(1)).toHaveAttribute('data-state', 'reached');
  await expect(rungs.nth(2)).toHaveAttribute('data-state', 'next');
  await expect(rungs.nth(3)).toHaveAttribute('data-state', 'locked');
  await expect(page.getByRole('link', { name: 'Become a supporter' })).toBeVisible();
});

test('the daily plan links to the next unlock', async ({ page }) => {
  await stub(page, { solved: 30 });
  await page.goto('/dashboard');
  const line = page.getByTestId('next-unlock');
  await expect(line).toContainText('Next unlock in 20 positions');
  await line.click();
  await expect(page).toHaveURL(/\/path$/);
});

test('supporters are not pitched on /path', async ({ page }) => {
  await stub(page, { solved: 30, supporter: ACTIVE });
  await page.goto('/path');
  await expect(page.getByRole('heading', { name: '30 positions trained' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Become a supporter' })).toHaveCount(0);
});

test('an unknown article slug says so', async ({ page }) => {
  await stub(page, { solved: 30 });
  await page.goto('/path/no-such-article');
  await expect(page.getByText("That article doesn't exist.")).toBeVisible();
});
