// Verbatim port of lib/src/utils/winning_chances.dart — Lichess winning-chances model.
// These thresholds gate blunder detection AND the on-the-fly accept rule (5% chances lost).

export type MoveClassification = 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const inaccuracyThresholdPercent = 10;
export const mistakeThresholdPercent = 15;
export const blunderThresholdPercent = 25;

/** Lichess winning chances formula. CP → win % (0..100). */
export function winPercent(centipawns: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1);
}

/**
 * Winning chances lost from the moving side's perspective.
 * Both evals are raw engine output (each from its position's side-to-move).
 * `evalAfter` is negated since it's from the opponent's perspective.
 */
export function winningChancesLost(evalBefore: number, evalAfter: number): number {
  const winBefore = winPercent(evalBefore);
  const winAfter = winPercent(-evalAfter);
  return winBefore - winAfter;
}

export function classify(chancesLost: number): MoveClassification {
  if (chancesLost >= blunderThresholdPercent) return 'blunder';
  if (chancesLost >= mistakeThresholdPercent) return 'mistake';
  if (chancesLost >= inaccuracyThresholdPercent) return 'inaccuracy';
  return 'good';
}

/**
 * Winning chances lost, rounded — the single definition of the `eval_swing`
 * value stored on a blunder row. Kept here so every writer (game analysis,
 * enrichment backfill, endgame slip logging, scenario severity) computes it the
 * same way and can't drift.
 */
export function roundedChancesLost(evalBefore: number, evalAfter: number): number {
  return Math.round(winningChancesLost(evalBefore, evalAfter));
}

/** Classify a move given its before/after evals, returning both the raw loss and the label. */
export function classifySwing(evalBefore: number, evalAfter: number) {
  const chancesLost = winningChancesLost(evalBefore, evalAfter);
  return { chancesLost, classification: classify(chancesLost) };
}

/** Trainable = mistake or blunder (≥15% chances lost). */
export function isTrainable(chancesLost: number): boolean {
  return chancesLost >= mistakeThresholdPercent;
}

/**
 * Raw centipawns lost by the move, from the mover's perspective. Both evals
 * are raw engine output (each from its position's side-to-move); `evalAfter`
 * is negated back to the mover's perspective before comparing, same
 * convention as `winningChancesLost`. Positive = the move made things worse.
 * Display-only companion to the percent-based `winningChancesLost` — the
 * percent model still backs classification/threshold logic.
 */
export function cpLoss(evalBefore: number, evalAfter: number): number {
  return evalBefore + evalAfter;
}

/**
 * Convert a raw engine score (always side-to-move perspective) to a fixed
 * color's perspective — e.g. for classifying an endgame as won/drawn/lost for
 * the user regardless of whose turn it is.
 */
export function cpForColor(
  cpSideToMove: number,
  sideToMove: 'white' | 'black',
  color: 'white' | 'black',
): number {
  return sideToMove === color ? cpSideToMove : -cpSideToMove;
}
