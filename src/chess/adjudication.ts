import { Chess } from 'chess.js';
import { halfmoveClock, pieceCounts, totalPieces, type PieceCounts } from './material';

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

/** Consecutive qualifying user moves required for an early adjudicated success (hold mode). */
export const HOLD_MOVES = 10;

/**
 * How a play-out can end successfully.
 * - `hold`: the training-queue drill — hold the deserved result for
 *   `holdMoves` consecutive user moves and the point is adjudicated yours.
 * - `finish`: the Endgames tab — play to the bitter end. A win target succeeds
 *   only on checkmate; a draw target on a draw by rule or when the engine
 *   "accepts" the draw (see `engineAcceptsDraw`).
 * The fail rules are identical in both modes.
 */
export type AdjudicationRules = { mode: 'hold'; holdMoves: number } | { mode: 'finish' };
export const HOLD_RULES: AdjudicationRules = { mode: 'hold', holdMoves: HOLD_MOVES };
export const FINISH_RULES: AdjudicationRules = { mode: 'finish' };

// Win target: the user must keep converting. Dropping below CONVERT_FLOOR (or
// bleeding ≥ the mistake threshold in one move) forfeits the win.
const WIN_FAIL_BELOW_PCT = 60;
const WIN_HOLD_PCT = 75; // matches classifyGameState's missedWin band
const WIN_SINGLE_MOVE_DROP_PCT = 15; // matches isTrainable

// Draw target: the user must stay out of a lost position.
const DRAW_FAIL_BELOW_PCT = 25; // matches classifyGameState's alreadyLosing band
const DRAW_HOLD_PCT = 40;

// "Engine accepts the draw" (finish mode, draw target): the position is
// dead-level at a depth that means something, and nobody has made progress
// (no pawn move or capture) for a while.
export const DRAW_ACCEPT_CP = 30;
export const DRAW_ACCEPT_MIN_DEPTH = 18;
/** Plies on the halfmove clock — 8 quiet moves each side. */
export const DRAW_ACCEPT_QUIET_PLIES = 16;

/** Eval (user perspective, cp) at which the progress cue says the engine would resign. */
export const RESIGN_CP = 1000;

/**
 * Game-over detection straight from chess.js — checked BEFORE any engine call,
 * because parseEvalCp returns an ambiguous 0 at terminal positions.
 * `userColor` disambiguates who delivered a checkmate (the side to move in a
 * mated position is the loser). chess.js built from a bare FEN has no move
 * history, so threefold repetition is passed in by the caller (`repetitions`
 * = how many times this position has now occurred).
 */
export function terminalState(
  fen: string,
  userColor: 'white' | 'black',
  repetitions = 1,
): TerminalKind | null {
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
  if (chess.isDraw()) return 'draw-rule'; // 50-move, insufficient material
  if (repetitions >= 3) return 'draw-rule'; // threefold, tracked by the store
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
  rules: AdjudicationRules;
}

export interface JudgeMoveResult {
  verdict: 'ok' | 'fail' | 'adjudicated-success';
  heldStreak: number;
}

/**
 * Judge one (non-terminal) user move. A qualifying move extends the hold
 * streak; in hold mode, `holdMoves` qualifying moves in a row adjudicate the
 * play-out as a success (in finish mode the streak is only a progress meter).
 * A move that gives up the target result fails immediately. Moves in between
 * (e.g. win % drifting through the 60–75 band on a win target) neither fail
 * nor extend the streak — the streak resets so "held" always means
 * consecutively held.
 */
export function judgeUserMove(input: JudgeMoveInput): JudgeMoveResult {
  const { target, userWinPctBefore, userWinPctAfter, heldStreak, rules } = input;
  const adjudicate = (nextStreak: number) =>
    rules.mode === 'hold' && nextStreak >= rules.holdMoves;

  if (target === 'win') {
    if (
      userWinPctAfter < WIN_FAIL_BELOW_PCT ||
      userWinPctBefore - userWinPctAfter >= WIN_SINGLE_MOVE_DROP_PCT
    ) {
      return { verdict: 'fail', heldStreak: 0 };
    }
    const nextStreak = userWinPctAfter >= WIN_HOLD_PCT ? heldStreak + 1 : 0;
    if (adjudicate(nextStreak)) return { verdict: 'adjudicated-success', heldStreak: nextStreak };
    return { verdict: 'ok', heldStreak: nextStreak };
  }

  // target === 'draw'
  if (userWinPctAfter < DRAW_FAIL_BELOW_PCT) {
    return { verdict: 'fail', heldStreak: 0 };
  }
  const nextStreak = userWinPctAfter >= DRAW_HOLD_PCT ? heldStreak + 1 : 0;
  if (adjudicate(nextStreak)) return { verdict: 'adjudicated-success', heldStreak: nextStreak };
  return { verdict: 'ok', heldStreak: nextStreak };
}

function singlePiece(c: PieceCounts): 'n' | 'b' | 'r' | 'q' | null {
  if (totalPieces(c) !== 1 || c.p !== 0) return null;
  if (c.n) return 'n';
  if (c.b) return 'b';
  if (c.r) return 'r';
  return 'q';
}

/**
 * Pawnless, one piece each, and the pair is a textbook draw: R/R, Q/Q, B/B,
 * N/N, B/N. Rook vs minor is deliberately NOT here — Philidor is not a free
 * draw and the engine should have to fail to make progress first.
 */
export function trivialDrawMaterial(fen: string): boolean {
  const { white, black } = pieceCounts(fen);
  const w = singlePiece(white);
  const b = singlePiece(black);
  if (!w || !b) return false;
  if (w === b) return true;
  return (w === 'b' && b === 'n') || (w === 'n' && b === 'b');
}

export interface DrawAcceptInput {
  /** Position after the user's move (opponent to move). */
  fen: string;
  /** Raw side-to-move score in cp; only the magnitude matters. */
  scoreCp: number;
  depth: number | null;
}

/**
 * Finish-mode draw target: the engine concedes the half point when the
 * position is dead-level at depth and no progress has been made for
 * `DRAW_ACCEPT_QUIET_PLIES` plies, or when the material is a textbook draw.
 */
export function engineAcceptsDraw(input: DrawAcceptInput): boolean {
  if (trivialDrawMaterial(input.fen)) return true;
  const quiet = halfmoveClock(input.fen) >= DRAW_ACCEPT_QUIET_PLIES;
  const level = Math.abs(input.scoreCp) <= DRAW_ACCEPT_CP;
  const deep = (input.depth ?? 0) >= DRAW_ACCEPT_MIN_DEPTH;
  return quiet && level && deep;
}
