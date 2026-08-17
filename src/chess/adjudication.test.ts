import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  HOLD_MOVES,
  judgeTerminal,
  judgeUserMove,
  terminalState,
} from './adjudication';

describe('terminalState', () => {
  it('detects checkmate by the user (opponent to move, mated)', () => {
    // Back-rank mate: black king mated by white — black to move.
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const chess = new Chess(fen);
    chess.move({ from: 'a1', to: 'a8' });
    expect(terminalState(chess.fen(), 'white')).toBe('checkmate-by-user');
    expect(terminalState(chess.fen(), 'black')).toBe('checkmate-by-opponent');
  });

  it('detects stalemate', () => {
    // Classic stalemate: black king cornered, not in check, no moves.
    const fen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    expect(terminalState(fen, 'white')).toBe('stalemate');
  });

  it('detects insufficient material as a draw rule', () => {
    expect(terminalState('8/8/4k3/8/8/4K3/8/8 w - - 0 1', 'white')).toBe('draw-rule');
  });

  it('returns null for a live position', () => {
    expect(terminalState('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'white')).toBeNull();
  });
});

describe('judgeTerminal', () => {
  it('user checkmate succeeds on both targets', () => {
    expect(judgeTerminal('checkmate-by-user', 'win')).toBe('success');
    expect(judgeTerminal('checkmate-by-user', 'draw')).toBe('success');
  });
  it('opponent checkmate fails on both targets', () => {
    expect(judgeTerminal('checkmate-by-opponent', 'win')).toBe('fail');
    expect(judgeTerminal('checkmate-by-opponent', 'draw')).toBe('fail');
  });
  it('stalemate/draw succeed only on a draw target', () => {
    expect(judgeTerminal('stalemate', 'win')).toBe('fail');
    expect(judgeTerminal('stalemate', 'draw')).toBe('success');
    expect(judgeTerminal('draw-rule', 'win')).toBe('fail');
    expect(judgeTerminal('draw-rule', 'draw')).toBe('success');
  });
});

describe('judgeUserMove — win target', () => {
  it('fails when the win evaporates below the floor', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 90, userWinPctAfter: 55, heldStreak: 4 });
    expect(r.verdict).toBe('fail');
  });

  it('fails on a single-move drop of 15+ even above the floor', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 95, userWinPctAfter: 70, heldStreak: 4 });
    expect(r.verdict).toBe('fail');
  });

  it('extends the streak while holding >= 75%', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 90, userWinPctAfter: 88, heldStreak: 3 });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(4);
  });

  it('resets the streak in the 60-75 drift band without failing', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 76, userWinPctAfter: 70, heldStreak: 6 });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(0);
  });

  it('adjudicates success at the hold threshold', () => {
    const r = judgeUserMove({
      target: 'win',
      userWinPctBefore: 92,
      userWinPctAfter: 91,
      heldStreak: HOLD_MOVES - 1,
    });
    expect(r.verdict).toBe('adjudicated-success');
  });
});

describe('judgeUserMove — draw target', () => {
  it('fails when the position becomes lost', () => {
    const r = judgeUserMove({ target: 'draw', userWinPctBefore: 45, userWinPctAfter: 20, heldStreak: 2 });
    expect(r.verdict).toBe('fail');
  });

  it('holds in the safe band', () => {
    const r = judgeUserMove({ target: 'draw', userWinPctBefore: 48, userWinPctAfter: 47, heldStreak: 1 });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(2);
  });

  it('resets the streak in the 25-40 shaky band without failing', () => {
    const r = judgeUserMove({ target: 'draw', userWinPctBefore: 45, userWinPctAfter: 30, heldStreak: 5 });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(0);
  });

  it('adjudicates success after HOLD_MOVES held moves', () => {
    const r = judgeUserMove({
      target: 'draw',
      userWinPctBefore: 50,
      userWinPctAfter: 52,
      heldStreak: HOLD_MOVES - 1,
    });
    expect(r.verdict).toBe('adjudicated-success');
  });
});
