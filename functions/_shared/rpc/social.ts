/**
 * Review queue for the daily puzzle video (Instagram Reel + TikTok, published
 * through Buffer). scripts/social/plan.ts fills `social_posts` a week ahead
 * from a GitHub Actions cron and scripts/social/publish.ts hands today's row to
 * Buffer; this module only lets the admin look at the queue and veto / restore
 * a day (SocialQueueCard on /analytics). Table: d1/migrations/0003_social_posts.sql
 * + 0008_social_v2.sql.
 */
import { adminRpc, argString, badRequest, conflict, notFound, type RpcRegistry } from './core';
import { all, first, run } from '../db';

const DAY_MS = 86400_000;

const COLUMNS = `id, blunder_id, scheduled_for, status, hook_template, motif, caption, tiktok_caption, puzzle,
  media_url, poster_url, permalink, ig_error, tiktok_status, tiktok_error,
  plays, reach, likes, comments, saves, shares, insights_at, posted_at,
  format, fell_count, script, script_source, voice, buffer_ig_post_id, buffer_tiktok_post_id, buffer_error`;

/** UTC date (YYYY-MM-DD) — the planner schedules by UTC day. */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Upcoming slots (queued + vetoed, today onward) and what went out (or failed) in the last 14 days. */
export async function socialQueue(db: D1Database, today = utcToday()) {
  const upcoming = await all(
    db,
    `SELECT ${COLUMNS} FROM social_posts
     WHERE status IN ('queued', 'vetoed') AND scheduled_for >= ?
     ORDER BY scheduled_for, status DESC`,
    [today],
    'social_posts',
  );
  const recent = await all(
    db,
    `SELECT ${COLUMNS} FROM social_posts
     WHERE status IN ('posted', 'failed') AND scheduled_for >= ? AND scheduled_for <= ?
     ORDER BY scheduled_for DESC`,
    [addDays(today, -14), today],
    'social_posts',
  );
  return { today, upcoming, recent };
}

/** Veto a queued slot or restore a vetoed one. Today onward only: past rows are history. */
export async function socialSetStatus(db: D1Database, id: string, status: string, today = utcToday()) {
  if (status !== 'vetoed' && status !== 'queued') throw badRequest('status must be vetoed or queued');
  const row = await first<{ status: string; scheduled_for: string | null }>(
    db,
    `SELECT status, scheduled_for FROM social_posts WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound('no such post');
  if (!row.scheduled_for || row.scheduled_for < today) throw badRequest('only upcoming posts can change');
  const from = status === 'vetoed' ? 'queued' : 'vetoed';
  if (row.status !== from) throw conflict(`post is ${row.status}`);
  if (status === 'queued') {
    // The planner refills a vetoed day from tomorrow on; the slot index allows one live row.
    const taken = await first(
      db,
      `SELECT id FROM social_posts WHERE scheduled_for = ? AND status IN ('queued', 'posted') AND id <> ?`,
      [row.scheduled_for, id],
    );
    if (taken) throw conflict('that day already has another post');
  }
  await run(db, `UPDATE social_posts SET status = ? WHERE id = ? AND status = ?`, [status, id, from]);
  return null;
}

export const handlers: RpcRegistry = {
  'admin.socialQueue': adminRpc(async (ctx) => socialQueue(ctx.db)),

  'admin.socialSetStatus': adminRpc<Record<string, unknown>>(async (ctx, args) =>
    socialSetStatus(ctx.db, argString(args, 'id'), argString(args, 'status')),
  ),
};
