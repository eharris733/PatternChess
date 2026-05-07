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

type FakeProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  lichess_username: string | null;
  chesscom_username: string | null;
  preferred_rated_only: boolean;
  preferred_time_controls: string[];
  last_synced_lichess_at: string | null;
  last_synced_chesscom_at: string | null;
  created_at: string;
};

const DEFAULT_PROFILE: FakeProfile = {
  id: FAKE_USER_ID,
  display_name: 'Sync User',
  avatar_url: null,
  lichess_username: 'drnykterstein',
  chesscom_username: 'hikaru',
  preferred_rated_only: true,
  preferred_time_controls: ['blitz', 'rapid'],
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: new Date().toISOString(),
};

async function stubProfileAndApis(
  page: import('@playwright/test').Page,
  profileOverride?: Partial<FakeProfile>,
) {
  const profile: FakeProfile = { ...DEFAULT_PROFILE, ...profileOverride };
  await page.addInitScript(
    ({ session, project, profile, userId }) => {
      // Captured outbound calls so tests can assert on them.
      const captured: { lichessUrls: string[]; profilePatchBodies: any[] } = {
        lichessUrls: [],
        profilePatchBodies: [],
      };
      (window as any).__captured__ = captured;

      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        const method = (init?.method ?? 'GET').toUpperCase();
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
          // Capture profiles PATCH bodies (the Save flow).
          if (
            url.includes(`${project}.supabase.co/rest/v1/profiles`) &&
            method === 'PATCH'
          ) {
            try {
              captured.profilePatchBodies.push(JSON.parse(init?.body ?? '{}'));
            } catch {
              /* noop */
            }
            return Promise.resolve(
              new Response(JSON.stringify([profile]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // Supabase REST: profiles select for our user → return one row
          if (
            url.includes(`${project}.supabase.co/rest/v1/profiles`) &&
            url.includes(`id=eq.${userId}`) &&
            method === 'GET'
          ) {
            return Promise.resolve(
              new Response(JSON.stringify([profile]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          // Supabase REST: existing game keys / inserts → empty
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
          // Lichess game stream: capture URL, return empty body
          if (url.includes('lichess.org/api/games/user/')) {
            captured.lichessUrls.push(url);
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
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile,
      userId: FAKE_USER_ID,
    },
  );
}

async function getCaptured(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      (window as any).__captured__ as {
        lichessUrls: string[];
        profilePatchBodies: any[];
      },
  );
}

test('SyncIndicator stays visible after sync and exposes Sync now', async ({ page }) => {
  await stubProfileAndApis(page);
  await page.goto('/');

  const pill = page.getByRole('button', { name: /Sync/ });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText(/Sync/, { timeout: 10_000 });

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
  await expect(ratedOnly).toBeChecked();

  await expect(page.getByRole('checkbox', { name: 'Bullet' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Blitz' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Rapid' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Classical' })).not.toBeChecked();
});

test('Time-control checkboxes are independently toggleable (multi-select)', async ({ page }) => {
  // Start with no time controls set so we toggle the boxes from off → on.
  await stubProfileAndApis(page, { preferred_time_controls: [] });
  await page.goto('/profile');

  const bullet = page.getByRole('checkbox', { name: 'Bullet' });
  const blitz = page.getByRole('checkbox', { name: 'Blitz' });
  const rapid = page.getByRole('checkbox', { name: 'Rapid' });
  const classical = page.getByRole('checkbox', { name: 'Classical' });

  await expect(bullet).not.toBeChecked();
  await expect(blitz).not.toBeChecked();
  await expect(rapid).not.toBeChecked();
  await expect(classical).not.toBeChecked();

  // Pick blitz + rapid; bullet/classical stay off.
  await blitz.check();
  await rapid.check();
  await expect(blitz).toBeChecked();
  await expect(rapid).toBeChecked();
  await expect(bullet).not.toBeChecked();
  await expect(classical).not.toBeChecked();

  // Toggling blitz off must not disturb rapid.
  await blitz.uncheck();
  await expect(blitz).not.toBeChecked();
  await expect(rapid).toBeChecked();
});

test('Saving sends the selected time controls as an array in the PATCH body', async ({ page }) => {
  await stubProfileAndApis(page, { preferred_time_controls: [] });
  await page.goto('/profile');

  await page.getByRole('checkbox', { name: 'Blitz' }).check();
  await page.getByRole('checkbox', { name: 'Rapid' }).check();
  await page.getByRole('button', { name: /^Save/ }).click();

  // Wait for the "Saved." confirmation so we know the PATCH has resolved.
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 5_000 });

  const captured = await getCaptured(page);
  expect(captured.profilePatchBodies.length).toBeGreaterThan(0);
  const last = captured.profilePatchBodies[captured.profilePatchBodies.length - 1];
  expect(Array.isArray(last.preferred_time_controls)).toBe(true);
  expect([...last.preferred_time_controls].sort()).toEqual(['blitz', 'rapid']);
});

test('Lichess fetch joins selected time controls comma-separated as perfType', async ({ page }) => {
  await stubProfileAndApis(page, { preferred_time_controls: ['blitz', 'rapid'] });
  await page.goto('/');

  // Sync auto-fires on sign-in; wait for the lichess request to be captured.
  await expect
    .poll(async () => (await getCaptured(page)).lichessUrls.length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const { lichessUrls } = await getCaptured(page);
  const url = lichessUrls[0];
  const params = new URL(url).searchParams;
  const perfType = params.get('perfType');
  expect(perfType).not.toBeNull();
  expect(perfType!.split(',').sort()).toEqual(['blitz', 'rapid']);
});

test('Empty time-control selection omits perfType from the Lichess request', async ({ page }) => {
  await stubProfileAndApis(page, { preferred_time_controls: [] });
  await page.goto('/');

  await expect
    .poll(async () => (await getCaptured(page)).lichessUrls.length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const { lichessUrls } = await getCaptured(page);
  const params = new URL(lichessUrls[0]).searchParams;
  expect(params.has('perfType')).toBe(false);
});
