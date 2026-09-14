import { expect, test, type Page } from '@playwright/test';

// Phase-2 tech-debt fix: background persistence writes in the training store
// used to be fire-and-forget (`.catch(console.warn)`), so a failed session /
// progress write was invisible. They now set `persistError`, surfaced as a
// dismissible banner in TrainingRoute. This spec drives a drill to completion
// with the training-session PATCH forced to 500 and asserts the banner shows.

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

// Same forced-mate line as training_sequence.spec.ts: exact stored-line matches
// so the drill completes without the engine.
const LADDER_MATE = '7k/8/8/8/8/2q5/R7/1R5K w - - 0 1';

const BLUNDER = {
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
};

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

// Stub auth + data, but return a real session object for the create-session
// POST and a 500 for the update-session PATCH, so drill completion hits a
// failing background write.
async function stubWithFailingSessionUpdate(page: Page) {
  await page.addInitScript(
    ({ session, project, profile, blunder, game }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (
            init?.method ??
            (typeof input === 'object' ? input?.method : undefined) ??
            'GET'
          ).toUpperCase();
          const json = (body: unknown, status = 200) =>
            Promise.resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { 'content-type': 'application/json' },
              }),
            );
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (url.includes('/rest/v1/training_sessions')) {
            if (method === 'POST') {
              return json({
                id: 's1',
                user_id: 'e2e-user',
                local_date: '2026-09-14',
                blunders_attempted: 0,
                blunders_correct: 0,
                cycles_completed: 0,
                started_at: new Date().toISOString(),
                ended_at: null,
                created_at: new Date().toISOString(),
              });
            }
            if (method === 'PATCH') {
              // The write under test: fail it so the store surfaces persistError.
              return json({ message: 'forced failure', code: 'PGRST500' }, 500);
            }
            return json([]);
          }
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': '*/3' } }),
            );
          }
          if (url.includes('/rest/v1/rpc/get_blunder_motif_counts')) {
            return json({ counts: {}, tagged: 0, untagged: 1, total: 1 });
          }
          if (url.includes('/rest/v1/profiles')) return json(profile);
          if (url.includes('/rest/v1/blunders')) return json([blunder]);
          if (url.includes('/rest/v1/games')) return json(game);
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE, blunder: BLUNDER, game: GAME },
  );
}

async function dragMove(
  page: Page,
  from: { file: number; rank: number },
  to: { file: number; rank: number },
) {
  const board = page.locator('cg-board');
  await expect(board).toBeVisible();
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

test('a failed session-progress write surfaces a dismissible banner', async ({ page }) => {
  await stubWithFailingSessionUpdate(page);
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();

  await expect(page.getByText('Move 1 of 2')).toBeVisible();

  // 1.Ra7 (exact) → 2.Rb8# completes the drill, which fires the failing
  // updateTrainingSession(correct) PATCH.
  await dragMove(page, { file: 0, rank: 2 }, { file: 0, rank: 7 });
  await expect(page.getByText('Move 2 of 2')).toBeVisible();
  await dragMove(page, { file: 1, rank: 1 }, { file: 1, rank: 8 });
  await expect(page.getByText('Solution correct')).toBeVisible();

  const banner = page.getByRole('alert').filter({ hasText: /may not have saved/i });
  await expect(banner).toBeVisible();

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
});
