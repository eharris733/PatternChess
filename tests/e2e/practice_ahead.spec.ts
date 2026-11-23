import { expect, test, type Page } from '@playwright/test';
import { stubApp } from './helpers/api';

// The training loop never dead-ends: an openings session stays in openings
// through "Keep training", every empty queue offers "Practice ahead"
// (blunders.upcoming, drilled through the normal SR rules), and /training's
// landing has Openings and Endgames focuses that lead back to their pages.

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();
const LATER = new Date(Date.now() + 5 * 86_400_000).toISOString();

const PROFILE = {
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
  current_streak_days: 0,
  longest_streak_days: 0,
  last_drill_local_date: null,
  timezone: null,
  board_theme: 'default',
  show_engine_evals: false,
  reveal_before_solve: false,
  autoplay_refutation: false,
  show_answer_on_miss: false,
  commitment_level: 'regular',
  daily_positions_goal: 10,
  daily_games_goal: 1,
};

// White to play with the black queen en prise: gxh5 is the only good move.
const FREE_QUEEN = '4k3/8/8/7q/6P1/8/8/4K3 w - - 0 1';

function tactic(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    game_id: 'g1',
    kind: 'tactic',
    fen: FREE_QUEEN,
    move_number: 1,
    played_move: 'e1d1',
    correct_moves: [{ move: 'g4h5', eval: 900 }],
    eval_before: 900,
    eval_after: -800,
    eval_swing: 1700,
    side_to_move: 'white',
    cycle_number: 1,
    last_drilled_at: PAST,
    next_drill_at: PAST,
    times_correct: 1,
    times_attempted: 1,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'middlegame',
    ...overrides,
  };
}

const THEORY = {
  openingFamily: "King's Pawn Game",
  openingName: "King's Pawn Game: Wayward Queen Attack",
  theoryMoves: [{ uci: 'g1f3', san: 'Nf3', games: 900, share: 80, moverWinPct: 38, tier: 'otb' }],
  positionGames: 1100,
  source: 'book',
  v: 2,
};

function opening(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    game_id: 'g1',
    kind: 'opening',
    // After 1.e4 e5 the user played 2.Qh5; theory is Nf3.
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    move_number: 2,
    played_move: 'd1h5',
    correct_moves: [{ move: 'g1f3', eval: 30 }],
    eval_before: 30,
    eval_after: -40,
    eval_swing: 70,
    side_to_move: 'white',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: PAST,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'opening',
    solution_line: null,
    drill_data: THEORY,
    ...overrides,
  };
}

// A later opening drill from the same game (after 2...Nc6), not due yet.
const UPCOMING_OPENING = opening({
  id: 'o2',
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3',
  move_number: 3,
  played_move: 'f1c4',
  correct_moves: [{ move: 'h5f3', eval: 10 }],
  next_drill_at: SOON,
  drill_data: { ...THEORY, theoryMoves: [{ uci: 'h5f3', san: 'Qf3', games: 50, share: 60, moverWinPct: 40, tier: 'otb' }] },
});

const GAME = {
  id: 'g1',
  platform: 'lichess',
  username: 'tester',
  opponent: 'rival',
  pgn: '1. e4 e5 2. Qh5 Nc6 3. Bc4 g6 *',
  time_control: '600',
  rated: false,
  result: null,
  played_at: PAST,
  created_at: PAST,
  analyzed_at: PAST,
  eco: null,
  opening_name: null,
  user_color: 'white',
  user_rating: null,
  opponent_rating: null,
  clock_per_ply: null,
  total_plies: 6,
  parsed_metadata_at: null,
};

async function stub(
  page: Page,
  blunders: Record<string, unknown>[],
  opts: { profile?: Record<string, unknown>; sessions?: Record<string, unknown>[]; supporter?: boolean } = {},
) {
  const rec = await stubApp(page, {
    profile: { ...PROFILE, ...opts.profile },
    blunders,
    games: [GAME],
    ...(opts.sessions ? { sessions: opts.sessions } : {}),
    rpc: {
      // Supporters train past their daily goal; free players stop at it.
      'supporters.mine': () =>
        opts.supporter
          ? { status: 'active', current_period_end: null, cancel_at_period_end: false, first_supported_at: new Date().toISOString() }
          : null,
      // The SR write lands on the seeded row, so the next queue sees it.
      'blunders.updateAfterDrill': (a) => {
        const row = blunders.find((b) => b.id === a.id);
        if (row) Object.assign(row, a.patch ?? {});
        return null;
      },
      'sessions.create': (a) => ({
        id: 's1',
        user_id: 'e2e-user',
        started_at: new Date().toISOString(),
        ended_at: null,
        local_date: a.localDate,
        blunders_attempted: 0,
        blunders_correct: 0,
        cycles_completed: 0,
      }),
    },
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
  return rec;
}

async function dragMove(page: Page, from: { file: number; rank: number }, to: { file: number; rank: number }) {
  const board = page.locator('cg-board');
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width } = box!;
  const sq = width / 8;
  const fromPx = { x: x + sq * from.file + sq / 2, y: y + sq * (8 - from.rank) + sq / 2 };
  const toPx = { x: x + sq * to.file + sq / 2, y: y + sq * (8 - to.rank) + sq / 2 };
  await page.mouse.move(fromPx.x, fromPx.y);
  await page.mouse.down();
  await page.mouse.move(toPx.x, toPx.y, { steps: 8 });
  await page.mouse.up();
}

test('an openings session stays in openings: Keep training never leaks into the main queue', async ({ page }) => {
  const rec = await stub(page, [opening(), UPCOMING_OPENING, tactic()]);
  await page.goto('/dashboard');
  const step = page.getByTestId('plan-step-openings');
  await expect(step).toContainText('1 in queue');
  await step.getByRole('button', { name: 'Review' }).click();

  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByTestId('training-focus-banner')).toContainText('Opening reviews · 1 position');
  await page.getByTestId('skip-intro').click();
  await expect(page.getByTestId('drill-prompt')).toHaveText('Play the move for White');
  await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 }); // Nf3
  await expect(page.getByTestId('opening-verdict')).toContainText('Great!');
  await page.keyboard.press('Space');

  const done = page.getByTestId('training-complete');
  await expect(done).toBeVisible();
  await expect(done.getByTestId('complete-focus')).toHaveText('Focus: Opening reviews');
  await expect(done.getByRole('button', { name: 'Back to Openings' })).toBeVisible();
  await done.getByRole('button', { name: 'Keep training' }).click();

  // The due tactic must not show up: the focus is exhausted, so the screen
  // offers practice ahead in openings and the way back.
  const empty = page.getByTestId('training-empty');
  await expect(empty.getByRole('heading', { name: 'Nothing due in Opening reviews' })).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Back to Openings' })).toBeVisible();
  await expect(page.locator('cg-board')).toHaveCount(0);
  await empty.getByTestId('practice-ahead').click();

  // The drill just solved is now "upcoming" too, so the batch holds both.
  await expect(page.getByTestId('training-focus-banner')).toContainText(/Opening reviews · practice ahead · \d+ positions?/);
  await page.getByTestId('skip-intro').click();
  await expect(page.getByTestId('drill-prompt')).toHaveText('Play the move for White');
  const upcomingCalls = rec.callsTo('blunders.upcoming');
  expect(upcomingCalls.some((c) => c.args.kind === 'opening')).toBe(true);
  expect(upcomingCalls.every((c) => c.args.kind === 'opening' || c.args.excludeKind === 'opening')).toBe(true);

  await page.getByTestId('training-focus-banner').getByRole('button', { name: 'Back to Openings' }).click();
  await expect(page).toHaveURL(/\/openings$/);
});

test('a clear queue offers Practice ahead from the plan, and it drills through the SR rules', async ({ page }) => {
  const upcomingTactic = tactic({ next_drill_at: SOON });
  const rec = await stub(page, [upcomingTactic, tactic({ id: 't2', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', correct_moves: [{ move: 'h1h8', eval: 900 }], next_drill_at: LATER })]);
  await page.goto('/dashboard');
  const step = page.getByTestId('plan-step-train');
  await expect(step).toContainText('Queue clear: practice ahead');
  await step.getByRole('button', { name: 'Practice ahead' }).click();

  await expect(page.getByTestId('training-focus-banner')).toContainText('Practice ahead · 2 positions');
  await expect(page.getByText('White to play')).toBeVisible();
  await dragMove(page, { file: 6, rank: 4 }, { file: 7, rank: 5 }); // gxh5
  await expect(page.getByText('Solution correct')).toBeVisible();
  // Not due yet, so it's practice: mastery stays put and so does the due date
  // (advanceSr); the drill time still lands.
  await expect(page.getByTestId('sr-practice')).toContainText('Practice. Mastery moves when');
  const write = await rec.waitFor('blunders.updateAfterDrill', (a) => a.id === 't1');
  expect(write.args.patch).toMatchObject({ cycle_number: 1, next_drill_at: new Date(SOON).toISOString() });
  const calls = rec.callsTo('blunders.upcoming');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0].args).toMatchObject({ excludeKind: 'opening', limit: 10 });
});

test('an empty /training offers Practice ahead instead of a dead end', async ({ page }) => {
  await stub(page, [tactic({ next_drill_at: SOON })]);
  await page.goto('/training');
  const empty = page.getByTestId('training-empty');
  await expect(empty.getByRole('heading', { name: "You're caught up" })).toBeVisible();
  await expect(page.getByText(/tomorrow/i)).toHaveCount(0);
  await empty.getByTestId('practice-ahead').click();
  await expect(page.getByTestId('training-focus-banner')).toContainText('Practice ahead · 1 position');
  await expect(page.getByText('White to play')).toBeVisible();
});

test('the empty state waits for the practice-ahead lookup instead of flashing a dead end', async ({ page }) => {
  await stub(page, [tactic({ next_drill_at: SOON })]);
  // Hold blunders.upcoming back, as after a finished focus whose writes just
  // dropped the cached lookup.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/rpc/blunders.upcoming', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/training');
  const empty = page.getByTestId('training-empty');
  await expect(empty.getByTestId('training-empty-pending')).toBeVisible();
  await expect(empty.getByText("Nothing to drill yet. Play a game and we'll find fresh material.")).toHaveCount(0);
  await expect(empty.getByRole('button', { name: /Check for new games|Pick a focus/ })).toHaveCount(0);
  release();
  await expect(empty.getByTestId('practice-ahead')).toBeVisible();
  await expect(empty.getByTestId('training-empty-pending')).toHaveCount(0);
  await expect(empty.getByText('Keep going with the positions due next. Results count like any review.')).toBeVisible();
});

test('the landing has Openings and Endgames focuses that lead back to their pages', async ({ page }) => {
  await stub(page, [
    tactic(),
    tactic({ id: 't3', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', correct_moves: [{ move: 'h1h8', eval: 900 }], phase: 'endgame', next_drill_at: SOON }),
    opening(),
  ]);
  await page.goto('/training');
  await expect(page.getByTestId('focus-openings')).toContainText('1 in queue');
  // No endgame position is due, so the tile practices ahead.
  await expect(page.getByTestId('focus-endgames')).toContainText('Practice ahead');
  await page.getByTestId('focus-endgames').click();
  const banner = page.getByTestId('training-focus-banner');
  await expect(banner).toContainText('Endgame · practice ahead · 1 position');
  await banner.getByRole('button', { name: 'Back to Endgames' }).click();
  await expect(page).toHaveURL(/\/endgames$/);
});

// Today's positions goal (1) is already met by an earlier session, so the
// session below finishes the Train step and nothing else.
function goalMetToday() {
  return [
    {
      id: 's0',
      user_id: 'e2e-user',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      local_date: new Date().toLocaleDateString('en-CA'),
      blunders_attempted: 1,
      blunders_correct: 1,
      cycles_completed: 0,
    },
  ];
}

async function solveFreeQueen(page: Page) {
  await expect(page.getByText('White to play')).toBeVisible();
  await dragMove(page, { file: 6, rank: 4 }, { file: 7, rank: 5 }); // gxh5
  await expect(page.getByText('Solution correct')).toBeVisible();
  await page.keyboard.press('Space');
}

test('a finished session says "Session done" and points at the next step while the plan is open', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('pc:plan-done-shown'));
  await stub(page, [tactic(), UPCOMING_OPENING], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
    supporter: true,
  });
  await page.goto('/training');
  await page.getByRole('button', { name: 'Review 1 position' }).click();
  await solveFreeQueen(page);

  const done = page.getByTestId('training-complete');
  await expect(done).toBeVisible();
  // The positions goal is met, but the Openings step isn't: not "Today's plan: done".
  const next = done.getByTestId('complete-next');
  await expect(next).toContainText('Review 1 opening');
  await expect(done.getByRole('heading', { name: 'Session done' })).toBeVisible();
  await expect(done.getByRole('heading', { name: "Today's plan: done" })).toHaveCount(0);
  await next.getByRole('button', { name: 'Practice' }).click();
  await expect(page.getByTestId('training-focus-banner')).toContainText('Opening reviews · practice ahead · 1 position');
});

test('"Today\'s plan: done" shows once every plan step is done', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('pc:plan-done-shown'));
  await stub(page, [tactic()], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
    supporter: true,
  });
  await page.goto('/training');
  await page.getByRole('button', { name: 'Review 1 position' }).click();
  await solveFreeQueen(page);
  const done = page.getByTestId('training-complete');
  await expect(done.getByRole('heading', { name: "Today's plan: done" })).toBeVisible();
  await expect(done.getByTestId('complete-next')).toHaveCount(0);
});

test('a free player at the day\'s goal sees the lock and its countdown, and a click opens the daily-limit sheet', async ({ page }) => {
  // An opening still to review keeps the whole plan open, so the lock is about positions.
  const rec = await stub(page, [tactic(), UPCOMING_OPENING], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
  });
  await page.goto('/training');
  const banner = page.getByTestId('limit-banner-positions');
  await expect(banner).toContainText("Today's positions: done");
  await expect(banner.getByTestId('daily-limit-countdown')).toContainText(/Unlocks in (\d+h \d\dm|\d+m \d\ds|\d+s)/);
  await page.getByRole('button', { name: 'Review 1 position' }).click();

  const sheet = page.getByTestId('daily-limit');
  await expect(sheet).toContainText('You trained your 1 position for today.');
  await expect(sheet.getByTestId('daily-limit-timer')).toHaveText(/^(\d+h \d\dm|\d+m \d\ds|\d+s)$/);
  // Annual is preselected: $5/month, billed annually; monthly is $12.
  await expect(sheet.getByTestId('supporter-plan-annual')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('supporter-plan-annual')).toContainText('$5/month');
  await expect(sheet.getByTestId('supporter-plan-annual')).toContainText('Billed annually ($60/year)');
  await expect(sheet.getByTestId('supporter-plan-monthly')).toContainText('$12/month');
  await expect(sheet.getByTestId('supporter-unlock-checkout')).toHaveText('Train unlimited');
  // No session started: the board never showed and nothing was written.
  await expect(page.locator('cg-board')).toHaveCount(0);
  expect(rec.callsTo('blunders.updateAfterDrill')).toHaveLength(0);
  await sheet.getByTestId('daily-limit-dismiss').click();
  await expect(sheet).toHaveCount(0);
});

test('the plan card locks a finished step with a countdown; supporters are never locked', async ({ page }) => {
  await stub(page, [tactic(), UPCOMING_OPENING], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
  });
  await page.goto('/dashboard');
  const step = page.getByTestId('plan-step-train');
  await expect(step.getByTestId('plan-step-train-unlocks')).toContainText('Unlocks in');
  await step.locator('[data-locked="daily-limit"]').click();
  await expect(page.getByTestId('daily-limit')).toContainText("Today's positions: done");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('supporters keep training past the goal with no lock', async ({ page }) => {
  await stub(page, [tactic(), UPCOMING_OPENING], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
    supporter: true,
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('plan-step-train-unlocks')).toHaveCount(0);
  await page.goto('/training');
  await expect(page.getByTestId('limit-banner-positions')).toHaveCount(0);
});

test('the sidebar meter counts today\'s positions, then shows the countdown and opens the sheet', async ({ page }) => {
  await stub(page, [tactic(), UPCOMING_OPENING], {
    profile: { commitment_level: 'custom', daily_positions_goal: 2, daily_games_goal: 0 },
    sessions: goalMetToday(), // 1 of 2
  });
  await page.goto('/dashboard');
  const meter = page.locator('aside').getByTestId('usage-meter');
  await expect(meter.getByTestId('usage-meter-count')).toHaveText('1/2');
  await expect(meter).toHaveAttribute('data-locked', 'false');
  await meter.click();
  await expect(page).toHaveURL(/\/training$/);
});

test('a used-up meter shows the countdown and Go unlimited; supporters see a heart instead', async ({ page }) => {
  await stub(page, [tactic()], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
  });
  await page.goto('/dashboard');
  const meter = page.locator('aside').getByTestId('usage-meter');
  await expect(meter).toHaveAttribute('data-locked', 'true');
  await expect(meter.getByTestId('usage-meter-unlocks')).toContainText('Unlocks in');
  await expect(meter.getByTestId('usage-meter-cta')).toHaveText('Go unlimited');
  await expect(page.locator('aside').getByTestId('nav-supporter-mark')).toHaveCount(0);
  await meter.click();
  await expect(page.getByTestId('daily-limit')).toContainText("Today's positions: done");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('supporters get no meter, just the heart by their name', async ({ page }) => {
  await stub(page, [tactic()], {
    profile: { commitment_level: 'custom', daily_positions_goal: 1, daily_games_goal: 0 },
    sessions: goalMetToday(),
    supporter: true,
  });
  await page.goto('/dashboard');
  await expect(page.locator('aside').getByTestId('nav-supporter-mark')).toBeVisible();
  await expect(page.getByTestId('usage-meter')).toHaveCount(0);
});

const NOW = new Date().toISOString();
const reviewedToday = (id: string) => opening({ id, last_drilled_at: NOW, next_drill_at: SOON, cycle_number: 1, times_attempted: 1, times_correct: 1 });

test('opening reviews stop at 3 a day for free players, mid-session too', async ({ page }) => {
  // Two reviewed today, two due (the same position twice, so either order solves the same way).
  const rec = await stub(page, [reviewedToday('od1'), reviewedToday('od2'), opening(), opening({ id: 'o3' })]);
  await page.goto('/openings');
  await page.getByTestId('review-due').click();
  await expect(page.getByTestId('training-focus-banner')).toContainText('Opening reviews · 2 positions');
  await page.getByTestId('skip-intro').click();
  await expect(page.getByTestId('drill-prompt')).toHaveText('Play the move for White');
  await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 }); // Nf3
  await expect(page.getByTestId('opening-verdict')).toContainText('Great!');
  await page.keyboard.press('Space');

  // The third review of the day was the last one: the second due drill waits.
  const done = page.getByTestId('training-complete');
  await expect(done.getByRole('heading', { name: "Today's opening reviews: done" })).toBeVisible();
  await expect(done.getByTestId('training-capped')).toContainText('You reviewed your 3 openings for today.');
  await expect(done.getByTestId('daily-limit-countdown')).toContainText('Unlocks in');
  expect(rec.callsTo('blunders.updateAfterDrill')).toHaveLength(1);
  await done.getByTestId('training-capped-upsell').click();
  await expect(page.getByTestId('daily-limit')).toContainText("Today's opening reviews: done");
});

test('with 3 openings reviewed today, Review on /openings opens the daily-limit sheet', async ({ page }) => {
  await stub(page, [reviewedToday('od1'), reviewedToday('od2'), reviewedToday('od3'), opening()]);
  await page.goto('/openings');
  await expect(page.getByTestId('openings-unlocks')).toContainText('Unlocks in');
  await page.getByTestId('review-due').click();
  await expect(page.getByTestId('daily-limit')).toContainText('You reviewed your 3 openings for today.');
  await expect(page).toHaveURL(/\/openings$/);
});

test('a focus with no positions at all says "None yet" and leads to its page', async ({ page }) => {
  await stub(page, [tactic()]);
  await page.goto('/training');
  await expect(page.getByTestId('focus-openings')).toContainText('None yet');
  await expect(page.getByTestId('focus-endgames')).toContainText('None yet');
  await expect(page.getByText('Practice ahead')).toHaveCount(0);
  await page.getByTestId('focus-openings').click();
  await expect(page).toHaveURL(/\/openings$/);
});
