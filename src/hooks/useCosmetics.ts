import { useCallback, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useRewardState } from './useRewardState';
import { useThemeStore } from '../state/themeStore';
import { usePieceSetStore } from '../state/pieceSetStore';
import { ACHIEVEMENTS } from '../lib/achievements';
import { itemAvailable, rewardsFor, unlockHint, type RewardItem } from '../lib/rewards';
import { resolveAvatar, type AvatarParts } from '../lib/avatar';
import type { BoardTheme } from '../lib/themeIds';
import type { PieceSet } from '../lib/pieceSets';
import { updateCosmetics } from '../services/db/cosmetics';

const achievementTitle = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? null;

/**
 * The one place cosmetics are picked: theme, piece set and avatar, each
 * applied at once (stores + document) and saved to the profile in the
 * background. `lockHint(item)` says what unlocks a reward item (null =
 * available); the current pick is never shown as locked.
 */
export function useCosmetics() {
  const { profile, refreshProfile } = useAuth();
  const rewards = useRewardState();
  const theme = useThemeStore((s) => s.theme);
  const setStoreTheme = useThemeStore((s) => s.setTheme);
  const pieceSet = usePieceSetStore((s) => s.pieceSet);
  const setStorePieceSet = usePieceSetStore((s) => s.setPieceSet);
  const [error, setError] = useState<string | null>(null);
  const avatar = resolveAvatar(profile?.avatar ?? null, profile?.id ?? 'player');

  const lockHint = useCallback(
    (item: RewardItem): string | null => {
      if (rewardsFor(item).length === 0) return null;
      if (rewards.ready && itemAvailable(item, rewards)) return null;
      return unlockHint(item, achievementTitle);
    },
    [rewards],
  );

  const save = useCallback(
    (patch: Parameters<typeof updateCosmetics>[0], what: string) => {
      if (!profile) return Promise.resolve();
      setError(null);
      return updateCosmetics(patch)
        .then(() => refreshProfile())
        .catch((err) => {
          console.warn(`[profile] save ${what} failed`, err);
          setError(`Couldn't save your ${what}. Try again.`);
        });
    },
    [profile, refreshProfile],
  );

  const pickTheme = useCallback(
    (next: BoardTheme) => {
      setStoreTheme(next);
      if (profile && profile.boardTheme !== next) void save({ theme: next }, 'theme');
    },
    [profile, save, setStoreTheme],
  );

  const pickPieceSet = useCallback(
    (next: PieceSet) => {
      setStorePieceSet(next);
      if (profile && profile.pieceSet !== next) void save({ pieceSet: next }, 'pieces');
    },
    [profile, save, setStorePieceSet],
  );

  const saveAvatar = useCallback((next: AvatarParts | null) => save({ avatar: next }, 'avatar'), [save]);

  return { theme, pieceSet, avatar, rewards, lockHint, pickTheme, pickPieceSet, saveAvatar, error };
}
