import { supabase } from '../../lib/supabase';
import { fetchInChunks } from '../../services/db/paginate';
import { GameRecord, gameRecordFromJson } from '../../models/gameRecord';
import { Blunder } from '../../models/blunder';
import { ContextFilter, GAME_STATE_LABEL, computeBlunderContext } from '../../chess/blunderContext';

/** Fetch the given games by id into a lookup map (used for batch context/opening filtering). */
export async function fetchGamesByIds(ids: string[]): Promise<Map<string, GameRecord>> {
  if (ids.length === 0) return new Map();
  // Chunked: the due queue can span far more games than fit in one URL.
  const rows = await fetchInChunks([...new Set(ids)], async (chunk) => {
    const { data, error } = await supabase.from('games').select().in('id', chunk);
    if (error) throw error;
    return data ?? [];
  });
  const map = new Map<string, GameRecord>();
  for (const row of rows) {
    const g = gameRecordFromJson(row);
    map.set(g.id, g);
  }
  return map;
}

/** Narrow a blunder list to those matching a game-state / time context filter. */
export function applyContextFilter(
  blunders: Blunder[],
  games: Map<string, GameRecord>,
  filter: ContextFilter,
): Blunder[] {
  return blunders.filter((b) => {
    const ctx = computeBlunderContext(b, (b.gameId ? games.get(b.gameId) : null) ?? null);
    if (filter === 'timeTrouble') return ctx.inTimeTrouble;
    if (filter === 'longThink') return ctx.isLongThink;
    return ctx.gameState === filter;
  });
}

/** Human label for a context filter (time buckets + game-state labels). */
export function filterLabel(filter: ContextFilter): string {
  if (filter === 'timeTrouble') return 'Time trouble';
  if (filter === 'longThink') return 'Long think';
  return GAME_STATE_LABEL[filter];
}
