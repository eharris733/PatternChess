import { rpc } from '../../lib/api';
import type { Tables } from '../../lib/database.types';
import { GameRecord, gameRecordFromJson } from '../../models/gameRecord';
import { Blunder } from '../../models/blunder';
import { ContextFilter, GAME_STATE_LABEL, computeBlunderContext } from '../../chess/blunderContext';

/** Fetch the given games by id into a lookup map (used for batch context/opening filtering). */
export async function fetchGamesByIds(ids: string[]): Promise<Map<string, GameRecord>> {
  if (ids.length === 0) return new Map();
  // One request; the server splits the id list for D1's parameter limit.
  const rows = await rpc<Tables<'games'>[]>('games.byIds', { ids: [...new Set(ids)] });
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
