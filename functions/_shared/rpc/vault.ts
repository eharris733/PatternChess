import { argStringArray, userRpc, type RpcRegistry } from './core';
import { selectIn } from './training';

/**
 * Vault export: the few game fields an exported position needs that the
 * games list leaves out (the site's game id, for a link back to the game).
 * Only the caller's games come back; unknown or foreign ids are skipped.
 */

export interface GameLinkRow {
  id: string;
  platform: string;
  external_game_id: string;
  time_control: string | null;
}

/** At most this many ids per call (the Vault exports one filtered set at a time). */
export const MAX_LINK_IDS = 5000;

type Args = Record<string, unknown>;

export const handlers: RpcRegistry = {
  /** getGameLinks: platform + site game id for the given games. */
  'vault.gameLinks': userRpc<Args>(async (ctx, args) =>
    selectIn<GameLinkRow>(
      ctx.db,
      argStringArray(args, 'ids', MAX_LINK_IDS),
      (ph) =>
        `SELECT id, platform, external_game_id, time_control FROM games WHERE user_id = ? AND id IN (${ph})`,
      [ctx.user.id],
    ),
  ),
};
