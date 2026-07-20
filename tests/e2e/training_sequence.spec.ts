import { expect, test, type Page } from '@playwright/test';

// Multi-move sequence drills: a blunder row with a stored solution_line whose
// tactic stays forcing (here: forced mate) makes the user play their side of
// the line move by move, with the opponent's replies auto-played.

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

// White has a forced ladder mate (1.Ra7 Kg8 2.Rb8#) but is otherwise lost —
// the black queen picks up a rook after any deviation, so a wrong second move
// genuinely grades as a blunder instead of passing the 5% accept rule.
const LADDER_MATE = '7k/8/8/8/8/2q5/R7/1R5K w - - 0 1';

function makeSequenceBlunder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    game_id: 'g1',
    fen: LADDER_MATE,
    move_number: 40,
    played_move: 'h1g1',
    correct_moves: [{ move: 'a2a7', eval: 9998 }],
    eval_before: 9998,
    eval_after: -200,
    eval_swing: 95,
    side_to_move: 'white',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: PAST,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'endgame',
    solution_line: { pv: ['a2a7', 'h8g8', 'b1b8'], playedPv: [], v: 1 },
    ...overrides,
  };
}

const GAME = {
  id: 'g1',
  platform: 'pgn',
  username: 'tester',
  opponent: 'rival',
  pgn: '',
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
  clock_per_ply: [55000, 58000],
  total_plies: 2,
  parsed_metadata_at: null,
};

async function stubTrainingAuth(page: Page, blunders: Record<string, unknown>[]) {
  await page.addInitScript(
    ({ session, project, profile, blunders, game }) => {
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
          if (url.includes('/rest/v1/games')) return json(game);
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE, blunders, game: GAME },
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
  // White orientation: file index from a=0; rank r is (8 - r) rows from the top.
  const fromPx = { x: x + sq * from.file + sq / 2, y: y + sq * (8 - from.rank) + sq / 2 };
  const toPx = { x: x + sq * to.file + sq / 2, y: y + sq * (8 - to.rank) + sq / 2 };
  await page.mouse.move(fromPx.x, fromPx.y);
  await page.mouse.down();
  await page.mouse.move(toPx.x, toPx.y, { steps: 8 });
  await page.mouse.up();
}

test('a stored mate line drills as a two-move sequence', async ({ page }) => {
  await stubTrainingAuth(page, [makeSequenceBlunder()]);
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  await expect(page.getByText('Move 1 of 2')).toBeVisible();

  // 1.Ra7 — exact match, no engine involved.
  await dragMove(page, { file: 0, rank: 2 }, { file: 0, rank: 7 });
  await expect(page.getByText('Correct — keep going')).toBeVisible();

  // The opponent's reply (…Kg8) auto-plays, then the second step is prompted.
  await expect(page.getByText('Move 2 of 2')).toBeVisible();

  // 2.Rb8# completes the drill.
  await dragMove(page, { file: 1, rank: 1 }, { file: 1, rank: 8 });
  await expect(page.getByText('Solution correct')).toBeVisible();
});

test('a wrong move mid-sequence fails the drill', async ({ page }) => {
  await stubTrainingAuth(page, [makeSequenceBlunder()]);
  await page.goto('/training');

  await expect(page.getByText('Move 1 of 2')).toBeVisible();
  await dragMove(page, { file: 0, rank: 2 }, { file: 0, rank: 7 });
  await expect(page.getByText('Move 2 of 2')).toBeVisible();

  // 2.Ra1?? hangs the rook to Qxa1 — the engine grades it a real fail.
  await dragMove(page, { file: 0, rank: 7 }, { file: 0, rank: 1 });
  await expect(page.getByText(/That's a (blunder|mistake|inaccuracy)|Incorrect/)).toBeVisible({
    timeout: 60_000,
  });
});

test('the motif card surfaces recurring weaknesses and drills them on click', async ({ page }) => {
  // Enough tagged rows (≥10) for the card's minimum, forks in the majority.
  const rows = Array.from({ length: 12 }, (_, i) =>
    makeSequenceBlunder({
      id: `b${i}`,
      fen: `7k/8/8/8/8/2q5/R7/1R5K w - - ${i} 1`,
      motifs: i < 8 ? ['missedFork'] : ['allowedMate', 'backRankWeakness'],
    }),
  );
  await stubTrainingAuth(page, rows);
  await page.goto('/dashboard');

  await expect(page.getByText('Recurring weaknesses')).toBeVisible();
  await expect(page.getByText('Missed fork')).toBeVisible();
  await expect(page.getByText('Allowed mate')).toBeVisible();

  // Click-through lands on training with the motif filter chip active.
  await page.getByText('Missed fork').click();
  await expect(page).toHaveURL(/\/training/);
  await expect(page.getByText(/Missed fork · \d+ blunder/)).toBeVisible();
});

test('a legacy row without a solution line stays a single-move drill', async ({ page }) => {
  const legacy = makeSequenceBlunder({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    move_number: 1,
    played_move: 'f2f3',
    correct_moves: [{ move: 'd2d4', eval: 30 }],
    eval_before: 20,
    eval_after: 150,
    eval_swing: 17,
    phase: 'opening',
    solution_line: null,
  });
  await stubTrainingAuth(page, [legacy]);
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  await expect(page.getByText(/Move 1 of/)).toHaveCount(0);

  await dragMove(page, { file: 3, rank: 2 }, { file: 3, rank: 4 });
  await expect(page.getByText('Solution correct')).toBeVisible();
});
