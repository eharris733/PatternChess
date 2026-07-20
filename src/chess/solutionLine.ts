import { Chess } from 'chess.js';
import type { SolutionLine } from '../models/blunder';
import { CASTLING_NORMALIZE, parseUciMove } from './moveUtils';

export interface DrillLine {
  /**
   * Trimmed UCI plies from the blunder position. Even indices are the user's
   * moves, odd indices the opponent's auto-played replies; the line always
   * ends on a user ply. Empty when no usable line exists (caller falls back
   * to the single-move drill).
   */
  plies: string[];
  userMoveCount: number;
}

const MAX_USER_MOVES = 3;
/** parseEvalCp maps "mate in N" to ±(10000 − N). */
const MATE_EVAL_ABS = 9000;

const EMPTY: DrillLine = { plies: [], userMoveCount: 0 };

/**
 * Decide how much of a stored solution PV the user must play. The policy is
 * computed at drill time (never persisted) so it can be tuned without a
 * migration: the user plays pv[0], and each further user ply is included only
 * while the line stays forcing — the user's next move is a capture, check,
 * promotion, or mate, or the position is a forced mate for the user — capped
 * at MAX_USER_MOVES. Every ply is legality-checked by replay; the line is cut
 * at the first ply that fails. A null/short/quiet line yields a single user
 * move, which is exactly the pre-multi-move drill behavior.
 */
export function computeDrillLine(
  fen: string,
  line: SolutionLine | null,
  evalBefore: number,
): DrillLine {
  if (!line || line.pv.length === 0) return EMPTY;

  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return EMPTY;
  }

  const replayed: Array<{ uci: string; forcing: boolean }> = [];
  for (const rawUci of line.pv) {
    const uci = CASTLING_NORMALIZE[rawUci] ?? rawUci;
    const m = parseUciMove(uci);
    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      break;
    }
    if (!result) break;
    replayed.push({
      uci: rawUci,
      forcing:
        Boolean(result.captured) ||
        Boolean(result.promotion) ||
        chess.inCheck() ||
        chess.isCheckmate(),
    });
  }
  if (replayed.length === 0) return EMPTY;

  // From the user's perspective (side to move at `fen`) a positive mate score
  // means the user is delivering mate — keep the whole line forcing then.
  const isMateForUser = evalBefore >= MATE_EVAL_ABS;

  let lastUserPly = 0;
  for (let k = 2; k < replayed.length && k / 2 < MAX_USER_MOVES; k += 2) {
    if (!replayed[k].forcing && !isMateForUser) break;
    lastUserPly = k;
  }

  return {
    plies: replayed.slice(0, lastUserPly + 1).map((r) => r.uci),
    userMoveCount: lastUserPly / 2 + 1,
  };
}
