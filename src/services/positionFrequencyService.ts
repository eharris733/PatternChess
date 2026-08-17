import { GameRecord, resolveOutcome } from '../models/gameRecord';
import { parseGame } from './pgnParserService';
import { toEpd } from '../chess/moveUtils';

export interface MoveTally {
  count: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface PositionStats {
  /** Times this position occurred across the indexed games. */
  total: number;
  /** Moves the user played here (own-side positions). */
  userMoves: Map<string, MoveTally>;
  /** Moves opponents played here (their-side positions). */
  opponentMoves: Map<string, MoveTally>;
}

export interface FrequencyIndex {
  /** `${gameCount}:${newestCreatedAt}` — cheap invalidation key. */
  version: string;
  white: Map<string, PositionStats>;
  black: Map<string, PositionStats>;
  forColor(color: 'white' | 'black'): Map<string, PositionStats>;
}

/** Opening theory only — index the first 30 plies (15 moves) of each game. */
const MAX_PLIES = 30;
/** Yield to the main thread every N games while indexing. */
const CHUNK_SIZE = 50;

function indexVersion(games: GameRecord[]): string {
  let newest = 0;
  for (const g of games) newest = Math.max(newest, g.createdAt.getTime());
  return `${games.length}:${newest}`;
}

function tally(map: Map<string, MoveTally>, uci: string, outcome: 'win' | 'loss' | 'draw' | null) {
  let t = map.get(uci);
  if (!t) {
    t = { count: 0, wins: 0, draws: 0, losses: 0 };
    map.set(uci, t);
  }
  t.count++;
  if (outcome === 'win') t.wins++;
  else if (outcome === 'draw') t.draws++;
  else if (outcome === 'loss') t.losses++;
}

function emptyIndex(version: string): FrequencyIndex {
  const white = new Map<string, PositionStats>();
  const black = new Map<string, PositionStats>();
  return {
    version,
    white,
    black,
    forColor(color) {
      return color === 'white' ? this.white : this.black;
    },
  };
}

async function build(games: GameRecord[]): Promise<FrequencyIndex> {
  const index = emptyIndex(indexVersion(games));
  let processed = 0;
  for (const game of games) {
    if (game.userColor && game.pgn) {
      const sideMap = index.forColor(game.userColor);
      const outcome = resolveOutcome(game.platform, game.result, game.userColor);
      let positions: ReturnType<typeof parseGame>;
      try {
        positions = parseGame(game.pgn);
      } catch {
        positions = [];
      }
      const plies = Math.min(positions.length, MAX_PLIES);
      for (let i = 0; i < plies; i++) {
        const pos = positions[i];
        if (!pos.uciMove) continue;
        const epd = toEpd(pos.fen);
        let stats = sideMap.get(epd);
        if (!stats) {
          stats = { total: 0, userMoves: new Map(), opponentMoves: new Map() };
          sideMap.set(epd, stats);
        }
        stats.total++;
        tally(
          pos.sideToMove === game.userColor ? stats.userMoves : stats.opponentMoves,
          pos.uciMove,
          outcome,
        );
      }
    }
    processed++;
    if (processed % CHUNK_SIZE === 0) {
      // Keep the main thread responsive on large game libraries.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return index;
}

// Module-level singleton — the raw PGNs are already in the TanStack games
// cache, so this is pure recomputation; memory-only with cheap version-based
// invalidation (IndexedDB persistence is not worth it at tens of ms of
// chess.js work per thousand games).
let cache: { version: string; promise: Promise<FrequencyIndex> } | null = null;

export function getFrequencyIndex(games: GameRecord[]): Promise<FrequencyIndex> {
  const version = indexVersion(games);
  if (cache?.version === version) return cache.promise;
  const promise = build(games);
  cache = { version, promise };
  return promise;
}

/** Test seam. */
export function __clearFrequencyIndexCache(): void {
  cache = null;
}
