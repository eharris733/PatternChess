/**
 * Format a raw engine evaluation (centipawns, player's perspective) for display.
 *
 * The shared core of what used to be three near-identical formatters
 * (`EvalDisplay`, `WinningChancesDisplay`, endgame `PlayoutPanel`). The
 * presentation differences those sites intentionally kept — decimal precision
 * and how a mate score reads — are preserved via options, so callers opt into a
 * variant rather than re-deriving the `cp/100` + sign + mate-threshold logic.
 *
 * Mate scores are encoded as `±(MATE_SCORE - N)` for mate-in-N (see
 * `parseEvalCp`), so `MATE_SCORE - |cp|` recovers the move count. Any score at
 * or beyond ±`MATE_CP_THRESHOLD` is treated as mate. Out-of-scale values —
 * e.g. legacy rows written with a different mate encoding — would make that
 * subtraction produce a nonsense count, so a count that isn't a small positive
 * integer falls back to a bare `M` / `-M` marker instead of leaking a huge int.
 */

export const MATE_CP_THRESHOLD = 9000;
const MATE_SCORE = 10000;

export interface FormatEvalOptions {
  /** Decimal places for the pawn value. Default 2. */
  decimals?: number;
  /**
   * How to render a mate score:
   * - `'count'` → `M3` / `-M3` (moves to mate; default)
   * - `'symbol'` → `M` / `-M`
   * - `'word'` → `Mate` / `Mated`
   */
  mate?: 'count' | 'symbol' | 'word';
}

export function formatEval(cp: number, options: FormatEvalOptions = {}): string {
  const { decimals = 2, mate = 'count' } = options;
  if (Math.abs(cp) >= MATE_CP_THRESHOLD) {
    const mated = cp < 0;
    if (mate === 'word') return mated ? 'Mated' : 'Mate';
    const sign = mated ? '-' : '';
    const movesToMate = MATE_SCORE - Math.abs(cp);
    // A valid mate count is a small positive integer; anything else (mate
    // delivered, or an out-of-scale/corrupt eval) shows a bare marker.
    if (mate === 'symbol' || movesToMate < 1) return `${sign}M`;
    return `${sign}M${movesToMate}`;
  }
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(decimals)}`;
}

/** Moves to mate encoded in a mate score, or null when it isn't a valid count. */
function mateMoves(cp: number): number | null {
  const n = MATE_SCORE - Math.abs(cp);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * What a move cost, for display. Both evals are raw engine output, each from
 * its position's side to move (same convention as `cpLoss`). When a mate score
 * is involved the centipawn difference is meaningless (e.g. "9905cp"), so:
 * - `allowsMate`: after the move the opponent has a forced mate.
 * - `missedMate`: the mover had a forced mate and the move gave it up.
 * - `cp`: centipawns lost (positive = worse), with any leftover mate-vs-mate
 *   difference (a slower mate) clamped to the non-mate range.
 * `moves` is null when the stored score is out of scale.
 */
export type MoveCost =
  | { kind: 'allowsMate'; moves: number | null }
  | { kind: 'missedMate'; moves: number | null }
  | { kind: 'cp'; cp: number };

export function moveCost(evalBefore: number, evalAfter: number): MoveCost {
  const beforeMating = evalBefore >= MATE_CP_THRESHOLD;
  const beforeMated = evalBefore <= -MATE_CP_THRESHOLD;
  const afterOpponentMates = evalAfter >= MATE_CP_THRESHOLD;
  const afterStillMating = evalAfter <= -MATE_CP_THRESHOLD;
  if (afterOpponentMates && !beforeMated) return { kind: 'allowsMate', moves: mateMoves(evalAfter) };
  if (beforeMating && !afterStillMating) return { kind: 'missedMate', moves: mateMoves(evalBefore) };
  const cp = evalBefore + evalAfter;
  return { kind: 'cp', cp: Math.max(-MATE_CP_THRESHOLD, Math.min(MATE_CP_THRESHOLD, cp)) };
}

/** Short label for a `MoveCost`: "−320cp", "allows M1", "missed M3". */
export function formatMoveCost(cost: MoveCost): string {
  if (cost.kind === 'cp') return `${cost.cp > 0 ? '−' : '+'}${Math.round(Math.abs(cost.cp))}cp`;
  const m = cost.moves ? `M${cost.moves}` : 'mate';
  return cost.kind === 'allowsMate' ? `allows ${m}` : `missed ${m}`;
}

/** Phrase for prose: "mate in 1", or "a forced mate" when the count is unknown. */
export function mateInPhrase(moves: number | null): string {
  return moves ? `mate in ${moves}` : 'a forced mate';
}
