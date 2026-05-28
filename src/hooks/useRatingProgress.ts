import { useMemo } from 'react';
import { useGames } from './useGames';
import { useAuth } from '../auth/useAuth';
import type { GameRecord } from '../models/gameRecord';
import { categoryForTimeControl, type TimeControlCategory } from '../services/chessApiService';

export interface CategoryRatingProgress {
  category: TimeControlCategory;
  games: number;
  startRating: number;
  latestRating: number;
  delta: number;
  startDate: Date | null;
  latestDate: Date | null;
}

/**
 * Rating change from the earliest to the latest rated game in each time-control
 * category. Ratings across categories aren't comparable, so we never blend them.
 *
 * When `joinedAt` is given, only games played after the account was created
 * count — so a freshly onboarded user doesn't see a rating delta drawn from
 * their entire imported history before they've actually played anything new.
 */
export function ratingProgressFromGames(
  games: GameRecord[],
  joinedAt?: Date | null,
): CategoryRatingProgress[] {
  const joinedMs = joinedAt?.getTime() ?? null;
  const byCategory = new Map<TimeControlCategory, GameRecord[]>();
  for (const g of games) {
    if (!g.rated || typeof g.userRating !== 'number' || !g.playedAt) continue;
    if (joinedMs !== null && g.playedAt.getTime() < joinedMs) continue;
    const category = categoryForTimeControl(g.timeControl);
    if (!category) continue;
    const arr = byCategory.get(category) ?? [];
    arr.push(g);
    byCategory.set(category, arr);
  }

  const out: CategoryRatingProgress[] = [];
  for (const [category, arr] of byCategory) {
    if (arr.length < 2) continue; // need a start and a later point
    const sorted = [...arr].sort((a, b) => a.playedAt!.getTime() - b.playedAt!.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    out.push({
      category,
      games: arr.length,
      startRating: first.userRating!,
      latestRating: last.userRating!,
      delta: last.userRating! - first.userRating!,
      startDate: first.playedAt,
      latestDate: last.playedAt,
    });
  }
  out.sort((a, b) => b.games - a.games); // most-played first
  return out;
}

export function useRatingProgress() {
  const games = useGames();
  const { profile } = useAuth();
  const joinedAt = profile?.createdAt ?? null;
  const progress = useMemo(
    () => (games.data ? ratingProgressFromGames(games.data, joinedAt) : []),
    [games.data, joinedAt],
  );
  return { progress, isPending: games.isPending };
}
