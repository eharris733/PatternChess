// Everything the notifier reads or writes in the app D1 (`patternchess-app`).
// D1 ports of the Postgres functions the Worker used to call over PostgREST:
//   email_candidates / email_outbox  -> emailCandidates / emailOutbox (+ rules.ts)
//   email_report_data                -> reportData
//   email_prefs_json                 -> prefsJson
//   email_prefs_by_token / email_update_prefs_by_token / email_unsubscribe /
//   email_confirm                    -> prefsByToken / updatePrefsByToken /
//                                       unsubscribeByToken / confirmEmail
// plus the email_confirmations and email_sends writes.
//
// Addresses come from better-auth's `user` table (Lichess sign-ins carry the
// placeholder `<id>@lichess.invalid`, which counts as no address).

import { all, first, run, stmt } from './db';
import type { OutboxData, OutboxRow } from './outbox';
import type { Prefs } from './pages';
import type { EventsLoader } from './events';
import { decide, eventsStateFor, realEmail, REMINDER_KINDS, REPORT_KINDS, type CandidateFacts } from './rules';
import type { EmailKind } from './templates';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const inList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');

const REMINDERS = inList(REMINDER_KINDS);
const REPORTS = inList(REPORT_KINDS);
const DUE_KINDS = "'tactic', 'endgame'";

/**
 * Per-player facts for the rules engine. `userId` null = every opted-in
 * player (the hourly run); a user id = that player whatever their opt-in
 * (admin preview / samples), like email_candidates(p_now, p_user).
 */
const FACTS_SQL = `
WITH base AS (
  SELECT p.id, p.created_at, p.email_reminders, p.email_reports, p.email_hour,
         p.email_unsub_token, p.current_streak_days, p.last_drill_local_date,
         p.contact_email, p.contact_email_verified_at,
         coalesce(p.streak_freezes, 0) AS streak_freezes,
         coalesce(p.daily_positions_goal, 10) AS positions_goal,
         coalesce(p.daily_games_goal, 1) AS games_goal,
         nullif(u.email, '') AS auth_email,
         p.display_name, p.lichess_username, p.chesscom_username, p.timezone,
         p.events_state
  FROM profiles p
  JOIN "user" u ON u.id = p.id
  WHERE (?1 IS NULL AND p.email_opt_in = 1) OR p.id = ?1
),
sends AS (
  SELECT s.user_id,
         max(CASE WHEN s.kind <> 'confirm' THEN s.sent_at END) AS last_any,
         max(CASE WHEN s.kind IN (${REMINDERS}) THEN s.sent_at END) AS last_reminder,
         max(CASE WHEN s.kind IN (${REPORTS}) THEN s.sent_at END) AS last_report,
         max(CASE WHEN s.kind = 'confirm' THEN s.sent_at END) AS last_confirm,
         max(s.kind = 'ready') AS ready_sent,
         max(s.kind = 'welcome') AS welcome_sent
  FROM email_sends s
  WHERE s.user_id IN (SELECT id FROM base)
  GROUP BY s.user_id
),
pos AS (
  -- Openings are left out of "due", as in the daily plan's train step.
  SELECT b.user_id,
         sum(CASE WHEN b.next_drill_at <= ?2 AND b.retired_at IS NULL AND b.kind IN (${DUE_KINDS}) THEN 1 ELSE 0 END) AS due_now,
         sum(CASE WHEN b.retired_at IS NULL THEN 1 ELSE 0 END) AS live_total,
         max(b.last_drilled_at) AS last_trained
  FROM blunders b
  WHERE b.user_id IN (SELECT id FROM base)
  GROUP BY b.user_id
)
SELECT b.*,
       coalesce(pos.due_now, 0) AS due_now,
       coalesce(pos.live_total, 0) AS live_total,
       pos.last_trained,
       s.last_any, s.last_reminder, s.last_report, s.last_confirm,
       coalesce(s.ready_sent, 0) AS ready_sent,
       coalesce(s.welcome_sent, 0) AS welcome_sent,
       (SELECT count(*) FROM email_sends e
         WHERE e.user_id = b.id AND e.kind IN (${REMINDERS})
           AND (pos.last_trained IS NULL OR e.sent_at > pos.last_trained)) AS unanswered,
       (SELECT count(*) FROM blunders f
         WHERE f.user_id = b.id AND f.retired_at IS NULL AND f.kind IN (${DUE_KINDS})
           AND f.created_at > max(coalesce(s.last_any, ?3), ?4)) AS fresh_blunders
FROM base b
LEFT JOIN pos ON pos.user_id = b.id
LEFT JOIN sends s ON s.user_id = b.id
ORDER BY b.id`;

export async function candidateFacts(db: D1Database, now: Date, userId: string | null): Promise<CandidateFacts[]> {
  const t = now.getTime();
  return all<CandidateFacts>(db, FACTS_SQL, [userId, iso(t), iso(t - DAY), iso(t - 7 * DAY)]);
}

/** Total Elo gained by all players (landing_stats_cache, refreshed by the landing.stats RPC). */
export async function communityElo(db: D1Database): Promise<number> {
  const row = await first<{ payload: string }>(db, 'SELECT payload FROM landing_stats_cache WHERE id = 1');
  if (!row) return 0;
  try {
    const n = Math.round(Number((JSON.parse(row.payload) as { eloGained?: unknown }).eloGained));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export type ReportData = NonNullable<OutboxData['report']> & { periodDays: number };

/** The weekly report numbers for [since, now) — email_report_data(). */
export async function reportData(db: D1Database, userId: string, since: Date, now: Date): Promise<ReportData> {
  const s = since.toISOString();
  const n = now.toISOString();
  const weekAgo = iso(now.getTime() - 7 * DAY);

  const [sessions, mastered, games, rated, mine, optOut, motif] = await Promise.all([
    first<{ attempted: number; solved: number; minutes: number | null; active_days: number }>(
      db,
      `SELECT coalesce(sum(blunders_attempted), 0) AS attempted,
              coalesce(sum(blunders_correct), 0) AS solved,
              sum(CASE WHEN ended_at > started_at
                       THEN min((julianday(ended_at) - julianday(started_at)) * 1440.0, 120) END) AS minutes,
              count(DISTINCT CASE WHEN blunders_correct > 0 THEN local_date END) AS active_days
       FROM training_sessions WHERE user_id = ? AND started_at >= ?`,
      [userId, s],
    ),
    // cycle 4 = the ladder length (SPACED_REPETITION_DAYS).
    first<{ n: number }>(
      db,
      `SELECT count(*) AS n FROM blunders
       WHERE user_id = ? AND cycle_number = 4 AND last_drill_failed = 0 AND last_drilled_at >= ?`,
      [userId, s],
    ),
    first<{ n: number }>(db, 'SELECT count(*) AS n FROM games WHERE user_id = ? AND played_at >= ? AND played_at < ?', [
      userId,
      s,
      n,
    ]),
    all<{ user_rating: number; platform: string; time_category: string }>(
      db,
      `SELECT user_rating, platform, time_category FROM games
       WHERE user_id = ? AND rated = 1 AND user_rating IS NOT NULL
         AND played_at >= ? AND played_at < ? AND platform IN ('lichess', 'chess.com')
         AND time_category IS NOT NULL
       ORDER BY played_at, id`,
      [userId, s, n],
    ),
    first<{ solved: number }>(
      db,
      'SELECT coalesce(sum(blunders_correct), 0) AS solved FROM training_sessions WHERE user_id = ? AND started_at >= ?',
      [userId, weekAgo],
    ),
    first<{ leaderboard_opt_out: number }>(db, 'SELECT leaderboard_opt_out FROM profiles WHERE id = ?', [userId]),
    first<{ mo: string }>(
      db,
      `SELECT j.value AS mo FROM blunders b, json_each(b.motifs) j
       WHERE b.user_id = ? AND b.kind = 'tactic' AND b.retired_at IS NULL AND b.created_at >= ?
       GROUP BY j.value ORDER BY count(*) DESC, j.value LIMIT 1`,
      [userId, s],
    ),
  ]);

  // Elo change in the most-played (platform, time category) bucket: last - first rating.
  const buckets = new Map<string, { n: number; first: number; last: number }>();
  for (const g of rated) {
    const key = `${g.platform}|${g.time_category}`;
    const b = buckets.get(key);
    if (b) {
      b.n++;
      b.last = g.user_rating;
    } else buckets.set(key, { n: 1, first: g.user_rating, last: g.user_rating });
  }
  let top: { n: number; first: number; last: number } | null = null;
  for (const b of buckets.values()) if (!top || b.n > top.n) top = b;
  const eloChange = top && top.n >= 2 ? top.last - top.first : null;

  let leaderboardRank: number | null = null;
  const mySolved = Number(mine?.solved ?? 0);
  if (mySolved > 0 && !optOut?.leaderboard_opt_out) {
    const ahead = await first<{ n: number }>(
      db,
      `SELECT count(*) AS n FROM (
         SELECT ts.user_id, sum(ts.blunders_correct) AS solved
         FROM training_sessions ts JOIN profiles p ON p.id = ts.user_id
         WHERE ts.started_at >= ? AND p.leaderboard_opt_out = 0
         GROUP BY ts.user_id
       ) WHERE solved > ?`,
      [weekAgo, mySolved],
    );
    leaderboardRank = 1 + Number(ahead?.n ?? 0);
  }

  return {
    periodDays: Math.max(1, Math.round((now.getTime() - since.getTime()) / DAY)),
    attempted: Number(sessions?.attempted ?? 0),
    solved: Number(sessions?.solved ?? 0),
    minutes: Math.round(Number(sessions?.minutes ?? 0)),
    activeDays: Number(sessions?.active_days ?? 0),
    newlyMastered: Number(mastered?.n ?? 0),
    gamesPlayed: Number(games?.n ?? 0),
    eloChange,
    leaderboardRank,
    topMotif: motif?.mo ?? null,
  };
}

export interface CandidateOptions {
  /**
   * Fetches "Events near you" for a state (events.ts stateEventsLoader).
   * Omitted = no events lookups (tests, and anything that must stay offline).
   */
  loadEvents?: EventsLoader;
}

/**
 * One row per player considered (kind null = nothing this hour), with the
 * template data. The report is attached for weekly_report rows, and always
 * when a single user is asked for (admin preview), as in Postgres; the same
 * goes for "Events near you" when the player saved a state (eventsStateFor).
 */
export async function emailCandidates(
  db: D1Database,
  now: Date,
  userId: string | null = null,
  opts: CandidateOptions = {},
): Promise<OutboxRow[]> {
  const [facts, elo] = await Promise.all([candidateFacts(db, now, userId), communityElo(db)]);
  const rows: OutboxRow[] = [];
  for (const f of facts) {
    const d = decide(f, now);
    const data: OutboxData = {
      firstName: d.firstName,
      streak: d.streak,
      streakFreezes: Number(f.streak_freezes),
      lastDrillLocalDate: f.last_drill_local_date,
      localToday: d.local.today,
      dueNow: Number(f.due_now),
      liveTotal: Number(f.live_total),
      positionsGoal: Number(f.positions_goal),
      gamesGoal: Number(f.games_goal),
      freshBlunders: Number(f.fresh_blunders),
      communityElo: elo,
    };
    if (d.kind === 'weekly_report' || userId !== null) {
      data.report = await reportData(db, f.id, new Date(now.getTime() - 7 * DAY), now);
    }
    const eventsState = eventsStateFor(userId !== null ? 'weekly_report' : d.kind, f);
    if (eventsState) {
      data.eventsState = eventsState;
      data.events = opts.loadEvents ? await opts.loadEvents(eventsState, d.local.today).catch(() => null) : null;
    }
    rows.push({ user_id: f.id, kind: d.kind, to_email: d.to_email, unsub_token: f.email_unsub_token, data });
  }
  return rows;
}

/** What the hourly run sends: candidates with a kind and an address. */
export async function emailOutbox(
  db: D1Database,
  now: Date,
  opts: CandidateOptions = {},
): Promise<Array<OutboxRow & { kind: EmailKind; to_email: string }>> {
  return (await emailCandidates(db, now, null, opts)).filter(
    (r): r is OutboxRow & { kind: EmailKind; to_email: string } => r.kind !== null && r.to_email !== null,
  );
}

// --- token pages -------------------------------------------------------------

/** e•••@gmail.com — the token pages must not leak a full address. */
export function maskEmail(email: string): string {
  return email.replace(/^(.)[^@]*(@.*)$/s, '$1•••$2');
}

export async function prefsJson(db: D1Database, userId: string): Promise<Prefs | null> {
  const p = await first<{
    email_opt_in: number;
    email_reminders: Prefs['reminders'];
    email_reports: Prefs['reports'];
    email_hour: number;
    contact_email: string | null;
    contact_email_verified_at: string | null;
    auth_email: string | null;
  }>(
    db,
    `SELECT p.email_opt_in, p.email_reminders, p.email_reports, p.email_hour,
            p.contact_email, p.contact_email_verified_at, u.email AS auth_email
     FROM profiles p JOIN "user" u ON u.id = p.id WHERE p.id = ?`,
    [userId],
  );
  if (!p) return null;
  return {
    optIn: !!p.email_opt_in,
    reminders: p.email_reminders,
    reports: p.email_reports,
    hour: Number(p.email_hour),
    email: maskEmail(p.contact_email ?? realEmail(p.auth_email) ?? ''),
    needsConfirm: p.contact_email != null && p.contact_email_verified_at == null,
  };
}

// Tokens are stored lowercase (Postgres compared uuids case-insensitively).
const tok = (t: string) => t.toLowerCase();

export async function prefsByToken(db: D1Database, token: string): Promise<Prefs | null> {
  const row = await first<{ id: string }>(db, 'SELECT id FROM profiles WHERE email_unsub_token = ?', [tok(token)]);
  return row ? prefsJson(db, row.id) : null;
}

export async function updatePrefsByToken(
  db: D1Database,
  token: string,
  prefs: { optIn: boolean; reminders: string; reports: string; hour: number },
): Promise<Prefs | null> {
  const row = await first<{ id: string }>(
    db,
    `UPDATE profiles SET email_opt_in = ?, email_reminders = ?, email_reports = ?, email_hour = ?
     WHERE email_unsub_token = ? RETURNING id`,
    [prefs.optIn, prefs.reminders, prefs.reports, prefs.hour, tok(token)],
  );
  return row ? prefsJson(db, row.id) : null;
}

export async function unsubscribeByToken(db: D1Database, token: string, now = new Date()): Promise<Prefs | null> {
  const row = await first<{ id: string }>(
    db,
    'UPDATE profiles SET email_opt_in = 0, email_unsubscribed_at = ? WHERE email_unsub_token = ? RETURNING id',
    [now.toISOString(), tok(token)],
  );
  return row ? prefsJson(db, row.id) : null;
}

/** Marks the contact address confirmed (if it is still the one the link was for) and spends every link. */
export async function confirmEmail(db: D1Database, token: string, now = new Date()): Promise<Prefs | null> {
  const c = await first<{ user_id: string; email: string }>(
    db,
    'SELECT user_id, email FROM email_confirmations WHERE token = ?',
    [tok(token)],
  );
  if (!c) return null;
  await db.batch([
    stmt(db, 'UPDATE profiles SET contact_email_verified_at = ? WHERE id = ? AND contact_email = ?', [
      now.toISOString(),
      c.user_id,
      c.email,
    ]),
    stmt(db, 'DELETE FROM email_confirmations WHERE user_id = ?', [c.user_id]),
  ]);
  return prefsJson(db, c.user_id);
}

/** One live confirmation link per user: the newest replaces the rest. */
export async function newConfirmToken(db: D1Database, userId: string, email: string, now = new Date()): Promise<string> {
  const token = crypto.randomUUID();
  await db.batch([
    stmt(db, 'DELETE FROM email_confirmations WHERE user_id = ?', [userId]),
    stmt(db, 'INSERT INTO email_confirmations (token, user_id, email, created_at) VALUES (?, ?, ?, ?)', [
      token,
      userId,
      email,
      now.toISOString(),
    ]),
  ]);
  return token;
}

export async function logSend(
  db: D1Database,
  row: { user_id: string; kind: EmailKind; to_email: string; provider_id: string | null },
  now = new Date(),
): Promise<void> {
  await run(db, 'INSERT INTO email_sends (user_id, kind, to_email, provider_id, sent_at) VALUES (?, ?, ?, ?, ?)', [
    row.user_id,
    row.kind,
    row.to_email,
    row.provider_id,
    now.toISOString(),
  ]);
}
