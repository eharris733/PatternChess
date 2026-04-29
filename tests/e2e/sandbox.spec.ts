import { expect, test } from '@playwright/test';

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
    user_metadata: { full_name: 'E2E User' },
    app_metadata: {},
    created_at: new Date().toISOString(),
  },
};

const SUPABASE_PROJECT = 'ydfwppthwnlgxnntzrvg';

async function stubAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ session, project }) => {
      try {
        // Block any outbound supabase calls so loaders don't hang
        const origFetch = window.fetch.bind(window);
        window.fetch = (input: any, init?: any) => {
          const url = typeof input === 'string' ? input : input?.url ?? '';
          if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
            return Promise.resolve(
              new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
            );
          }
          return origFetch(input, init);
        };
        const key = `sb-${project}-auth-token`;
        localStorage.setItem(key, JSON.stringify(session));
      } catch {
        /* ignore */
      }
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT },
  );
}

test('sandbox board exposes interactive chessground', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/__sandbox');

  const fenBefore = await page.locator('[data-testid="sandbox-fen"]').textContent();
  expect(fenBefore).toContain('rnbqkbnr');

  // Drag e2 → e4 by clicking on the source then destination square
  const board = page.locator('cg-board');
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;
  const sq = width / 8;

  // White on bottom (default orientation) — e2 is file e, rank 2.
  // file index e = 4, rank 2 from bottom = index 6 from top.
  const e2 = { x: x + sq * 4 + sq / 2, y: y + sq * 6 + sq / 2 };
  const e4 = { x: x + sq * 4 + sq / 2, y: y + sq * 4 + sq / 2 };

  await page.mouse.move(e2.x, e2.y);
  await page.mouse.down();
  await page.mouse.move(e4.x, e4.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => {
    return (await page.locator('[data-testid="sandbox-fen"]').textContent()) ?? '';
  }).toContain('4P3'); // pawn now on e4
});
