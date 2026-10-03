import { useEffect, useMemo } from 'react';
import { useAuth } from '../auth/useAuth';
import { playSound } from '../lib/sounds';
import { useBlunderStats } from './useBlunderStats';
import { useGames } from './useGames';
import { useEndgameScenarios } from './useEndgameScenarios';
import { useBookDepthGames, useTrainingTotals } from './useTrainingTotals';
import { ratingProgressFromGames } from './useRatingProgress';
import { srBucket } from '../models/blunder';
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
  const scenariosQuery = useEndgameScenarios();
  const totalsQuery = useTrainingTotals();
  const bookDepthQuery = useBookDepthGames();

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

    const scenarios = scenariosQuery.data ?? [];
    const endgamesRescued = scenarios.filter((s) => s.status === 'passed').length;
    const endgamePlayouts = scenarios.reduce((n, s) => n + s.attempts, 0);
    const scenarioSolved = scenarios.reduce((n, s) => n + s.timesCorrect, 0);
    // Scenarios have no recall floor (a play-out is pass/fail): mastered =
    // through the whole ladder, i.e. srBucket(s) === 'mastered'.
    const scenarioMastered = scenarios.filter((s) => srBucket(s) === 'mastered').length;

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
      endgamesRescued,
      usedTrainingFilter: profile?.usedTrainingFilter ? 1 : 0,
      followedInstagram: profile?.followedInstagram ? 1 : 0,
      sharesCount: profile?.sharesCount ?? 0,
      referralsCount: profile?.referralsCount ?? 0,
      minutesTrained: totalsQuery.data?.minutes ?? 0,
      activeDays: totalsQuery.data?.activeDays ?? 0,
      openingReviewsOpened: profile?.openingReviewsOpened ?? 0,
      openingSolved: stats.openingSolved,
      openingMastered: stats.openingMastered,
      bookDepthGames: bookDepthQuery.data ?? 0,
      learnChapters: profile?.learnChaptersDone.length ?? 0,
      endgamePlayouts,
      endgameSolved: scenarioSolved + stats.endgameSolved,
      endgameMastered: scenarioMastered + stats.endgameMastered,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    statsQuery.data,
    gamesQuery.data,
    scenariosQuery.data,
    totalsQuery.data,
    bookDepthQuery.data,
    profile?.openingReviewsOpened,
    profile?.learnChaptersDone,
    profile?.currentStreakDays,
    profile?.longestStreakDays,
    profile?.lichessUsername,
    profile?.chesscomUsername,
    profile?.createdAt,
    profile?.usedTrainingFilter,
    profile?.followedInstagram,
    profile?.sharesCount,
    profile?.referralsCount,
    prefKey,
  ]);

  const achievements = useMemo(() => evaluateAchievements(metrics), [metrics]);
  const earned = achievements.filter((a) => a.earned).length;

  // Unlock cue: achievements are derived, not stored, so remember which ids
  // this browser has already seen earned and chime for anything new. The
  // first evaluation for a user just seeds the set (no fanfare for history).
  // The set only grows, so a metric that loads late (or a query that fails)
  // can't make an old unlock chime again on the next visit.
  const earnedKey = achievements
    .filter((a) => a.earned)
    .map((a) => a.id)
    .join(',');
  useEffect(() => {
    if (!profile?.id || statsQuery.isPending || totalsQuery.isPending || bookDepthQuery.isPending) return;
    const storageKey = `pc:ach-seen:${profile.id}`;
    let seen: string[] | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      seen = raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      seen = null;
    }
    const now = earnedKey ? earnedKey.split(',') : [];
    if (seen !== null && now.some((id) => !seen!.includes(id))) playSound('achievement');
    try {
      localStorage.setItem(storageKey, JSON.stringify([...new Set([...(seen ?? []), ...now])]));
    } catch {
      /* private mode etc. */
    }
  }, [earnedKey, profile?.id, statsQuery.isPending, totalsQuery.isPending, bookDepthQuery.isPending]);

  return {
    metrics,
    achievements,
    earned,
    total: achievements.length,
    isPending: statsQuery.isPending,
  };
}
