import { supabase } from '../../lib/supabase';

export type LeaderboardMetric = 'solved' | 'mastered' | 'elo' | 'streak';
export type LeaderboardWindow = 'all' | 'week';

export interface LeaderboardRow {
  rank: number;
  /** Public handle: lichess → chess.com → display name → "Player". Never an email or id. */
  label: string;
  value: number;
  isMe: boolean;
}

export interface Leaderboard {
  metric: LeaderboardMetric;
  window: LeaderboardWindow;
  /** Start of the window (ISO) for 'week'; null for all-time. */
  since: string | null;
  rows: LeaderboardRow[];
  /** The caller's own row (null when they have no score or opted out). */
  me: LeaderboardRow | null;
}

function rowFromJson(j: any): LeaderboardRow {
  return {
    rank: Number(j.rank ?? 0),
    label: String(j.label ?? 'Player'),
    value: Number(j.value ?? 0),
    isMe: Boolean(j.isMe),
  };
}

/**
 * `leaderboard` RPC (security definer, migration 20260915140000): top-N
 * plus the caller's own rank for one metric × window. Opted-out users are
 * excluded server-side.
 */
export async function getLeaderboard(
  metric: LeaderboardMetric,
  window: LeaderboardWindow,
  limit = 20,
): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc('leaderboard', { metric, win: window, limit_n: limit });
  if (error) throw error;
  const j = (data ?? {}) as any;
  return {
    metric,
    window,
    since: (j.since as string | null) ?? null,
    rows: Array.isArray(j.rows) ? j.rows.map(rowFromJson) : [],
    me: j.me ? rowFromJson(j.me) : null,
  };
}
