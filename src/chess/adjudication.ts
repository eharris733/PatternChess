import { Chess } from 'chess.js';

// Adjudication rules for endgame play-outs vs the engine. Pure — engine calls
// and board state live in the play-out stores; this module only judges.
//
// All win-percent inputs are from the USER's perspective (via winPercent +
// cpForColor), regardless of whose turn it is.

export type PlayoutTarget = 'win' | 'draw';

export type TerminalKind =
  | 'checkmate-by-user'
  | 'checkmate-by-opponent'
  | 'stalemate'
  | 'draw-rule';

/** Consecutive qualifying user moves required for an early adjudicated success. */
export const HOLD_MOVES = 10;

// Win target: the user must keep converting. Dropping below CONVERT_FLOOR (or
// bleeding ≥ the mistake threshold in one move) forfeits the win.
const WIN_FAIL_BELOW_PCT = 60;
const WIN_HOLD_PCT = 75; // matches classifyGameState's missedWin band
const WIN_SINGLE_MOVE_DROP_PCT = 15; // matches isTrainable

// Draw target: the user must stay out of a lost position.
const DRAW_FAIL_BELOW_PCT = 25; // matches classifyGameState's alreadyLosing band
const DRAW_HOLD_PCT = 40;

/**
 * Game-over detection straight from chess.js — checked BEFORE any engine call,
 * because parseEvalCp returns an ambiguous 0 at terminal positions.
 * `userColor` disambiguates who delivered a checkmate (the side to move in a
 * mated position is the loser).
 */
export function terminalState(fen: string, userColor: 'white' | 'black'): TerminalKind | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  if (chess.isCheckmate()) {
    const matedColor = chess.turn() === 'w' ? 'white' : 'black';
    return matedColor === userColor ? 'checkmate-by-opponent' : 'checkmate-by-user';
  }
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isDraw()) return 'draw-rule'; // 50-move, threefold, insufficient material
  return null;
}

/** Whether a terminal position achieves the target result for the user. */
export function judgeTerminal(
  terminal: TerminalKind,
  target: PlayoutTarget,
): 'success' | 'fail' {
  switch (terminal) {
    case 'checkmate-by-user':
      // Over-delivering on a draw target is fine.
      return 'success';
    case 'checkmate-by-opponent':
      return 'fail';
    case 'stalemate':
    case 'draw-rule':
      return target === 'draw' ? 'success' : 'fail';
  }
}

export interface JudgeMoveInput {
  target: PlayoutTarget;
  /** User win % before the move (from the position they moved in). */
  userWinPctBefore: number;
  /** User win % after the move (from the resulting position). */
  userWinPctAfter: number;
  heldStreak: number;
}

export interface JudgeMoveResult {
  verdict: 'ok' | 'fail' | 'adjudicated-success';
  heldStreak: number;
}

/**
 * Judge one (non-terminal) user move. A qualifying move extends the hold
 * streak; HOLD_MOVES qualifying moves in a row adjudicate the play-out as a
 * success. A move that gives up the target result fails immediately. Moves in
 * between (e.g. win % drifting through the 60–75 band on a win target) neither
 * fail nor extend the streak — the streak resets so "held" always means
 * consecutively held.
 */
export function judgeUserMove(input: JudgeMoveInput): JudgeMoveResult {
  const { target, userWinPctBefore, userWinPctAfter, heldStreak } = input;

  if (target === 'win') {
    if (
      userWinPctAfter < WIN_FAIL_BELOW_PCT ||
      userWinPctBefore - userWinPctAfter >= WIN_SINGLE_MOVE_DROP_PCT
    ) {
      return { verdict: 'fail', heldStreak: 0 };
    }
    const nextStreak = userWinPctAfter >= WIN_HOLD_PCT ? heldStreak + 1 : 0;
    if (nextStreak >= HOLD_MOVES) return { verdict: 'adjudicated-success', heldStreak: nextStreak };
    return { verdict: 'ok', heldStreak: nextStreak };
  }

  // target === 'draw'
  if (userWinPctAfter < DRAW_FAIL_BELOW_PCT) {
    return { verdict: 'fail', heldStreak: 0 };
  }
  const nextStreak = userWinPctAfter >= DRAW_HOLD_PCT ? heldStreak + 1 : 0;
  if (nextStreak >= HOLD_MOVES) return { verdict: 'adjudicated-success', heldStreak: nextStreak };
  return { verdict: 'ok', heldStreak: nextStreak };
}
