import { expect, test, type Page } from '@playwright/test';

// The training screen's pre-solve information policy:
//  - reveal_before_solve = false (the default): a new position goes straight
//    to solving with no "You played", no refutation, and no win-chance numbers;
//    everything is revealed after the attempt.
//  - reveal_before_solve = true: the classic review step ("I'm ready") shows
//    the played move and refutation up front.

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

function makeProfile(revealBeforeSolve: boolean) {
  return {
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
    reveal_before_solve: revealBeforeSolve,
  };
}

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White to play with the black queen en prise (gxh5). Any other move leaves
// White a whole queen down, so the engine genuinely grades a wrong try as a
// blunder instead of accepting it under the 5% rule.
const FREE_QUEEN = '4k3/8/8/7q/6P1/8/8/4K3 w - - 0 1';

function makeBlunder(overrides: Record<string, unknown> = {}) {
  // Brand-new (never drilled) blunder so the review step is the deciding factor.
  return {
    id: 'b1',
    game_id: 'g1',
    fen: STARTPOS,
    move_number: 1,
    played_move: 'f2f3',
    correct_moves: [{ move: 'd2d4', eval: 30 }],
    eval_before: 20,
    eval_after: 150,
    eval_swing: 170,
    side_to_move: 'white',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: PAST,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'opening',
    ...overrides,
  };
}

const BLUNDERS = [makeBlunder()];

const GAME = {
  id: 'g1',
  platform: 'pgn',
  username: 'tester',
  opponent: 'rival',
  pgn: '',
  // 10 minutes, no increment. The blunder is move 1 for White, so the clock
  // line should read "10:00 left · spent 50s" (60000cs - 55000cs).
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

async function stubTrainingAuth(
  page: Page,
  opts: { revealBeforeSolve: boolean; blunders?: Record<string, unknown>[] },
) {
  await page.addInitScript(
    ({ session, project, profile, blunders, game }) => {
      // Capture share-link copies without needing real clipboard permissions.
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (text: string) => {
            (window as any).__copiedText = text;
            return Promise.resolve();
          },
        },
        configurable: true,
      });

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
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile: makeProfile(opts.revealBeforeSolve),
      blunders: opts.blunders ?? BLUNDERS,
      game: GAME,
    },
  );
}

async function dragMove(page: Page, from: { file: number; rank: number }, to: { file: number; rank: number }) {
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

test('hidden mode (default): new position goes straight to solving with no spoilers', async ({ page }) => {
  await stubTrainingAuth(page, { revealBeforeSolve: false });
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  // No review step, no played move, no win-chance numbers before the attempt.
  await expect(page.getByRole('button', { name: /I'm ready/i })).toHaveCount(0);
  await expect(page.getByText(/You played/)).toHaveCount(0);
  await expect(page.getByText('Win chance')).toHaveCount(0);
  // The opt-in toggle is still there.
  await expect(page.getByText(/See what you played/i)).toBeVisible();
  // Clock context is informational, not a hint — visible while solving.
  await expect(page.getByText('10:00 left · spent 50s')).toBeVisible();
});

test('hidden mode: solving reveals the win chances and the game move', async ({ page }) => {
  await stubTrainingAuth(page, { revealBeforeSolve: false });
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  // d2 -> d4 is the stored correct move — accepted without the engine.
  await dragMove(page, { file: 3, rank: 2 }, { file: 3, rank: 4 });

  await expect(page.getByText('Solution correct')).toBeVisible();
  await expect(page.getByText('Win chance')).toBeVisible();
  // The game move lives in its own tab now (played f2f3 -> SAN "f3").
  await expect(page.getByRole('button', { name: 'Your game: f3' })).toBeVisible();
});

test('hidden mode: arrow keys step through the tab in focus', async ({ page }) => {
  await stubTrainingAuth(page, { revealBeforeSolve: false });
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  await dragMove(page, { file: 3, rank: 2 }, { file: 3, rank: 4 });
  await expect(page.getByText('Solution correct')).toBeVisible();

  // Switch to the game-move tab and wait for the lazy refutation line.
  await page.getByRole('button', { name: 'Your game: f3' }).click();
  await expect(page.locator('[data-key="r0"]')).toBeVisible({ timeout: 60_000 });

  // Arrows must drive the visible (refutation) line, not the continuation.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-key="r0"]')).toHaveClass(/bg-text-primary/);
});

test('hidden mode: the share button opens a preview modal that copies a /p link', async ({ page }) => {
  await stubTrainingAuth(page, { revealBeforeSolve: false });
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  await page.getByRole('button', { name: /Share puzzle/i }).click();

  // Modal: board preview + the exact link, then copy.
  const dialog = page.getByRole('dialog', { name: 'Share this puzzle' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('cg-board')).toBeVisible();
  await expect(dialog.getByLabel('Share link')).toHaveValue(/\/p\?d=/);
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => (window as any).__copiedText as string);
  expect(copied).toContain('/p?d=');
});

test('hidden mode: a wrong try reveals both refutations after the attempt', async ({ page }) => {
  const blunders = [
    makeBlunder({
      fen: FREE_QUEEN,
      played_move: 'e1d1',
      correct_moves: [{ move: 'g4h5', eval: 800 }],
      eval_before: 800,
      eval_after: 900,
      eval_swing: 1700,
    }),
  ];
  await stubTrainingAuth(page, { revealBeforeSolve: false, blunders });
  await page.goto('/training');

  await expect(page.getByText('White to play')).toBeVisible();
  // e1 -> e2 (Ke2): legal, but leaves the queen alive — a real blunder.
  await dragMove(page, { file: 4, rank: 1 }, { file: 4, rank: 2 });

  // Engine boot + depth-18 eval can take a moment on first use.
  await expect(page.getByText(/That's a (blunder|mistake)|Incorrect/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Win chance')).toBeVisible();
  // Two tabs: the user's wrong try (default-active) and the game move.
  await expect(page.getByRole('button', { name: 'Your try: Ke2' })).toBeVisible();
  await page.getByRole('button', { name: 'Your game: Kd1' }).click();
  // eval_before=800 -> ~95% win chance -> missed win -> adaptive label.
  await expect(page.getByText('Engine line')).toBeVisible();
  // The original game move's refutation loads lazily after the attempt.
  await expect(page.locator('[data-key="r0"]')).toBeVisible({ timeout: 60_000 });
});

test('reveal mode: the review step shows the played move before solving', async ({ page }) => {
  await stubTrainingAuth(page, { revealBeforeSolve: true });
  await page.goto('/training');

  await expect(page.getByRole('button', { name: /I'm ready/i })).toBeVisible();
  await expect(page.getByText(/You played/)).toBeVisible();
  await expect(page.getByText('Win chance')).toBeVisible();
});
