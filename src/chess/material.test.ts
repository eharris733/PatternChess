import { describe, expect, it } from 'vitest';
import { bishopSquareColors, halfmoveClock, pieceCounts, totalPieces } from './material';

describe('pieceCounts', () => {
  it('counts non-king pieces per side', () => {
    const { white, black } = pieceCounts('r3k2r/pp3ppp/2n5/8/8/2N5/PP3PPP/R1BQK2R w KQkq - 3 12');
    expect(white).toEqual({ p: 5, n: 1, b: 1, r: 2, q: 1 });
    expect(black).toEqual({ p: 5, n: 1, b: 0, r: 2, q: 0 });
    expect(totalPieces(white)).toBe(10);
  });

  it('is empty for bare kings', () => {
    const { white, black } = pieceCounts('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(totalPieces(white)).toBe(0);
    expect(totalPieces(black)).toBe(0);
  });
});

describe('bishopSquareColors', () => {
  it('reports square colours (a1 dark, c1 dark, f1 light, c8 light, f8 dark)', () => {
    const { white, black } = bishopSquareColors('2b2b2/8/8/8/8/8/8/2B2B2 w - - 0 1');
    expect(white).toEqual(['dark', 'light']);
    expect(black).toEqual(['light', 'dark']);
  });
});

describe('halfmoveClock', () => {
  it('reads field 5 and tolerates garbage', () => {
    expect(halfmoveClock('4k3/8/8/8/8/8/8/4K3 w - - 17 40')).toBe(17);
    expect(halfmoveClock('4k3/8/8/8/8/8/8/4K3 w - - x 40')).toBe(0);
    expect(halfmoveClock('4k3/8/8/8/8/8/8/4K3')).toBe(0);
  });
});
