import { expect, test, type Page } from '@playwright/test';

// The /training landing/picker screen (train everything, or filter by
// opening/phase/pattern/situation first) and the repeat-miss refutation
// autoplay (profile toggle: autoplay_refutation).

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

function makeProfile(autoplayRefutation: boolean) {
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
    reveal_before_solve: false,
    autoplay_refutation: autoplayRefutation,
  };
}

const PAST = new Date(Date.now() - 86_400_000).toISOString();
// White to play with the black queen en prise (gxh5) — any other move leaves
// White a whole queen down, so the engine genuinely grades a wrong try as a
// blunder instead of accepting it under the 5% rule, both on the first try
// and on a repeat try.
const FREE_QUEEN = '4k3/8/8/7q/6P1/8/8/4K3 w - - 0 1';

function makeBlunder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    game_id: 'g1',
    fen: FREE_QUEEN,
    move_number: 1,
    // Distinct from the wrong move played in the test (e1e2) so the feedback
    // takes the classify() path instead of the "repeated blunder" one.
    played_move: 'e1d1',
    correct_moves: [{ move: 'g4h5', eval: 900 }],
    eval_before: 900,
    eval_after: -800,
    eval_swing: 1700,
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

async function stubTrainingAuth(
  page: Page,
  opts: { autoplayRefutation: boolean; blunders: Record<string, unknown>[] },
) {
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
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile: makeProfile(opts.autoplayRefutation),
      blunders: opts.blunders,
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
  const fromPx = { x: x + sq * from.file + sq / 2, y: y + sq * (8 - from.rank) + sq / 2 };
  const toPx = { x: x + sq * to.file + sq / 2, y: y + sq * (8 - to.rank) + sq / 2 };
  await page.mouse.move(fromPx.x, fromPx.y);
  await page.mouse.down();
  await page.mouse.move(toPx.x, toPx.y, { steps: 8 });
  await page.mouse.up();
}

// Ke2 — legal, but leaves the queen alive: a real blunder every time.
async function playWrongMove(page: Page) {
  await dragMove(page, { file: 4, rank: 1 }, { file: 4, rank: 2 });
}

test('the training landing screen offers a focus before starting', async ({ page }) => {
  await stubTrainingAuth(page, { autoplayRefutation: true, blunders: [makeBlunder()] });
  await page.goto('/training');

  await expect(page.getByRole('heading', { name: 'What do you want to train?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Review \d+ positions?/ })).toBeVisible();
  await expect(page.getByText('By opening')).toBeVisible();
  await expect(page.getByText('By phase')).toBeVisible();
  await expect(page.getByText('By pattern')).toBeVisible();
  await expect(page.getByText('By situation')).toBeVisible();

  // Picking a phase chip filters straight into the queue.
  await page.getByRole('button', { name: 'Opening', exact: true }).click();
  await expect(page.getByText(/Opening · \d+ blunder/)).toBeVisible();
  await expect(page.getByText('White to play')).toBeVisible();

  // "Change focus" returns to the picker.
  await page.getByRole('button', { name: 'Change focus' }).click();
  await expect(page.getByRole('heading', { name: 'What do you want to train?' })).toBeVisible();
});

test('an empty due queue skips the picker entirely', async ({ page }) => {
  await stubTrainingAuth(page, { autoplayRefutation: true, blunders: [] });
  await page.goto('/training');
  await expect(page.getByText(/No blunders due/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What do you want to train?' })).toHaveCount(0);
});

test('finishing the review queue offers to keep training instead of a dead end', async ({ page }) => {
  await stubTrainingAuth(page, { autoplayRefutation: true, blunders: [makeBlunder()] });
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();

  await expect(page.getByText('White to play')).toBeVisible();
  // gxh5 — the correct move, captures the queen.
  await dragMove(page, { file: 6, rank: 4 }, { file: 7, rank: 5 });
  await expect(page.getByText('Solution correct')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Cycle complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep training' }).click();
  // Back at the picker (or the empty state, if the queue is genuinely drained)
  // rather than stuck on the completion card.
  await expect(page.getByRole('heading', { name: 'Cycle complete' })).toHaveCount(0);
});

test('autoplay (default on): a repeat wrong attempt steps the refutation without a click', async ({
  page,
}) => {
  await stubTrainingAuth(page, { autoplayRefutation: true, blunders: [makeBlunder()] });
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();

  await expect(page.getByText('White to play')).toBeVisible();
  await playWrongMove(page);
  await expect(page.getByText(/That's a (blunder|mistake)|Incorrect/)).toBeVisible({
    timeout: 60_000,
  });
  // First wrong attempt: static reveal, no autoplay — starts at the first ply.
  await expect(page.locator('[data-key="r0"]')).toHaveClass(/bg-accent/, { timeout: 60_000 });

  // Continue — the only item in the queue comes right back around.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('White to play')).toBeVisible();
  await playWrongMove(page);
  await expect(page.getByText(/That's a (blunder|mistake)|Incorrect/)).toBeVisible({
    timeout: 60_000,
  });

  // Repeat wrong attempt: autoplay steps past r0 on its own within a couple
  // of seconds, with no click.
  await expect(page.locator('[data-key="r1"]')).toHaveClass(/bg-accent/, { timeout: 5_000 });
});

test('autoplay off: a repeat wrong attempt stays static', async ({ page }) => {
  await stubTrainingAuth(page, { autoplayRefutation: false, blunders: [makeBlunder()] });
  await page.goto('/training');
  await page.getByRole('button', { name: /Review \d+ positions?/ }).click();

  await expect(page.getByText('White to play')).toBeVisible();
  await playWrongMove(page);
  await expect(page.getByText(/That's a (blunder|mistake)|Incorrect/)).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('White to play')).toBeVisible();
  await playWrongMove(page);
  await expect(page.getByText(/That's a (blunder|mistake)|Incorrect/)).toBeVisible({
    timeout: 60_000,
  });

  // No autoplay: stays on r0 well past the ~700ms step interval.
  await page.waitForTimeout(2_500);
  await expect(page.locator('[data-key="r0"]')).toHaveClass(/bg-accent/);
});
