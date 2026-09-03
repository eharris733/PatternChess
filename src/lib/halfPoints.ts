import type { EndgameScenario } from '../models/endgameScenario';

/** Chess-score formatting from half-points: 7 → "3½", 2 → "1", 1 → "½". */
export function formatHalfPoints(halfPoints: number): string {
  const whole = Math.floor(halfPoints / 2);
  const frac = halfPoints % 2 === 1 ? '½' : '';
  return whole > 0 ? `${whole}${frac}` : frac || '0';
}

/** Half-points the game result fell short of the deserved result. */
export function droppedHalfPoints(s: EndgameScenario): number {
  if (s.deservedResult === 'win') return s.actualResult === 'loss' ? 2 : 1;
  return 1; // holdable position, lost
}
