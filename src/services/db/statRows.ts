import { supabase } from '../../lib/supabase';
import { queryClient } from '../../lib/queryClient';
import { fetchAllRows } from './paginate';

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
}

// Explicit so a fresh cache entry is reused by every card mounting in the same
// load; invalidation marks it stale regardless.
const STAT_ROWS_STALE_MS = 2 * 60_000;

const BLUNDER_STAT_COLUMNS =
  'id, kind, phase, game_id, eval_before, move_number, side_to_move, cycle_number, times_correct, times_attempted, last_drilled_at, last_drill_failed';

const GAME_STAT_COLUMNS =
  'id, opening_family, opening_name, eco, user_color, result, platform, time_control, clock_per_ply';

/** Every blunder row (all kinds, retired included — stats count them) for the user. */
export function getBlunderStatRows(userId: string): Promise<BlunderStatRow[]> {
  return queryClient.fetchQuery({
    queryKey: ['blunders', 'statRows', userId],
    staleTime: STAT_ROWS_STALE_MS,
    queryFn: () =>
      fetchAllRows(() =>
        supabase.from('blunders').select(BLUNDER_STAT_COLUMNS).eq('user_id', userId).order('id'),
      ) as Promise<BlunderStatRow[]>,
  });
}

/** Every game row for the user, with the columns the stats need (incl. clocks). */
export function getGameStatRows(userId: string): Promise<GameStatRow[]> {
  return queryClient.fetchQuery({
    queryKey: ['games', 'statRows', userId],
    staleTime: STAT_ROWS_STALE_MS,
    queryFn: () =>
      fetchAllRows(() =>
        supabase.from('games').select(GAME_STAT_COLUMNS).eq('user_id', userId).order('id'),
      ) as Promise<GameStatRow[]>,
  });
}
