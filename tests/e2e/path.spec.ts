import { expect, test, type Page } from '@playwright/test';
import { E2E_USER, stubApp } from './helpers/api';

// The progression ladder: /path counts lifetime positions trained, the daily
// plan shows the next unlock, and supporters can open every rung.

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
  const solved = opts.solved ?? 0;
  // One row carrying all the first-attempt solves: BlunderStats.reviewed = sum(times_correct).
  const blunders = solved
    ? [{ id: 'b1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', kind: 'tactic', times_correct: solved, times_attempted: solved, cycle_number: 1, last_drilled_at: new Date().toISOString(), next_drill_at: new Date(Date.now() + 86_400_000).toISOString() }]
    : [];
  const rec = await stubApp(page, {
    user: (opts.signedIn ?? true) ? E2E_USER : null,
    profile: { ...BASE_PROFILE, email_opt_in: true, app_opens: (opts.opens ?? 1) - 1, ...opts.profile },
    blunders,
    gameCount: 1,
    rpc: {
      'profile.bumpAppOpen': () => opts.opens ?? 1,
      'supporters.mine': () => opts.supporter ?? null,
    },
  });
  // Article bodies (functions/api/articles): this user is not a supporter.
  await page.route('**/api/articles/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
  return rec;
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
