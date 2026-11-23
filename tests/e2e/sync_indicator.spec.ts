import { expect, test } from '@playwright/test';
import { getRpcCalls, stubApp } from './helpers/api';

const FAKE_USER_ID = 'sync-indicator-user';
const USER = { id: FAKE_USER_ID, email: 'sync@example.com', name: 'Sync User' };

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
  // A non-zero game count so the onboarding gate treats this as a returning
  // user; profile.update calls (the Save flow) are recorded by the stub.
  await stubApp(page, { user: USER, profile, gameCount: 200 });
  await page.addInitScript(() => {
    // Captured chess-site calls so tests can assert on them.
    const captured: { lichessUrls: string[] } = { lichessUrls: [] };
    (window as any).__captured__ = captured;

    const origFetch = window.fetch.bind(window);
    window.fetch = (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (typeof url === 'string') {
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
  });
}

async function getCaptured(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      (window as any).__captured__ as {
        lichessUrls: string[];
      },
  );
}

test('SyncIndicator stays visible after sync and syncs again on tap', async ({ page }) => {
  await stubProfileAndApis(page);
  await page.goto('/dashboard');

  // The pill is the sidebar's sync control (aria-label "Sync: <headline>");
  // once the auto-sync settles it offers "Tap to sync now".
  const pill = page.getByRole('button', { name: /^Sync:/ });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Tap to sync now', { timeout: 10_000 });
  await expect(pill).toBeEnabled();
  const before = (await getCaptured(page)).lichessUrls.length;
  expect(before).toBeGreaterThan(0);

  // Tapping it runs a fresh sync (the pill itself is the "Sync now" button).
  await pill.click();
  await expect
    .poll(async () => (await getCaptured(page)).lichessUrls.length, { timeout: 10_000 })
    .toBeGreaterThan(before);
  await expect(pill).toContainText('Tap to sync now', { timeout: 10_000 });
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

test('Saving sends the selected time controls as an array in the profile.update patch', async ({ page }) => {
  await stubProfileAndApis(page, { preferred_time_controls: [] });
  await page.goto('/profile');

  await page.getByRole('checkbox', { name: 'Blitz' }).check();
  await page.getByRole('checkbox', { name: 'Rapid' }).check();
  await page.getByRole('button', { name: /^Save/ }).click();

  // Wait for the "Saved." confirmation so we know the update has resolved.
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 5_000 });

  const updates = getRpcCalls(page, 'profile.update');
  expect(updates.length).toBeGreaterThan(0);
  const last = updates[updates.length - 1].args.patch;
  expect(Array.isArray(last.preferred_time_controls)).toBe(true);
  expect([...last.preferred_time_controls].sort()).toEqual(['blitz', 'rapid']);
});

test('Lichess fetch joins selected time controls comma-separated as perfType', async ({ page }) => {
  await stubProfileAndApis(page, { preferred_time_controls: ['blitz', 'rapid'] });
  await page.goto('/dashboard');

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
  await page.goto('/dashboard');

  await expect
    .poll(async () => (await getCaptured(page)).lichessUrls.length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const { lichessUrls } = await getCaptured(page);
  const params = new URL(lichessUrls[0]).searchParams;
  expect(params.has('perfType')).toBe(false);
});
