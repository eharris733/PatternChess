import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { getAchievementRarity } from '../services/db/achievements';

/** "12% of players" per achievement (empty while the sample is too small to mean anything). */
export function useAchievementRarity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['achievementRarity'],
    queryFn: getAchievementRarity,
    enabled: !!user,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/** Below this share an earned achievement is called rare. */
export const RARE_PCT = 5;

/** "12% of players", "<1% of players"; null when unknown. */
export function rarityLabel(pct: number | undefined): string | null {
  if (pct == null) return null;
  if (pct < 1) return '<1% of players';
  return `${pct >= 10 ? Math.round(pct) : pct}% of players`;
}
