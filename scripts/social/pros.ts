// "Blunders decide games": the players we feature and where their games come
// from. Only games where BOTH players are on the roster are used, and names
// come only from here (checked against each account's chess.com profile on
// 2026-11-23), so the video never names someone from a bare handle.
//
// Source: chess.com's public API (monthly game archives per player). Moves are
// facts; we rebuild each game on our own board and never reuse footage.
// Lichess broadcasts (OTB) are a follow-up: their round PGNs came back without
// moves when this was built.
import { Chess } from 'chess.js';

export interface RosterPlayer {
  /** chess.com username, lowercase. */
  handle: string;
  name: string;
  /** What the narrator calls them. */
  short: string;
  title: string;
  /** Lower = more recognizable (ranks candidates). */
  fame: number;
}

export const PRO_PLAYERS: readonly RosterPlayer[] = [
  { handle: 'magnuscarlsen', name: 'Magnus Carlsen', short: 'Magnus', title: 'GM', fame: 1 },
  { handle: 'hikaru', name: 'Hikaru Nakamura', short: 'Hikaru', title: 'GM', fame: 1 },
  { handle: 'fabianocaruana', name: 'Fabiano Caruana', short: 'Caruana', title: 'GM', fame: 2 },
  { handle: 'gukeshdommaraju', name: 'Gukesh D', short: 'Gukesh', title: 'GM', fame: 2 },
  { handle: 'firouzja2003', name: 'Alireza Firouzja', short: 'Firouzja', title: 'GM', fame: 2 },
  { handle: 'rpragchess', name: 'Praggnanandhaa Rameshbabu', short: 'Pragg', title: 'GM', fame: 2 },
  { handle: 'lachesisq', name: 'Ian Nepomniachtchi', short: 'Nepo', title: 'GM', fame: 2 },
  { handle: 'thevish', name: 'Viswanathan Anand', short: 'Anand', title: 'GM', fame: 2 },
  { handle: 'gmwso', name: 'Wesley So', short: 'Wesley So', title: 'GM', fame: 3 },
  { handle: 'lyonbeast', name: 'Maxime Vachier-Lagrave', short: 'MVL', title: 'GM', fame: 3 },
  { handle: 'anishgiri', name: 'Anish Giri', short: 'Giri', title: 'GM', fame: 3 },
  { handle: 'levonaronian', name: 'Levon Aronian', short: 'Aronian', title: 'GM', fame: 3 },
  { handle: 'ghandeevam2003', name: 'Arjun Erigaisi', short: 'Arjun', title: 'GM', fame: 3 },
  { handle: 'nihalsarin', name: 'Nihal Sarin', short: 'Nihal', title: 'GM', fame: 3 },
  { handle: 'chesswarrior7197', name: 'Nodirbek Abdusattorov', short: 'Abdusattorov', title: 'GM', fame: 3 },
  { handle: 'duhless', name: 'Daniil Dubov', short: 'Dubov', title: 'GM', fame: 3 },
  { handle: 'polish_fighter3000', name: 'Jan-Krzysztof Duda', short: 'Duda', title: 'GM', fame: 3 },
  { handle: 'vincentkeymer', name: 'Vincent Keymer', short: 'Keymer', title: 'GM', fame: 3 },
  { handle: 'azerichess', name: 'Shakhriyar Mamedyarov', short: 'Mamedyarov', title: 'GM', fame: 3 },
  { handle: 'grischuk', name: 'Alexander Grischuk', short: 'Grischuk', title: 'GM', fame: 3 },
  { handle: 'viditchess', name: 'Vidit Gujrathi', short: 'Vidit', title: 'GM', fame: 4 },
  { handle: 'denlaz', name: 'Denis Lazavik', short: 'Lazavik', title: 'GM', fame: 4 },
  { handle: 'jospem', name: 'Jose Martinez', short: 'Martinez', title: 'GM', fame: 4 },
  { handle: 'wonderfultime', name: 'Tuan Minh Le', short: 'Tuan Minh Le', title: 'GM', fame: 4 },
  { handle: 'fairchess_on_youtube', name: 'Dmitry Andreikin', short: 'Andreikin', title: 'GM', fame: 4 },
];

const BY_HANDLE = new Map(PRO_PLAYERS.map((p) => [p.handle, p]));

export function rosterPlayer(handle: string): RosterPlayer | undefined {
  return BY_HANDLE.get(handle.toLowerCase());
}

/** A decisive game between two roster players. */
export interface ProGame {
  /** chess.com game id (from the URL). */
  id: string;
  url: string;
  pgn: string;
  white: { player: RosterPlayer; rating: number };
  black: { player: RosterPlayer; rating: number };
  winner: 'white' | 'black';
  event: string;
  year: number;
  timeControl: 'bullet' | 'blitz' | 'rapid';
  endTime: number;
}

/** chess.com archive game JSON (the fields we read). */
export interface ChessComGame {
  url: string;
  pgn?: string;
  rules: string;
  time_class: string;
  end_time: number;
  tournament?: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

const TIME_CLASSES = new Set(['bullet', 'blitz', 'rapid']);
/** The loser's result when the game was decided on the board. */
const DECIDED = new Set(['resigned', 'checkmated']);

/** "Titled Tuesday" from the tournament URL, else "Online blitz". */
export function eventLabel(g: Pick<ChessComGame, 'tournament' | 'time_class'>): string {
  const t = g.tournament ?? '';
  if (/titled-tuesday/i.test(t)) return 'Titled Tuesday';
  if (/speed-chess-championship/i.test(t)) return 'Speed Chess Championship';
  if (/bullet-chess-championship/i.test(t)) return 'Bullet Chess Championship';
  return `Online ${g.time_class}`;
}

/** Pure: an archive game → a ProGame when both players are on the roster and someone won. */
export function toProGame(g: ChessComGame): ProGame | null {
  const w = rosterPlayer(g.white.username);
  const b = rosterPlayer(g.black.username);
  if (!w || !b || g.rules !== 'chess' || !g.pgn || !TIME_CLASSES.has(g.time_class)) return null;
  const winner = g.white.result === 'win' ? 'white' : g.black.result === 'win' ? 'black' : null;
  if (!winner) return null;
  // Decided on the board: lost on time / abandoned games have no deciding blunder.
  if (!DECIDED.has((winner === 'white' ? g.black : g.white).result)) return null;
  const id = /\/(\d+)(?:[?#].*)?$/.exec(g.url)?.[1];
  if (!id) return null;
  return {
    id,
    url: g.url,
    pgn: g.pgn,
    white: { player: w, rating: g.white.rating },
    black: { player: b, rating: g.black.rating },
    winner,
    event: eventLabel(g),
    year: new Date(g.end_time * 1000).getUTCFullYear(),
    timeControl: g.time_class as ProGame['timeControl'],
    endTime: g.end_time,
  };
}

export const proBlunderId = (gameId: string) => `pro:chesscom:${gameId}`;

/** Higher is better: famous pairings first, then recency. */
export function proGameScore(g: ProGame, now = Date.now() / 1000): number {
  const fame = 10 - g.white.player.fame - g.black.player.fame;
  const ageDays = Math.max(0, (now - g.endTime) / 86400);
  return fame * 10 - ageDays * 0.5 + (g.timeControl === 'bullet' ? 0 : 3);
}

const UA = 'PatternChess social bot (+https://patternchess.com)';

async function getJson<T>(url: string, f: typeof fetch): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await f(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  }
  return null;
}

function monthPath(d: Date): string {
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Decisive roster-vs-roster games from this and last month's archives,
 * best first, minus `seen` (blunder ids already used or rejected).
 */
export async function fetchProGames(seen: ReadonlySet<string>, now = new Date(), f: typeof fetch = fetch): Promise<ProGame[]> {
  const months = [monthPath(now), monthPath(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)))];
  const byId = new Map<string, ProGame>();
  for (const p of PRO_PLAYERS) {
    for (const m of months) {
      const data = await getJson<{ games?: ChessComGame[] }>(`https://api.chess.com/pub/player/${p.handle}/games/${m}`, f);
      for (const g of data?.games ?? []) {
        const pg = toProGame(g);
        if (pg && !seen.has(proBlunderId(pg.id))) byId.set(pg.id, pg);
      }
    }
  }
  const t = now.getTime() / 1000;
  return [...byId.values()].sort((a, b) => proGameScore(b, t) - proGameScore(a, t));
}

/** The game's positions: fens[i] is before ply i; moves[i] the UCI of ply i. */
export function replayPgn(pgn: string): { fens: string[]; moves: string[] } | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const history = chess.history({ verbose: true });
  return {
    fens: history.map((m) => m.before),
    moves: history.map((m) => `${m.from}${m.to}${m.promotion ?? ''}`),
  };
}
