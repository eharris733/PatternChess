export interface CorrectMove {
  move: string;
  eval: number;
}

export type BlunderPhase = 'opening' | 'middlegame' | 'endgame';

export interface Blunder {
  id: string;
  gameId: string;
  fen: string;
  moveNumber: number;
  playedMove: string;
  correctMoves: CorrectMove[];
  evalBefore: number;
  evalAfter: number;
  evalSwing: number;
  sideToMove: string;
  cycleNumber: number;
  lastDrilledAt: Date | null;
  nextDrillAt: Date | null;
  timesCorrect: number;
  timesAttempted: number;
  createdAt: Date;
  phase: BlunderPhase;
}

/** Derive phase from move number + remaining piece count on the position. */
export function derivePhase(moveNumber: number, fen: string | null): BlunderPhase {
  if (fen) {
    const board = fen.split(' ')[0] ?? '';
    let pieces = 0;
    for (const ch of board) {
      if (/[prnbqkPRNBQK]/.test(ch)) pieces++;
    }
    if (pieces > 0 && pieces <= 12) return 'endgame';
  }
  if (moveNumber <= 12) return 'opening';
  if (moveNumber > 32) return 'endgame';
  return 'middlegame';
}

function parsePhase(v: unknown): BlunderPhase {
  return v === 'opening' || v === 'endgame' ? v : 'middlegame';
}

export const SPACED_REPETITION_DAYS = [1, 2, 4, 7, 14, 28, 56] as const;

export function nextDrillDate(b: Blunder): Date {
  const base = b.lastDrilledAt ?? b.createdAt;
  const idx = Math.min(b.cycleNumber, SPACED_REPETITION_DAYS.length - 1);
  const result = new Date(base);
  result.setDate(result.getDate() + SPACED_REPETITION_DAYS[idx]);
  return result;
}

export function recallRate(b: Blunder): number {
  return b.timesAttempted > 0 ? b.timesCorrect / b.timesAttempted : 0;
}

export function isCorrectMove(b: Blunder, uci: string): boolean {
  return b.correctMoves.some((cm) => cm.move === uci);
}

export function blunderFromJson(json: any): Blunder {
  const correctMoves = ((json.correct_moves as any[]) ?? []).map((e) => ({
    move: e.move as string,
    eval: e.eval as number,
  }));
  return {
    id: json.id as string,
    gameId: json.game_id as string,
    fen: json.fen as string,
    moveNumber: json.move_number as number,
    playedMove: json.played_move as string,
    correctMoves,
    evalBefore: json.eval_before as number,
    evalAfter: json.eval_after as number,
    evalSwing: json.eval_swing as number,
    sideToMove: json.side_to_move as string,
    cycleNumber: (json.cycle_number as number | null) ?? 0,
    lastDrilledAt: json.last_drilled_at ? new Date(json.last_drilled_at as string) : null,
    nextDrillAt: json.next_drill_at ? new Date(json.next_drill_at as string) : null,
    timesCorrect: (json.times_correct as number | null) ?? 0,
    timesAttempted: (json.times_attempted as number | null) ?? 0,
    createdAt: new Date(json.created_at as string),
    phase: parsePhase(json.phase),
  };
}

/** A blunder is "mastered" when it has graduated all 7 spaced-rep cycles with ≥80% recall. */
export function isMastered(b: Blunder): boolean {
  if (b.cycleNumber < SPACED_REPETITION_DAYS.length) return false;
  if (b.timesAttempted === 0) return false;
  return b.timesCorrect / b.timesAttempted >= 0.8;
}
