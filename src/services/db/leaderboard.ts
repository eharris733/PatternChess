import { rpc } from '../../lib/api';
import { supporterBadgeFromJson, type SupporterBadge } from '../../components/SupporterMark';
import { sanitizeAvatar, type AvatarParts } from '../../lib/avatar';

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
  /** 'supporter' (active) or 'early' (lapsed), per supporterBadge() on the server; null otherwise. */
  supporter: SupporterBadge | null;
  /** Pixel avatar (theirs or the id-seeded default); null from an older server. */
  avatar: AvatarParts | null;
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
    supporter: supporterBadgeFromJson(j.supporter),
    avatar: sanitizeAvatar(j.avatar),
  };
}

/**
 * `leaderboard.get` RPC (functions/_shared/rpc/leaderboard.ts): top-N plus the
 * caller's own rank for one metric × window. Opted-out users are excluded
 * server-side.
 */
export async function getLeaderboard(
  metric: LeaderboardMetric,
  window: LeaderboardWindow,
  limit = 20,
): Promise<Leaderboard> {
  const j = ((await rpc('leaderboard.get', { metric, window, limit })) ?? {}) as any;
  return {
    metric,
    window,
    since: (j.since as string | null) ?? null,
    rows: Array.isArray(j.rows) ? j.rows.map(rowFromJson) : [],
    me: j.me ? rowFromJson(j.me) : null,
  };
}

export type RatingCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface PublicLeaderboardRow {
  rank: number;
  /** Chess handle (lichess → chess.com) or "Player". Never a display name, email or id. */
  label: string;
  /** Platform of `label`; null when the player has no handle. */
  platform: 'lichess' | 'chesscom' | null;
  /** Current rating on `platform` in their most-played time control; null when unknown. */
  rating: number | null;
  ratingCategory: RatingCategory | null;
  /** Blunders reviewed (solved on the first attempt) over the last 7 days. */
  value: number;
  flair: string | null;
  supporter: SupporterBadge | null;
}

const RATING_CATEGORIES: ReadonlySet<string> = new Set(['bullet', 'blitz', 'rapid', 'classical']);

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
          platform: r.platform === 'lichess' || r.platform === 'chesscom' ? r.platform : null,
          rating: typeof r.rating === 'number' && r.rating > 0 ? r.rating : null,
          ratingCategory: RATING_CATEGORIES.has(r.ratingCategory)
            ? (r.ratingCategory as RatingCategory)
            : null,
          value: Number(r.value ?? 0),
          flair: typeof r.flair === 'string' && r.flair ? r.flair : null,
          supporter: supporterBadgeFromJson(r.supporter),
        }))
      : [],
  };
}

/**
 * `leaderboard.public` RPC (anon-callable): top 5 by blunders reviewed over
 * the last 7 days, with each player's platform and current rating for the
 * landing page. Server-cached for an hour; opted-out users are excluded.
 */
export async function getPublicLeaderboard(): Promise<PublicLeaderboard> {
  return publicLeaderboardFromJson(await rpc('leaderboard.public'));
}
