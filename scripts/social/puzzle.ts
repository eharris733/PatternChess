// A blunder row → everything the daily video and its caption need. Pure (no
// I/O) so the selection rules and the timeline are unit-testable.
import { Chess } from 'chess.js';
import { MOTIF_LABEL } from '../../workers/notifier/src/motifLabels.ts';

export type Side = 'white' | 'black';

/**
 * blunder: one of the owner's own blunders ("A 2056 player missed this").
 * fall: a move many PatternChess players got wrong in the same position
 * ("11 of our players fell for this. Would you?").
 */
export type Format = 'blunder' | 'fall';

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
  /** The moving piece and the captured one ('p','n','b','r','q','k'), for the script's fact sheet. */
  piece?: string;
  captured?: string | null;
}

export interface Puzzle {
  format: Format;
  blunderId: string;
  fen: string;
  side: Side;
  rating: number | null;
  /** "blitz", "rapid", … (as stored); null when unknown. */
  timeControl: string | null;
  /** blunder: what was played. fall: the tempting move most people play. */
  played: Ply;
  /** fall only: how the opponent punishes `played` (starts with their reply). Empty for blunder. */
  refutation: Ply[];
  /** fall only: distinct players who played `played` here. */
  fellCount: number | null;
  /** fall only: `<epd>|<uci>`, the dedup key. */
  trapKey: string | null;
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
      piece: m.piece,
      captured: m.captured ?? null,
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
    format: 'blunder',
    blunderId: row.id,
    fen: row.fen,
    side: row.side_to_move,
    rating: row.user_rating,
    timeControl: row.time_category,
    played,
    refutation: [],
    fellCount: null,
    trapKey: null,
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

/** The first four FEN fields (board, side, castling, en passant): one position whatever the move counters. */
export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export const MAX_REFUTATION_PLIES = 5;

/**
 * The punishment after a tempting move: up to MAX_REFUTATION_PLIES plies from
 * the opponent's reply, stopping at mate, trimmed back to the opponent's last
 * capture / check / promotion (even indexes are the opponent's moves). Never
 * empty when the first reply is legal.
 */
export function trimRefutation(fenAfterPlayed: string, pv: readonly string[]): Ply[] {
  const chess = new Chess(fenAfterPlayed);
  const plies: Ply[] = [];
  for (const uci of pv.slice(0, MAX_REFUTATION_PLIES)) {
    const ply = toPly(chess, uci);
    if (!ply) break;
    plies.push(ply);
    if (chess.isCheckmate()) return plies;
  }
  const payoff = (i: number) => i % 2 === 0 && (plies[i].capture || plies[i].check || plies[i].uci.length === 5);
  let end = plies.length;
  while (end > 1 && !payoff(end - 1)) end--;
  return plies.slice(0, end);
}

export interface FallInput {
  /** A representative blunder row (any player's; only its position is used). */
  blunderId: string;
  fen: string;
  tempting: string;
  fellCount: number;
  /** Engine PV after the tempting move (the opponent's reply first). */
  refutationPv: readonly string[];
  /** Engine PV for the right move. */
  bestPv: readonly string[];
  /** Mover's centipawns after the right move (mates as ±(10000 − n)). */
  bestCp: number;
}

/** A "would you fall for this?" puzzle; null when the moves don't replay. */
export function buildFallPuzzle(f: FallInput): Puzzle | null {
  const played = toPly(new Chess(f.fen), f.tempting);
  if (!played || !f.bestPv.length || f.bestPv[0] === f.tempting) return null;
  const refutation = trimRefutation(played.fen, f.refutationPv);
  if (refutation.length === 0) return null;
  // The right move: the whole winning line when it wins outright, else just the move.
  const solution = trimSolution(f.fen, f.bestCp >= 300 ? f.bestPv : f.bestPv.slice(0, 1));
  if (solution.length === 0) return null;
  const last = new Chess(solution[solution.length - 1].fen);
  return {
    format: 'fall',
    blunderId: f.blunderId,
    fen: f.fen,
    side: f.fen.split(' ')[1] === 'w' ? 'white' : 'black',
    rating: null,
    timeControl: null,
    played,
    refutation,
    fellCount: f.fellCount,
    trapKey: `${epdOf(f.fen)}|${f.tempting}`,
    solution,
    motif: null,
    motifLabel: null,
    mate: last.isCheckmate(),
  };
}
