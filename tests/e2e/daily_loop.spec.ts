import { expect, test, type Page } from '@playwright/test';
import { stubApp, type RpcRecorder } from './helpers/api';

// The daily loop (retention roadmap Phase 1): commitment level sizes the plan,
// the Play step counts games synced today, banked streak freezes show in the
// sidebar, and a sync that finds new blunders is celebrated on the dashboard.

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

async function stub(
  page: Page,
  opts: { profile?: Partial<typeof BASE_PROFILE>; gamesToday?: number; drillsToday?: number; supporter?: boolean } = {},
) {
  const gamesToday = opts.gamesToday ?? 0;
  const today = new Date().toLocaleDateString('en-CA');
  const sessions = opts.drillsToday
    ? [{ id: 's1', user_id: 'e2e-user', local_date: today, started_at: new Date().toISOString(), ended_at: null, blunders_attempted: opts.drillsToday, blunders_correct: opts.drillsToday, cycles_completed: 0 }]
    : [];
  const rec = await stubApp(page, {
    profile: { ...BASE_PROFILE, ...opts.profile },
    blunders: BLUNDERS,
    sessions,
    gameCount: 1,
    rpc: {
      'games.playedSince': () => Array.from({ length: gamesToday }, () => new Date().toISOString()),
      'blunders.liveIdsForGames': () => ['fresh-1', 'fresh-2'],
      'supporters.mine': () =>
        opts.supporter
          ? { status: 'active', current_period_end: null, cancel_at_period_end: false, first_supported_at: new Date().toISOString() }
          : null,
    },
  });
  await page.addInitScript(() => {
    // An automatic sync on load would race the stubs; mark it as just done.
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
  return rec;
}

/** Patches the page sent through profile.update, in order. */
const profilePatches = (rec: RpcRecorder) => rec.callsTo('profile.update').map((c) => c.args.patch as Record<string, any>);

test('the commitment level sizes the plan and the Play step counts games played today', async ({ page }) => {
  await stub(page, {
    profile: { commitment_level: 'serious', daily_positions_goal: 20, daily_games_goal: 2 },
    gamesToday: 1,
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('commitment-level')).toHaveText('Serious');
  await expect(page.getByText('Play 2 games')).toBeVisible();
  await expect(page.getByText('Train 20 positions')).toBeVisible();
  const playStep = page.getByTestId('plan-step-play');
  await expect(playStep.getByText('1/2')).toBeVisible();
  // Play comes last, and stays locked until the rest of the plan is done.
  await expect(page.locator('[data-plan-step]').last()).toContainText('Play 2 games');
  await expect(playStep).toHaveAttribute('data-state', 'locked');
  await expect(playStep.getByText('Unlocks when your plan is done.')).toBeVisible();
  await expect(playStep.getByRole('button', { name: 'Play (locked)' })).toBeDisabled();
  await expect(playStep.getByRole('link', { name: 'Play' })).toHaveCount(0);
});

test('the plan runs Train, Openings, Endgames, Play and always shows every step', async ({ page }) => {
  await stub(page);
  await page.goto('/dashboard');
  const steps = page.locator('[data-plan-step]');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText('Train 10 positions');
  // No opening drills or saved endgames yet: the steps still show, idle, with a way in.
  await expect(steps.nth(1)).toHaveAttribute('data-testid', 'plan-step-openings');
  await expect(steps.nth(1)).toHaveAttribute('data-state', 'idle');
  await expect(steps.nth(1).getByRole('button', { name: 'Openings' })).toBeVisible();
  await expect(steps.nth(2)).toHaveAttribute('data-testid', 'plan-step-endgames');
  await expect(steps.nth(2)).toHaveAttribute('data-state', 'idle');
  await expect(steps.nth(3)).toContainText('Play 1 game');
});

test('Play unlocks once the rest of the plan is done', async ({ page }) => {
  await stub(page, { drillsToday: 10 });
  await page.goto('/dashboard');
  const playStep = page.getByTestId('plan-step-play');
  await expect(playStep).toHaveAttribute('data-state', 'open');
  await expect(playStep.getByRole('link', { name: 'Play' })).toHaveAttribute('href', 'https://lichess.org/');
  await expect(playStep.getByTestId('logo-lichess')).toBeVisible();
  await expect(page.getByTestId('check-new-games')).toBeVisible();
  await expect(page.getByTestId('plan-done')).toHaveCount(0);
});

test('a finished plan invites you to keep going instead of saying see you tomorrow', async ({ page }) => {
  await stub(page, { drillsToday: 10, gamesToday: 1 });
  await page.goto('/dashboard');
  await expect(page.getByTestId('plan-progress')).toContainText('Plan done');
  await expect(page.getByTestId('plan-done')).toContainText('Plan done. Keep going?');
  await expect(page.getByTestId('daily-plan').getByText(/tomorrow/i)).toHaveCount(0);
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

test('Obsessed is a Supporter plan: a free player gets the unlock sheet, nothing saved', async ({ page }) => {
  const rec = await stub(page);
  await page.goto('/profile#commitment');
  const picker = page.getByTestId('commitment-picker');
  await expect(picker.getByTestId('commitment-obsessed')).toHaveAttribute('data-locked', 'true');
  await picker.getByTestId('commitment-obsessed').click();
  await expect(page.getByTestId('supporter-unlock')).toContainText('The Obsessed plan');
  await expect(picker.getByTestId('commitment-obsessed')).toHaveAttribute('aria-pressed', 'false');
  expect(profilePatches(rec).some((p) => p.commitment_level === 'obsessed')).toBe(false);
});

test('picking a commitment on /profile saves it', async ({ page }) => {
  const rec = await stub(page, { supporter: true });
  await page.goto('/profile#commitment');
  const picker = page.getByTestId('commitment-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Obsessed/ }).click();
  await expect(picker.getByRole('button', { name: /Obsessed/ })).toHaveAttribute('aria-pressed', 'true');
  // Every level describes the whole day, openings and endgames included.
  await expect(picker.getByTestId('commitment-summary')).toHaveText(
    'Your day: 30 positions, 3 opening reviews, 2 endgames, 3 games.',
  );
  await expect
    .poll(() => profilePatches(rec).find((p) => p.commitment_level))
    .toEqual({ commitment_level: 'obsessed', daily_positions_goal: 30, daily_games_goal: 3 });
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
  const rec = await stub(page);
  await page.goto('/profile#commitment');
  const picker = page.getByTestId('commitment-picker');
  await picker.getByRole('button', { name: 'Custom' }).click();
  const positions = picker.getByLabel('Positions per day');
  await positions.fill('');
  await positions.fill('15');
  await positions.press('Enter');
  const goalPatches = () => profilePatches(rec).filter((p) => p.commitment_level === 'custom');
  await expect
    .poll(() => goalPatches().at(-1))
    .toEqual({ commitment_level: 'custom', daily_positions_goal: 15, daily_games_goal: 1 });
  // One save for picking Custom, one for the edit: no per-keystroke writes.
  expect(goalPatches().length).toBe(2);
});

test('reminder emails can be switched off in /profile', async ({ page }) => {
  const rec = await stub(page, { profile: { email_opt_in: true } as Partial<typeof BASE_PROFILE> });
  await page.goto('/profile');
  const setting = page.getByTestId('email-reminders-setting');
  const box = setting.getByRole('checkbox');
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(() => profilePatches(rec).find((p) => 'email_opt_in' in p)?.email_opt_in).toBe(false);
});
