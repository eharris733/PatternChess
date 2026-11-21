import { expect, test, type Page } from '@playwright/test';

// The daily loop (retention roadmap Phase 1): commitment level sizes the plan,
// the Play step counts games synced today, banked streak freezes show in the
// sidebar, and a sync that finds new blunders is celebrated on the dashboard.

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

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLUNDERS = [
  { id: 'b1', game_id: 'g1', fen: STARTPOS, move_number: 10, played_move: 'e2e4', correct_moves: [{ move: 'd2d4', eval: 20 }], eval_before: 10, eval_after: -200, eval_swing: 210, side_to_move: 'white', cycle_number: 1, last_drilled_at: PAST, next_drill_at: PAST, times_correct: 1, times_attempted: 1, last_drill_failed: false, created_at: PAST, phase: 'opening', kind: 'tactic' },
];

async function stub(page: Page, opts: { profile?: Partial<typeof BASE_PROFILE>; gamesToday?: number } = {}) {
  await page.addInitScript(
    ({ session, project, profile, blunders, gamesToday }) => {
      (window as any).__patches = [];
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET').toUpperCase();
          const json = (body: unknown) =>
            Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (method === 'HEAD') {
            return Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': '*/1' } }));
          }
          if (method === 'PATCH') {
            (window as any).__patches.push({ url, body: init?.body ? JSON.parse(init.body) : null });
            return json([]);
          }
          if (url.includes('/rest/v1/profiles')) return json(profile);
          if (url.includes('/rest/v1/blunders')) {
            if (url.includes('select=id') && url.includes('game_id=in')) return json([{ id: 'fresh-1' }, { id: 'fresh-2' }]);
            return json(blunders);
          }
          if (url.includes('/rest/v1/games') && url.includes('select=played_at')) {
            return json(Array.from({ length: gamesToday }, () => ({ played_at: new Date().toISOString() })));
          }
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
      // An automatic sync on load would race the stubs; mark it as just done.
      sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
    },
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile: { ...BASE_PROFILE, ...opts.profile },
      blunders: BLUNDERS,
      gamesToday: opts.gamesToday ?? 0,
    },
  );
}

test('the commitment level sizes the plan and the Play step counts games played today', async ({ page }) => {
  await stub(page, {
    profile: { commitment_level: 'serious', daily_positions_goal: 20, daily_games_goal: 2 },
    gamesToday: 1,
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('commitment-level')).toHaveText('Serious');
  await expect(page.getByText('Play 2 games')).toBeVisible();
  await expect(page.getByText('Train 20 positions')).toBeVisible();
  const playStep = page.locator('[data-plan-step]').filter({ hasText: 'Play 2 games' });
  await expect(playStep.getByText('1/2')).toBeVisible();
  await expect(playStep.getByRole('link', { name: 'Play' })).toHaveAttribute('href', 'https://lichess.org/');
  await expect(page.getByTestId('check-new-games')).toBeVisible();
  // Play comes first in the plan.
  await expect(page.locator('[data-plan-step]').first()).toContainText('Play 2 games');
});

test('a zero-game commitment hides the Play step', async ({ page }) => {
  await stub(page, { profile: { commitment_level: 'custom', daily_positions_goal: 15, daily_games_goal: 0 } });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 15 positions')).toBeVisible();
  await expect(page.getByText(/^Play \d+ games?$/)).toHaveCount(0);
});

test('banked freezes keep a streak alive over a missed day and show as snowflakes', async ({ page }) => {
  await stub(page, { profile: { last_drill_local_date: daysAgo(2), streak_freezes: 2 } });
  await page.goto('/dashboard');
  const freezes = page.getByTestId('streak-freezes').first();
  await expect(freezes).toBeVisible();
  await expect(freezes.locator('svg')).toHaveCount(2);
});

test('picking a commitment on /profile saves it', async ({ page }) => {
  await stub(page);
  await page.goto('/profile#commitment');
  const picker = page.getByTestId('commitment-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Obsessed/ }).click();
  await expect(picker.getByRole('button', { name: /Obsessed/ })).toHaveAttribute('aria-pressed', 'true');
  const patches = await page.evaluate(() => (window as any).__patches as { url: string; body: any }[]);
  const saved = patches.find((p) => p.url.includes('/rest/v1/profiles') && p.body?.commitment_level);
  expect(saved?.body).toEqual({ commitment_level: 'obsessed', daily_positions_goal: 30, daily_games_goal: 3 });
});

test('a sync that finds new blunders is celebrated, and Train them now drills them', async ({ page }) => {
  await stub(page);
  await page.goto('/dashboard');
  await expect(page.getByText("Today's plan")).toBeVisible();
  await expect(page.getByTestId('fresh-blunders-card')).toHaveCount(0);
  // Simulate what runOneUnlocked records after an incremental sync.
  await page.evaluate(async () => {
    // Import the exact module instance the app loaded (Vite may add ?t=…).
    const url =
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => n.includes('/src/state/syncStore.ts')) ?? '/src/state/syncStore.ts';
    const mod = await import(/* @vite-ignore */ url);
    mod.useSyncStore.setState({ freshFinds: { games: 3, blunders: 5, gameIds: ['g9'], at: 4 } });
  });
  const card = page.getByTestId('fresh-blunders-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('5');
  await card.getByRole('button', { name: 'Train them now' }).click();
  await expect(page).toHaveURL(/\/training/);
});

test('custom numbers save on blur, not per keystroke', async ({ page }) => {
  await stub(page);
  await page.goto('/profile#commitment');
  const picker = page.getByTestId('commitment-picker');
  await picker.getByRole('button', { name: 'Custom' }).click();
  const positions = picker.getByLabel('Positions per day');
  await positions.fill('');
  await positions.fill('15');
  await positions.press('Enter');
  const goalPatches = () =>
    page.evaluate(() =>
      ((window as any).__patches as { url: string; body: any }[]).filter((p) => p.body?.commitment_level === 'custom'),
    );
  await expect
    .poll(async () => (await goalPatches()).at(-1)?.body)
    .toEqual({ commitment_level: 'custom', daily_positions_goal: 15, daily_games_goal: 1 });
  // One save for picking Custom, one for the edit: no per-keystroke writes.
  expect((await goalPatches()).length).toBe(2);
});

test('reminder emails can be switched off in /profile', async ({ page }) => {
  await stub(page, { profile: { email_opt_in: true } as Partial<typeof BASE_PROFILE> });
  await page.goto('/profile');
  const setting = page.getByTestId('email-reminders-setting');
  const box = setting.getByRole('checkbox');
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).__patches as { url: string; body: any }[])).find(
        (p) => p.body && 'email_opt_in' in p.body,
      )?.body.email_opt_in,
    )
    .toBe(false);
});
