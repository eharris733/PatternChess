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
