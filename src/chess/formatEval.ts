/**
 * Format a raw engine evaluation (centipawns, player's perspective) for display.
 *
 * The shared core of what used to be three near-identical formatters
 * (`EvalDisplay`, `WinningChancesDisplay`, endgame `PlayoutPanel`). The
 * presentation differences those sites intentionally kept — decimal precision
 * and how a mate score reads — are preserved via options, so callers opt into a
 * variant rather than re-deriving the `cp/100` + sign + mate-threshold logic.
 *
 * Scores at or beyond ±`MATE_CP_THRESHOLD` are treated as mate; the encoding
 * `10000 - |cp|` recovers the moves-to-mate count for the `'count'` variant.
 */

export const MATE_CP_THRESHOLD = 9000;

export interface FormatEvalOptions {
  /** Decimal places for the pawn value. Default 2. */
  decimals?: number;
  /**
   * How to render a mate score:
   * - `'count'` → `#3` / `-#3` (moves to mate; default)
   * - `'symbol'` → `#` / `-#`
   * - `'word'` → `Mate` / `Mated`
   */
  mate?: 'count' | 'symbol' | 'word';
}

export function formatEval(cp: number, options: FormatEvalOptions = {}): string {
  const { decimals = 2, mate = 'count' } = options;
  if (Math.abs(cp) >= MATE_CP_THRESHOLD) {
    if (mate === 'word') return cp > 0 ? 'Mate' : 'Mated';
    if (mate === 'symbol') return cp > 0 ? '#' : '-#';
    const movesToMate = 10000 - Math.abs(cp);
    return `${cp > 0 ? '#' : '-#'}${movesToMate}`;
  }
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(decimals)}`;
}
