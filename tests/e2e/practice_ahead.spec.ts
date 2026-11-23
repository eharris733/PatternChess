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

async function stub(page: Page, blunders: Record<string, unknown>[]) {
  const rec = await stubApp(page, {
    profile: PROFILE,
    blunders,
    games: [GAME],
    rpc: {
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
  await expect(step).toContainText('1 due');
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
  await expect(step).toContainText("Queue's clear. Practice ahead, it still counts.");
  await step.getByRole('button', { name: 'Practice ahead' }).click();

  await expect(page.getByTestId('training-focus-banner')).toContainText('Practice ahead · 2 positions');
  await expect(page.getByText('White to play')).toBeVisible();
  await dragMove(page, { file: 6, rank: 4 }, { file: 7, rank: 5 }); // gxh5
  await expect(page.getByText('Solution correct')).toBeVisible();
  // The early answer is recorded like any review (cycle advanced, rescheduled).
  const write = await rec.waitFor('blunders.updateAfterDrill', (a) => a.id === 't1');
  expect(write.args.patch).toMatchObject({ cycle_number: 2 });
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

test('the landing has Openings and Endgames focuses that lead back to their pages', async ({ page }) => {
  await stub(page, [
    tactic(),
    tactic({ id: 't3', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', correct_moves: [{ move: 'h1h8', eval: 900 }], phase: 'endgame', next_drill_at: SOON }),
    opening(),
  ]);
  await page.goto('/training');
  await expect(page.getByTestId('focus-openings')).toContainText('1 due');
  // No endgame position is due, so the tile practices ahead.
  await expect(page.getByTestId('focus-endgames')).toContainText('Practice ahead');
  await page.getByTestId('focus-endgames').click();
  const banner = page.getByTestId('training-focus-banner');
  await expect(banner).toContainText('Endgame · practice ahead · 1 position');
  await banner.getByRole('button', { name: 'Back to Endgames' }).click();
  await expect(page).toHaveURL(/\/endgames$/);
});
