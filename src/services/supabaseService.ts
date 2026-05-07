import { supabase } from '../lib/supabase';
import { Blunder, blunderFromJson, CorrectMove, nextDrillDate } from '../models/blunder';
import { GameRecord, gameRecordFromJson } from '../models/gameRecord';
import {
  GameAnnotation,
  gameAnnotationFromJson,
  MoveAnnotation,
  moveAnnotationToJson,
} from '../models/gameAnnotation';

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// --- Games ---

export async function insertGames(
  games: Array<Record<string, unknown>>,
): Promise<GameRecord[]> {
  const userId = await currentUserId();
  const enriched = userId ? games.map((g) => ({ ...g, user_id: userId })) : games;
  const { data, error } = await supabase.from('games').insert(enriched).select();
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
}

export async function getGames(opts?: { userId?: string }): Promise<GameRecord[]> {
  let q = supabase.from('games').select();
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { data, error } = await q.order('played_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
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

// --- Blunders ---

export async function insertBlunders(blunders: Array<Record<string, unknown>>): Promise<void> {
  if (blunders.length === 0) return;
  const userId = await currentUserId();
  const enriched = userId ? blunders.map((b) => ({ ...b, user_id: userId })) : blunders;
  const { error } = await supabase.from('blunders').insert(enriched);
  if (error) throw error;
}

export async function getBlundersForGames(gameIds: string[]): Promise<Blunder[]> {
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from('blunders')
    .select()
    .in('game_id', gameIds)
    .order('move_number');
  if (error) throw error;
  return (data ?? []).map(blunderFromJson);
}

export async function getDueBlunders(opts?: { userId?: string }): Promise<Blunder[]> {
  const now = new Date().toISOString();
  let q = supabase.from('blunders').select().lte('next_drill_at', now);
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { data, error } = await q.order('next_drill_at');
  if (error) throw error;
  return (data ?? []).map(blunderFromJson);
}

export async function appendCorrectMove(
  blunderId: string,
  updatedMoves: CorrectMove[],
): Promise<void> {
  const { error } = await supabase
    .from('blunders')
    .update({ correct_moves: updatedMoves })
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
    })
    .eq('id', blunder.id);
  if (error) throw error;
}

// --- Game Annotations ---

export async function getAnnotations(gameId: string): Promise<GameAnnotation | null> {
  const { data, error } = await supabase
    .from('game_annotations')
    .select()
    .eq('game_id', gameId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return gameAnnotationFromJson(data);
}

export async function saveAnnotations(
  gameId: string,
  annotations: MoveAnnotation[],
): Promise<void> {
  const userId = await currentUserId();
  const payload = {
    game_id: gameId,
    user_id: userId,
    annotations: annotations.map(moveAnnotationToJson),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('game_annotations')
    .upsert(payload, { onConflict: 'game_id' });
  if (error) throw error;
}

export async function getUnanalyzedGameIds(opts: {
  platform: string;
  username: string;
}): Promise<string[]> {
  const userId = await currentUserId();
  let q = supabase
    .from('games')
    .select('id')
    .eq('platform', opts.platform)
    .eq('username', opts.username)
    .is('analyzed_at', null);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => (row as { id: string }).id);
}

export async function deleteBlundersForGame(gameId: string): Promise<void> {
  const { error } = await supabase.from('blunders').delete().eq('game_id', gameId);
  if (error) throw error;
}

export async function resetGameAnalyzed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ analyzed_at: null })
    .eq('id', gameId);
  if (error) throw error;
}

export async function getExistingGameKeys(
  platform: string,
  username: string,
): Promise<Set<string>> {
  const userId = await currentUserId();
  let q = supabase
    .from('games')
    .select('platform, username, opponent, played_at')
    .eq('platform', platform)
    .eq('username', username);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const r = row as {
      platform: string;
      username: string;
      opponent: string;
      played_at: string | null;
    };
    keys.add(`${r.platform}|${r.username}|${r.opponent}|${r.played_at ?? ''}`);
  }
  return keys;
}

export async function updateProfileLastSynced(
  platform: 'lichess' | 'chess.com',
  ts: Date,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const column = platform === 'lichess' ? 'last_synced_lichess_at' : 'last_synced_chesscom_at';
  const { error } = await supabase
    .from('profiles')
    .update({ [column]: ts.toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// --- Opening Explorer Cache ---

export async function getCachedExplorerResult(fen: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('opening_explorer_cache')
    .select()
    .eq('fen', fen)
    .maybeSingle();
  if (error) return null;
  return (data?.result as any) ?? null;
}

export async function cacheExplorerResult(fen: string, result: any): Promise<void> {
  await supabase.from('opening_explorer_cache').upsert({ fen, result });
}

export const supabaseService = {
  insertGames,
  getGames,
  getGame,
  markGameAnalyzed,
  insertBlunders,
  getBlundersForGames,
  getDueBlunders,
  appendCorrectMove,
  updateBlunderAfterDrill,
  getAnnotations,
  saveAnnotations,
  getCachedExplorerResult,
  cacheExplorerResult,
  getExistingGameKeys,
  getUnanalyzedGameIds,
  deleteBlundersForGame,
  resetGameAnalyzed,
  updateProfileLastSynced,
};
