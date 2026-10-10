import { describe, expect, it } from 'vitest';
import { formatEval, formatMoveCost, mateInPhrase, moveCost } from './formatEval';

describe('formatEval — normal scores', () => {
  it('formats centipawns as signed pawns with the requested precision', () => {
    expect(formatEval(0)).toBe('0.00');
    expect(formatEval(34)).toBe('+0.34');
    expect(formatEval(-250)).toBe('-2.50');
    expect(formatEval(34, { decimals: 1 })).toBe('+0.3');
  });
});

describe('formatEval — mate scores (±(10000 - N) encoding)', () => {
  it('count variant shows M<n> / -M<n>', () => {
    expect(formatEval(9997)).toBe('M3'); // mate in 3
    expect(formatEval(9999)).toBe('M1');
    expect(formatEval(-9998)).toBe('-M2'); // being mated in 2
  });

  it('symbol variant shows a bare M / -M', () => {
    expect(formatEval(9997, { mate: 'symbol' })).toBe('M');
    expect(formatEval(-9998, { mate: 'symbol' })).toBe('-M');
  });

  it('word variant shows Mate / Mated', () => {
    expect(formatEval(9997, { mate: 'word' })).toBe('Mate');
    expect(formatEval(-9998, { mate: 'word' })).toBe('Mated');
  });

  it('mate delivered (count 0) shows a bare marker, not M0', () => {
    expect(formatEval(10000)).toBe('M');
    expect(formatEval(-10000)).toBe('-M');
  });

  it('never leaks a huge integer for out-of-scale / corrupt mate evals', () => {
    // Regression: a legacy/corrupt eval far beyond the mate band must not
    // render as `-1238768` — it falls back to a bare mate marker.
    expect(formatEval(-1248768)).toBe('-M');
    expect(formatEval(1248768)).toBe('M');
    expect(formatEval(-1248768)).not.toMatch(/\d/);
  });
});

describe('moveCost / formatMoveCost', () => {
  it('reports plain centipawn losses', () => {
    const cost = moveCost(80, 240); // +0.8 before, opponent +2.4 after
    expect(cost).toEqual({ kind: 'cp', cp: 320 });
    expect(formatMoveCost(cost)).toBe('−320cp');
  });

  it('reports a move that allows mate instead of ~9900cp', () => {
    // 1.e4 f6 2.Bc4 g5?? 3.Qh5#
    const cost = moveCost(-94, 9999);
    expect(cost).toEqual({ kind: 'allowsMate', moves: 1 });
    expect(formatMoveCost(cost)).toBe('allows M1');
    expect(mateInPhrase(1)).toBe('mate in 1');
  });

  it('reports a missed forced mate', () => {
    const cost = moveCost(9997, 150); // had mate in 3, now opponent only +1.5
    expect(cost).toEqual({ kind: 'missedMate', moves: 3 });
    expect(formatMoveCost(cost)).toBe('missed M3');
  });

  it('treats a slower mate as a small cp difference', () => {
    expect(moveCost(9997, -9995)).toEqual({ kind: 'cp', cp: 2 });
  });

  it('falls back to an uncounted mate for out-of-scale scores', () => {
    expect(moveCost(0, 1248768)).toEqual({ kind: 'allowsMate', moves: null });
    expect(mateInPhrase(null)).toBe('a forced mate');
  });
});
