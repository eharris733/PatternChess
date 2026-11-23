import { useMemo } from 'react';
import { useAchievements } from './useAchievements';
import { usePathProgress } from './usePathProgress';
import type { RewardState } from '../lib/rewards';

/**
 * Inputs for src/lib/rewards.ts: positions trained (the /path metric),
 * earned achievements and supporter perks. `ready` is false until all three
 * have loaded, so nothing flashes as locked (or gets revealed) on stale data.
 */
/**
 * The rung-only half: no achievements (useAchievements loads the games list,
 * so screens that don't already have it use this and leave achievement
 * rewards for later). `achievementsKnown` is false.
 */
export function useRungRewardState(): RewardState & { ready: boolean; achievementsKnown: false } {
  const path = usePathProgress();
  const none = useMemo(() => new Set<string>(), []);
  return {
    trained: path.trained,
    achievements: none,
    isSupporter: path.isSupporter,
    ready: !path.isPending,
    achievementsKnown: false,
  };
}

export function useRewardState(): RewardState & { ready: boolean; achievementsKnown: true } {
  const path = usePathProgress();
  const { achievements, isPending } = useAchievements();
  const earnedKey = achievements
    .filter((a) => a.earned)
    .map((a) => a.id)
    .join(',');
  const earned = useMemo(() => new Set(earnedKey ? earnedKey.split(',') : []), [earnedKey]);
  return {
    trained: path.trained,
    achievements: earned,
    isSupporter: path.isSupporter,
    ready: !path.isPending && !isPending,
    achievementsKnown: true,
  };
}
