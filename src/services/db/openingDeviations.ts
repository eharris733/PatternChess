import { supabase, toJson } from '../../lib/supabase';
import type { Tables, TablesInsert, TablesUpdate } from '../../lib/database.types';
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
import { fetchAllRows, fetchInChunks } from './paginate';

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

const uncheckedFilter = `opening_deviation_version.is.null,opening_deviation_version.lt.${DEVIATION_RULE_VERSION}`;

/** Games whose theory walk is missing or predates the current rule version. */
export async function getUncheckedDeviationGames(opts: {
  limit: number;
}): Promise<DeviationScanGame[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('games')
    .select('id, pgn, user_color, opening_family, opening_name, eco')
    .eq('user_id', userId)
    .or(uncheckedFilter)
    .order('played_at', { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
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
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .or(uncheckedFilter);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Write a game's theory walk (replacing any older-version row, so the eval
 * and past-book columns reset unless the walk sets them — it may pre-fill
 * eval_before from the book's stored eval) and stamp the game with the
 * current rule version.
 */
export async function saveDeviationWalk(
  row: Omit<TablesInsert<'opening_deviations'>, 'user_id' | 'rule_version'>,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase.from('opening_deviations').upsert(
    {
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
      theory_moves: toJson(row.theory_moves ?? []),
      user_id: userId,
      rule_version: DEVIATION_RULE_VERSION,
    },
    { onConflict: 'user_id,game_id' },
  );
  if (error) throw error;
  const { error: stampErr } = await supabase
    .from('games')
    .update({ opening_deviation_version: DEVIATION_RULE_VERSION })
    .eq('id', row.game_id);
  if (stampErr) throw stampErr;
}

/** User exits still waiting for the engine (oldest first). */
export async function getPendingDeviationEvals(opts: { limit: number }): Promise<OpeningDeviation[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('opening_deviations')
    .select()
    .eq('user_id', userId)
    .eq('status', 'user_left')
    .is('evaluated_at', null)
    .order('created_at', { ascending: true })
    .limit(opts.limit);
  if (error) throw error;
  return (data ?? []).map(openingDeviationFromJson);
}

export async function countPendingDeviationEvals(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('opening_deviations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'user_left')
    .is('evaluated_at', null);
  if (error) throw error;
  return count ?? 0;
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
  const { error } = await supabase
    .from('opening_deviations')
    .update({
      eval_before: result.evalBefore,
      eval_after: result.evalAfter,
      chances_lost: result.chancesLost,
      classification: result.classification,
      eval_depth: result.depth,
      evaluated_at: new Date().toISOString(),
      blunder_id: result.blunderId,
      ...(result.bookEndPly != null ? { book_end_ply: result.bookEndPly } : {}),
    })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Games whose opening continues past the book and hasn't been engine-scanned:
 * theory_end / opponent_left rows, and sound user exits (book_end_ply set by
 * setDeviationEval). Oldest first.
 */
export async function getPastBookQueue(opts: { limit: number }): Promise<(OpeningDeviation & { pgn: string })[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  // Only analyzed games: the scan defers to the game's tactic rows, so they
  // must exist before it runs.
  const { data, error } = await supabase
    .from('opening_deviations')
    .select('*, games!inner(pgn)')
    .eq('user_id', userId)
    .not('book_end_ply', 'is', null)
    .is('past_book_checked_at', null)
    .not('games.analyzed_at', 'is', null)
    .order('created_at', { ascending: true })
    .limit(opts.limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...openingDeviationFromJson(r),
    pgn: (r.games as unknown as { pgn: string }).pgn,
  }));
}

export async function countPastBookQueue(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('opening_deviations')
    .select('id, games!inner(analyzed_at)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('book_end_ply', 'is', null)
    .is('past_book_checked_at', null)
    .not('games.analyzed_at', 'is', null);
  if (error) throw error;
  return count ?? 0;
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
        theory_moves: toJson(mistake.theoryMoves),
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
  const { error } = await supabase.from('opening_deviations').update(patch).eq('id', id);
  if (error) throw error;
}

/** Every deviation row for the signed-in user (paged past PostgREST's 1000-row cap). */
export async function getDeviations(): Promise<OpeningDeviation[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await fetchAllRows(() =>
    supabase
      .from('opening_deviations')
      .select()
      .eq('user_id', userId)
      .neq('status', 'skipped')
      .order('created_at', { ascending: false })
      .order('id'),
  );
  return rows.map(openingDeviationFromJson);
}

/**
 * Id of an existing tactic/opening drill for this position, matched on EPD so
 * transpositions (same position, different move counters) count. A position
 * that already drills as a tactic must not be served twice.
 */
export async function findDrillForPosition(epd: string): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('blunders')
    .select('id, kind, retired_at')
    .eq('user_id', userId)
    .in('kind', ['tactic', 'opening'])
    .like('fen', `${epd} %`)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  // An opening drill retired by the orphan sweep that qualifies again goes
  // back into the queue.
  if (row.kind === 'opening' && row.retired_at) {
    const { error: upErr } = await supabase.from('blunders').update({ retired_at: null }).eq('id', row.id);
    if (upErr) throw upErr;
  }
  return row.id;
}

/** Whether this game's tactic analysis already flagged the position (EPD match). */
export async function hasTacticForGamePosition(gameId: string, epd: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const { count, error } = await supabase
    .from('blunders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('game_id', gameId)
    .eq('kind', 'tactic')
    .like('fen', `${epd} %`);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Retire live kind='opening' drills no deviation row points at any more —
 * exits a rule change dropped (past move 13, or a lopsided past-book slip).
 * Kept in the Vault; out of the due queue. Returns how many were retired.
 */
export async function retireOrphanOpeningDrills(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  // Both reads must be complete: a refs list truncated at PostgREST's
  // 1000-row cap would make live drills look orphaned and retire them.
  const drills = await fetchAllRows(() =>
    supabase.from('blunders').select('id').eq('user_id', userId).eq('kind', 'opening').is('retired_at', null).order('id'),
  );
  if (drills.length === 0) return 0;
  const refs = await fetchAllRows(() =>
    supabase
      .from('opening_deviations')
      .select('blunder_id')
      .eq('user_id', userId)
      .not('blunder_id', 'is', null)
      .order('id'),
  );
  const live = new Set(refs.map((r) => r.blunder_id));
  const orphans = drills.map((d) => d.id).filter((id) => !live.has(id));
  if (orphans.length === 0) return 0;
  await fetchInChunks(orphans, async (chunk) => {
    const { error: upErr } = await supabase
      .from('blunders')
      .update({ retired_at: new Date().toISOString() })
      .in('id', chunk);
    if (upErr) throw upErr;
    return [];
  });
  return orphans.length;
}

/** Games where the user was still in theory at move 10 (achievement metric). */
export async function countBookDepthGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const rows = await fetchAllRows(() =>
    supabase
      .from('opening_deviations')
      .select('status, reason, ply, book_end_ply')
      .eq('user_id', userId)
      .neq('status', 'skipped')
      .order('id'),
  );
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
  const { data, error } = await supabase
    .from('blunders')
    .upsert({ ...row, user_id: userId }, { onConflict: 'user_id,fen,kind', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return data?.[0]?.id ?? null;
}
