import { supabase } from '../../lib/supabase';

export type LeaderboardMetric = 'solved' | 'mastered' | 'openings' | 'endgames' | 'elo' | 'streak';
export type LeaderboardWindow = 'all' | 'week';

export interface LeaderboardRow {
  rank: number;
  /** Public handle: lichess → chess.com → display name → "Player". Never an email or id. */
  label: string;
  value: number;
  isMe: boolean;
  /** Chosen flair id (src/lib/flair.ts); null when none. Unknown ids render nothing. */
  flair: string | null;
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
    flair: typeof j.flair === 'string' && j.flair ? j.flair : null,
  };
}

/**
 * `leaderboard` RPC (security definer, migrations 20260915140000 + 20260927120000 for flair): top-N
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

export interface PublicLeaderboardRow {
  rank: number;
  /** Chess handle (lichess → chess.com) or "Player". Never a display name, email or id. */
  label: string;
  value: number;
  flair: string | null;
}

export interface PublicLeaderboard {
  /** Start of the rolling 7-day window (ISO). */
  since: string | null;
  computedAt: string;
  rows: PublicLeaderboardRow[];
}

export function publicLeaderboardFromJson(j: any): PublicLeaderboard {
  return {
    since: typeof j?.since === 'string' ? j.since : null,
    computedAt: String(j?.computedAt ?? ''),
    rows: Array.isArray(j?.rows)
      ? j.rows.map((r: any) => ({
          rank: Number(r.rank ?? 0),
          label: String(r.label ?? 'Player'),
          value: Number(r.value ?? 0),
          flair: typeof r.flair === 'string' && r.flair ? r.flair : null,
        }))
      : [],
  };
}

/**
 * `public_leaderboard` RPC (anon-callable, migration 20261010150000): top 5 by
 * positions solved over the last 7 days for the landing page. Server-cached
 * for an hour; opted-out users are excluded.
 */
export async function getPublicLeaderboard(): Promise<PublicLeaderboard> {
  const { data, error } = await supabase.rpc('public_leaderboard');
  if (error) throw error;
  return publicLeaderboardFromJson(data);
}
