import { expect, test, type Page } from '@playwright/test';

// Drives the dashboard as an *established* user (linked account + catalogued
// blunders) so the cards gated behind `!isFirstRun` actually render — the
// shared visual.spec stub is a brand-new user, so it can't cover these.

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

const PROFILE = {
  id: 'e2e-user',
  display_name: 'E2E User',
  avatar_url: null,
  lichess_username: 'tester', // a linked account -> not first-run
  chesscom_username: null,
  preferred_rated_only: false,
  preferred_time_controls: [],
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: new Date().toISOString(),
  current_streak_days: 3,
  longest_streak_days: 8,
  last_drill_local_date: null,
  timezone: null,
  board_theme: 'default',
};

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Three positions across ladder rungs: cycle 1, cycle 2, and a fresh one.
const BLUNDERS = [
  { id: 'b1', game_id: 'g1', fen: STARTPOS, move_number: 10, played_move: 'e2e4', correct_moves: [{ move: 'd2d4', eval: 20 }], eval_before: 10, eval_after: -200, eval_swing: 210, side_to_move: 'white', cycle_number: 1, last_drilled_at: PAST, next_drill_at: PAST, times_correct: 1, times_attempted: 1, last_drill_failed: false, created_at: PAST, phase: 'opening' },
  { id: 'b2', game_id: 'g1', fen: STARTPOS, move_number: 20, played_move: 'g1f3', correct_moves: [{ move: 'b1c3', eval: 15 }], eval_before: 5, eval_after: -180, eval_swing: 185, side_to_move: 'white', cycle_number: 2, last_drilled_at: PAST, next_drill_at: PAST, times_correct: 2, times_attempted: 2, last_drill_failed: false, created_at: PAST, phase: 'middlegame' },
  { id: 'b3', game_id: 'g1', fen: STARTPOS, move_number: 30, played_move: 'f1c4', correct_moves: [{ move: 'd2d4', eval: 0 }], eval_before: 0, eval_after: -150, eval_swing: 150, side_to_move: 'white', cycle_number: 0, last_drilled_at: null, next_drill_at: PAST, times_correct: 0, times_attempted: 0, last_drill_failed: false, created_at: PAST, phase: 'endgame' },
];

// Same vault, but nothing drilled yet — the explainer only shows before the first drill.
const UNDRILLED_BLUNDERS = BLUNDERS.map((b) => ({
  ...b,
  cycle_number: 0,
  last_drilled_at: null,
  times_correct: 0,
  times_attempted: 0,
}));

async function stubRichAuth(
  page: Page,
  opts: { drillsToday?: number; blunders?: typeof BLUNDERS } = {},
) {
  await page.addInitScript(
    ({ session, project, profile, blunders, drillsToday }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (
            init?.method ??
            (typeof input === 'object' ? input?.method : undefined) ??
            'GET'
          ).toUpperCase();
          const json = (body: unknown) =>
            Promise.resolve(
              new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': '*/3' } }),
            );
          }
          if (url.includes('/rest/v1/profiles')) return json(profile);
          if (url.includes('/rest/v1/blunders')) return json(blunders);
          if (url.includes('/rest/v1/training_sessions')) {
            if (drillsToday > 0) {
              const today = new Date().toLocaleDateString('en-CA');
              return json([
                {
                  id: 's1',
                  user_id: session.user.id,
                  started_at: new Date().toISOString(),
                  ended_at: new Date().toISOString(),
                  local_date: today,
                  blunders_attempted: drillsToday,
                  blunders_correct: drillsToday,
                  cycles_completed: 0,
                },
              ]);
            }
            return json([]);
          }
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile: PROFILE,
      blunders: opts.blunders ?? BLUNDERS,
      drillsToday: opts.drillsToday ?? 0,
    },
  );
}

test('dashboard renders the renamed + new cards for an established user', async ({ page }) => {
  await stubRichAuth(page);
  await page.goto('/dashboard');
  await expect(page.getByText("Today's plan")).toBeVisible();
  await expect(page.getByText('Training timeline')).toBeVisible();
  // Stat strip leads for returning users; the explainer is gone once they've drilled.
  await expect(page.getByText('Day streak')).toBeVisible();
  await expect(page.getByText('Points rescued')).toBeVisible();
  await expect(page.getByText('How training works')).toHaveCount(0);
  await expect(page.getByText(/positions? due/)).toBeVisible();
  // Timeline now combines the per-stage graph with the total blunder count.
  await expect(page.getByText(/blunders in vault/i)).toBeVisible();
  // Daily habit card surfaces the nearest achievement as a return nudge.
  await expect(page.getByText('Next achievement')).toBeVisible();
  // Rank badge (compact) headlines mastery, not reviews.
  await expect(page.getByText('Pawn', { exact: true })).toBeVisible();
  await expect(page.getByText(/0 mastered/i)).toBeVisible();
  // No "reviews" wording remains on the dashboard badge.
  await expect(page.getByText(/\breviews\b/i)).toHaveCount(0);
});

test('default board uses the soft tan, not the garish gold', async ({ page }) => {
  await stubRichAuth(page);
  await page.goto('/dashboard');
  const light = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--board-light').trim().toLowerCase(),
  );
  const dark = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--board-dark').trim().toLowerCase(),
  );
  expect(light).toBe('#f0d9b5');
  expect(dark).toBe('#c0ad90');
});

test('picking a theme persists across a reload', async ({ page }) => {
  await stubRichAuth(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: /Green/i }).click();
  expect(await page.evaluate(() => localStorage.getItem('patternchess.boardTheme'))).toBe('green');
  await page.reload();
  // The device's stored choice wins — AuthProvider must not revert it to the
  // profile's default theme.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('green');
});

test('how-it-works explainer collapses to a disclosure once dismissed', async ({ page }) => {
  await stubRichAuth(page, { blunders: UNDRILLED_BLUNDERS });
  await page.goto('/dashboard');
  await expect(page.getByText('How training works')).toBeVisible();
  await page.getByRole('button', { name: /Got it/i }).click();
  await expect(page.getByRole('button', { name: /Got it/i })).toHaveCount(0);
  const disclosure = page.getByRole('button', { name: /Show the training explainer/i });
  await expect(disclosure).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Got it/i })).toHaveCount(0);
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.getByRole('button', { name: /Got it/i })).toBeVisible();
});

test('keep-training stays visible after the daily goal is met', async ({ page }) => {
  await stubRichAuth(page, { drillsToday: 10 });
  await page.goto('/dashboard');
  // 10/10 drills today — the goal is met, and the CTA must remain available.
  await expect(page.getByText('/10')).toBeVisible();
  await expect(page.getByRole('button', { name: /Keep training/i })).toBeVisible();
});
