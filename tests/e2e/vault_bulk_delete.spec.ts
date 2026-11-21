import { expect, test } from '@playwright/test';

// Vault "Delete games…": pick a cutoff date, see the count, and delete exactly
// the games played before it.

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

const DAY = 86_400_000;
const game = (id: string, daysAgo: number) => ({
  id,
  user_id: 'e2e-user',
  platform: 'lichess',
  username: 'tester',
  opponent: `opp-${id}`,
  time_control: '600+0',
  rated: true,
  result: '1-0',
  user_color: 'white',
  played_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
  created_at: new Date().toISOString(),
  analyzed_at: new Date().toISOString(),
});
const GAMES = [game('g-new', 1), game('g-old1', 400), game('g-old2', 500)];

test('bulk delete removes only games played before the chosen date', async ({ page }) => {
  await page.addInitScript(
    ({ session, project, profile, games }) => {
      const w = window as unknown as { __deleted: string[] };
      w.__deleted = [];
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url: string = typeof input === 'string' ? input : input?.url ?? '';
        if (!url.includes(`${project}.supabase.co`)) return origFetch(input, init);
        const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
        const json = (body: unknown) =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        if (url.includes('/auth/v1/user')) return json(session.user);
        if (url.includes('/rest/v1/profiles')) return json(profile);
        if (method === 'HEAD') {
          return Promise.resolve(
            new Response(null, { status: 200, headers: { 'content-range': `*/${games.length}` } }),
          );
        }
        if (url.includes('/rest/v1/games')) {
          if (method === 'DELETE') {
            const ids = decodeURIComponent(url).match(/id=in\.\(([^)]*)\)/)?.[1].split(',') ?? [];
            w.__deleted.push(...ids.map((s) => s.replace(/"/g, '')));
            return json(ids.map((id) => ({ id: id.replace(/"/g, '') })));
          }
          return json(games.filter((g) => !w.__deleted.includes(g.id)));
        }
        return json([]);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE, games: GAMES },
  );

  await page.goto('/vault?tab=games');
  await expect(page.getByText('3 games synced')).toBeVisible();
  await page.getByRole('button', { name: 'Delete games…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete games' });
  await expect(dialog.getByRole('button', { name: /^Delete \d+ game/ })).toBeDisabled();

  const cutoff = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  await dialog.getByLabel('Delete games played before this date').fill(cutoff);
  await dialog.getByRole('button', { name: 'Delete 2 games' }).click();

  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as any).__deleted)).toEqual(['g-old1', 'g-old2']);
  await expect(page.getByText('1 game synced')).toBeVisible();
});
