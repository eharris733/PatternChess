import { expect, test } from '@playwright/test';

const FAKE_USER_ID = 'sync-indicator-user';
const FAKE_SESSION = {
  access_token: 'fake',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fake-refresh',
  user: {
    id: FAKE_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'sync@example.com',
    user_metadata: { full_name: 'Sync User', avatar_url: null },
    app_metadata: {},
    created_at: new Date().toISOString(),
  },
};
const SUPABASE_PROJECT = 'ydfwppthwnlgxnntzrvg';

const FAKE_PROFILE_ROW = {
  id: FAKE_USER_ID,
  display_name: 'Sync User',
  avatar_url: null,
  lichess_username: 'drnykterstein',
  chesscom_username: 'hikaru',
  preferred_rated_only: true,
  preferred_time_control: 'blitz',
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: new Date().toISOString(),
};

async function stubProfileAndApis(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ session, project, profile, userId }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string') {
          // Supabase auth: getUser
          if (url.includes(`${project}.supabase.co/auth/v1/user`)) {
            return Promise.resolve(
              new Response(JSON.stringify(session.user), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // Supabase REST: profiles select for our user → return one row
          if (
            url.includes(`${project}.supabase.co/rest/v1/profiles`) &&
            url.includes(`id=eq.${userId}`) &&
            (init?.method ?? 'GET') === 'GET'
          ) {
            return Promise.resolve(
              new Response(JSON.stringify([profile]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // Supabase REST: existing game keys → empty
          if (url.includes(`${project}.supabase.co/rest/v1/games`)) {
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // Any other supabase call → empty array
          if (url.includes(`${project}.supabase.co`)) {
            return Promise.resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // Lichess game stream: NDJSON, return empty body
          if (url.includes('lichess.org/api/games/user/')) {
            return Promise.resolve(
              new Response('', {
                status: 200,
                headers: { 'content-type': 'application/x-ndjson' },
              }),
            );
          }
          // Chess.com archives → no archives, so fetch loop exits immediately
          if (url.includes('api.chess.com/pub/player/')) {
            return Promise.resolve(
              new Response(JSON.stringify({ archives: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: FAKE_PROFILE_ROW, userId: FAKE_USER_ID },
  );
}

test('SyncIndicator stays visible after sync and exposes Sync now', async ({ page }) => {
  await stubProfileAndApis(page);
  await page.goto('/');

  // The indicator pill is in the AppShell topbar. After sync completes for both
  // providers it stays visible (was previously auto-hidden); after the 4s collapse
  // it shows the idle "Sync" label with the ↻ glyph.
  const pill = page.getByRole('button', { name: /Sync/ });
  await expect(pill).toBeVisible();

  // Wait long enough for the post-done collapse → idle.
  await expect(pill).toContainText(/Sync/, { timeout: 10_000 });

  // Open the popover and confirm the new "Sync now" trigger exists and is enabled.
  await pill.click();
  const syncNow = page.getByRole('button', { name: 'Sync now' });
  await expect(syncNow).toBeVisible();
  await expect(syncNow).toBeEnabled();
});

test('Profile sync preferences inputs render', async ({ page }) => {
  await stubProfileAndApis(page);
  await page.goto('/profile');

  await expect(page.getByRole('heading', { name: 'Sync preferences' })).toBeVisible();
  const ratedOnly = page.getByRole('checkbox', { name: 'Rated games only' });
  await expect(ratedOnly).toBeVisible();
  await expect(ratedOnly).toBeChecked(); // profile has preferred_rated_only: true

  const select = page.getByRole('combobox');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('blitz'); // profile preferred_time_control
});
