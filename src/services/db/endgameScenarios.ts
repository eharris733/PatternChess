import { supabase } from '../../lib/supabase';
import type { TablesInsert } from '../../lib/database.types';
import { EndgameScenario, endgameScenarioFromJson, ScenarioStatus } from '../../models/endgameScenario';
import { currentUserId } from './currentUser';

export async function getEndgameScenarios(): Promise<EndgameScenario[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('endgame_scenarios')
    .select()
    .eq('user_id', userId)
    .is('retired_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(endgameScenarioFromJson);
}

/** Scenarios the deep re-check hasn't looked at yet (oldest first). */
export async function getUnverifiedEndgameScenarios(opts: {
  limit: number;
}): Promise<EndgameScenario[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('endgame_scenarios')
    .select()
    .eq('user_id', userId)
    .is('verified_at', null)
    .is('retired_at', null)
    .order('created_at', { ascending: true })
    .limit(opts.limit);
  if (error) throw error;
  return (data ?? []).map(endgameScenarioFromJson);
}

export async function countUnverifiedEndgameScenarios(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('endgame_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('verified_at', null)
    .is('retired_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markEndgameScenarioVerified(
  id: string,
  result: { verifyEvalCp: number; retired: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('endgame_scenarios')
    .update({
      verified_at: now,
      verify_eval_cp: result.verifyEvalCp,
      retired_at: result.retired ? now : null,
    })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Idempotent scan write: one scenario per game, first write wins so
 * status/attempts survive re-scans.
 */
export async function upsertEndgameScenarios(
  rows: Omit<TablesInsert<'endgame_scenarios'>, 'user_id'>[],
): Promise<void> {
  if (rows.length === 0) return;
  const userId = await currentUserId();
  if (!userId) return; // scenarios are owner-scoped — nothing to persist without one
  const enriched: TablesInsert<'endgame_scenarios'>[] = rows.map((r) => ({ ...r, user_id: userId }));
  const { error } = await supabase
    .from('endgame_scenarios')
    .upsert(enriched, { onConflict: 'user_id,game_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function updateEndgameScenarioResult(
  id: string,
  update: { status: ScenarioStatus; attempts: number },
): Promise<void> {
  const { error } = await supabase
    .from('endgame_scenarios')
    .update({
      status: update.status,
      attempts: update.attempts,
      last_played_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}
