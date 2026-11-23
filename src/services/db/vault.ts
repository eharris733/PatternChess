import { rpc } from '../../lib/api';

/** What a Vault export needs to link a position back to its game on the site. */
export interface GameLink {
  gameId: string;
  platform: string;
  externalGameId: string;
  timeControl: string | null;
}

interface GameLinkRow {
  id: string;
  platform: string;
  external_game_id: string;
  time_control: string | null;
}

/** Site game ids for the given games (the caller's only), keyed by game id. */
export async function getGameLinks(gameIds: readonly string[]): Promise<Map<string, GameLink>> {
  const ids = [...new Set(gameIds)];
  if (ids.length === 0) return new Map();
  const rows = (await rpc<GameLinkRow[] | null>('vault.gameLinks', { ids })) ?? [];
  return new Map(
    rows.map((r) => [
      r.id,
      { gameId: r.id, platform: r.platform, externalGameId: r.external_game_id, timeControl: r.time_control },
    ]),
  );
}
