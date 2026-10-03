import { Chess } from 'chess.js';
import type { BookPosition, BookTier } from '../services/openingBookService';
import { moveStats, positionGames, titledShare } from '../services/openingBookService';
import type { TheoryMove } from '../models/blunder';
import { moveToUci } from './moveUtils';
import type { MoveClassification } from './winningChances';

/**
 * Where a game leaves opening theory, judged against the self-hosted opening
 * book (OTB broadcasts 2200+, Lichess Elite filling in — see bookFormat.ts).
 * Pure — the book lookup is injected so tests run offline.
 *
 * Walking from the start position, the user "leaves theory" at their first
 * move that either
 *   - isn't in the book (< MIN_MOVE_GAMES games),
 *   - is in the book but the engine vet rejected it (`sound === false`: more
 *     than 8% winning chances worse than the best option), or
 *   - leads to a line where their side wins < LOSING_WIN_PCT of games
 *     (only with ≥ MIN_WINRATE_GAMES games, so a 0-of-2 sample can't trigger).
 * The walk stops without blaming the user when theory itself runs out
 * (< MIN_POSITION_GAMES games in the position) or when the opponent leaves
 * the book first; `bookEndPly` then marks where the engine takes over (the
 * past-book scan in openingDeviationService). The exit is engine-scored
 * afterwards; only ≥10% chances lost counts as "went wrong".
 *
 * Bump DEVIATION_RULE_VERSION whenever these rules change — every game with an
 * older games.opening_deviation_version is re-walked.
 */
export const DEVIATION_RULE_VERSION = 3;
export const MIN_POSITION_GAMES = 10;
export const MIN_MOVE_GAMES = 3;
export const MIN_WINRATE_GAMES = 20;
export const LOSING_WIN_PCT = 10;
/** Theory share below which a book move isn't offered as "the" theory move. */
export const MIN_THEORY_SHARE_PCT = 5;
/** The opening window: 13 full moves. Nothing past it is an opening exit. */
export const MAX_THEORY_PLIES = 26;
/**
 * Past the book, a position this lopsided (side-to-move |cp|, about 68/32
 * winning chances) means the opening was already left behind: later mistakes
 * belong to the regular blunder pipeline, so the past-book scan stops.
 */
export const PAST_BOOK_MAX_EVAL_CP = 200;
const MAX_THEORY_MOVES = 5;

export type DeviationStatus = 'user_left' | 'opponent_left' | 'theory_end' | 'in_book' | 'skipped';
export type DeviationReason = 'not_in_book' | 'losing_line' | 'engine_rejected' | 'past_book';

/** The only source of user-facing labels for why a move left theory. */
export const DEVIATION_REASON_LABEL: Record<DeviationReason, string> = {
  not_in_book: 'Left the book',
  losing_line: 'Losing line',
  engine_rejected: 'Popular but unsound',
  past_book: 'Mistake after theory',
};

export interface DeviationWalk {
  status: DeviationStatus;
  /** 0-based ply of the exit move (null for in_book / skipped). */
  ply: number | null;
  moveNumber: number | null;
  fenBefore: string | null;
  playedSan: string | null;
  playedUci: string | null;
  reason: DeviationReason | null;
  theoryMoves: TheoryMove[];
  positionGames: number | null;
  playedGames: number | null;
  playedMoverWinPct: number | null;
  /** Tier that answered for the exit position (or the last book position). */
  bookTier: BookTier | null;
  /**
   * First ply the book can no longer judge (theory_end / opponent_left); the
   * past-book engine scan starts here. Null for user_left / skipped.
   */
  bookEndPly: number | null;
  /** The book's stored side-to-move eval of fenBefore, when it has one. */
  bookEvalCp: number | null;
  bookEvalDepth: number | null;
}

/**
 * Book lookup: the position, null when the book doesn't have it, or 'error'
 * when the lookup itself failed (the game must be retried, not stamped).
 */
export type BookLookup = (fen: string) => Promise<BookPosition | null | 'error'>;

/** FEN minus the halfmove/fullmove counters — groups transpositions. */
export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function emptyWalk(status: DeviationStatus): DeviationWalk {
  return {
    status,
    ply: null,
    moveNumber: null,
    fenBefore: null,
    playedSan: null,
    playedUci: null,
    reason: null,
    theoryMoves: [],
    positionGames: null,
    playedGames: null,
    playedMoverWinPct: null,
    bookTier: null,
    bookEndPly: null,
    bookEvalCp: null,
    bookEvalDepth: null,
  };
}

/**
 * The book moves worth teaching at `fen`: enough games, a real share of the
 * position, not engine-rejected and not a losing line for the mover,
 * best-played first. SAN is re-derived with chess.js so it matches the board.
 */
export function theoryMovesAt(fen: string, result: BookPosition): TheoryMove[] {
  const mover = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const total = positionGames(result);
  if (total === 0) return [];
  const out: TheoryMove[] = [];
  for (const m of result.moves) {
    const { games, moverWinPct } = moveStats(m, mover);
    const share = (games / total) * 100;
    if (games < MIN_MOVE_GAMES || share < MIN_THEORY_SHARE_PCT) continue;
    if (m.sound === false) continue;
    if (games >= MIN_WINRATE_GAMES && moverWinPct < LOSING_WIN_PCT) continue;
    let uci: string;
    let san: string;
    try {
      const mv = new Chess(fen).move(m.uci);
      uci = moveToUci(mv);
      san = mv.san;
    } catch {
      continue;
    }
    out.push({
      uci,
      san,
      games,
      share,
      moverWinPct,
      titledShare: titledShare(m, result),
      tier: result.tier,
    });
  }
  out.sort((a, b) => b.games - a.games);
  return out.slice(0, MAX_THEORY_MOVES);
}

/** Every FEN a walk of these moves can look up (for one batched book request). */
export function walkFens(sanMoves: string[], startFen?: string): string[] {
  const chess = startFen ? new Chess(startFen) : new Chess();
  const fens: string[] = [];
  const limit = Math.min(sanMoves.length, MAX_THEORY_PLIES);
  for (let ply = 0; ply < limit; ply++) {
    fens.push(chess.fen());
    try {
      chess.move(sanMoves[ply]);
    } catch {
      break;
    }
  }
  return fens;
}

/**
 * Walk a game's moves through the book. Returns 'retry' if any lookup
 * failed — the caller must not stamp the game, or a transient network error
 * would permanently record a wrong exit.
 */
export async function findDeviation(
  sanMoves: string[],
  userColor: 'white' | 'black',
  lookup: BookLookup,
  startFen?: string,
): Promise<DeviationWalk | 'retry'> {
  const chess = startFen ? new Chess(startFen) : new Chess();
  const limit = Math.min(sanMoves.length, MAX_THEORY_PLIES);
  let lastTier: BookTier | null = null;

  for (let ply = 0; ply < limit; ply++) {
    const fenBefore = chess.fen();
    const mover = chess.turn() === 'w' ? 'white' : 'black';
    const moveNumber = Number(fenBefore.split(' ')[5]) || Math.floor(ply / 2) + 1;

    const result = await lookup(fenBefore);
    if (result === 'error') return 'retry';

    let played;
    try {
      played = chess.move(sanMoves[ply]);
    } catch {
      return emptyWalk('skipped');
    }
    const playedUci = moveToUci(played);

    const total = result ? positionGames(result) : 0;
    const base = {
      ply,
      moveNumber,
      fenBefore,
      playedSan: played.san,
      playedUci,
      positionGames: total,
      bookTier: result?.tier ?? lastTier,
      bookEvalCp: result?.cp ?? null,
      bookEvalDepth: result?.depth ?? null,
    };

    if (!result || total < MIN_POSITION_GAMES) {
      return { ...emptyWalk('theory_end'), ...base, bookEndPly: ply };
    }
    lastTier = result.tier;

    const match = result.moves.find((m) => m.uci === playedUci);
    const stats = match ? moveStats(match, mover) : { games: 0, moverWinPct: 0 };
    const played3 = stats.games >= MIN_MOVE_GAMES;
    const rejected = played3 && match?.sound === false;

    if (mover !== userColor) {
      // The opponent's dubious-but-common moves stay in book: the user's
      // reply is still judged against theory.
      if (!played3) {
        return {
          ...emptyWalk('opponent_left'),
          ...base,
          playedGames: stats.games,
          playedMoverWinPct: match ? stats.moverWinPct : null,
          bookEndPly: ply + 1,
        };
      }
      continue;
    }

    const losing = played3 && stats.games >= MIN_WINRATE_GAMES && stats.moverWinPct < LOSING_WIN_PCT;
    if (!played3 || rejected || losing) {
      return {
        ...emptyWalk('user_left'),
        ...base,
        reason: rejected ? 'engine_rejected' : losing ? 'losing_line' : 'not_in_book',
        theoryMoves: theoryMovesAt(fenBefore, result),
        playedGames: stats.games,
        playedMoverWinPct: match ? stats.moverWinPct : null,
      };
    }
  }

  return { ...emptyWalk('in_book'), bookTier: lastTier };
}

/** True while a past-book position is still level enough to judge as opening play. */
export function pastBookGate(evalCp: number): boolean {
  return Math.abs(evalCp) <= PAST_BOOK_MAX_EVAL_CP;
}

/** Ply of the user's first book move at move 11 — "in theory through move 10". */
export const BOOK_DEPTH_PLY = 20;

/**
 * Whether the user was still in theory at `minPly` in this game: their exit
 * (or the point where theory ran out or the opponent left) came no earlier.
 * Past-book rows count from where the book ended, not the later mistake.
 */
export function stayedInBookThrough(
  row: { status: DeviationStatus; reason: DeviationReason | null; ply: number | null; bookEndPly: number | null },
  minPly: number = BOOK_DEPTH_PLY,
): boolean {
  switch (row.status) {
    case 'in_book':
      return true;
    case 'user_left': {
      const exit = row.reason === 'past_book' ? row.bookEndPly : row.ply;
      return exit != null && exit >= minPly;
    }
    case 'theory_end':
    case 'opponent_left':
      return row.bookEndPly == null || row.bookEndPly >= minPly;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Aggregation for /openings
// ---------------------------------------------------------------------------

export interface OpeningDeviation {
  id: string;
  gameId: string;
  status: DeviationStatus;
  ply: number | null;
  moveNumber: number | null;
  userColor: 'white' | 'black' | null;
  fenBefore: string | null;
  epdBefore: string | null;
  playedUci: string | null;
  playedSan: string | null;
  reason: DeviationReason | null;
  theoryMoves: TheoryMove[];
  positionGames: number | null;
  playedGames: number | null;
  playedMoverWinPct: number | null;
  evalBefore: number | null;
  evalAfter: number | null;
  chancesLost: number | null;
  classification: MoveClassification | null;
  evaluatedAt: Date | null;
  bookTier: BookTier | null;
  bookEndPly: number | null;
  pastBookCheckedAt: Date | null;
  blunderId: string | null;
  openingFamily: string | null;
  openingName: string | null;
  eco: string | null;
  createdAt: Date;
}

/** A recurring exit: same position, same user move, across games. */
export interface DeviationLeak {
  key: string;
  fenBefore: string;
  moveNumber: number;
  playedSan: string;
  playedUci: string;
  reason: DeviationReason;
  count: number;
  /** Mean chances lost over the evaluated occurrences; null while pending. */
  avgChancesLost: number | null;
  worst: MoveClassification | null;
  theoryMoves: TheoryMove[];
  /** Newest first — the first one is the game the review opens on. */
  gameIds: string[];
  blunderId: string | null;
  /** Ranking weight: count × mean loss (0 while unevaluated). */
  score: number;
}

export interface OpeningSummary {
  family: string;
  color: 'white' | 'black';
  /** Most common full name / ECO inside the family, for display. */
  dominantName: string | null;
  dominantEco: string | null;
  games: number;
  userLeft: number;
  opponentLeft: number;
  theoryEnd: number;
  inBook: number;
  /** Mean move number of the first exit (either side); null if none. */
  avgExitMove: number | null;
  /** User exits scored inaccuracy or worse. */
  costlyExits: number;
  /** User exits still waiting for the engine. */
  pendingEvals: number;
  leaks: DeviationLeak[];
}

const SEVERITY: Record<MoveClassification, number> = {
  good: 0,
  inaccuracy: 1,
  mistake: 2,
  blunder: 3,
};

export function isCostly(c: MoveClassification | null): boolean {
  return c != null && SEVERITY[c] >= SEVERITY.inaccuracy;
}

function mode(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export const UNCLASSIFIED_FAMILY = 'Unclassified';

/**
 * Group deviation rows per (opening family, user colour) and, inside each,
 * collapse repeated exits from the same position with the same move into
 * leaks ranked by count × mean loss. Families sort by costly exits, then your
 * own exits, then games.
 */
export function summarizeDeviations(rows: OpeningDeviation[]): OpeningSummary[] {
  const groups = new Map<string, OpeningDeviation[]>();
  for (const r of rows) {
    if (r.status === 'skipped' || !r.userColor) continue;
    const key = `${r.openingFamily ?? UNCLASSIFIED_FAMILY}|${r.userColor}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: OpeningSummary[] = [];
  for (const [key, g] of groups) {
    const [family, color] = key.split('|') as [string, 'white' | 'black'];
    const exits = g.filter((r) => r.status === 'user_left' || r.status === 'opponent_left');
    const moveNums = exits.map((r) => r.moveNumber).filter((n): n is number => n != null);

    const leakMap = new Map<string, OpeningDeviation[]>();
    for (const r of g) {
      if (r.status !== 'user_left' || !r.epdBefore || !r.playedUci) continue;
      const k = `${r.epdBefore}|${r.playedUci}`;
      const l = leakMap.get(k);
      if (l) l.push(r);
      else leakMap.set(k, [r]);
    }

    const leaks: DeviationLeak[] = [];
    for (const [k, occ] of leakMap) {
      const evaluated = occ.filter((r) => r.chancesLost != null);
      const avg = evaluated.length
        ? evaluated.reduce((s, r) => s + (r.chancesLost ?? 0), 0) / evaluated.length
        : null;
      let worst: MoveClassification | null = null;
      for (const r of evaluated) {
        if (r.classification && (!worst || SEVERITY[r.classification] > SEVERITY[worst])) {
          worst = r.classification;
        }
      }
      // Newest occurrence carries the freshest masters snapshot.
      const newestFirst = [...occ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const latest = newestFirst[0];
      leaks.push({
        key: k,
        fenBefore: latest.fenBefore!,
        moveNumber: latest.moveNumber ?? 0,
        playedSan: latest.playedSan ?? latest.playedUci!,
        playedUci: latest.playedUci!,
        reason: latest.reason ?? 'not_in_book',
        count: occ.length,
        avgChancesLost: avg,
        worst,
        theoryMoves: latest.theoryMoves,
        gameIds: newestFirst.map((r) => r.gameId),
        blunderId: occ.find((r) => r.blunderId)?.blunderId ?? null,
        score: occ.length * Math.max(avg ?? 0, 0),
      });
    }
    leaks.sort((a, b) => b.score - a.score || b.count - a.count);

    out.push({
      family,
      color,
      dominantName: mode(g.map((r) => r.openingName)),
      dominantEco: mode(g.map((r) => r.eco)),
      games: g.length,
      userLeft: g.filter((r) => r.status === 'user_left').length,
      opponentLeft: g.filter((r) => r.status === 'opponent_left').length,
      theoryEnd: g.filter((r) => r.status === 'theory_end').length,
      inBook: g.filter((r) => r.status === 'in_book').length,
      avgExitMove: moveNums.length ? moveNums.reduce((s, n) => s + n, 0) / moveNums.length : null,
      costlyExits: g.filter((r) => r.status === 'user_left' && isCostly(r.classification)).length,
      pendingEvals: g.filter((r) => r.status === 'user_left' && r.evaluatedAt == null).length,
      leaks,
    });
  }

  // Costly exits first, then openings with your own exits still being scored,
  // then volume.
  out.sort(
    (a, b) => b.costlyExits - a.costlyExits || b.userLeft - a.userLeft || b.games - a.games,
  );
  return out;
}

/** Leaks worth drilling: costly exits plus the ones the engine hasn't scored yet. */
export function trainableLeaks(s: OpeningSummary): DeviationLeak[] {
  return s.leaks.filter((l) => isCostly(l.worst) || l.avgChancesLost == null);
}

/** Games where the user's own exit cost them (each repeat counts). */
export function costlyExitGames(s: OpeningSummary): number {
  return s.leaks.filter((l) => isCostly(l.worst)).reduce((n, l) => n + l.count, 0);
}

/**
 * Typical move number of the user's costly exits, weighted by how often each
 * repeats — "you leave theory by move N". Null with no costly exits.
 */
export function typicalExitMove(s: OpeningSummary): number | null {
  const costly = s.leaks.filter((l) => isCostly(l.worst));
  const games = costly.reduce((n, l) => n + l.count, 0);
  if (games === 0) return null;
  return Math.round(costly.reduce((sum, l) => sum + l.moveNumber * l.count, 0) / games);
}

/**
 * The opening to lead /openings with: the most games lost to a costly exit,
 * ties broken by the single most-repeated slip, then by volume. Null when no
 * opening has a costly exit yet.
 */
export function headlineOpening(summaries: OpeningSummary[]): OpeningSummary | null {
  let best: OpeningSummary | null = null;
  let bestKey: [number, number, number] = [0, 0, 0];
  for (const s of summaries) {
    const games = costlyExitGames(s);
    if (games === 0) continue;
    const repeat = Math.max(0, ...s.leaks.filter((l) => isCostly(l.worst)).map((l) => l.count));
    const key: [number, number, number] = [games, repeat, s.games];
    if (
      !best ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))
    ) {
      best = s;
      bestKey = key;
    }
  }
  return best;
}
