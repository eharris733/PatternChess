import { rpc } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';

// The dashboard's stats functions (stats.ts) each used to page through the
// whole blunders/games table for a different handful of columns — ~9 blunder
// scans and 4 game scans per cold load. They now derive from one narrow fetch
// per table, cached in TanStack Query so concurrent callers share a single
// request. The keys sit under ['blunders'] / ['games'], so the existing
// invalidations (sync, drills, deletes) refresh them with everything else.

export interface BlunderStatRow {
  id: string;
  kind: string | null;
  phase: string | null;
  game_id: string | null;
  eval_before: number | null;
  move_number: number;
  side_to_move: string;
  cycle_number: number | null;
  times_correct: number | null;
  times_attempted: number | null;
  last_drilled_at: string | null;
  last_drill_failed: boolean | null;
}

export interface GameStatRow {
  id: string;
  opening_family: string | null;
  opening_name: string | null;
  eco: string | null;
  user_color: string | null;
  result: string | null;
  platform: string | null;
  time_control: string | null;
  clock_per_ply: unknown;
  rated: boolean | null;
  user_rating: number | null;
}

// Explicit so a fresh cache entry is reused by every card mounting in the same
// load; invalidation marks it stale regardless.
const STAT_ROWS_STALE_MS = 2 * 60_000;

// Server page size cap (functions/_shared/rpc/profile.ts STAT_ROWS_PAGE_MAX).
const STAT_ROWS_PAGE = 5000;

/** Keyset-paged read (by id) until a short page: the server scopes to the session user. */
async function fetchAllStatRows<T extends { id: string }>(name: 'stats.blunderRows' | 'stats.gameRows'): Promise<T[]> {
  const out: T[] = [];
  let afterId = '';
  for (;;) {
    const page = (await rpc<T[]>(name, { afterId, limit: STAT_ROWS_PAGE })) ?? [];
    out.push(...page);
    if (page.length < STAT_ROWS_PAGE) return out;
    afterId = page[page.length - 1].id;
  }
}

/** Every blunder row (all kinds, retired included — stats count them) for the user. */
export function getBlunderStatRows(userId: string): Promise<BlunderStatRow[]> {
  return queryClient.fetchQuery({
    queryKey: ['blunders', 'statRows', userId],
    staleTime: STAT_ROWS_STALE_MS,
    queryFn: () => fetchAllStatRows<BlunderStatRow>('stats.blunderRows'),
  });
}

/** Every game row for the user, with the columns the stats need (incl. clocks). */
export function getGameStatRows(userId: string): Promise<GameStatRow[]> {
  return queryClient.fetchQuery({
    queryKey: ['games', 'statRows', userId],
    staleTime: STAT_ROWS_STALE_MS,
    queryFn: () => fetchAllStatRows<GameStatRow>('stats.gameRows'),
  });
}
