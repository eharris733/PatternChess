import { expect, test, type Page } from '@playwright/test';

// Dashboard email asks (src/lib/asks.ts): from the 2nd app open, accounts with
// reminders off are asked to turn them on, and Lichess sign-ins without an
// address are asked for one (confirmed by link). /profile carries the same form.

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
  opts: { profile?: Record<string, unknown>; email?: string; opens: number },
) {
  await page.addInitScript(
    ({ session, project, profile, opens }) => {
      (window as any).__patches = [];
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
          if (method === 'PATCH') {
            (window as any).__patches.push({ url, body: init?.body ? JSON.parse(init.body) : null });
            return json([]);
          }
          if (url.includes('/rest/v1/profiles')) return json(profile);
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
      sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
    },
    {
      session: { ...FAKE_SESSION, user: { ...FAKE_SESSION.user, email: opts.email ?? 'e2e@example.com' } },
      project: SUPABASE_PROJECT,
      profile: { ...BASE_PROFILE, email_opt_in: false, app_opens: opts.opens - 1, ...opts.profile },
      opens: opts.opens,
    },
  );
}

test('no ask on the first open', async ({ page }) => {
  await stub(page, { opens: 1 });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
  const rpcs = await page.evaluate(() => (window as any).__rpcs.map((r: any) => r.name));
  expect(rpcs).toContain('bump_app_open');
});

test('the 2nd open asks a Google account to turn reminders on', async ({ page }) => {
  await stub(page, { opens: 2 });
  await page.goto('/dashboard');
  const card = page.getByTestId('email-ask');
  await expect(card.getByText("Want a nudge when it's time to train?")).toBeVisible();
  await card.getByRole('button', { name: 'Yes, remind me' }).click();
  await expect(page.getByTestId('email-ask-done')).toBeVisible();
  const patches = await page.evaluate(() => (window as any).__patches);
  expect(patches.some((p: any) => p.url.includes('/profiles') && p.body?.email_opt_in === true)).toBe(true);
});

test('"Not now" records the answer and hides the card', async ({ page }) => {
  await stub(page, { opens: 3 });
  await page.goto('/dashboard');
  await page.getByTestId('email-ask').getByRole('button', { name: 'Not now' }).first().click();
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
  const rpcs = await page.evaluate(() => (window as any).__rpcs);
  expect(rpcs.find((r: any) => r.name === 'mark_ask_prompted')?.body).toEqual({ p_ask: 'email' });
});

test('an ask answered 2 weeks ago twice never comes back', async ({ page }) => {
  await stub(page, {
    opens: 9,
    profile: { email_prompted_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), email_prompt_count: 2 },
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
});

test('a Lichess sign-in adds an address from the ask', async ({ page }) => {
  await stub(page, { opens: 2, email: '' });
  await page.goto('/dashboard');
  const card = page.getByTestId('email-ask');
  await card.getByLabel('Email address').fill('player@example.com');
  await card.getByRole('button', { name: 'Yes, remind me' }).click();
  await expect(page.getByTestId('contact-email-pending')).toContainText('player@example.com');
  const patches = await page.evaluate(() => (window as any).__patches);
  const p = patches.find((x: any) => x.url.includes('/profiles') && x.body?.contact_email);
  expect(p.body).toMatchObject({ contact_email: 'player@example.com', email_opt_in: true });
});

test('/profile lets a Lichess sign-in add an address', async ({ page }) => {
  await stub(page, { opens: 1, email: '' });
  await page.goto('/profile');
  const section = page.getByTestId('email-reminders-setting');
  await expect(section.getByText(/doesn't share an email address/)).toBeVisible();
  await expect(section.getByTestId('contact-email-form')).toBeVisible();
});

test('/profile shows a typed-in address waiting for its confirmation click', async ({ page }) => {
  await stub(page, { opens: 1, email: '', profile: { contact_email: 'me@example.com', email_opt_in: true } });
  await page.goto('/profile');
  await expect(page.getByTestId('contact-email-pending')).toContainText('me@example.com');
});

test('/profile picks the reminder hour', async ({ page }) => {
  await stub(page, { opens: 1, profile: { email_opt_in: true, email_hour: 18 } });
  await page.goto('/profile');
  const hour = page.getByTestId('email-hour');
  await expect(hour).toHaveValue('18');
  await hour.selectOption('8');
  const patches = await page.evaluate(() => (window as any).__patches);
  expect(patches.some((p: any) => p.body?.email_hour === 8)).toBe(true);
});
