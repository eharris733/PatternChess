import { expect, test } from '@playwright/test';

// Games sync never revisits (a PGN upload whose analysis was cut short) must be
// finished by the dashboard's maintenance worker. Sync is stubbed to find
// nothing of its own, so the only thing that can stamp the PGN game is the
// leftover sweep.

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
};

const PGN_GAME = {
  id: 'pgn-game-1',
  user_id: 'e2e-user',
  platform: 'pgn',
  username: 'tester',
  opponent: 'someone',
  pgn: '[White "tester"]\n[Black "someone"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
  time_control: '600+0',
  rated: true,
  result: 'loss',
  user_color: 'white',
  played_at: new Date(Date.now() - 86_400_000).toISOString(),
  created_at: new Date().toISOString(),
  analyzed_at: null,
  parsed_metadata_at: new Date().toISOString(),
  opening_classified_at: new Date().toISOString(),
};

test('dashboard finishes PGN games that sync left unanalyzed', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('https://lichess.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' }),
  );
  await page.addInitScript(
    ({ session, project, profile, game }) => {
      const w = window as unknown as { __stamped: string[] };
      w.__stamped = [];
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url: string = typeof input === 'string' ? input : input?.url ?? '';
        if (!url.includes(`${project}.supabase.co`)) return origFetch(input, init);
        const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
        const json = (body: unknown, headers: Record<string, string> = {}) =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json', ...headers },
            }),
          );
        const pending = w.__stamped.length === 0;
        if (url.includes('/auth/v1/user')) return json(session.user);
        if (url.includes('/rest/v1/profiles')) return json(profile);
        if (url.includes('/rest/v1/games')) {
          if (method === 'PATCH') {
            if (/[?&]id=eq\./.test(url) && init?.body?.includes('analyzed_at')) {
              w.__stamped.push(decodeURIComponent(url));
            }
            return json([]);
          }
          if (url.includes('analyzed_at=is.null')) {
            const n = pending ? 1 : 0;
            if (method === 'HEAD') {
              return Promise.resolve(
                new Response(null, { status: 200, headers: { 'content-range': `*/${n}` } }),
              );
            }
            // Sync's own sweep is scoped to its platform — it must not see the PGN game.
            if (url.includes('platform=eq.')) return json([]);
            return json(pending ? [{ id: game.id }] : []);
          }
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': '*/1' } }),
            );
          }
          if (/[?&]id=eq\./.test(url)) return json(game);
          // Game lists: one game, so the shell renders the dashboard rather
          // than the first-import screen.
          return json([{ ...game, analyzed_at: pending ? null : new Date().toISOString() }]);
        }
        if (method === 'HEAD') {
          return Promise.resolve(
            new Response(null, { status: 200, headers: { 'content-range': '*/0' } }),
          );
        }
        return json([]);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE, game: PGN_GAME },
  );

  await page.goto('/dashboard');
  await expect
    .poll(() => page.evaluate(() => (window as any).__stamped as string[]), { timeout: 45_000 })
    .toEqual([expect.stringContaining('id=eq.pgn-game-1')]);
});
