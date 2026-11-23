import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchChessComGames,
  fetchLichessGames,
  readStreamWithProgress,
  type FetchProgress,
} from './chessApiService';

const lichessGame = (id: string) =>
  [
    '[Event "rated blitz game"]',
    `[Site "https://lichess.org/${id}"]`,
    '[White "me"]',
    '[Black "them"]',
    '[Result "1-0"]',
    '[UTCDate "2026.11.20"]',
    '[UTCTime "10:00:00"]',
    '[TimeControl "300+0"]',
    '',
    '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0',
    '',
    '',
  ].join('\n');

/** A Response whose body arrives in the given chunks. */
function streamed(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readStreamWithProgress', () => {
  it('counts complete games as they stream, a header split across chunks once', async () => {
    const pgn = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC'].map(lichessGame).join('');
    // Split in the middle of the second game's "[Event " marker.
    const cut = pgn.indexOf('[Event', 10) + 3;
    const seen: number[] = [];
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
    const text = await readStreamWithProgress(streamed([pgn.slice(0, cut), pgn.slice(cut)]), (n) => seen.push(n));
    expect(text).toBe(pgn);
    // Chunk 1 holds game 1's start only; chunk 2 completes games 1 and 2 (game 3 may still be streaming).
    expect(seen).toEqual([0, 2]);
  });

  it('falls back to text() without a body stream', async () => {
    const res = new Response(null, { status: 200 });
    expect(await readStreamWithProgress(res, () => {})).toBe('');
  });
});

describe('fetch progress', () => {
  it('Lichess reports a live count against the import cap', async () => {
    const pgn = ['AAAAAAAA', 'BBBBBBBB'].map(lichessGame).join('');
    vi.stubGlobal('fetch', vi.fn(async () => streamed([pgn])));
    const seen: FetchProgress[] = [];
    const games = await fetchLichessGames('me', { maxGames: 200, onProgress: (p) => seen.push(p) });
    expect(games.map((g) => g.external_game_id)).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    expect(seen[0]).toEqual({ fetched: 0, target: 200 });
    expect(seen.at(-1)).toEqual({ fetched: 2, target: 200 });
  });

  it('chess.com reports per month: months back on a backlog, month i/n on an incremental sync', async () => {
    const month = (n: number, endBase: number) => ({
      games: Array.from({ length: n }, (_, i) => ({
        url: `https://www.chess.com/game/live/${endBase + i}`,
        pgn: '[Event "Live"]\n\n1. e4 *',
        time_control: '600',
        rated: true,
        end_time: endBase + i,
        white: { username: 'me', result: 'win' },
        black: { username: 'them', result: 'checkmated' },
      })),
    });
    const archives = ['2026/09', '2026/10', '2026/11'].map((m) => `https://api.chess.com/pub/player/me/games/${m}`);
    const bodies: Record<string, unknown> = {
      'https://api.chess.com/pub/player/me/games/archives': { archives },
      [archives[0]]: month(2, Date.UTC(2026, 8, 15) / 1000),
      [archives[1]]: month(3, Date.UTC(2026, 9, 15) / 1000),
      [archives[2]]: month(4, Date.UTC(2026, 10, 15) / 1000),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(bodies[url]), { status: 200 })),
    );
    vi.useFakeTimers();

    const seen: FetchProgress[] = [];
    const run = fetchChessComGames('me', { maxGames: 200, onProgress: (p) => seen.push(p) });
    await vi.runAllTimersAsync();
    expect((await run).length).toBe(9);
    expect(seen.map((p) => [p.fetched, p.monthsDone, p.monthsTotal, p.target])).toEqual([
      [0, 0, null, 200],
      [4, 1, null, 200],
      [7, 2, null, 200],
      [9, 3, null, 200],
    ]);

    // Incremental, since mid-October: the window is October + November.
    const inc: FetchProgress[] = [];
    const run2 = fetchChessComGames('me', {
      // Between October's first and second game: its last two are newer.
      since: new Date(Date.UTC(2026, 9, 15, 0, 0, 0, 500)),
      onProgress: (p) => inc.push(p),
    });
    await vi.runAllTimersAsync();
    expect((await run2).length).toBe(4 + 2);
    expect(inc.map((p) => [p.fetched, p.monthsDone, p.monthsTotal, p.target])).toEqual([
      [0, 0, 2, null],
      [4, 1, 2, null],
      [6, 2, 2, null],
    ]);
  });
});
