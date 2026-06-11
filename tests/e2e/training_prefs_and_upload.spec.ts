import { expect, test, type Page } from '@playwright/test';

// Covers two of the testing-feedback features:
//  - the profile "Training" card persists the two new preference columns
//  - the PGN upload modal surfaces a color override when the entered name
//    doesn't match a game's White/Black headers (Lichess study exports).

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

async function stubAuth(
  page: Page,
  opts: { patchBehavior?: 'ok' | 'slow' | 'fail' } = {},
) {
  await page.addInitScript(
    ({ session, project, profile, patchBehavior }) => {
      (window as any).__patches = [];
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
          if (method === 'PATCH' && url.includes('/rest/v1/profiles')) {
            (window as any).__patches.push(String(init?.body ?? ''));
            if (patchBehavior === 'fail') {
              return json({ code: '42703', message: 'column does not exist' }, 400);
            }
            if (patchBehavior === 'slow') {
              return new Promise((resolve) =>
                setTimeout(() => resolve(new Response(JSON.stringify(profile), { status: 200 })), 2000),
              );
            }
          }
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': '*/3' } }),
            );
          }
          if (url.includes('/rest/v1/profiles')) return json(profile);
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
      patchBehavior: opts.patchBehavior ?? 'ok',
    },
  );
}

test('profile training card saves the two new preferences on toggle', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/profile');

  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();

  await page.getByText('Show the review step before solving').click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).__patches as string[]))
    .toContainEqual(expect.stringContaining('"reveal_before_solve":true'));

  await page.getByText('Show raw engine evals').click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).__patches as string[]))
    .toContainEqual(expect.stringContaining('"show_engine_evals":true'));
});

test('training toggles flip optimistically while the PATCH is in flight', async ({ page }) => {
  await stubAuth(page, { patchBehavior: 'slow' });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();

  const checkbox = page
    .locator('label', { hasText: 'Show the review step before solving' })
    .locator('input[type="checkbox"]');
  await checkbox.click();
  // The PATCH takes 2s in this stub; the checkbox must be checked well before
  // that — assert within 500ms.
  await expect(checkbox).toBeChecked({ timeout: 500 });
});

test('training toggles revert when the PATCH fails', async ({ page }) => {
  await stubAuth(page, { patchBehavior: 'fail' });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();

  const checkbox = page
    .locator('label', { hasText: 'Show the review step before solving' })
    .locator('input[type="checkbox"]');
  await checkbox.click();
  await expect(page.getByText(/Could not save this preference/)).toBeVisible();
  await expect(checkbox).not.toBeChecked();
});

const UNMATCHED_PGN = `[Event "Club Championship"]
[Site "OTB"]
[White "Someone Else"]
[Black "Another Player"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

test('pgn upload surfaces the color override for unmatched games', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/vault');

  await page.getByRole('button', { name: 'Upload PGNs' }).first().click();
  await expect(page.getByRole('heading', { name: 'Upload PGNs' })).toBeVisible();

  // The modal's labels aren't htmlFor-associated — target by placeholder.
  await page.locator('textarea.input').fill(UNMATCHED_PGN);
  const nameInput = page.getByPlaceholder('e.g. drnykterstein');
  await nameInput.fill('tester');

  // The entered name matches neither header — the override appears.
  await expect(page.getByText(/don't list|doesn't list/)).toBeVisible();
  await expect(page.getByText('Not sure (analyze both sides)')).toBeVisible();
  await page.getByText('Black', { exact: true }).click();

  // A matching name makes the override disappear again.
  await nameInput.fill('Someone Else');
  await expect(page.getByText(/don't list|doesn't list/)).toHaveCount(0);
});
