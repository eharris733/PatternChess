import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';

// Opening trainer: practice mode plays the repertoire against a weighted book
// opponent (stubbed explorer); mistakes are engine-judged; queue drills play
// out to the end of coverage.

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

function toEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

const START_FEN = new Chess().fen();
const afterE4E5 = (() => {
  const c = new Chess();
  c.move('e4');
  c.move('e5');
  return c.fen();
})();

const REPERTOIRE = [
  {
    id: 'r1',
    color: 'white',
    epd: toEpd(START_FEN),
    uci: 'e2e4',
    san: 'e4',
    created_at: PAST,
  },
  {
    id: 'r2',
    color: 'white',
    epd: toEpd(afterE4E5),
    uci: 'g1f3',
    san: 'Nf3',
    created_at: PAST,
  },
];

function makeOpeningDrillRow() {
  return {
    id: 'b-opening',
    game_id: null,
    fen: START_FEN,
    move_number: 1,
    played_move: 'd2d4',
    correct_moves: [{ move: 'e2e4', eval: 30 }],
    eval_before: 30,
    eval_after: 20,
    eval_swing: 8,
    side_to_move: 'white',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: PAST,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'opening',
    solution_line: { pv: ['e2e4'], playedPv: [], v: 1 },
    motifs: [],
    kind: 'opening',
    drill_data: { color: 'white', repertoireMove: 'e2e4', v: 1 },
  };
}

async function stubOpeningTrainer(
  page: Page,
  opts: { blunders: Record<string, unknown>[]; repertoire: Record<string, unknown>[] },
) {
  await page.addInitScript(
    ({ session, project, profile, blunders, repertoire }) => {
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
          if (url.includes('/rest/v1/repertoire_moves')) return json(repertoire);
          if (url.includes('/rest/v1/blunders')) return json(blunders);
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
      repertoire: opts.repertoire,
    },
  );

  // Deterministic opponent book: after 1.e4 Black plays 1...e5; anywhere else
  // Black plays Nc6 (legal in the post-Nf3 position we reach).
  await page.route('https://explorer.lichess.org/**', async (route) => {
    const url = new URL(route.request().url());
    const fen = url.searchParams.get('fen') ?? '';
    const board = fen.split(' ')[0];
    const move =
      board === 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR'
        ? { uci: 'e7e5', san: 'e5', white: 0, draws: 0, black: 100 }
        : { uci: 'b8c6', san: 'Nc6', white: 0, draws: 0, black: 100 };
    await route.fulfill({ json: { white: 0, draws: 0, black: 100, moves: [move] } });
  });
}

async function dragMove(
  page: Page,
  from: { file: number; rank: number },
  to: { file: number; rank: number },
) {
  const board = page.locator('cg-board');
  await expect(board).toBeVisible();
  // The practice layout can push the board's bottom ranks below the 720px
  // viewport fold — mouse events there silently miss.
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

test('practice mode walks the book and prompts to extend at the edge', async ({ page }) => {
  await stubOpeningTrainer(page, { blunders: [], repertoire: REPERTOIRE });
  await page.goto('/openings');
  await page.getByRole('button', { name: 'practice' }).click();

  await expect(page.getByText('Play your repertoire move')).toBeVisible({ timeout: 30_000 });

  // 1.e4 (book) -> stubbed reply 1...e5 -> still in book. Wait for the reply
  // to land (breadcrumb) before moving again — the board is frozen meanwhile.
  await dragMove(page, { file: 4, rank: 2 }, { file: 4, rank: 4 });
  await expect(page.getByText('1.e4 e5')).toBeVisible({ timeout: 30_000 });
  // Let the reply animation finish — a drag starting mid-animation is dropped.
  await page.waitForTimeout(400);

  // 2.Nf3 (book) -> reply 2...Nc6 -> position uncovered -> out of book.
  await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 });
  await expect(page.getByText('Out of book — line complete')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: /Extend repertoire from here/ }),
  ).toBeVisible();
});

test('practice mode flags a bad off-book move via the engine', async ({ page }) => {
  await stubOpeningTrainer(page, { blunders: [], repertoire: REPERTOIRE });
  await page.goto('/openings');
  await page.getByRole('button', { name: 'practice' }).click();

  await expect(page.getByText('Play your repertoire move')).toBeVisible({ timeout: 30_000 });

  // 1.g4?? — clearly worse than the book 1.e4; the engine judges it a mistake.
  await dragMove(page, { file: 6, rank: 2 }, { file: 6, rank: 4 });
  await expect(page.getByText(/That's a mistake|That's not your best line/)).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('Your book move is')).toBeVisible();
});

test('an opening drill in the training queue plays out to end of coverage', async ({ page }) => {
  await stubOpeningTrainer(page, {
    blunders: [makeOpeningDrillRow()],
    // Only the start position is covered -> the drill ends after one book move
    // and the sampled reply.
    repertoire: [REPERTOIRE[0]],
  });
  await page.goto('/training');

  // Concealed presentation — same prompt as a tactic drill.
  await expect(page.getByText('White to play')).toBeVisible({ timeout: 30_000 });

  await dragMove(page, { file: 4, rank: 2 }, { file: 4, rank: 4 });
  await expect(page.getByText(/Book line held/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Next/ })).toBeVisible();
});
