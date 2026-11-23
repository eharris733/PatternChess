import { rpc } from '../../lib/api';
import type { AvatarParts } from '../../lib/avatar';
import type { PieceSet } from '../../lib/pieceSets';
import { LEGACY_BOARD_THEMES, type BoardTheme } from '../../lib/themeIds';
import type { TablesUpdate } from '../../lib/database.types';

/**
 * Writes the player's cosmetics (migration 0005): the pixel avatar (null =
 * back to the generated default), piece set and theme. Unlocks are checked in
 * the client (src/lib/rewards.ts), like flair.
 */
export async function updateCosmetics(patch: {
  avatar?: AvatarParts | null;
  pieceSet?: PieceSet;
  theme?: BoardTheme;
}): Promise<void> {
  const row: TablesUpdate<'profiles'> = {};
  if (patch.avatar !== undefined) row.avatar = patch.avatar as TablesUpdate<'profiles'>['avatar'];
  // NULL = the default (cburnett), so a default pick leaves no column value behind.
  if (patch.pieceSet !== undefined) row.piece_set = patch.pieceSet === 'cburnett' ? null : patch.pieceSet;
  if (patch.theme !== undefined) {
    row.theme = patch.theme;
    if (LEGACY_BOARD_THEMES.includes(patch.theme)) row.board_theme = patch.theme;
  }
  if (Object.keys(row).length === 0) return;
  await rpc('profile.update', { patch: row });
}

export interface PathRewardClaim {
  granted: boolean;
  /** 'not_reached' (the server counts fewer positions) or 'already_claimed'. */
  reason: string | null;
  streakFreezes: number | null;
}

/** Banks a /path rung's streak freeze (once per rung; the server re-checks the rung). */
export async function claimPathReward(rung: number): Promise<PathRewardClaim> {
  const d = await rpc<PathRewardClaim>('profile.claimPathReward', { rung });
  return { granted: !!d?.granted, reason: d?.reason ?? null, streakFreezes: d?.streakFreezes ?? null };
}
