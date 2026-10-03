import { supabase } from '../../lib/supabase';
import type { TablesInsert, TablesUpdate } from '../../lib/database.types';
import { GameRecord, gameRecordFromJson } from '../../models/gameRecord';
import { currentUserId } from './currentUser';
import { fetchAllRows } from './paginate';

export async function insertGames(
  games: Omit<TablesInsert<'games'>, 'user_id'>[],
): Promise<GameRecord[]> {
  const userId = await currentUserId();
  const enriched = userId ? games.map((g) => ({ ...g, user_id: userId })) : games;
  // ON CONFLICT DO NOTHING on (user_id, platform, external_game_id): a second
  // tab / a racing trigger inserting the same game must not abort the whole
  // batch. `.select()` returns only the rows actually inserted, so callers'
  // "inserted" counts stay honest.
  const { data, error } = await supabase
    .from('games')
    .upsert(enriched, {
      onConflict: 'user_id,platform,external_game_id',
      ignoreDuplicates: true,
    })
    .select();
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
}

// Every column GameRecord needs EXCEPT the heavy `pgn` (full move text, ~1KB
// each) and `clock_per_ply` (per-move clock array). The games list/insights
// never render the PGN — replay fetches the single full row via getGame — so
// omitting them drops the list payload from ~1MB to tens of KB for active users.
const GAME_LIST_COLUMNS =
  'id, platform, username, opponent, time_control, rated, result, played_at, ' +
  'created_at, analyzed_at, eco, opening_name, opening_family, ' +
  'opening_classified_at, user_color, user_rating, ' +
  'opponent_rating, total_plies, parsed_metadata_at';

export async function getGames(opts?: { userId?: string }): Promise<GameRecord[]> {
  // Sort by played_at primarily, but break ties (and rank PGN uploads with
  // missing/old [Date] headers) by insertion time so freshly-imported games
  // always surface at the top of the vault. `id` keeps pages stable.
  const rows = await fetchAllRows(() => {
    let q = supabase.from('games').select(GAME_LIST_COLUMNS);
    if (opts?.userId) q = q.eq('user_id', opts.userId);
    return q
      .order('played_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false })
      .order('id');
  });
  return rows.map(gameRecordFromJson);
}

export async function getGame(id: string): Promise<GameRecord> {
  const { data, error } = await supabase.from('games').select().eq('id', id).single();
  if (error) throw error;
  return gameRecordFromJson(data);
}

export async function markGameAnalyzed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ analyzed_at: new Date().toISOString() })
    .eq('id', gameId);
  if (error) throw error;
}

export async function getUnanalyzedGameIds(opts: {
  platform: string;
  username: string;
}): Promise<string[]> {
  const userId = await currentUserId();
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('games')
      .select('id')
      .eq('platform', opts.platform)
      .eq('username', opts.username)
      .is('analyzed_at', null)
      .order('played_at', { ascending: false, nullsFirst: false })
      .order('id');
    if (userId) q = q.eq('user_id', userId);
    return q;
  });
  return rows.map((row) => (row as { id: string }).id);
}

/** User-wide unanalyzed-game count — the maintenance worker's sync guard. */
export async function countUnanalyzedGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('analyzed_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteGame(gameId: string): Promise<number> {
  // Blunders reference games; remove them first so the game row delete succeeds
  // even without an ON DELETE CASCADE on the FK.
  const { error: blundersError } = await supabase
    .from('blunders')
    .delete()
    .eq('game_id', gameId);
  if (blundersError) throw blundersError;
  // `.select()` lets the caller detect a 0-row delete (e.g. blocked by RLS),
  // which Supabase reports without an error.
  const { data, error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

export async function resetGameAnalyzed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ analyzed_at: null })
    .eq('id', gameId);
  if (error) throw error;
}

export async function getExistingExternalGameIds(
  platform: string,
): Promise<Set<string>> {
  const userId = await currentUserId();
  const ids = new Set<string>();
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('games')
      .select('external_game_id')
      .eq('platform', platform)
      .not('external_game_id', 'is', null)
      .order('id');
    if (userId) q = q.eq('user_id', userId);
    return q;
  });
  for (const row of rows) {
    const id = (row as { external_game_id: string | null }).external_game_id;
    if (id) ids.add(id);
  }
  return ids;
}

export async function getGameCount(
  platform: string,
  username: string,
): Promise<number> {
  const userId = await currentUserId();
  let q = supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('platform', platform)
    .eq('username', username);
  if (userId) q = q.eq('user_id', userId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function getTotalGameCount(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

export async function getUnparsedGames(opts?: { limit?: number }): Promise<GameRecord[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  let q = supabase
    .from('games')
    .select()
    .eq('user_id', userId)
    .is('parsed_metadata_at', null);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
}

export async function countUnparsedGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('parsed_metadata_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Games still needing position-based opening classification, oldest first. */
export async function getUnclassifiedOpeningGames(opts?: {
  limit?: number;
}): Promise<Array<{ id: string; pgn: string }>> {
  const userId = await currentUserId();
  if (!userId) return [];
  let q = supabase
    .from('games')
    .select('id, pgn')
    .eq('user_id', userId)
    .is('opening_classified_at', null)
    .order('id');
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; pgn: string }>;
}

export async function countUnclassifiedOpeningGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('opening_classified_at', null);
  if (error) throw error;
  return count ?? 0;
}

export interface GameOpeningPatch {
  id: string;
  /** NULL for games too short to classify — the row is still stamped as done. */
  eco: string | null;
  opening_name: string | null;
  opening_family: string | null;
}

/**
 * Write a batch of classified openings in one round trip (an active account has
 * thousands of games, so per-row PATCHes are far too slow). Returns the number
 * of rows the RPC actually updated.
 */
export async function applyGameOpenings(rows: GameOpeningPatch[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase.rpc('apply_game_openings', {
    p_rows: rows as unknown as TablesInsert<'games'>[] as never,
  });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

export async function updateGameMetadata(
  gameId: string,
  patch: {
    eco?: string | null;
    openingName?: string | null;
    userColor?: 'white' | 'black' | null;
    userRating?: number | null;
    opponentRating?: number | null;
    clockPerPly?: number[] | null;
    totalPlies?: number | null;
  },
): Promise<void> {
  const update: TablesUpdate<'games'> = {
    parsed_metadata_at: new Date().toISOString(),
  };
  if (patch.eco !== undefined) update.eco = patch.eco;
  if (patch.openingName !== undefined) update.opening_name = patch.openingName;
  if (patch.userColor !== undefined) update.user_color = patch.userColor;
  if (patch.userRating !== undefined) update.user_rating = patch.userRating;
  if (patch.opponentRating !== undefined) update.opponent_rating = patch.opponentRating;
  if (patch.clockPerPly !== undefined) update.clock_per_ply = patch.clockPerPly;
  if (patch.totalPlies !== undefined) update.total_plies = patch.totalPlies;
  const { error } = await supabase.from('games').update(update).eq('id', gameId);
  if (error) throw error;
}
