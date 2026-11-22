import { expect, test } from '@playwright/test';
import { stubApp } from './helpers/api';

// Games sync never revisits (a PGN upload whose analysis was cut short) must be
// finished by the dashboard's maintenance worker. Sync is stubbed to find
// nothing of its own, so the only thing that can stamp the PGN game is the
// leftover sweep.

const PROFILE = { lichess_username: 'tester' };

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
  const stamped: string[] = [];
  const pending = () => stamped.length === 0;
  await stubApp(page, {
    profile: PROFILE,
    gameCount: 1,
    rpc: {
      'games.markAnalyzed': (args) => {
        stamped.push(args.gameId);
        return null;
      },
      'games.countUnanalyzed': () => (pending() ? 1 : 0),
      // Sync's own sweep is scoped to its platform — it must not see the PGN game.
      'games.unanalyzedIds': () => [],
      'games.leftoverUnanalyzedIds': () => (pending() ? [PGN_GAME.id] : []),
      'games.get': (args) => (args.id === PGN_GAME.id ? PGN_GAME : null),
      'games.byIds': (args) => ((args.ids as string[]).includes(PGN_GAME.id) ? [PGN_GAME] : []),
      // Game lists: one game, so the shell renders the dashboard rather than
      // the first-import screen.
      'games.list': () => [{ ...PGN_GAME, analyzed_at: pending() ? null : new Date().toISOString() }],
    },
  });

  await page.goto('/dashboard');
  await expect.poll(() => stamped, { timeout: 45_000 }).toEqual(['pgn-game-1']);
});
