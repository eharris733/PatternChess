import { useMemo } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBlunderStats } from './useBlunderStats';
import { useGames } from './useGames';
import { ratingProgressFromGames } from './useRatingProgress';
import {
  AchievementMetrics,
  EMPTY_METRICS,
  evaluateAchievements,
  type EvaluatedAchievement,
} from '../lib/achievements';

/**
 * Assembles the shared achievement metric bundle from the stats the app already
 * loads (blunder stats, vault games, profile streaks + rating history) and
 * evaluates every achievement against it.
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

  // Stable key for the preferred-time-controls array so the memo below doesn't
  // re-run on every render (arrays are referentially unstable).
  const prefKey = [...(profile?.preferredTimeControls ?? [])].sort().join(',');

  const metrics = useMemo<AchievementMetrics>(() => {
    const stats = statsQuery.data;
    const games = gamesQuery.data;
    if (!stats) return EMPTY_METRICS;

    // Best net rating gain across any (time-control × platform) series since the
    // user joined — reuses the dashboard's rating-progress computation.
    let ratingGained = 0;
    if (games) {
      const progress = ratingProgressFromGames(games, {
        joinedAt: profile?.createdAt ?? null,
        preferredCategories: profile?.preferredTimeControls ?? [],
      });
      for (const cat of progress) {
        for (const series of cat.series) ratingGained = Math.max(ratingGained, series.delta);
      }
    }

    return {
      reviewed: stats.reviewed,
      mastered: stats.mastered,
      totalBlunders: stats.totalBlunders,
      gamesAnalyzed: games?.length ?? 0,
      currentStreakDays: profile?.currentStreakDays ?? 0,
      longestStreakDays: profile?.longestStreakDays ?? 0,
      connectedLichess: profile?.lichessUsername ? 1 : 0,
      connectedChesscom: profile?.chesscomUsername ? 1 : 0,
      ratingGained,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    statsQuery.data,
    gamesQuery.data,
    profile?.currentStreakDays,
    profile?.longestStreakDays,
    profile?.lichessUsername,
    profile?.chesscomUsername,
    profile?.createdAt,
    prefKey,
  ]);

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
