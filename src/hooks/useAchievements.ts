import { useMemo } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBlunderStats } from './useBlunderStats';
import { useGames } from './useGames';
import {
  AchievementMetrics,
  EMPTY_METRICS,
  evaluateAchievements,
  type EvaluatedAchievement,
} from '../lib/achievements';

/**
 * Assembles the shared achievement metric bundle from the stats the app
 * already loads (blunder stats, vault games, profile streaks) and evaluates
 * every achievement against it.
 */
export function useAchievements(): {
  metrics: AchievementMetrics;
  achievements: EvaluatedAchievement[];
  earned: number;
  total: number;
  isPending: boolean;
} {
  const { profile } = useAuth();
  const statsQuery = useBlunderStats();
  const gamesQuery = useGames();

  const metrics = useMemo<AchievementMetrics>(() => {
    const stats = statsQuery.data;
    const games = gamesQuery.data;
    if (!stats) return EMPTY_METRICS;
    return {
      reviewed: stats.reviewed,
      mastered: stats.mastered,
      totalBlunders: stats.totalBlunders,
      gamesAnalyzed: games?.length ?? 0,
      currentStreakDays: profile?.currentStreakDays ?? 0,
      longestStreakDays: profile?.longestStreakDays ?? 0,
    };
  }, [statsQuery.data, gamesQuery.data, profile?.currentStreakDays, profile?.longestStreakDays]);

  const achievements = useMemo(() => evaluateAchievements(metrics), [metrics]);
  const earned = achievements.filter((a) => a.earned).length;

  return {
    metrics,
    achievements,
    earned,
    total: achievements.length,
    isPending: statsQuery.isPending,
  };
}
