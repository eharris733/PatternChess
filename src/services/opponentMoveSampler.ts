import { Chess } from 'chess.js';
import { GameRecord } from '../models/gameRecord';
import { PositionStats } from './positionFrequencyService';
import { fetchExplorer } from './openingExplorerService';
import { ratingBandFor } from './openingExplorerService';
import { weightedExplorerMove } from './repertoireBuilderService';
import { categoryForTimeControl } from './chessApiService';
import { parseUciMove, toEpd } from '../chess/moveUtils';
import { getOpponentStockfish } from '../hooks/useStockfish';

export interface OpponentBand {
  ratings: number[];
  speeds: string[];
}

export interface SampledMove {
  uci: string;
  source: 'games' | 'explorer' | 'engine';
}

/** Real opponent samples required before the user's own data outweighs the explorer. */
const MIN_OWN_SAMPLES = 5;
/** Stockfish's UCI_Elo floor/ceiling. */
const ENGINE_ELO_MIN = 1320;
const ENGINE_ELO_MAX = 3190;
const ENGINE_MOVETIME_MS = 300;

/**
 * Rating band + speeds describing the opposition the user actually faces:
 * most recent known rating, dominant time-control class. Games are expected
 * newest-first (getGames order).
 */
export function bandFromGames(games: GameRecord[]): OpponentBand & { userRating: number | null } {
  let userRating: number | null = null;
  for (const g of games) {
    if (typeof g.userRating === 'number') {
      userRating = g.userRating;
      break;
    }
  }
  const speedCounts = new Map<string, number>();
  for (const g of games) {
    const cat = categoryForTimeControl(g.timeControl);
    if (cat) speedCounts.set(cat, (speedCounts.get(cat) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let best = 0;
  for (const [cat, n] of speedCounts) {
    if (n > best) {
      best = n;
      dominant = cat;
    }
  }
  return {
    ratings: ratingBandFor(userRating),
    speeds: dominant ? [dominant] : ['blitz', 'rapid'],
    userRating,
  };
}

function legalMoves(fen: string): Set<string> {
  try {
    const chess = new Chess(fen);
    return new Set(chess.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`));
  } catch {
    return new Set();
  }
}

function weightedFromTallies(
  tallies: Map<string, { count: number }>,
  legal: Set<string>,
  rng: () => number,
): string | null {
  const entries = [...tallies.entries()].filter(([uci]) => legal.has(uci));
  const total = entries.reduce((a, [, t]) => a + t.count, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const [uci, t] of entries) {
    roll -= t.count;
    if (roll < 0) return uci;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

/**
 * Sample the opponent's reply, weighted toward what the user actually faces:
 * their real opponents' moves where the sample is big enough, the Lichess
 * rated-players book in their rating band below that, and a strength-limited
 * engine when both are unavailable (offline, rate-limited, out of book).
 * Null only when the position is terminal or every source fails.
 */
export async function sampleOpponentMove(opts: {
  fen: string;
  stats?: Map<string, PositionStats>;
  band: OpponentBand;
  userRating: number | null;
  rng?: () => number;
}): Promise<SampledMove | null> {
  const rng = opts.rng ?? Math.random;
  const legal = legalMoves(opts.fen);
  if (legal.size === 0) return null;

  const stats = opts.stats?.get(toEpd(opts.fen));
  if (stats) {
    const ownSampleCount = [...stats.opponentMoves.values()].reduce((a, t) => a + t.count, 0);
    if (ownSampleCount >= MIN_OWN_SAMPLES) {
      const uci = weightedFromTallies(stats.opponentMoves, legal, rng);
      if (uci) return { uci, source: 'games' };
    }
  }

  const book = await fetchExplorer(opts.fen, {
    db: 'lichess',
    ratings: opts.band.ratings,
    speeds: opts.band.speeds,
  });
  if (book) {
    const legalBook = { ...book, moves: book.moves.filter((m) => legal.has(m.uci)) };
    const move = weightedExplorerMove(legalBook, rng);
    if (move) return { uci: move.uci, source: 'explorer' };
  }

  try {
    const sf = await getOpponentStockfish();
    const elo = Math.max(ENGINE_ELO_MIN, Math.min(ENGINE_ELO_MAX, opts.userRating ?? 1600));
    await sf.setOptions({ UCI_LimitStrength: 'true', UCI_Elo: elo });
    const reply = await sf.bestMoveTimed(opts.fen, ENGINE_MOVETIME_MS);
    if (reply.bestMove && legal.has(reply.bestMove)) {
      return { uci: reply.bestMove, source: 'engine' };
    }
    // Rook-square castling encodings etc. still parse; last resort re-check.
    const parsed = parseUciMove(reply.bestMove);
    if (reply.bestMove && parsed.from && parsed.to) return { uci: reply.bestMove, source: 'engine' };
  } catch {
    /* fall through */
  }
  return null;
}
