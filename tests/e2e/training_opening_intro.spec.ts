import { expect, test, type Page } from '@playwright/test';

// Opening drills: the user's game plays out up to the position, then the
// prompt asks for the move; a book move is "Great!" and can be added to the
// repertoire, which then becomes the expected answer.

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


// After 1.e4 e5 the user (White) played 2.Qh5 in the game; theory is Nf3 / Bc4.
const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const EPD = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -';

const OPENING_DRILL = {
  id: 'o1',
  game_id: 'g1',
  kind: 'opening',
  fen: FEN,
  move_number: 2,
  played_move: 'd1h5',
  correct_moves: [
    { move: 'g1f3', eval: 30 },
    { move: 'f1c4', eval: 25 },
  ],
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
  drill_data: {
    openingFamily: "King's Pawn Game",
    openingName: "King's Pawn Game: Wayward Queen Attack",
    theoryMoves: [
      { uci: 'g1f3', san: 'Nf3', games: 900, share: 80, moverWinPct: 38, tier: 'otb' },
      { uci: 'f1c4', san: 'Bc4', games: 100, share: 9, moverWinPct: 35, tier: 'otb' },
    ],
    positionGames: 1100,
    source: 'book',
    v: 2,
  },
};

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

async function stub(page: Page, repertoire: Record<string, unknown>[] = []) {
  await page.addInitScript(
    ({ session, project, profile, blunders, game, repertoire }) => {
      const origFetch = window.fetch.bind(window);
      (window as any).__repertoireWrites = [] as unknown[];
      (window as any).__sessionWrites = [] as unknown[];
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET').toUpperCase();
          const json = (body: unknown) =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
            );
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (method === 'HEAD') {
            return Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': '*/1' } }));
          }
          if (url.includes('/rest/v1/repertoire_moves')) {
            if (method === 'POST') {
              const row = JSON.parse(init.body);
              (window as any).__repertoireWrites.push(row);
              return json({ id: 'r-new', created_at: new Date().toISOString(), ...row });
            }
            return json(repertoire);
          }
          if (url.includes('/rest/v1/training_sessions')) {
            if (method === 'POST') {
              const row = JSON.parse(init.body);
              return json({ id: 's1', started_at: new Date().toISOString(), ended_at: null, ...row });
            }
            if (method === 'PATCH') (window as any).__sessionWrites.push(JSON.parse(init.body));
            return json([]);
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
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE, blunders: [OPENING_DRILL], game: GAME, repertoire },
  );
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

test('an opening drill plays the game out, then a book move is great and joins the repertoire', async ({ page }) => {
  await stub(page);
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();

  // Intro: the opening is named and the game replays before the prompt.
  await expect(page.getByTestId('opening-drill-name')).toHaveText("King's Pawn Game: Wayward Queen Attack");
  await expect(page.getByTestId('skip-intro')).toBeVisible();
  await expect(page.getByTestId('drill-prompt')).toHaveText('Play the move for White', { timeout: 10_000 });

  // 2.Nf3 — a theory move.
  await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 });
  const verdict = page.getByTestId('opening-verdict');
  await expect(verdict).toContainText('Great! Nf3 is book.');
  // Who plays it: the chart, captioned with the tier's rating floor.
  const chart = verdict.getByTestId('theory-moves-line');
  await expect(chart).toContainText('Players rated 2200+ (OTB) play');
  await expect(chart).toContainText('80%');

  await verdict.getByTestId('add-to-repertoire').click();
  await expect(verdict.getByTestId('in-repertoire')).toBeVisible();
  const writes = await page.evaluate(() => (window as any).__repertoireWrites as Array<Record<string, string>>);
  expect(writes[0]).toMatchObject({ color: 'white', epd: EPD, uci: 'g1f3', san: 'Nf3' });
});

test('with a repertoire move saved, another book move is a nudge toward it', async ({ page }) => {
  await stub(page, [
    { id: 'r1', user_id: 'e2e-user', color: 'white', epd: EPD, uci: 'f1c4', san: 'Bc4', created_at: PAST },
  ]);
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();
  await page.getByTestId('skip-intro').click();
  await expect(page.getByTestId('drill-prompt')).toHaveText('Play the move for White');

  await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 });
  await expect(page.getByText('Good move, but your repertoire move is Bc4').first()).toBeVisible();
});

test('Space skips the intro, and an opening drill never fills the daily "Train" goal', async ({ page }) => {
  await stub(page);
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();
  await expect(page.getByTestId('skip-intro')).toBeVisible();
  await page.keyboard.press('Space');
  // Well under the ~2.5s the full replay takes.
  await expect(page.getByTestId('drill-prompt')).toHaveText('Play the move for White', { timeout: 1500 });

  await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 });
  await expect(page.getByTestId('opening-verdict')).toContainText('Great! Nf3 is book.');
  // training_sessions feeds "Train N positions"; openings have their own step.
  const writes = await page.evaluate(() => (window as any).__sessionWrites as Array<Record<string, number>>);
  for (const w of writes) expect(w.blunders_attempted ?? 0).toBe(0);
});
