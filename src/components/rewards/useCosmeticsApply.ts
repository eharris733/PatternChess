import { useCallback } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useThemeStore } from '../../state/themeStore';
import { usePieceSetStore } from '../../state/pieceSetStore';
import { resolveAvatar } from '../../lib/avatar';
import type { RewardItem } from '../../lib/rewards';
import { updateCosmetics } from '../../services/db/cosmetics';

/** "Use it now" from the reward reveal: puts the item on (theme, pieces, or onto your avatar) and saves it. */
export function useCosmeticsApply() {
  const { profile, refreshProfile } = useAuth();
  return useCallback(
    (item: RewardItem) => {
      if (!profile) return;
      let patch: Parameters<typeof updateCosmetics>[0] | null = null;
      if (item.kind === 'theme') {
        useThemeStore.getState().setTheme(item.id);
        patch = { theme: item.id };
      } else if (item.kind === 'pieceSet') {
        usePieceSetStore.getState().setPieceSet(item.id);
        patch = { pieceSet: item.id };
      } else if (item.kind === 'avatar') {
        patch = { avatar: { ...resolveAvatar(profile.avatar, profile.id), [item.part]: item.id } };
      }
      if (!patch) return;
      void updateCosmetics(patch)
        .then(() => refreshProfile())
        .catch((err) => console.warn('[rewards] apply failed', err));
    },
    [profile, refreshProfile],
  );
}
