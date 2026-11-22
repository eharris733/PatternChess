/**
 * Leaderboards + landing-page social proof (ported from the Postgres RPCs
 * `leaderboard`, `public_leaderboard`, `landing_stats`, `supporter_badge`).
 *
 * - `leaderboard.get`    (user)   top N + the caller's own row for one metric × window.
 * - `leaderboard.public` (public) landing "This week" top 5, cached 1 h in public_leaderboard_cache.
 * - `landing.stats`      (public) positions reviewed + Elo gained, cached 6 h in landing_stats_cache.
 *
 * Public payloads carry chess handles / display names only — never emails or ids.
 * The Postgres versions took an advisory lock while recomputing; here two
 * concurrent misses both recompute and the last upsert wins (harmless).
 */
import { badRequest, publicRpc, userRpc, type RpcRegistry } from './core';
import { all, chunk, first, nowIso, placeholders, run } from '../db';

export type LeaderboardMetric = 'solved' | 'mastered' | 'elo' | 'streak' | 'openings' | 'endgames';
export type LeaderboardWindow = 'all' | 'week';
export type SupporterBadge = 'supporter' | 'early';

const METRICS: readonly LeaderboardMetric[] = ['solved', 'mastered', 'elo', 'streak', 'openings', 'endgames'];
const WINDOWS: readonly LeaderboardWindow[] = ['all', 'week'];

/** Supporter perks run while the subscription is in one of these (functions/_shared/supporters.ts PERK_STATUSES). */
const PERK_STATUSES = ['active', 'trialing', 'past_due'];

export const LANDING_STATS_TTL_MS = 6 * 3600_000;
export const PUBLIC_LEADERBOARD_TTL_MS = 3600_000;

// --- pure helpers ------------------------------------------------------------

/** Monday 00:00 UTC of `now`'s ISO week (Postgres `date_trunc('week', now())` in a UTC session). */
export function isoWeekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

/** `supporter_badge(uid)`: 'supporter' while perks run, 'early' once supported, else null. */
export function supporterBadge(row: { status: string | null; first_supported_at: string | null } | undefined): SupporterBadge | null {
  if (!row) return null;
  if (row.status && PERK_STATUSES.includes(row.status)) return 'supporter';
  if (row.first_supported_at) return 'early';
  return null;
}

/** Public label: lichess → chess.com → display name → "Player" (never an email or id). */
export function publicLabel(p: {
  lichess_username: string | null;
  chesscom_username: string | null;
  display_name?: string | null;
}): string {
  return p.lichess_username || p.chesscom_username || p.display_name || 'Player';
}

export interface Ranked<T> {
  rank: number;
  item: T;
}

/**
 * `rank() over (order by value desc, user_id)`: the user id tie-break makes
 * every key unique, so rank = 1-based position. Rows with value ≤ 0 drop out.
 */
export function rankByValue<T extends { user_id: string; value: number }>(rows: readonly T[]): Ranked<T>[] {
  return rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0))
    .map((item, i) => ({ rank: i + 1, item }));
}

export interface RecentGame {
  played_at: string;
  user_rating: number;
  category: string | null;
}

/**
 * public_leaderboard's rating pick over a player's last 50 rated games on
 * their platform (newest first): the most-played category (ties → the one
 * played most recently), then the newest rating in it.
 */
export function mainCategoryRating(games: readonly RecentGame[]): { category: string; rating: number } | null {
  const byCat = new Map<string, { n: number; last: string; rating: number }>();
  for (const g of games) {
    if (!g.category) continue;
    const cur = byCat.get(g.category);
    if (!cur) byCat.set(g.category, { n: 1, last: g.played_at, rating: g.user_rating });
    else {
      cur.n += 1;
      if (g.played_at > cur.last) {
        cur.last = g.played_at;
        cur.rating = g.user_rating;
      }
    }
  }
  let best: { category: string; n: number; last: string; rating: number } | null = null;
  for (const [category, v] of byCat) {
    if (!best || v.n > best.n || (v.n === best.n && v.last > best.last)) best = { category, ...v };
  }
  return best ? { category: best.category, rating: best.rating } : null;
}

// --- shared queries ----------------------------------------------------------

/**
 * Elo gained per user: per (user, platform, time category) series of rated
 * lichess/chess.com games played after joining (and after `since`), the
 * positive latest − first rating delta when the series has ≥ 3 games
 * (MIN_POINTS_PER_SERIES in useRatingProgress.ts). Same rule as the old
 * landing_stats() / leaderboard('elo').
 */
export async function eloGainedByUser(db: D1Database, since: string): Promise<Map<string, number>> {
  const rows = await all<{ user_id: string; value: number }>(
    db,
    `WITH rg AS (
       SELECT g.user_id, g.platform, g.time_category AS category, g.played_at, g.user_rating
       FROM games g JOIN profiles p ON p.id = g.user_id
       WHERE g.rated = 1 AND g.user_rating IS NOT NULL AND g.played_at IS NOT NULL
         AND g.platform IN ('lichess', 'chess.com') AND g.time_category IS NOT NULL
         AND g.played_at >= max(coalesce(p.created_at, ''), ?)
     ),
     ordered AS (
       SELECT user_id, platform, category, user_rating,
         row_number() OVER (PARTITION BY user_id, platform, category ORDER BY played_at ASC)  AS rn_first,
         row_number() OVER (PARTITION BY user_id, platform, category ORDER BY played_at DESC) AS rn_last
       FROM rg
     ),
     buckets AS (
       SELECT user_id,
         max(CASE WHEN rn_first = 1 THEN user_rating END) AS first_rating,
         max(CASE WHEN rn_last = 1 THEN user_rating END)  AS latest_rating,
         count(*) AS n
       FROM ordered GROUP BY user_id, platform, category
     )
     SELECT user_id, sum(max(latest_rating - first_rating, 0)) AS value
     FROM buckets WHERE n >= 3 GROUP BY user_id`,
    [since],
  );
  return new Map(rows.map((r) => [r.user_id, Number(r.value) || 0]));
}

/** supporter_badge() for many users at once. */
export async function supporterBadges(db: D1Database, userIds: readonly string[]): Promise<Map<string, SupporterBadge | null>> {
  const out = new Map<string, SupporterBadge | null>();
  for (const ids of chunk([...new Set(userIds)], 90)) {
    const rows = await all<{ user_id: string; status: string | null; first_supported_at: string | null }>(
      db,
      `SELECT user_id, status, first_supported_at FROM supporters WHERE user_id IN (${placeholders(ids.length)})`,
      ids,
    );
    for (const r of rows) out.set(r.user_id, supporterBadge(r));
  }
  return out;
}

async function metricValues(
  db: D1Database,
  metric: LeaderboardMetric,
  win: LeaderboardWindow,
  since: string,
): Promise<Map<string, number>> {
  const week = win === 'week';
  const toMap = (rows: { user_id: string; value: number | null }[]) =>
    new Map(rows.map((r) => [r.user_id, Number(r.value) || 0]));
  // Openings / endgames this week: items whose latest review since Monday was
  // solved (per-kind counts aren't logged per session).
  const solvedItem = `CASE WHEN last_drilled_at >= ?2 AND last_drill_failed = 0 AND times_correct > 0 THEN 1 ELSE 0 END`;
  switch (metric) {
    case 'solved':
      return toMap(
        week
          ? await all(db, `SELECT user_id, sum(blunders_correct) AS value FROM training_sessions WHERE started_at >= ? GROUP BY user_id`, [since])
          : await all(db, `SELECT user_id, sum(times_correct) AS value FROM blunders WHERE user_id IS NOT NULL GROUP BY user_id`),
      );
    case 'mastered':
      // Same rule as getBlunderStats().mastered: whole ladder (cycle ≥ 4) and ≥ 80% recall.
      return toMap(
        await all(
          db,
          `SELECT user_id, count(*) AS value FROM blunders
           WHERE cycle_number >= 4 AND times_attempted > 0 AND times_correct * 1.0 / times_attempted >= 0.8
             AND (?1 = 0 OR last_drilled_at >= ?2)
           GROUP BY user_id`,
          [week ? 1 : 0, since],
        ),
      );
    case 'openings':
      return toMap(
        await all(
          db,
          `SELECT user_id, CASE WHEN ?1 = 1 THEN sum(${solvedItem}) ELSE sum(times_correct) END AS value
           FROM blunders WHERE kind = 'opening' GROUP BY user_id`,
          [week ? 1 : 0, since],
        ),
      );
    case 'endgames':
      return toMap(
        await all(
          db,
          `SELECT user_id, CASE WHEN ?1 = 1 THEN sum(${solvedItem}) ELSE sum(times_correct) END AS value
           FROM (
             SELECT user_id, times_correct, last_drilled_at, last_drill_failed FROM blunders WHERE kind = 'endgame'
             UNION ALL
             SELECT user_id, times_correct, last_drilled_at, last_drill_failed FROM endgame_scenarios WHERE retired_at IS NULL
           ) GROUP BY user_id`,
          [week ? 1 : 0, since],
        ),
      );
    case 'elo':
      return eloGainedByUser(db, since);
    case 'streak':
      return new Map(); // read straight off profiles
  }
}

// --- leaderboard.get -----------------------------------------------------------

export interface LeaderboardRowOut {
  rank: number;
  label: string;
  value: number;
  isMe: boolean;
  flair: string | null;
  supporter: SupporterBadge | null;
}

async function leaderboard(
  db: D1Database,
  me: string,
  metric: LeaderboardMetric,
  win: LeaderboardWindow,
  limitN: number,
  now = new Date(),
) {
  const sinceDate = win === 'week' ? isoWeekStart(now) : null;
  const since = sinceDate ? sinceDate.toISOString() : '';
  const [profiles, values] = await Promise.all([
    all<{
      id: string;
      lichess_username: string | null;
      chesscom_username: string | null;
      display_name: string | null;
      flair: string | null;
      current_streak_days: number;
      longest_streak_days: number;
    }>(
      db,
      `SELECT id, lichess_username, chesscom_username, display_name, flair, current_streak_days, longest_streak_days
       FROM profiles WHERE leaderboard_opt_out = 0`,
    ),
    metricValues(db, metric, win, since),
  ]);
  const scores = profiles.map((p) => ({
    user_id: p.id,
    label: publicLabel(p),
    flair: p.flair || null,
    value:
      metric === 'streak'
        ? Number(win === 'week' ? p.current_streak_days : p.longest_streak_days) || 0
        : values.get(p.id) ?? 0,
  }));
  const ranked = rankByValue(scores);
  const top = ranked.slice(0, limitN);
  const mine = ranked.find((r) => r.item.user_id === me) ?? null;
  const badges = await supporterBadges(db, [...top.map((r) => r.item.user_id), ...(mine ? [me] : [])]);
  const out = (r: Ranked<(typeof scores)[number]>, isMe: boolean): LeaderboardRowOut => ({
    rank: r.rank,
    label: r.item.label,
    value: r.item.value,
    isMe,
    flair: r.item.flair,
    supporter: badges.get(r.item.user_id) ?? null,
  });
  return {
    metric,
    window: win,
    since: sinceDate ? since : null,
    rows: top.map((r) => out(r, r.item.user_id === me)),
    me: mine ? out(mine, true) : null,
  };
}

// --- leaderboard.public --------------------------------------------------------

export interface PublicLeaderboardPayload {
  since: string;
  computedAt: string;
  rows: {
    rank: number;
    label: string;
    platform: 'lichess' | 'chesscom' | null;
    rating: number | null;
    ratingCategory: string | null;
    value: number;
    flair: string | null;
    supporter: SupporterBadge | null;
  }[];
}

export async function computePublicLeaderboard(db: D1Database, now = new Date()): Promise<PublicLeaderboardPayload> {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const solved = await all<{
    user_id: string;
    value: number;
    lichess_username: string | null;
    chesscom_username: string | null;
    flair: string | null;
  }>(
    db,
    `SELECT s.user_id, s.value, p.lichess_username, p.chesscom_username, p.flair
     FROM (SELECT user_id, sum(blunders_correct) AS value FROM training_sessions WHERE started_at >= ? GROUP BY user_id) s
     JOIN profiles p ON p.id = s.user_id
     WHERE p.leaderboard_opt_out = 0`,
    [since],
  );
  const top = rankByValue(solved.map((r) => ({ ...r, value: Number(r.value) || 0 }))).slice(0, 5);
  const badges = await supporterBadges(db, top.map((t) => t.item.user_id));
  const rows = await Promise.all(
    top.map(async ({ rank, item }) => {
      // Chess handles only — never the display name (it can be a real name).
      const platform: 'lichess' | 'chesscom' | null = item.lichess_username
        ? 'lichess'
        : item.chesscom_username
          ? 'chesscom'
          : null;
      let rating: { category: string; rating: number } | null = null;
      if (platform) {
        const games = await all<RecentGame>(
          db,
          // chess.com daily ("1/1209600") and correspondence have no rating category.
          `SELECT played_at, user_rating,
             CASE WHEN time_control LIKE '%/%' THEN NULL ELSE time_category END AS category
           FROM games
           WHERE user_id = ? AND platform = ? AND user_rating IS NOT NULL AND played_at IS NOT NULL
           ORDER BY played_at DESC LIMIT 50`,
          [item.user_id, platform === 'chesscom' ? 'chess.com' : 'lichess'],
        );
        rating = mainCategoryRating(games);
      }
      return {
        rank,
        label: item.lichess_username || item.chesscom_username || 'Player',
        platform,
        rating: rating?.rating ?? null,
        ratingCategory: rating?.category ?? null,
        value: item.value,
        flair: item.flair || null,
        supporter: badges.get(item.user_id) ?? null,
      };
    }),
  );
  return { since, computedAt: now.toISOString(), rows };
}

// --- landing.stats -------------------------------------------------------------

export interface LandingStatsPayload {
  positionsReviewed: number;
  eloGained: number;
  computedAt: string;
}

export async function computeLandingStats(db: D1Database, now = new Date()): Promise<LandingStatsPayload> {
  const [reviewed, elo] = await Promise.all([
    first<{ n: number | null }>(db, `SELECT coalesce(sum(times_correct), 0) AS n FROM blunders`),
    eloGainedByUser(db, ''),
  ]);
  let eloGained = 0;
  for (const v of elo.values()) eloGained += v;
  return { positionsReviewed: Number(reviewed?.n ?? 0), eloGained, computedAt: now.toISOString() };
}

type CacheTable = 'landing_stats_cache' | 'public_leaderboard_cache';

/** Serve the singleton cache row while fresh; otherwise recompute and upsert it. */
export async function cached<T>(
  db: D1Database,
  table: CacheTable,
  ttlMs: number,
  compute: () => Promise<T>,
  now = new Date(),
): Promise<T> {
  const row = await first<{ payload: string; computed_at: string }>(
    db,
    `SELECT payload, computed_at FROM ${table} WHERE id = 1`,
  );
  if (row && Date.parse(row.computed_at) > now.getTime() - ttlMs) {
    try {
      return JSON.parse(row.payload) as T;
    } catch {
      // fall through and recompute a corrupt row
    }
  }
  const fresh = await compute();
  await run(
    db,
    `INSERT INTO ${table} (id, payload, computed_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at`,
    [JSON.stringify(fresh), nowIso()],
  );
  return fresh;
}

// --- registry ------------------------------------------------------------------

export const handlers: RpcRegistry = {
  'leaderboard.get': userRpc<{ metric?: unknown; window?: unknown; limit?: unknown }>(async (ctx, args) => {
    const metric = args.metric as LeaderboardMetric;
    const win = (args.window ?? 'all') as LeaderboardWindow;
    if (!METRICS.includes(metric)) throw badRequest(`unknown metric ${String(args.metric)}`);
    if (!WINDOWS.includes(win)) throw badRequest(`unknown window ${String(args.window)}`);
    const n = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 20;
    return leaderboard(ctx.db, ctx.user.id, metric, win, Math.min(Math.max(n, 1), 100));
  }),

  'leaderboard.public': publicRpc(async (ctx) =>
    cached(ctx.db, 'public_leaderboard_cache', PUBLIC_LEADERBOARD_TTL_MS, () => computePublicLeaderboard(ctx.db)),
  ),

  'landing.stats': publicRpc(async (ctx) =>
    cached(ctx.db, 'landing_stats_cache', LANDING_STATS_TTL_MS, () => computeLandingStats(ctx.db)),
  ),
};

export const __test = { leaderboard };
