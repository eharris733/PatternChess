import { classifyGameState } from '../chess/blunderContext';
import type { DeviationWalk } from '../chess/openingDeviation';
import { resolveOutcome, type GameOutcome } from '../models/gameRecord';
import { derivePhase } from '../models/blunder';
import type { BookTier } from '../chess/bookFormat';
import type { BlunderCandidate } from '../stockfish/stockfishWorkerClient';
import type { Translator } from '../i18n/useT';

/**
 * The signed-out landing demo's "Your plan for today": the same three parts as
 * the real plan (blunders, openings, endgames), computed from the handful of
 * games the demo already fetched and analyzed. Pure; the service feeds it.
 */

export type DemoColor = 'white' | 'black';

/** One demo game as the plan needs it. */
export interface DemoPlanGame {
  /** Opening family from the board (openingClassifier), null when unclassifiable. */
  family: string | null;
  /** The visitor's side, null when the username matched neither player. */
  color: DemoColor | null;
  /** PGN `Result` header ("1-0", "0-1", "1/2-1/2", "*"). */
  result: string | null;
  /** The visitor's blunders in this game (analysis only records their moves). */
  blunders: BlunderCandidate[];
  /** Book walk of this game, null when it wasn't walked or the lookup failed. */
  walk: DeviationWalk | null;
}

export interface DemoTheoryExit {
  moveNumber: number;
  playedSan: string;
  /** The most-played sound theory move there, when the book has one. */
  theorySan: string | null;
  tier: BookTier | null;
}

export interface DemoOpeningStat {
  family: string;
  games: number;
  total: number;
  /** Rounded share of the analyzed games. */
  sharePct: number;
  /** Games of this opening the book could judge. */
  checkedGames: number;
  /** Of those, games where the visitor left theory themselves. */
  exitGames: number;
  /** The earliest of those exits. */
  exit: DemoTheoryExit | null;
}

export interface DemoEndgameStat {
  /** Endgame-phase blunders across the analyzed games. */
  blunders: number;
  /** Points thrown away in endgames: a won endgame drawn = 0.5, lost = 1; a drawn one lost = 0.5. */
  pointsDropped: number;
  /** Games where an endgame slip cost a result. */
  gamesWithDrops: number;
}

export interface DemoPlan {
  opening: DemoOpeningStat | null;
  endgame: DemoEndgameStat;
}

/** "7. Nf3" for White, "7...Nf6" for Black. */
export function sanWithMoveNumber(moveNumber: number, color: DemoColor, san: string): string {
  return color === 'white' ? `${moveNumber}. ${san}` : `${moveNumber}...${san}`;
}

/**
 * Walks that say something about the visitor's theory: they left it, stayed
 * in it for the whole window, or followed it for a few moves before theory or
 * the opponent ran out. A walk the book knew nothing about doesn't count.
 */
const MIN_JUDGED_PLIES = 4;
function bookJudged(walk: DeviationWalk): boolean {
  if (walk.status === 'user_left' || walk.status === 'in_book') return true;
  if (walk.status === 'theory_end' || walk.status === 'opponent_left') {
    return (walk.bookEndPly ?? 0) >= MIN_JUDGED_PLIES;
  }
  return false;
}

export function mostPlayedOpening(games: DemoPlanGame[]): DemoOpeningStat | null {
  const total = games.length;
  if (total === 0) return null;
  const counts = new Map<string, number>();
  for (const g of games) {
    if (!g.family) continue;
    counts.set(g.family, (counts.get(g.family) ?? 0) + 1);
  }
  let family: string | null = null;
  let best = 0;
  // Ties go to the opening of the most recent game (games arrive newest first).
  for (const g of games) {
    if (!g.family) continue;
    const n = counts.get(g.family)!;
    if (n > best) {
      best = n;
      family = g.family;
    }
  }
  if (!family) return null;

  const mine = games.filter((g) => g.family === family);
  const walked = mine.filter((g) => g.walk && bookJudged(g.walk));
  const exits = walked.filter(
    (g): g is DemoPlanGame & { walk: DeviationWalk; color: DemoColor } =>
      g.walk!.status === 'user_left' && g.walk!.ply != null && !!g.color,
  );
  exits.sort((a, b) => a.walk.ply! - b.walk.ply!);
  const first = exits[0] ?? null;
  const exit: DemoTheoryExit | null =
    first && first.walk.moveNumber != null && first.walk.playedSan
      ? {
          moveNumber: first.walk.moveNumber,
          playedSan: sanWithMoveNumber(first.walk.moveNumber, first.color, first.walk.playedSan),
          theorySan: first.walk.theoryMoves[0]
            ? sanWithMoveNumber(first.walk.moveNumber, first.color, first.walk.theoryMoves[0].san)
            : null,
          tier: first.walk.theoryMoves[0]?.tier ?? first.walk.bookTier ?? null,
        }
      : null;

  return {
    family,
    games: best,
    total,
    sharePct: Math.round((best / total) * 100),
    checkedGames: walked.length,
    exitGames: exits.length,
    exit,
  };
}

function outcomeOf(g: DemoPlanGame): GameOutcome | null {
  // PGN results are White-relative; resolveOutcome turns them into the visitor's.
  return resolveOutcome('pgn', g.result, g.color);
}

/**
 * Same rule as endgame scenarios (deriveScenarioCandidates): the first
 * endgame blunder from a winning position in a game that wasn't won, or from a
 * level one in a game that was lost, is a dropped result. One per game.
 */
export function endgameDrops(games: DemoPlanGame[]): DemoEndgameStat {
  let blunders = 0;
  let pointsDropped = 0;
  let gamesWithDrops = 0;
  for (const g of games) {
    const endgame = g.blunders
      .filter((b) => derivePhase(b.moveNumber, b.fen) === 'endgame')
      .sort((a, z) => a.moveNumber - z.moveNumber);
    blunders += endgame.length;
    const outcome = outcomeOf(g);
    if (outcome !== 'loss' && outcome !== 'draw') continue;
    for (const b of endgame) {
      const state = classifyGameState(b.evalBefore);
      let dropped = 0;
      if (state === 'missedWin') dropped = outcome === 'loss' ? 1 : 0.5;
      else if (state === 'roughlyEqual' && outcome === 'loss') dropped = 0.5;
      if (dropped > 0) {
        pointsDropped += dropped;
        gamesWithDrops++;
        break;
      }
    }
  }
  return { blunders, pointsDropped, gamesWithDrops };
}

export function buildDemoPlan(games: DemoPlanGame[]): DemoPlan {
  return { opening: mostPlayedOpening(games), endgame: endgameDrops(games) };
}

/** "1 point", "1.5 points": whole numbers without a trailing ".0". */
export function formatPoints(points: number, t?: Translator): string {
  if (t) {
    const n = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(points);
    return t('demo.points', { count: points, n });
  }
  const n = Number.isInteger(points) ? String(points) : points.toFixed(1);
  return `${n} point${points === 1 ? '' : 's'}`;
}
