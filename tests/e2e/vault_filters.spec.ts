import { expect, test, type Page } from '@playwright/test';

// Vault filter bar + expandable blunder-position thumbnails.
// Stubs auth and the games/blunders REST endpoints so no real user is needed.

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
  lichess_username: null,
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

const NOW = new Date().toISOString();

function gameRow(overrides: Record<string, unknown>) {
  return {
    user_id: 'e2e-user',
    platform: 'lichess',
    username: 'hero',
    pgn: '1. e4 e5 *',
    time_control: '600+5',
    rated: true,
    played_at: NOW,
    created_at: NOW,
    eco: null,
    opening_name: null,
    user_rating: 1500,
    opponent_rating: 1500,
    clock_per_ply: null,
    total_plies: 40,
    parsed_metadata_at: null,
    ...overrides,
  };
}

// game-a: analyzed, 2 blunders, user won as black.
// game-b: analyzed, clean, user lost as white.
// game-c: not yet analyzed.
const GAMES = [
  gameRow({
    id: 'game-a',
    opponent: 'MagnusFan',
    user_color: 'black',
    result: '0-1',
    analyzed_at: NOW,
    opening_name: 'Sicilian Defense',
    played_at: '2026-08-20T12:00:00Z',
  }),
  gameRow({
    id: 'game-b',
    opponent: 'CleanPlayer',
    user_color: 'white',
    result: '0-1',
    analyzed_at: NOW,
    opening_name: 'Italian Game',
    played_at: '2026-08-22T12:00:00Z',
  }),
  gameRow({
    id: 'game-c',
    platform: 'chess.com',
    opponent: 'MysteryMan',
    user_color: 'white',
    result: 'win',
    analyzed_at: null,
    played_at: '2026-08-25T12:00:00Z',
  }),
];

function blunderRow(overrides: Record<string, unknown>) {
  return {
    user_id: 'e2e-user',
    game_id: 'game-a',
    eval_before: 50,
    eval_after: -350,
    eval_swing: 400,
    side_to_move: 'b',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: NOW,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: NOW,
    phase: 'middlegame',
    solution_line: null,
    kind: 'tactic',
    drill_data: null,
    analysis_depth: 12,
    retired_at: null,
    ...overrides,
  };
}

const BLUNDERS = [
  blunderRow({
    id: 'blunder-1',
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    move_number: 1,
    played_move: 'g8f6',
    correct_moves: [{ move: 'e7e5', eval: -20 }],
    motifs: ['allowedFork'],
    phase: 'opening',
  }),
  blunderRow({
    id: 'blunder-2',
    fen: 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5',
    move_number: 5,
    played_move: 'f6d5',
    correct_moves: [{ move: 'c6a5', eval: -40 }],
    motifs: ['leftPieceHanging'],
  }),
];

async function stubVault(page: Page) {
  await page.addInitScript(
    ({ session, project, profile, games, blunders }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : (input?.url ?? '');
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
          if (method === 'HEAD') {
            // Non-zero game count keeps the onboarding gate closed.
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': '*/3' } }),
            );
          }
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (url.includes('/rest/v1/profiles')) return json(profile);
          if (url.includes('/rest/v1/games')) return json(games);
          if (url.includes('/rest/v1/blunders')) {
            // getBlunderCountsByGame projects only game_id.
            if (url.includes('select=game_id')) {
              return json(blunders.map((b: any) => ({ game_id: b.game_id })));
            }
            // getBlundersForGames filters by game_id=in.(…).
            if (url.includes('game_id=in.')) {
              return json(
                blunders.filter((b: any) => url.includes(b.game_id)),
              );
            }
            return json([]);
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
      games: GAMES,
      blunders: BLUNDERS,
    },
  );
}

test('vault filter pills, search, and sort narrow the game list', async ({ page }) => {
  await stubVault(page);
  await page.goto('/vault');

  // All three games render with their blunder labels.
  await expect(page.getByText('MagnusFan')).toBeVisible();
  await expect(page.getByText('CleanPlayer')).toBeVisible();
  await expect(page.getByText('MysteryMan')).toBeVisible();
  await expect(page.getByRole('button', { name: /2 blunders/ })).toBeVisible();

  // Pills carry per-bucket counts.
  const hasBlunders = page.getByRole('button', { name: 'Has blunders 1' });
  await expect(hasBlunders).toBeVisible();
  await expect(page.getByRole('button', { name: 'No blunders 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not analyzed 1' })).toBeVisible();

  // "Has blunders" leaves only the blunder game.
  await hasBlunders.click();
  await expect(page.getByText('CleanPlayer')).not.toBeVisible();
  await expect(page.getByText('MysteryMan')).not.toBeVisible();
  await expect(page.getByText('MagnusFan')).toBeVisible();
  await expect(page.getByText('Showing 1 of 3 games')).toBeVisible();

  // Clear filters restores everything.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('CleanPlayer')).toBeVisible();

  // Search matches opponent and opening names.
  const search = page.getByLabel('Search games');
  await search.fill('italian');
  await expect(page.getByText('CleanPlayer')).toBeVisible();
  await expect(page.getByText('MagnusFan')).not.toBeVisible();
  await search.fill('');

  // "Most blunders" sorts the blunder game to the top.
  await page.getByLabel('Sort games').selectOption('blunders');
  await expect(page.locator('li').filter({ hasText: 'vs' }).first()).toContainText(
    'MagnusFan',
  );
});

test('expanding a game shows blunder thumbnails and a position preview modal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await stubVault(page);
  await page.goto('/vault');

  await page.getByRole('button', { name: /2 blunders/ }).click();

  // Two mini boards render with move labels (played move in case-correct SAN).
  await expect(page.getByText('Nf6?')).toBeVisible();
  await expect(page.getByText('Nxd5?')).toBeVisible();
  await expect(page.locator('cg-board')).toHaveCount(2);

  // Clicking a thumbnail opens the larger preview with played/best moves.
  await page.getByRole('button', { name: /Move 5/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Blunder position' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Nxd5?')).toBeVisible();
  await expect(dialog.getByText('Na5')).toBeVisible();
  await expect(dialog.getByText('Left a piece hanging')).toBeVisible();
  await expect(dialog.getByText('Black to move', { exact: false })).toBeVisible();

  // Close via the X button; thumbnails stay expanded.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('cg-board')).toHaveCount(2);

  // Collapse hides the boards again.
  await page.getByRole('button', { name: /2 blunders/ }).click();
  await expect(page.locator('cg-board')).toHaveCount(0);

  expect(errors).toEqual([]);
});
