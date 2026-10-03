import { expect, test, type Page } from '@playwright/test';

// /openings → click an exit → /openings/review/:gameId autoplays the game to
// the exit move and shows the database lines for the position on the board.

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

const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const AFTER_E4_EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';
// After 1.e4 e5 — white played 2.Qh5 instead of 2.Nf3.
const EXIT_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const EXIT_EPD = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -';
const AFTER_NF3_EPD = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -';

const PGN = '1. e4 e5 2. Qh5 Nc6 3. Bc4 g6 4. Qf3 Nf6 *';

function move(uci: string, san: string, w: number, d: number, b: number, sound: boolean | null = true) {
  return { uci, san, white: w, draws: d, black: b, titled: 0, cp: null, sound };
}

const BOOK: Record<string, unknown> = {
  [START_EPD]: {
    tier: 'otb', white: 400, draws: 400, black: 200, cp: 20, depth: 30,
    moves: [move('e2e4', 'e4', 200, 200, 100), move('d2d4', 'd4', 200, 200, 100)],
  },
  [AFTER_E4_EPD]: {
    tier: 'otb', white: 200, draws: 200, black: 100, cp: -20, depth: 30,
    moves: [move('e7e5', 'e5', 200, 200, 100)],
  },
  [EXIT_EPD]: {
    tier: 'otb', white: 500, draws: 400, black: 300, cp: 20, depth: 30,
    moves: [
      move('g1f3', 'Nf3', 400, 350, 250),
      move('f1c4', 'Bc4', 80, 40, 40),
      move('d1h5', 'Qh5', 1, 0, 2, false),
    ],
  },
  [AFTER_NF3_EPD]: {
    tier: 'otb', white: 400, draws: 350, black: 250, cp: -20, depth: 30,
    moves: [move('b8c6', 'Nc6', 300, 250, 200), move('g8f6', 'Nf6', 100, 100, 50)],
  },
};

const DEVIATION = {
  id: 'd1',
  user_id: 'e2e-user',
  game_id: 'g1',
  status: 'user_left',
  rule_version: 3,
  ply: 2,
  move_number: 2,
  user_color: 'white',
  fen_before: EXIT_FEN,
  epd_before: EXIT_EPD,
  played_uci: 'd1h5',
  played_san: 'Qh5',
  reason: 'not_in_book',
  theory_moves: [
    { uci: 'g1f3', san: 'Nf3', games: 1000, share: 83, moverWinPct: 40, tier: 'otb' },
    { uci: 'f1c4', san: 'Bc4', games: 160, share: 13, moverWinPct: 50, tier: 'otb' },
  ],
  position_games: 1200,
  played_games: 3,
  played_mover_win_pct: 33,
  eval_before: 30,
  eval_after: -40,
  chances_lost: 12,
  classification: 'inaccuracy',
  eval_depth: 18,
  evaluated_at: new Date().toISOString(),
  book_tier: 'otb',
  book_end_ply: null,
  past_book_checked_at: null,
  blunder_id: null,
  opening_family: "King's Pawn Game",
  opening_name: "King's Pawn Game: Wayward Queen Attack",
  eco: 'C20',
  created_at: new Date().toISOString(),
};

const GAME = {
  id: 'g1',
  platform: 'lichess',
  username: 'tester',
  opponent: 'rival',
  pgn: PGN,
  time_control: '600',
  rated: true,
  result: '1-0',
  played_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  analyzed_at: new Date().toISOString(),
  eco: 'C20',
  opening_name: "King's Pawn Game: Wayward Queen Attack",
  opening_family: "King's Pawn Game",
  user_color: 'white',
  user_rating: 1500,
  opponent_rating: 1500,
  clock_per_ply: null,
  total_plies: 8,
  parsed_metadata_at: null,
};

async function stub(page: Page) {
  await page.addInitScript(
    ({ session, project, deviation, game }) => {
      (window as any).__rpcCalls = [];
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : (input?.url ?? '');
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET').toUpperCase();
          const json = (body: unknown) =>
            Promise.resolve(
              new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
            );
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (method === 'HEAD') {
            // Games exist (skips onboarding); nothing left for the scan to walk or score.
            const n = url.includes('/games') && !url.includes('opening_deviation_version') ? 3 : 0;
            return Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': `*/${n}` } }));
          }
          if (url.includes('/rest/v1/rpc/')) {
            (window as any).__rpcCalls.push(url.split('/rpc/')[1]);
            return json(1);
          }
          if (url.includes('/rest/v1/opening_deviations')) return json([deviation]);
          if (url.includes('/rest/v1/games')) return /[?&]id=eq\./.test(url) ? json(game) : json([game]);
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, deviation: DEVIATION, game: GAME },
  );
  await page.route('**/api/book', async (route) => {
    const { fens } = route.request().postDataJSON() as { fens: string[] };
    const positions: Record<string, unknown> = {};
    for (const fen of fens) {
      const epd = fen.split(' ').slice(0, 4).join(' ');
      if (BOOK[epd]) positions[epd] = BOOK[epd];
    }
    await route.fulfill({ json: { positions } });
  });
}

test('clicking an exit replays the opening to it and shows the database lines', async ({ page }) => {
  await stub(page);
  await page.goto('/openings');
  const card = page.getByTestId('deviation-card');
  await expect(card).toContainText('You played 2.Qh5');
  await card.getByTestId('deviation-link').click();

  await expect(page).toHaveURL(/\/openings\/review\/g1$/);
  const review = page.getByTestId('opening-review');
  await expect(review.getByRole('heading', { name: /Wayward Queen Attack/ })).toBeVisible();
  await expect(page.getByTestId('exit-summary')).toContainText('You played 2.Qh5');
  await expect(page.getByTestId('exit-summary')).toContainText('Left the book');

  // Autoplay lands on the exit: the explorer lists the book moves there with
  // the theory move and the engine-rejected played move marked.
  await expect(page.getByTestId('replay')).toBeVisible({ timeout: 10_000 });
  const explorer = page.getByTestId('book-explorer');
  const nf3 = explorer.getByTestId('book-move').filter({ hasText: 'Nf3' });
  await expect(nf3).toContainText('Book');
  await expect(explorer.getByTestId('book-move').filter({ hasText: 'Qh5' })).toContainText('?!');
  await expect(explorer.getByTestId('book-move').filter({ hasText: 'Qh5' })).toContainText('You');
  // Theory + played arrows on the board.
  await expect(page.locator('svg.cg-shapes g, svg.cg-shapes line')).not.toHaveCount(0);

  // Explore the main line: the panel follows the new position.
  await nf3.click();
  await expect(page.getByTestId('branch-trail')).toContainText('2.Nf3');
  await expect(explorer.getByTestId('book-move').filter({ hasText: 'Nc6' })).toBeVisible();

  // Back to the game restores the exit position.
  await page.getByTestId('back-to-exit').click();
  await expect(page.getByTestId('branch-trail')).toHaveCount(0);
  await expect(explorer.getByTestId('book-move').filter({ hasText: 'Nf3' })).toContainText('Book');

  // Opening the review counts toward the "First Look" achievement.
  const rpcCalls = await page.evaluate(() => (window as any).__rpcCalls as string[]);
  expect(rpcCalls.some((c) => c.startsWith('increment_opening_reviews'))).toBe(true);
});

test('stepping past the book shows the out-of-book state', async ({ page }) => {
  await stub(page);
  await page.goto('/openings/review/g1');
  // Wait for autoplay to land on the exit (theory tags only show there).
  await expect(
    page.getByTestId('book-move').filter({ hasText: 'Nf3' }),
  ).toContainText('Book', { timeout: 10_000 });
  // 3.Bc4 position (after 2...Nc6) is not in the stub book.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('book-empty')).toBeVisible();
});
