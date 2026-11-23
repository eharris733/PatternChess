// A blunder row → everything the daily video and its caption need. Pure (no
// I/O) so the selection rules and the timeline are unit-testable.
import { Chess } from 'chess.js';
import { MOTIF_LABEL } from '../../workers/notifier/src/motifLabels.ts';

export type Side = 'white' | 'black';

/** The blunders + games columns plan.ts selects (decoded: JSON parsed). */
export interface BlunderRow {
  id: string;
  fen: string;
  move_number: number;
  played_move: string;
  correct_moves: { move: string; eval: number }[] | null;
  eval_before: number;
  eval_after: number;
  eval_swing: number;
  side_to_move: Side;
  solution_line: { pv?: string[]; playedPv?: string[] } | null;
  motifs: string[] | null;
  user_rating: number | null;
  time_category: string | null;
}

export interface Ply {
  uci: string;
  san: string;
  from: string;
  to: string;
  /** Position after the move. */
  fen: string;
  capture: boolean;
  check: boolean;
}

export interface Puzzle {
  blunderId: string;
  fen: string;
  side: Side;
  rating: number | null;
  /** "blitz", "rapid", … (as stored); null when unknown. */
  timeControl: string | null;
  played: Ply;
  /** The winning line shown in the reveal: the user's moves and the replies, trimmed. */
  solution: Ply[];
  /** The motif shown on the reveal ("Missed fork"), or null. */
  motif: string | null;
  motifLabel: string | null;
  mate: boolean;
}

/** Mate scores are stored as ±(10000 − n). */
export const MATE_THRESHOLD = 9000;

/** Motifs that describe what the user *missed* — the ones worth a "find it" video, best first. */
const SHOWABLE_MOTIFS = [
  'missedMate',
  'missedFork',
  'missedSkewer',
  'missedPin',
  'missedDiscoveredAttack',
  'hangingPiece',
  'trappedPiece',
  'backRankWeakness',
] as const;

export const MAX_USER_MOVES = 3;

function toPly(chess: Chess, uci: string): Ply | null {
  try {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    return {
      uci,
      san: m.san,
      from: m.from,
      to: m.to,
      fen: chess.fen(),
      capture: m.isCapture() || m.isEnPassant(),
      check: chess.inCheck(),
    };
  } catch {
    return null;
  }
}

/**
 * The reveal line: at most MAX_USER_MOVES of the user's moves (and the replies
 * between them), stopping at mate, and trimmed back to the last capture /
 * check / promotion so it ends on the payoff instead of a quiet consolidating move.
 */
export function trimSolution(fen: string, pv: readonly string[]): Ply[] {
  const chess = new Chess(fen);
  const plies: Ply[] = [];
  for (const uci of pv.slice(0, MAX_USER_MOVES * 2 - 1)) {
    const ply = toPly(chess, uci);
    if (!ply) break;
    plies.push(ply);
    if (chess.isCheckmate()) return plies;
  }
  let end = plies.length;
  while (end > 1 && !(plies[end - 1].capture || plies[end - 1].check || plies[end - 1].uci.length === 5)) end--;
  // A user move that ends on the opponent's reply would hide the payoff; end on the user's move.
  if (end % 2 === 0) end--;
  return plies.slice(0, Math.max(1, end));
}

export function pickMotif(motifs: readonly string[] | null | undefined): string | null {
  for (const m of SHOWABLE_MOTIFS) if (motifs?.includes(m)) return m;
  return null;
}

/** Null when the row can't make a clean video (illegal moves, no solution). */
export function buildPuzzle(row: BlunderRow): Puzzle | null {
  const best = row.solution_line?.pv?.[0] ?? row.correct_moves?.[0]?.move;
  if (!best) return null;
  const pv = row.solution_line?.pv?.length ? row.solution_line.pv : [best];
  if (pv[0] !== best) return null;
  const played = toPly(new Chess(row.fen), row.played_move);
  if (!played || row.played_move === best) return null;
  const solution = trimSolution(row.fen, pv);
  if (solution.length === 0) return null;
  const motif = pickMotif(row.motifs);
  const last = new Chess(solution[solution.length - 1].fen);
  return {
    blunderId: row.id,
    fen: row.fen,
    side: row.side_to_move,
    rating: row.user_rating,
    timeControl: row.time_category,
    played,
    solution,
    motif,
    motifLabel: motif ? (MOTIF_LABEL[motif] ?? null) : null,
    mate: last.isCheckmate() || (row.correct_moves?.[0]?.eval ?? 0) >= MATE_THRESHOLD,
  };
}

/**
 * Cheap pre-filter before the engine check: a real missed win (best move
 * keeps ≥ +300cp or mate for the mover), a showable motif, past the opening,
 * and a reveal of at most MAX_USER_MOVES moves.
 */
export function isCandidate(row: BlunderRow): boolean {
  const bestEval = row.correct_moves?.[0]?.eval ?? row.eval_before;
  if (bestEval < 300) return false;
  if (row.move_number < 8) return false;
  if (!pickMotif(row.motifs)) return false;
  return buildPuzzle(row) !== null;
}

/** Higher is better: mates and forks first, then the size of the swing. */
export function candidateScore(row: BlunderRow): number {
  const motif = pickMotif(row.motifs);
  const motifBonus = motif === 'missedMate' ? 30 : motif === 'missedFork' || motif === 'missedSkewer' ? 20 : motif ? 10 : 0;
  return motifBonus + Math.min(row.eval_swing, 100);
}

export function sideLabel(side: Side): string {
  return side === 'white' ? 'White' : 'Black';
}
