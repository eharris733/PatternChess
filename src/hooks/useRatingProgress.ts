import { useMemo } from 'react';
import { useGames } from './useGames';
import { useAuth } from '../auth/useAuth';
import type { GameRecord } from '../models/gameRecord';
import { categoryForTimeControl, type TimeControlCategory } from '../services/chessApiService';

export type RatingPlatform = 'lichess' | 'chess.com';

export interface RatingSeriesPoint {
  /** Time the rated game was played. */
  at: Date;
  rating: number;
}

export interface PlatformSeries {
  platform: RatingPlatform;
  points: RatingSeriesPoint[];
  startRating: number;
  latestRating: number;
  delta: number;
}

export interface CategoryRatingProgress {
  category: TimeControlCategory;
  series: PlatformSeries[];
  /** Total rated games across all platforms in this category, post-join. */
  games: number;
}

const PLATFORMS: RatingPlatform[] = ['lichess', 'chess.com'];
// Per platform-series — enough points to draw a meaningful line.
const MIN_POINTS_PER_SERIES = 3;

/**
 * Rating trajectory per (time-control category × platform). Filters:
 * - rated games only with a known user rating + played-at timestamp
 * - games played *after* `joinedAt` (so a freshly onboarded user doesn't see a
 *   trajectory drawn entirely from their pre-PatternChess history)
 * - categories the user has selected in their preferences (empty = all)
 *
 * Ratings across categories or platforms aren't comparable, so we never blend
 * them — each platform gets its own series within a category.
 */
export function ratingProgressFromGames(
  games: GameRecord[],
  opts: {
    joinedAt?: Date | null;
    preferredCategories?: TimeControlCategory[];
  } = {},
): CategoryRatingProgress[] {
  const joinedMs = opts.joinedAt?.getTime() ?? null;
  const allowedCategories = opts.preferredCategories?.length
    ? new Set(opts.preferredCategories)
    : null;

  // (category, platform) → points
  const buckets = new Map<string, RatingSeriesPoint[]>();
  const key = (c: TimeControlCategory, p: RatingPlatform) => `${c}|${p}`;

  for (const g of games) {
    if (!g.rated || typeof g.userRating !== 'number' || !g.playedAt) continue;
    if (joinedMs !== null && g.playedAt.getTime() < joinedMs) continue;
    if (g.platform !== 'lichess' && g.platform !== 'chess.com') continue;
    const category = categoryForTimeControl(g.timeControl);
    if (!category) continue;
    if (allowedCategories && !allowedCategories.has(category)) continue;
    const k = key(category, g.platform);
    const arr = buckets.get(k) ?? [];
    arr.push({ at: g.playedAt, rating: g.userRating });
    buckets.set(k, arr);
  }

  // Sort points chronologically inside each bucket.
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  // Group by category for output.
  const byCategory = new Map<TimeControlCategory, PlatformSeries[]>();
  for (const platform of PLATFORMS) {
    for (const category of [
      'bullet',
      'blitz',
      'rapid',
      'classical',
    ] as TimeControlCategory[]) {
      const arr = buckets.get(key(category, platform));
      if (!arr || arr.length < MIN_POINTS_PER_SERIES) continue;
      const start = arr[0].rating;
      const latest = arr[arr.length - 1].rating;
      const series: PlatformSeries = {
        platform,
        points: arr,
        startRating: start,
        latestRating: latest,
        delta: latest - start,
      };
      const list = byCategory.get(category) ?? [];
      list.push(series);
      byCategory.set(category, list);
    }
  }

  const out: CategoryRatingProgress[] = [];
  for (const [category, series] of byCategory) {
    const games = series.reduce((sum, s) => sum + s.points.length, 0);
    out.push({ category, series, games });
  }
  // Most-played category first.
  out.sort((a, b) => b.games - a.games);
  return out;
}

export function useRatingProgress() {
  const games = useGames();
  const { profile } = useAuth();
  const joinedAt = profile?.createdAt ?? null;
  const preferredCategories = profile?.preferredTimeControls ?? [];
  const prefKey = [...preferredCategories].sort().join(',');
  const progress = useMemo(
    () =>
      games.data
        ? ratingProgressFromGames(games.data, {
            joinedAt,
            preferredCategories,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games.data, joinedAt, prefKey],
  );
  return { progress, isPending: games.isPending };
}
