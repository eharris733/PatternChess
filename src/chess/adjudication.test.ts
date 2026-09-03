import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  DRAW_ACCEPT_CP,
  DRAW_ACCEPT_MIN_DEPTH,
  DRAW_ACCEPT_QUIET_PLIES,
  engineAcceptsDraw,
  FINISH_RULES,
  HOLD_MOVES,
  HOLD_RULES,
  judgeTerminal,
  judgeUserMove,
  terminalState,
  trivialDrawMaterial,
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

  it('treats a third occurrence as a draw by repetition', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    expect(terminalState(fen, 'white', 2)).toBeNull();
    expect(terminalState(fen, 'white', 3)).toBe('draw-rule');
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

const hold = { rules: HOLD_RULES };

describe('judgeUserMove — win target', () => {
  it('fails when the win evaporates below the floor', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 90, userWinPctAfter: 55, heldStreak: 4, ...hold });
    expect(r.verdict).toBe('fail');
  });

  it('fails on a single-move drop of 15+ even above the floor', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 95, userWinPctAfter: 70, heldStreak: 4, ...hold });
    expect(r.verdict).toBe('fail');
  });

  it('extends the streak while holding >= 75%', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 90, userWinPctAfter: 88, heldStreak: 3, ...hold });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(4);
  });

  it('resets the streak in the 60-75 drift band without failing', () => {
    const r = judgeUserMove({ target: 'win', userWinPctBefore: 76, userWinPctAfter: 70, heldStreak: 6, ...hold });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(0);
  });

  it('adjudicates success at the hold threshold', () => {
    const r = judgeUserMove({
      target: 'win',
      userWinPctBefore: 92,
      userWinPctAfter: 91,
      heldStreak: HOLD_MOVES - 1,
      ...hold,
    });
    expect(r.verdict).toBe('adjudicated-success');
  });

  it('respects a custom hold length', () => {
    const r = judgeUserMove({
      target: 'win',
      userWinPctBefore: 92,
      userWinPctAfter: 91,
      heldStreak: 2,
      rules: { mode: 'hold', holdMoves: 3 },
    });
    expect(r.verdict).toBe('adjudicated-success');
  });
});

describe('judgeUserMove — draw target', () => {
  it('fails when the position becomes lost', () => {
    const r = judgeUserMove({ target: 'draw', userWinPctBefore: 45, userWinPctAfter: 20, heldStreak: 2, ...hold });
    expect(r.verdict).toBe('fail');
  });

  it('holds in the safe band', () => {
    const r = judgeUserMove({ target: 'draw', userWinPctBefore: 48, userWinPctAfter: 47, heldStreak: 1, ...hold });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(2);
  });

  it('resets the streak in the 25-40 shaky band without failing', () => {
    const r = judgeUserMove({ target: 'draw', userWinPctBefore: 45, userWinPctAfter: 30, heldStreak: 5, ...hold });
    expect(r.verdict).toBe('ok');
    expect(r.heldStreak).toBe(0);
  });

  it('adjudicates success after HOLD_MOVES held moves', () => {
    const r = judgeUserMove({
      target: 'draw',
      userWinPctBefore: 50,
      userWinPctAfter: 52,
      heldStreak: HOLD_MOVES - 1,
      ...hold,
    });
    expect(r.verdict).toBe('adjudicated-success');
  });
});

describe('judgeUserMove — finish mode', () => {
  it('never adjudicates success, however long the hold', () => {
    const win = judgeUserMove({ target: 'win', userWinPctBefore: 92, userWinPctAfter: 91, heldStreak: 50, rules: FINISH_RULES });
    expect(win.verdict).toBe('ok');
    expect(win.heldStreak).toBe(51);
    const draw = judgeUserMove({ target: 'draw', userWinPctBefore: 50, userWinPctAfter: 52, heldStreak: 50, rules: FINISH_RULES });
    expect(draw.verdict).toBe('ok');
    expect(draw.heldStreak).toBe(51);
  });

  it('keeps the fail rules', () => {
    expect(judgeUserMove({ target: 'win', userWinPctBefore: 90, userWinPctAfter: 55, heldStreak: 4, rules: FINISH_RULES }).verdict).toBe('fail');
    expect(judgeUserMove({ target: 'win', userWinPctBefore: 95, userWinPctAfter: 70, heldStreak: 4, rules: FINISH_RULES }).verdict).toBe('fail');
    expect(judgeUserMove({ target: 'draw', userWinPctBefore: 45, userWinPctAfter: 20, heldStreak: 2, rules: FINISH_RULES }).verdict).toBe('fail');
  });
});

describe('trivialDrawMaterial', () => {
  it('accepts pawnless symmetric single pieces and bishop vs knight', () => {
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/R3K2r w - - 0 1')).toBe(true);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/Q3K2q w - - 0 1')).toBe(true);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/B3K2b w - - 0 1')).toBe(true);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/N3K2n w - - 0 1')).toBe(true);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/B3K2n w - - 0 1')).toBe(true);
  });

  it('rejects rook vs minor, pawns, and extra material', () => {
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/R3K2b w - - 0 1')).toBe(false);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/4P3/R3K2r w - - 0 1')).toBe(false);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/RR2K2r w - - 0 1')).toBe(false);
    expect(trivialDrawMaterial('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toBe(false);
  });
});

describe('engineAcceptsDraw', () => {
  // Rook + pawns each — not trivial, so the quiet/level/deep rule decides.
  const busy = (clock: number) => `4k3/pp6/8/8/8/8/PP6/R3K2r w - - ${clock} 40`;

  it('needs the full quiet spell, a level score, and real depth', () => {
    expect(engineAcceptsDraw({ fen: busy(DRAW_ACCEPT_QUIET_PLIES), scoreCp: DRAW_ACCEPT_CP, depth: DRAW_ACCEPT_MIN_DEPTH })).toBe(true);
    expect(engineAcceptsDraw({ fen: busy(DRAW_ACCEPT_QUIET_PLIES - 1), scoreCp: 0, depth: 30 })).toBe(false);
    expect(engineAcceptsDraw({ fen: busy(DRAW_ACCEPT_QUIET_PLIES), scoreCp: DRAW_ACCEPT_CP + 1, depth: 30 })).toBe(false);
    expect(engineAcceptsDraw({ fen: busy(DRAW_ACCEPT_QUIET_PLIES), scoreCp: -DRAW_ACCEPT_CP, depth: DRAW_ACCEPT_MIN_DEPTH - 1 })).toBe(false);
    expect(engineAcceptsDraw({ fen: busy(DRAW_ACCEPT_QUIET_PLIES), scoreCp: 0, depth: null })).toBe(false);
  });

  it('accepts textbook material regardless of the clock', () => {
    expect(engineAcceptsDraw({ fen: '4k3/8/8/8/8/8/8/R3K2r w - - 0 1', scoreCp: 80, depth: 5 })).toBe(true);
    expect(engineAcceptsDraw({ fen: '4k3/8/8/8/8/8/8/R3K2b w - - 0 1', scoreCp: 0, depth: 30 })).toBe(false);
  });
});
