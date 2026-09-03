import { expect, test, type Page } from '@playwright/test';

// Endgame trainer: adjudicated play-outs vs the engine. Uses a KQ vs K position
// where g5-g7 is checkmate (terminal success) and g5-g6 is stalemate (terminal
// fail on a win target) so both paths resolve without waiting on the 10-move
// hold adjudication.

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
};

const PAST = new Date(Date.now() - 86_400_000).toISOString();

// White: Kf6, Qg5. Black: Kh8. Qg7# mates; Qg6?? stalemates.
const KQK_WIN = '7k/8/5K2/6Q1/8/8/8/8 w - - 0 60';

const GAME = {
  id: 'g1',
  platform: 'lichess',
  username: 'tester',
  opponent: 'rival',
  pgn: '',
  time_control: '600+0',
  rated: true,
  result: '0-1',
  played_at: PAST,
  created_at: PAST,
  analyzed_at: PAST,
  eco: null,
  opening_name: null,
  user_color: 'white',
  user_rating: 1500,
  opponent_rating: 1500,
  clock_per_ply: null,
  total_plies: 120,
  parsed_metadata_at: null,
};

function makeEndgameDrillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b-endgame',
    game_id: 'g1',
    fen: KQK_WIN,
    move_number: 60,
    played_move: 'g5g6',
    correct_moves: [{ move: 'g5g7', eval: 9999 }],
    eval_before: 9999,
    eval_after: 0,
    eval_swing: 50,
    side_to_move: 'white',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: PAST,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'endgame',
    solution_line: { pv: ['g5g7'], playedPv: [], v: 1 },
    motifs: [],
    kind: 'endgame',
    drill_data: { deservedResult: 'win', sourceGameId: 'g1', v: 1 },
    ...overrides,
  };
}

const SCENARIO = {
  id: 's1',
  user_id: 'e2e-user',
  game_id: 'g1',
  blunder_id: 'b1',
  start_fen: KQK_WIN,
  user_color: 'white',
  deserved_result: 'win',
  actual_result: 'loss',
  status: 'pending',
  attempts: 0,
  last_played_at: null,
  created_at: PAST,
};

async function stubEndgameAuth(
  page: Page,
  opts: { blunders: Record<string, unknown>[]; scenarios: Record<string, unknown>[] },
) {
  await page.addInitScript(
    ({ session, project, profile, blunders, scenarios, game }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : (input?.url ?? '');
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
          if (url.includes('/rest/v1/endgame_scenarios')) return json(scenarios);
          if (url.includes('/rest/v1/blunders')) return json(blunders);
          if (url.includes('/rest/v1/games')) {
            // getGame(id) parses a single object; getGames() expects an array.
            // (Match ?id=eq./&id=eq. exactly — 'user_id=eq.' contains 'id=eq.'.)
            return /[?&]id=eq\./.test(url) ? json(game) : json([game]);
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
      blunders: opts.blunders,
      scenarios: opts.scenarios,
      game: GAME,
    },
  );
}

async function dragMove(
  page: Page,
  from: { file: number; rank: number },
  to: { file: number; rank: number },
) {
  const board = page.locator('cg-board');
  await expect(board).toBeVisible();
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

// The play-out becomes movable once the opening engine eval lands.
async function waitForSolving(page: Page) {
  await expect(page.getByText(/Loading position|Setting up the position/)).toHaveCount(0, {
    timeout: 60_000,
  });
}

test('an endgame drill in the training queue is played out and passes on mate', async ({
  page,
}) => {
  await stubEndgameAuth(page, { blunders: [makeEndgameDrillRow()], scenarios: [] });
  await page.goto('/training');

  // Concealed presentation — same prompt as a tactic drill.
  await expect(page.getByText('White to play')).toBeVisible({ timeout: 30_000 });
  await waitForSolving(page);

  // Qg7# — terminal success.
  await dragMove(page, { file: 6, rank: 5 }, { file: 6, rank: 7 });
  await expect(page.getByText(/Checkmate — converted|Win secured/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: /Next/ })).toBeVisible();
});

test('stalemating in a training-queue play-out fails the drill', async ({ page }) => {
  await stubEndgameAuth(page, { blunders: [makeEndgameDrillRow()], scenarios: [] });
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible({ timeout: 30_000 });
  await waitForSolving(page);

  // Qg6?? — stalemate, forfeits the win.
  await dragMove(page, { file: 6, rank: 5 }, { file: 6, rank: 6 });
  await expect(page.getByText(/Stalemate — the win slipped away/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: /Continue/ })).toBeVisible();
});

test('the endgames tab lists dropped endgames and rescues one on mate', async ({ page }) => {
  await stubEndgameAuth(page, { blunders: [], scenarios: [SCENARIO] });
  await page.goto('/endgames');

  // Grouped by endgame family with a static board preview on the card.
  await expect(page.getByText('Queen endgames')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Winning — lost')).toBeVisible();
  await expect(page.locator('li cg-board').first()).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await expect(page.getByText('Convert this win.')).toBeVisible();
  await waitForSolving(page);

  await dragMove(page, { file: 6, rank: 5 }, { file: 6, rank: 7 });
  await expect(page.getByText(/point rescued/)).toBeVisible({ timeout: 60_000 });

  // The primary action returns to the list (Space does the same).
  await page.getByRole('button', { name: 'Return to list (Space)' }).click();
  await expect(page.getByText('Queen endgames')).toBeVisible();
});

// White Rb1+Ke1 vs black Ra8+Ke8: dead draw, but Rb8+?? drops the rook to Rxb8.
const RR_DRAW = 'r3k3/8/8/8/8/8/8/1R2K3 w - - 0 40';

const DRAW_SCENARIO = {
  ...SCENARIO,
  id: 's2',
  start_fen: RR_DRAW,
  deserved_result: 'draw',
  actual_result: 'loss',
};

test('an eval-judged slip shows hint first, then the engine refutation line', async ({ page }) => {
  await stubEndgameAuth(page, { blunders: [], scenarios: [DRAW_SCENARIO] });
  await page.goto('/endgames');

  await expect(page.getByText('Rook endgames')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Holdable — lost')).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await expect(page.getByText('Hold this draw.')).toBeVisible();

  // The hint button is present for the whole play-out — including while the
  // position is still loading or the opponent is thinking (it disables, it
  // never disappears).
  await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
  await waitForSolving(page);

  // Two-level hint, like the tactics trainer.
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByRole('button', { name: 'Show move' })).toBeVisible();

  // Rb8+?? — hangs the rook; the eval judge calls the slip.
  await dragMove(page, { file: 1, rank: 1 }, { file: 1, rank: 8 });
  await expect(page.getByText(/That move gives up the draw/)).toBeVisible({ timeout: 60_000 });

  // The refutation viewer explains the fail, starting with the played move.
  await expect(page.getByText('Why the draw is gone')).toBeVisible();
  await expect(page.getByText(/engine holds with/)).toBeVisible();
  const refutationMove = page.locator('[data-key="r1"]');
  await expect(refutationMove).toBeVisible();
  await refutationMove.click();
  await expect(refutationMove).toHaveClass(/ring-accent/);
  await expect(page.locator('cg-board')).toBeVisible();

  // Arrow keys step the line, same as the training shell.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-key="r2"]')).toHaveClass(/ring-accent/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-key="r0"]')).toHaveClass(/ring-accent/);

  await expect(page.getByRole('button', { name: 'Add to training queue' })).toBeVisible();
});

test('the dashboard summarizes dropped endgames and links to the trainer', async ({ page }) => {
  await stubEndgameAuth(page, {
    blunders: [],
    scenarios: [SCENARIO, { ...DRAW_SCENARIO, status: 'passed' }],
  });
  await page.goto('/dashboard');

  // Breakdown card: points at stake, per-group rescue progress, status counts.
  await expect(page.getByText('Dropped endgames')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('point waiting to be rescued')).toBeVisible();
  await expect(page.getByText('Missed wins')).toBeVisible();
  await expect(page.getByText('Missed draws')).toBeVisible();
  await expect(page.getByText('1 unplayed · 1 rescued')).toBeVisible();

  // CTA lands on the trainer list.
  await page.getByRole('button', { name: 'Play them out' }).click();
  await expect(page).toHaveURL(/\/endgames$/);
  await expect(page.getByText('Winning — lost')).toBeVisible({ timeout: 30_000 });
});

test('take-back rewinds the user move and the engine reply', async ({ page }) => {
  await stubEndgameAuth(page, { blunders: [], scenarios: [DRAW_SCENARIO] });
  await page.goto('/endgames');

  await expect(page.getByText('Rook endgames')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByText('Hold this draw.')).toBeVisible();

  const takeBack = page.getByRole('button', { name: 'Take back' });
  await expect(takeBack).toBeDisabled();
  await waitForSolving(page);

  // Rb2 — quiet; the judge passes it and the engine replies.
  await dragMove(page, { file: 1, rank: 1 }, { file: 1, rank: 2 });
  await expect(page.getByText('Judging your move…')).toHaveCount(0, { timeout: 60_000 });
  await expect(takeBack).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('1 move played')).toBeVisible();

  await takeBack.click();
  await expect(takeBack).toBeDisabled();
  await expect(page.getByText('0 moves played')).toBeVisible();
  await expect(page.locator('cg-board square.last-move')).toHaveCount(0);
});

test('a slip in the endgames tab is logged only on request, then retried', async ({ page }) => {
  await stubEndgameAuth(page, { blunders: [], scenarios: [SCENARIO] });
  await page.goto('/endgames');

  await expect(page.getByText('Queen endgames')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await waitForSolving(page);

  // Qg6?? — stalemate, forfeits the win.
  await dragMove(page, { file: 6, rank: 5 }, { file: 6, rank: 6 });
  await expect(page.getByText(/Stalemate — the win slipped away/)).toBeVisible({
    timeout: 60_000,
  });

  // Logging is opt-in: nothing was inserted automatically.
  await expect(page.getByText(/joins your training queue/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to training queue' }).click();
  await expect(page.getByText(/joins your training queue/)).toBeVisible();

  // Space retries from the mistake (even with the log button still focused),
  // and the mate still passes.
  await page.keyboard.press('Space');
  await expect(page.getByText(/Stalemate — the win slipped away/)).toHaveCount(0);
  await waitForSolving(page);
  await dragMove(page, { file: 6, rank: 5 }, { file: 6, rank: 7 });
  await expect(page.getByText(/point rescued/)).toBeVisible({ timeout: 60_000 });
});
