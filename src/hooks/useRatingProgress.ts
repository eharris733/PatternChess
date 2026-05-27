import { useMemo } from 'react';
import { useGames } from './useGames';
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
 */
export function ratingProgressFromGames(games: GameRecord[]): CategoryRatingProgress[] {
  const byCategory = new Map<TimeControlCategory, GameRecord[]>();
  for (const g of games) {
    if (!g.rated || typeof g.userRating !== 'number' || !g.playedAt) continue;
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
  const progress = useMemo(
    () => (games.data ? ratingProgressFromGames(games.data) : []),
    [games.data],
  );
  return { progress, isPending: games.isPending };
}
