import { supabase, toJson } from '../../lib/supabase';
import type { TablesInsert } from '../../lib/database.types';
import {
  Blunder,
  blunderFromJson,
  CorrectMove,
  nextDrillDate,
  sortDueQueue,
} from '../../models/blunder';
import { currentUserId } from './currentUser';
import { fetchAllRows, fetchInChunks } from './paginate';

export async function insertBlunders(
  blunders: Omit<TablesInsert<'blunders'>, 'user_id'>[],
): Promise<void> {
  if (blunders.length === 0) return;
  const userId = await currentUserId();
  // Analysis callers predate `kind` and omit it — they are always tactics.
  const enriched: TablesInsert<'blunders'>[] = blunders.map((b) => ({
    kind: 'tactic',
    ...b,
    ...(userId ? { user_id: userId } : {}),
  }));
  // Drop intra-batch duplicates (e.g. threefold repetition) — Postgres rejects
  // an upsert payload that conflicts with itself on the onConflict target.
  const seen = new Set<string>();
  const deduped: TablesInsert<'blunders'>[] = [];
  for (const row of enriched) {
    const key = `${row.user_id ?? ''}|${row.fen ?? ''}|${row.kind ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  const { error } = await supabase
    .from('blunders')
    .upsert(deduped, { onConflict: 'user_id,fen,kind', ignoreDuplicates: true });
  if (error) throw error;
}

// Game-analysis views (Vault, Review) show blunders *found in the game* —
// endgame play-out slips also carry a game_id but aren't part of the game's
// analysis, so these stay tactic-only.
export async function getBlundersForGames(gameIds: string[]): Promise<Blunder[]> {
  const rows = await fetchInChunks(gameIds, (chunk) =>
    fetchAllRows(() =>
      supabase.from('blunders').select().in('game_id', chunk).eq('kind', 'tactic').order('id'),
    ),
  );
  return rows.map(blunderFromJson).sort((a, b) => a.moveNumber - b.moveNumber);
}

export async function getBlunderCountsByGame(opts?: {
  userId?: string;
}): Promise<Record<string, number>> {
  const rows = await fetchAllRows(() => {
    let q = supabase.from('blunders').select('game_id').eq('kind', 'tactic').order('id');
    if (opts?.userId) q = q.eq('user_id', opts.userId);
    return q;
  });
  const counts: Record<string, number> = {};
  for (const row of rows as Array<{ game_id: string }>) {
    counts[row.game_id] = (counts[row.game_id] ?? 0) + 1;
  }
  return counts;
}

export async function getDueBlunders(opts?: { userId?: string }): Promise<Blunder[]> {
  const now = new Date().toISOString();
  // Retired rows (deepening showed the position wasn't really a blunder) are
  // hidden from the queue but keep their SR history and stay in Vault/stats.
  // Paged: a backlog past PostgREST's 1000-row cap used to show "Review 1000".
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('blunders')
      .select()
      .lte('next_drill_at', now)
      .is('retired_at', null)
      .order('next_drill_at', { ascending: true })
      .order('id');
    if (opts?.userId) q = q.eq('user_id', opts.userId);
    return q;
  });
  // Final ordering (pressing reviews → mastered maintenance → new, by relative
  // overdue-ness) happens client-side in sortDueQueue — see its docstring for why.
  return sortDueQueue(rows.map(blunderFromJson));
}

/**
 * Every live (not retired) drill of one kind, with its SR state — for the
 * mastery views on /openings. Not filtered by due date.
 */
export async function getDrillsOfKind(kind: 'opening' | 'endgame'): Promise<Blunder[]> {
  const rows = await fetchAllRows(() =>
    supabase.from('blunders').select().eq('kind', kind).is('retired_at', null).order('id'),
  );
  return rows.map(blunderFromJson);
}

/**
 * Every live (not retired) trainable position of every kind, newest first —
 * the Vault's position lists (blunders, mastered).
 */
export async function getAllLiveBlunders(): Promise<Blunder[]> {
  const rows = await fetchAllRows(() =>
    supabase.from('blunders').select().is('retired_at', null).order('created_at', { ascending: false }).order('id'),
  );
  return rows.map(blunderFromJson);
}

/**
 * Specific drills for an on-demand session ("Drill these 5", "Train"),
 * whether or not they are due, in the canonical queue order. Drilling one
 * early still goes through the normal SR rules.
 */
export async function getBlundersByIds(ids: string[]): Promise<Blunder[]> {
  const rows = await fetchInChunks(ids, async (chunk) => {
    const { data, error } = await supabase.from('blunders').select().in('id', chunk).is('retired_at', null);
    if (error) throw error;
    return data ?? [];
  });
  return sortDueQueue(rows.map(blunderFromJson));
}

export async function getDueTomorrowCount(opts?: { userId?: string }): Promise<number> {
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startOfDayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  let q = supabase
    .from('blunders')
    .select('*', { count: 'exact', head: true })
    .gte('next_drill_at', startOfTomorrow.toISOString())
    .lt('next_drill_at', startOfDayAfter.toISOString());
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function appendCorrectMove(
  blunderId: string,
  updatedMoves: CorrectMove[],
): Promise<void> {
  const { error } = await supabase
    .from('blunders')
    .update({ correct_moves: toJson(updatedMoves) })
    .eq('id', blunderId);
  if (error) throw error;
}

export async function updateBlunderAfterDrill(blunder: Blunder): Promise<void> {
  const next = nextDrillDate(blunder);
  const { error } = await supabase
    .from('blunders')
    .update({
      cycle_number: blunder.cycleNumber,
      last_drilled_at: new Date().toISOString(),
      next_drill_at: next.toISOString(),
      times_correct: blunder.timesCorrect,
      times_attempted: blunder.timesAttempted,
      last_drill_failed: blunder.lastDrillFailed,
    })
    .eq('id', blunder.id);
  if (error) throw error;
}

/** Candidate pool for the endgame scan: the user's endgame-phase analysis blunders. */
export async function getEndgameCandidateBlunders(): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await fetchAllRows(() =>
    supabase
      .from('blunders')
      .select()
      .eq('user_id', userId)
      .eq('kind', 'tactic')
      .eq('phase', 'endgame')
      // Rows the deeper pass retired weren't real blunders — don't seed
      // scenarios from them.
      .is('retired_at', null)
      .order('move_number')
      .order('id'),
  );
  return rows.map(blunderFromJson);
}

/** Persist backfilled enrichment (engine line + motif tags) on a blunder row. */
export async function updateBlunderEnrichment(
  id: string,
  enrichment: {
    solution_line: Record<string, unknown>;
    motifs: string[];
    analysis_depth?: number | null;
    deepened_at?: string;
  },
): Promise<void> {
  const update = { ...enrichment, solution_line: toJson(enrichment.solution_line) };
  const { error } = await supabase.from('blunders').update(update).eq('id', id);
  if (error) throw error;
}

/**
 * Persist a background deepening pass: rewritten evals/PV/motifs plus the
 * deepening metadata. Always an UPDATE — `insertBlunders` upserts with
 * ignoreDuplicates, so a re-insert of the same (user, fen, kind) is a no-op.
 */
export async function updateBlunderDeepening(
  id: string,
  patch: {
    eval_before: number;
    eval_after: number;
    eval_swing: number;
    correct_moves: CorrectMove[];
    solution_line: Record<string, unknown>;
    motifs: string[];
    analysis_depth: number | null;
    deepened_at: string;
    retired_at: string | null;
  },
): Promise<void> {
  const update = {
    ...patch,
    correct_moves: toJson(patch.correct_moves),
    solution_line: toJson(patch.solution_line),
  };
  const { error } = await supabase.from('blunders').update(update).eq('id', id);
  if (error) throw error;
}

export async function countBlundersForDeepening(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('blunders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('kind', ['tactic', 'endgame'])
    .not('solution_line', 'is', null)
    .is('deepened_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Rows awaiting their timed background re-analysis, shallowest first. */
export async function getBlundersForDeepening(opts: { limit: number }): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('blunders')
    .select()
    .eq('user_id', userId)
    .in('kind', ['tactic', 'endgame'])
    .not('solution_line', 'is', null)
    .is('deepened_at', null)
    .order('analysis_depth', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
  return (data ?? []).map(blunderFromJson);
}

export async function countUnenrichedBlunders(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('blunders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', 'tactic')
    .is('solution_line', null);
  if (error) throw error;
  return count ?? 0;
}

export async function getUnenrichedBlunders(opts: { limit: number }): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('blunders')
    .select()
    .eq('user_id', userId)
    .eq('kind', 'tactic')
    .is('solution_line', null)
    .order('created_at', { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
  return (data ?? []).map(blunderFromJson);
}

// Opening items are deduped across every game that reaches the same position
// but keep only one game_id, so re-analyzing that one game must not wipe an
// item (and its SR progress) the other games share.
export async function deleteBlundersForGame(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('blunders')
    .delete()
    .eq('game_id', gameId)
    .neq('kind', 'opening');
  if (error) throw error;
}

export async function deleteBlunder(blunderId: string): Promise<number> {
  // `.select()` returns the rows actually deleted. A row-level policy that
  // blocks the delete removes 0 rows WITHOUT raising an error, so callers must
  // check the returned count to know the delete really happened.
  const { data, error } = await supabase
    .from('blunders')
    .delete()
    .eq('id', blunderId)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}
