import { rpc } from '../../lib/api';
import type { Json, Tables, TablesInsert, TablesUpdate } from '../../lib/database.types';
import { parseTheoryMoves, type TheoryMove } from '../../models/blunder';
import type { MoveClassification } from '../../chess/winningChances';
import {
  DEVIATION_RULE_VERSION,
  stayedInBookThrough,
  type DeviationReason,
  type DeviationStatus,
  type OpeningDeviation,
} from '../../chess/openingDeviation';
import { currentUserId } from './currentUser';

const STATUSES: readonly DeviationStatus[] = [
  'user_left',
  'opponent_left',
  'theory_end',
  'in_book',
  'skipped',
];
const CLASSES: readonly MoveClassification[] = ['good', 'inaccuracy', 'mistake', 'blunder'];
const REASONS: readonly DeviationReason[] = [
  'not_in_book',
  'losing_line',
  'engine_rejected',
  'past_book',
];

export function openingDeviationFromJson(r: Tables<'opening_deviations'>): OpeningDeviation {
  return {
    id: r.id,
    gameId: r.game_id,
    status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as DeviationStatus) : 'skipped',
    ply: r.ply,
    moveNumber: r.move_number,
    userColor: r.user_color === 'white' || r.user_color === 'black' ? r.user_color : null,
    fenBefore: r.fen_before,
    epdBefore: r.epd_before,
    playedUci: r.played_uci,
    playedSan: r.played_san,
    reason: (REASONS as readonly string[]).includes(r.reason ?? '') ? (r.reason as DeviationReason) : null,
    theoryMoves: parseTheoryMoves(r.theory_moves),
    positionGames: r.position_games,
    playedGames: r.played_games,
    playedMoverWinPct: r.played_mover_win_pct,
    evalBefore: r.eval_before,
    evalAfter: r.eval_after,
    chancesLost: r.chances_lost,
    classification: (CLASSES as readonly string[]).includes(r.classification ?? '')
      ? (r.classification as MoveClassification)
      : null,
    evaluatedAt: r.evaluated_at ? new Date(r.evaluated_at) : null,
    bookTier: r.book_tier === 'otb' || r.book_tier === 'elite' ? r.book_tier : null,
    bookEndPly: r.book_end_ply,
    pastBookCheckedAt: r.past_book_checked_at ? new Date(r.past_book_checked_at) : null,
    blunderId: r.blunder_id,
    openingFamily: r.opening_family,
    openingName: r.opening_name,
    eco: r.eco,
    createdAt: new Date(r.created_at),
  };
}

export interface DeviationScanGame {
  id: string;
  pgn: string;
  userColor: 'white' | 'black' | null;
  openingFamily: string | null;
  openingName: string | null;
  eco: string | null;
}

/** Games whose theory walk is missing or predates the current rule version. */
export async function getUncheckedDeviationGames(opts: {
  limit: number;
}): Promise<DeviationScanGame[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const data = await rpc<
    Pick<Tables<'games'>, 'id' | 'pgn' | 'user_color' | 'opening_family' | 'opening_name' | 'eco'>[]
  >('openings.uncheckedGames', { ruleVersion: DEVIATION_RULE_VERSION, limit: opts.limit });
  return (data ?? []).map((g) => ({
    id: g.id,
    pgn: g.pgn,
    userColor: g.user_color === 'white' || g.user_color === 'black' ? g.user_color : null,
    openingFamily: g.opening_family,
    openingName: g.opening_name,
    eco: g.eco,
  }));
}

export async function countUncheckedDeviationGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return (await rpc<number>('openings.countUncheckedGames', { ruleVersion: DEVIATION_RULE_VERSION })) ?? 0;
}

/**
 * Write a game's theory walk (replacing any older-version row, so the eval
 * and past-book columns reset unless the walk sets them — it may pre-fill
 * eval_before from the book's stored eval) and stamp the game with the
 * current rule version (one transaction on the server).
 */
export async function saveDeviationWalk(
  row: Omit<TablesInsert<'opening_deviations'>, 'user_id' | 'rule_version'>,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await rpc('openings.saveWalk', {
    ruleVersion: DEVIATION_RULE_VERSION,
    row: {
      eval_before: null,
      eval_after: null,
      chances_lost: null,
      classification: null,
      eval_depth: null,
      evaluated_at: null,
      book_tier: null,
      book_end_ply: null,
      past_book_checked_at: null,
      blunder_id: null,
      ...row,
      theory_moves: row.theory_moves ?? [],
    },
  });
}

/** User exits still waiting for the engine (oldest first). */
export async function getPendingDeviationEvals(opts: { limit: number }): Promise<OpeningDeviation[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const data = await rpc<Tables<'opening_deviations'>[]>('openings.pendingEvals', { limit: opts.limit });
  return (data ?? []).map(openingDeviationFromJson);
}

export async function countPendingDeviationEvals(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return (await rpc<number>('openings.countPendingEvals')) ?? 0;
}

export async function setDeviationEval(
  id: string,
  result: {
    evalBefore: number;
    evalAfter: number;
    chancesLost: number;
    classification: MoveClassification;
    depth: number | null;
    blunderId: string | null;
    /** A sound exit hands the rest of the opening to the past-book scan. */
    bookEndPly?: number | null;
  },
): Promise<void> {
  const patch: TablesUpdate<'opening_deviations'> = {
    eval_before: result.evalBefore,
    eval_after: result.evalAfter,
    chances_lost: result.chancesLost,
    classification: result.classification,
    eval_depth: result.depth,
    evaluated_at: new Date().toISOString(),
    blunder_id: result.blunderId,
    ...(result.bookEndPly != null ? { book_end_ply: result.bookEndPly } : {}),
  };
  await rpc('openings.updateDeviation', { id, patch });
}

/**
 * Games whose opening continues past the book and hasn't been engine-scanned:
 * theory_end / opponent_left rows, and sound user exits (book_end_ply set by
 * setDeviationEval). Oldest first. Only analyzed games: the scan defers to
 * the game's tactic rows, so they must exist before it runs.
 */
export async function getPastBookQueue(opts: { limit: number }): Promise<(OpeningDeviation & { pgn: string })[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const data = await rpc<(Tables<'opening_deviations'> & { pgn: string })[]>('openings.pastBookQueue', {
    limit: opts.limit,
  });
  return (data ?? []).map((r) => ({ ...openingDeviationFromJson(r), pgn: r.pgn }));
}

export async function countPastBookQueue(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return (await rpc<number>('openings.countPastBookQueue')) ?? 0;
}

/**
 * Record the past-book scan: `mistake` rewrites the row as the user's exit
 * (status user_left, reason past_book, already engine-scored); null just
 * stamps it as checked.
 */
export async function setPastBookResult(
  id: string,
  mistake: {
    ply: number;
    moveNumber: number;
    fenBefore: string;
    epdBefore: string;
    playedUci: string;
    playedSan: string;
    theoryMoves: TheoryMove[];
    positionGames: number | null;
    evalBefore: number;
    evalAfter: number;
    chancesLost: number;
    classification: MoveClassification;
    depth: number | null;
    blunderId: string | null;
  } | null,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: TablesUpdate<'opening_deviations'> = mistake
    ? {
        status: 'user_left',
        reason: 'past_book',
        ply: mistake.ply,
        move_number: mistake.moveNumber,
        fen_before: mistake.fenBefore,
        epd_before: mistake.epdBefore,
        played_uci: mistake.playedUci,
        played_san: mistake.playedSan,
        theory_moves: mistake.theoryMoves as unknown as Json,
        position_games: mistake.positionGames,
        played_games: null,
        played_mover_win_pct: null,
        eval_before: mistake.evalBefore,
        eval_after: mistake.evalAfter,
        chances_lost: mistake.chancesLost,
        classification: mistake.classification,
        eval_depth: mistake.depth,
        evaluated_at: now,
        blunder_id: mistake.blunderId,
        past_book_checked_at: now,
      }
    : { past_book_checked_at: now };
  await rpc('openings.updateDeviation', { id, patch });
}

/** Every deviation row for the signed-in user. */
export async function getDeviations(): Promise<OpeningDeviation[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<Tables<'opening_deviations'>[]>('openings.list');
  return (rows ?? []).map(openingDeviationFromJson);
}

/**
 * Id of an existing tactic/opening drill for this position, matched on EPD so
 * transpositions (same position, different move counters) count. A position
 * that already drills as a tactic must not be served twice. An opening drill
 * retired by the orphan sweep that qualifies again goes back into the queue
 * (the server un-retires it).
 */
export async function findDrillForPosition(epd: string): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  return (await rpc<string | null>('openings.findDrill', { epd })) ?? null;
}

/** Whether this game's tactic analysis already flagged the position (EPD match). */
export async function hasTacticForGamePosition(gameId: string, epd: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  return (await rpc<boolean>('openings.hasTacticForGamePosition', { gameId, epd })) === true;
}

/**
 * Retire live kind='opening' drills no deviation row points at any more —
 * exits a rule change dropped (past move 13, or a lopsided past-book slip).
 * Kept in the Vault; out of the due queue. Returns how many were retired.
 */
export async function retireOrphanOpeningDrills(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return (await rpc<number>('openings.retireOrphanDrills')) ?? 0;
}

/** Games where the user was still in theory at move 10 (achievement metric). */
export async function countBookDepthGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const rows =
    (await rpc<Pick<Tables<'opening_deviations'>, 'status' | 'reason' | 'ply' | 'book_end_ply'>[]>(
      'openings.bookDepthRows',
    )) ?? [];
  let n = 0;
  for (const r of rows) {
    const status = (STATUSES as readonly string[]).includes(r.status) ? (r.status as DeviationStatus) : 'skipped';
    const reason = (REASONS as readonly string[]).includes(r.reason ?? '') ? (r.reason as DeviationReason) : null;
    if (stayedInBookThrough({ status, reason, ply: r.ply, bookEndPly: r.book_end_ply })) n++;
  }
  return n;
}

/** Insert one kind='opening' drill and return its id (null if it already existed). */
export async function insertOpeningDrill(
  row: Omit<TablesInsert<'blunders'>, 'user_id'>,
): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  return (await rpc<string | null>('openings.insertDrill', { row })) ?? null;
}
