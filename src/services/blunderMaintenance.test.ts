import { describe, expect, it } from 'vitest';
import { mergeCorrectMoves } from './blunderEnrichmentBackfill';

describe('mergeCorrectMoves', () => {
  it('puts the new best move first ahead of existing entries', () => {
    const merged = mergeCorrectMoves({ move: 'e2e4', eval: 120 }, [
      { move: 'd2d4', eval: 80 },
      { move: 'g1f3', eval: 60 },
    ]);
    expect(merged).toEqual([
      { move: 'e2e4', eval: 120 },
      { move: 'd2d4', eval: 80 },
      { move: 'g1f3', eval: 60 },
    ]);
  });

  it('replaces a stale duplicate of the best move instead of keeping both', () => {
    const merged = mergeCorrectMoves({ move: 'e2e4', eval: 150 }, [
      { move: 'd2d4', eval: 80 },
      { move: 'e2e4', eval: 90 },
    ]);
    expect(merged).toEqual([
      { move: 'e2e4', eval: 150 },
      { move: 'd2d4', eval: 80 },
    ]);
  });

  it('preserves accept-rule-appended alternatives in order', () => {
    const existing = [
      { move: 'a1a8', eval: 300 },
      { move: 'h1h8', eval: 290 },
      { move: 'b1b8', eval: 285 },
    ];
    const merged = mergeCorrectMoves({ move: 'a1a8', eval: 310 }, existing);
    expect(merged.map((m) => m.move)).toEqual(['a1a8', 'h1h8', 'b1b8']);
    expect(merged[0].eval).toBe(310);
  });

  it('handles an empty existing list', () => {
    expect(mergeCorrectMoves({ move: 'e2e4', eval: 10 }, [])).toEqual([
      { move: 'e2e4', eval: 10 },
    ]);
  });
});
