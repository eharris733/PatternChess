import { expect, test, type Page } from '@playwright/test';
import { stubApp } from './helpers/api';

/**
 * Live fetch progress: chess.com pages its archive by month, so the sidebar
 * pill and the onboarding import screen count games month by month instead
 * of sitting on "Syncing…". The chess.com API is stubbed with three slow
 * monthly archives (newest first: 4, 3, then 2 games).
 */

const USER = { id: 'sync-progress-user', email: 'progress@example.com', name: 'Progress' };

const PROFILE = {
  id: USER.id,
  display_name: 'Progress',
  lichess_username: null,
  chesscom_username: 'progress-test',
  preferred_rated_only: false,
  preferred_time_controls: [],
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: new Date().toISOString(),
};

async function stubChessCom(page: Page, monthDelayMs: number) {
  await page.addInitScript((delay: number) => {
    const archives = ['2026/09', '2026/10', '2026/11'].map(
      (m) => `https://api.chess.com/pub/player/progress-test/games/${m}`,
    );
    const sizes: Record<string, number> = { '2026/09': 2, '2026/10': 3, '2026/11': 4 };
    const month = (key: string) => {
      const [y, m] = key.split('/').map(Number);
      const base = Date.UTC(y, m - 1, 15) / 1000;
      return {
        games: Array.from({ length: sizes[key] }, (_, i) => ({
          url: `https://www.chess.com/game/live/${base + i}`,
          pgn: '[Event "Live Chess"]\n[White "progress-test"]\n[Black "them"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
          time_control: '600',
          rated: true,
          end_time: base + i,
          white: { username: 'progress-test', result: 'win' },
          black: { username: 'them', result: 'resigned' },
        })),
      };
    };
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: any, init?: any) => {
      const url: string = typeof input === 'string' ? input : input?.url ?? '';
      if (url.endsWith('/games/archives')) return Promise.resolve(json({ archives }));
      const hit = /games\/(\d{4}\/\d{2})$/.exec(url);
      if (hit && url.includes('api.chess.com')) {
        return new Promise((resolve) => setTimeout(() => resolve(json(month(hit[1]))), delay));
      }
      return origFetch(input, init);
    };
  }, monthDelayMs);
}

test('the sidebar pill counts chess.com games month by month', async ({ page }) => {
  await stubChessCom(page, 1500);
  await stubApp(page, { user: USER, profile: PROFILE, gameCount: 200 });
  await page.goto('/dashboard');

  const pill = page.getByRole('button', { name: /^Sync:/ });
  await expect(pill).toHaveAccessibleName('Sync: Fetching 4 of 200', { timeout: 10_000 });
  await expect(pill).toContainText('1 month back');
  await expect(pill).toHaveAccessibleName('Sync: Fetching 7 of 200', { timeout: 10_000 });
  await expect(pill).toContainText('2 months back');
  // All nine fetched, then the run settles.
  await expect(pill).toContainText('Tap to sync now', { timeout: 15_000 });
});

test('the sidebar pill counts Lichess games as the export streams in', async ({ page }) => {
  // Lichess streams its PGN export; send one game every 800 ms.
  await page.addInitScript(() => {
    const game = (id: string) =>
      `[Event "rated blitz game"]\n[Site "https://lichess.org/${id}"]\n[White "streamer"]\n[Black "them"]\n` +
      `[Result "1-0"]\n[UTCDate "2026.11.20"]\n[UTCTime "10:00:00"]\n[TimeControl "300+0"]\n\n1. e4 e5 1-0\n\n\n`;
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: any, init?: any) => {
      const url: string = typeof input === 'string' ? input : input?.url ?? '';
      if (url.includes('lichess.org/api/games/user/')) {
        const enc = new TextEncoder();
        const ids = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD'];
        const body = new ReadableStream({
          async start(c) {
            for (const id of ids) {
              c.enqueue(enc.encode(game(id)));
              await new Promise((r) => setTimeout(r, 800));
            }
            c.close();
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }
      return origFetch(input, init);
    };
  });
  await stubApp(page, {
    user: USER,
    profile: { ...PROFILE, chesscom_username: null, lichess_username: 'streamer' },
    gameCount: 200,
  });
  await page.goto('/dashboard');
  const pill = page.getByRole('button', { name: /^Sync:/ });
  await expect(pill).toHaveAccessibleName('Sync: Fetching 1 of 200', { timeout: 10_000 });
  await expect(pill).toHaveAccessibleName('Sync: Fetching 2 of 200', { timeout: 5_000 });
  await expect(pill).toContainText('Tap to sync now', { timeout: 15_000 });
});

test("a finished sync refreshes the plan's endgame and opening steps without a reload", async ({ page }) => {
  await stubChessCom(page, 1500);
  const rpc = await stubApp(page, {
    user: USER,
    profile: PROFILE,
    gameCount: 200,
    rpc: {
      // The fetched games are new: insert returns them as rows.
      'games.insert': (a) =>
        (a.games as Record<string, unknown>[]).map((g, i) => ({ ...g, id: `new-${i}`, user_id: USER.id })),
    },
  });
  await page.goto('/dashboard');
  const pill = page.getByRole('button', { name: /^Sync:/ });
  await expect(pill).toHaveAccessibleName(/Sync: Fetching \d/, { timeout: 10_000 });
  // The plan card has loaded its steps once by now.
  await expect.poll(() => rpc.callsTo('endgameScenarios.list').length, { timeout: 10_000 }).toBeGreaterThan(0);
  const endgameBefore = rpc.callsTo('endgameScenarios.list').length;
  const openingBefore = rpc.callsTo('blunders.drillsOfKind').filter((c) => c.args.kind === 'opening').length;
  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations++;
  });

  await expect(pill).toHaveAccessibleName(/Sync: \+9 games/, { timeout: 15_000 });
  await expect.poll(() => rpc.callsTo('endgameScenarios.list').length, { timeout: 10_000 }).toBeGreaterThan(endgameBefore);
  await expect
    .poll(() => rpc.callsTo('blunders.drillsOfKind').filter((c) => c.args.kind === 'opening').length, { timeout: 10_000 })
    .toBeGreaterThan(openingBefore);
  expect(navigations).toBe(0);
});

test('the onboarding import screen shows the live fetch line', async ({ page }) => {
  await stubChessCom(page, 1500);
  await stubApp(page, { user: USER, profile: PROFILE, gameCount: 0 });
  await page.goto('/dashboard');

  await expect(page.getByText('Importing games')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Fetching games… 4 of 200 (1 month back)')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Fetching games… 7 of 200 (2 months back)')).toBeVisible({ timeout: 10_000 });
});
