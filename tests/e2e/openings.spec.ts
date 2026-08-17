import { expect, test, type Page } from '@playwright/test';

// Repertoire builder: guided walk with a stateful repertoire stub — picking a
// move persists it, the queue recomputes, and the walk continues deeper via
// the (stubbed) masters book.

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

async function stubOpeningsAuth(page: Page) {
  await page.addInitScript(
    ({ session, project, profile }) => {
      // Stateful in-page repertoire store so picks survive the refetch.
      const repertoire: Array<Record<string, unknown>> = [];
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
          if (url.includes('/rest/v1/repertoire_moves')) {
            if (method === 'POST') {
              try {
                const row = JSON.parse(String(init?.body ?? '{}'));
                const rows = Array.isArray(row) ? row : [row];
                for (const r of rows) {
                  const i = repertoire.findIndex(
                    (x) => x.epd === r.epd && x.color === r.color,
                  );
                  const stored = { id: `r${repertoire.length}`, created_at: new Date().toISOString(), ...r };
                  if (i >= 0) repertoire[i] = stored;
                  else repertoire.push(stored);
                }
              } catch {
                /* ignore */
              }
              return json(repertoire);
            }
            return json(repertoire);
          }
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE },
  );

  // Deterministic masters book: 1.e4 dominant; Black always answers 1...e5.
  await page.route('https://explorer.lichess.org/**', async (route) => {
    const url = new URL(route.request().url());
    const fen = url.searchParams.get('fen') ?? '';
    const sideToMove = fen.split(' ')[1];
    const body =
      sideToMove === 'w'
        ? {
            white: 100,
            draws: 0,
            black: 0,
            moves: [{ uci: 'e2e4', san: 'e4', white: 100, draws: 0, black: 0 }],
          }
        : {
            white: 0,
            draws: 0,
            black: 100,
            moves: [{ uci: 'e7e5', san: 'e5', white: 0, draws: 0, black: 100 }],
          };
    await route.fulfill({ json: body });
  });
}

test('picking a masters move saves it and the walk advances past the reply', async ({
  page,
}) => {
  await stubOpeningsAuth(page);
  await page.goto('/openings');

  await expect(page.getByText('Start position')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Masters book', { exact: true })).toBeVisible();

  // Pick 1.e4 from the masters panel. (The "Saved" badge clears as soon as the
  // walk advances, so assert the advance itself.)
  await page.getByRole('button', { name: /^e4/ }).first().click();

  // Start covered -> masters walk plays 1.e4 e5 and presents move 2.
  await expect(page.getByText('1.e4 e5')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('1 covered')).toBeVisible();
});
