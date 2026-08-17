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

/** Trainable = mistake or blunder (≥15% chances lost). */
export function isTrainable(chancesLost: number): boolean {
  return chancesLost >= mistakeThresholdPercent;
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
