/**
 * Achievement rarity ("12% of players have this", feedback round 2).
 *
 * Achievements are computed in the browser (src/lib/achievements.ts); the
 * client records each newly earned id here (`achievements.record`) so the
 * server can count them. `achievements.rarity` is the share of players who
 * have trained at least once that hold each achievement — counted over the
 * trained players whose unlocks we've seen (anyone who opened the app since
 * recording began; every trained player has at least one unlock), so the
 * percentages aren't diluted while older accounts backfill. Cached 1 h.
 *
 * Unlocks are client-claimed like flair: low stakes, aggregate only.
 */
import { badRequest, userRpc, type RpcRegistry } from './core';
import { all, batch, chunk, nowIso, placeholders, stmt } from '../db';
import { ACHIEVEMENTS } from '../../../src/lib/achievements';
import { cached } from './leaderboard';

const KNOWN = new Set(ACHIEVEMENTS.map((a) => a.id));

/** Hide percentages until this many players are counted (tiny samples mislead). */
export const RARITY_MIN_PLAYERS = 20;
const RARITY_TTL_MS = 60 * 60 * 1000;

export interface AchievementRarity {
  /** Players counted (trained at least once, with recorded unlocks). */
  players: number;
  /** Achievement id → share of those players who have it, 0–100 (one decimal). Empty below RARITY_MIN_PLAYERS. */
  pct: Record<string, number>;
  computedAt: string;
}

export async function computeRarity(db: D1Database, now = new Date()): Promise<AchievementRarity> {
  const trained = `EXISTS (SELECT 1 FROM training_sessions ts WHERE ts.user_id = ua.user_id)`;
  const [{ n }] = await all<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT ua.user_id) AS n FROM user_achievements ua WHERE ${trained}`,
  );
  const players = Number(n ?? 0);
  const pct: Record<string, number> = {};
  if (players >= RARITY_MIN_PLAYERS) {
    const rows = await all<{ achievement_id: string; c: number }>(
      db,
      `SELECT ua.achievement_id, COUNT(*) AS c FROM user_achievements ua WHERE ${trained} GROUP BY ua.achievement_id`,
    );
    for (const r of rows) {
      if (KNOWN.has(r.achievement_id)) pct[r.achievement_id] = Math.round((Number(r.c) / players) * 1000) / 10;
    }
  }
  return { players, pct, computedAt: now.toISOString() };
}

export const handlers: RpcRegistry = {
  /** The caller's newly earned achievement ids (unknown ids are ignored; repeats are no-ops). */
  'achievements.record': userRpc<{ ids?: unknown }>(async (ctx, args) => {
    if (!Array.isArray(args.ids)) throw badRequest('ids must be an array');
    const ids = [...new Set(args.ids.filter((id): id is string => typeof id === 'string' && KNOWN.has(id)))];
    if (ids.length === 0) return { recorded: 0 };
    const at = nowIso();
    await batch(
      ctx.db,
      chunk(ids, 30).map((part) =>
        stmt(
          ctx.db,
          `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, earned_at) VALUES ${part
            .map(() => `(${placeholders(3)})`)
            .join(', ')}`,
          part.flatMap((id) => [ctx.user.id, id, at]),
        ),
      ),
    );
    return { recorded: ids.length };
  }),

  /** Share of players holding each achievement (cached 1 h). */
  'achievements.rarity': userRpc(async (ctx) =>
    cached(ctx.db, 'achievement_rarity_cache', RARITY_TTL_MS, () => computeRarity(ctx.db)),
  ),
};
