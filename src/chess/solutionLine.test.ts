import { describe, expect, it } from 'vitest';
import { computeDrillLine } from './solutionLine';
import type { SolutionLine } from '../models/blunder';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function line(pv: string[]): SolutionLine {
  return { pv, playedPv: [], v: 1 };
}

describe('computeDrillLine', () => {
  it('returns empty for a null line (legacy row)', () => {
    expect(computeDrillLine(START_FEN, null, 120)).toEqual({ plies: [], userMoveCount: 0 });
  });

  it('returns empty for an empty pv', () => {
    expect(computeDrillLine(START_FEN, line([]), 120)).toEqual({ plies: [], userMoveCount: 0 });
  });

  it('cuts a quiet line to a single user move', () => {
    // Second user move (Nf3) is neither capture, check, nor promotion.
    const result = computeDrillLine(START_FEN, line(['e2e4', 'e7e5', 'g1f3']), 80);
    expect(result.plies).toEqual(['e2e4']);
    expect(result.userMoveCount).toBe(1);
  });

  it('extends through a forcing capture/check sequence', () => {
    // Nxd5 (wins the queen), ...e6, Nxc7+ (capture + fork check).
    const fen = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 1';
    const result = computeDrillLine(fen, line(['c3d5', 'e7e6', 'd5c7']), 350);
    expect(result.plies).toEqual(['c3d5', 'e7e6', 'd5c7']);
    expect(result.userMoveCount).toBe(2);
  });

  it('keeps a quiet continuation when the eval is a forced mate for the user', () => {
    const result = computeDrillLine(START_FEN, line(['e2e4', 'e7e5', 'g1f3']), 9998);
    expect(result.plies).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(result.userMoveCount).toBe(2);
  });

  it('does not extend when the user is the one being mated', () => {
    const result = computeDrillLine(START_FEN, line(['e2e4', 'e7e5', 'g1f3']), -9998);
    expect(result.plies).toEqual(['e2e4']);
    expect(result.userMoveCount).toBe(1);
  });

  it('caps at three user moves and ends on a user ply', () => {
    const pv = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5'];
    const result = computeDrillLine(START_FEN, line(pv), 9995);
    expect(result.plies).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4']);
    expect(result.userMoveCount).toBe(3);
  });

  it('truncates at the first illegal ply', () => {
    // e4e5 is blocked by the pawn that just arrived on e5.
    const result = computeDrillLine(START_FEN, line(['e2e4', 'e7e5', 'e4e5']), 9998);
    expect(result.plies).toEqual(['e2e4']);
    expect(result.userMoveCount).toBe(1);
  });

  it('handles a mate delivered on the first user move', () => {
    // Scholar's mate position: Qxf7#.
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const result = computeDrillLine(fen, line(['h5f7']), 9999);
    expect(result.plies).toEqual(['h5f7']);
    expect(result.userMoveCount).toBe(1);
  });
});
