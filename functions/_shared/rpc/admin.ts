/**
 * Admin analytics + win-back (ported from the Postgres SECURITY DEFINER RPCs
 * admin_kpis, admin_user_list, admin_retention, admin_email_stats,
 * admin_outreach_leads, admin_mark_contacted, admin_unmark_contacted,
 * admin_landing_ctas, admin_supporters) and the anonymous funnel-event insert.
 *
 * Every admin handler is `adminRpc` (email allowlist in functions/_shared/auth.ts).
 * The heavy aggregates are a few GROUP BY scans assembled in TypeScript:
 * the tables are small (hundreds of users, a few thousand sessions/events),
 * and TS keeps the Postgres-only bits (percentile_cont, regex, grouping sets,
 * date_trunc) readable.
 *
 * Emails: Lichess accounts carry the placeholder `<id>@lichess.invalid`
 * (isPlaceholderEmail in ../auth); every email this module returns maps that
 * placeholder to null, like Supabase's empty email.
 */
import { adminRpc, argString, badRequest, publicRpc, type RpcRegistry } from './core';
import { all, first, nowIso, run, uuid } from '../db';

/** The owner's own account stays out of the KPI funnel / retention (as in Postgres). */
const KPI_EXCLUDED_EMAIL = 'elliotmharris@gmail.com';

/** SQL: the user's real email, NULL for '' and the Lichess placeholder (keep in sync with LICHESS_PLACEHOLDER_DOMAIN). */
const REAL_EMAIL_SQL = `CASE WHEN u.email IS NULL OR u.email = '' OR lower(u.email) LIKE '%@lichess.invalid' THEN NULL ELSE u.email END`;

const DAY_MS = 86400_000;

// --- pure helpers ------------------------------------------------------------

/** Bot / tool user agents dropped from landing views (Postgres `!~*` list in admin_kpis). */
export const BOT_UA_RE =
  /(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|python-requests|curl|wget|monitor|preview|scan|lighthouse|pingdom|uptime)/i;

/** percentile_cont(p) within group (order by x): linear interpolation, 0 for an empty set. */
export function percentileCont(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** UTC calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function utcDay(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Whole days from date a to date b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the ISO week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

const maxTs = (a: string | null, b: string | null): string | null => (a && b ? (a > b ? a : b) : a ?? b);

function countBy<T>(items: readonly T[], key: (t: T) => string): { date: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count }));
}

// --- per-user funnel (shared by admin.kpis and admin.userList) ----------------

export interface FunnelUser {
  id: string;
  email: string | null;
  displayName: string | null;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  createdAt: string;
  connected: boolean;
  synced: boolean;
  foundBlunders: boolean;
  openedTraining: boolean;
  trained: boolean;
  games: number;
  blunders: number;
  trainingSessions: number;
  lastSessionAt: string | null;
  lastActive: string | null;
}

interface ActivityMaps {
  games: Map<string, { games: number; analyzed: boolean; lastGame: string | null }>;
  blunders: Map<string, number>;
  sessions: Map<string, { sessions: number; lastSession: string | null; attempted: boolean }>;
}

async function activityMaps(db: D1Database): Promise<ActivityMaps> {
  const [g, b, t] = await Promise.all([
    all<{ user_id: string; games: number; analyzed: number; last_game: string | null }>(
      db,
      `SELECT user_id, count(*) AS games, max(analyzed_at IS NOT NULL) AS analyzed, max(created_at) AS last_game
       FROM games WHERE user_id IS NOT NULL GROUP BY user_id`,
    ),
    all<{ user_id: string; n: number }>(db, `SELECT user_id, count(*) AS n FROM blunders WHERE user_id IS NOT NULL GROUP BY user_id`),
    all<{ user_id: string; sessions: number; last_session: string | null; attempted: number }>(
      db,
      `SELECT user_id, count(*) AS sessions, max(started_at) AS last_session, max(blunders_attempted > 0) AS attempted
       FROM training_sessions GROUP BY user_id`,
    ),
  ]);
  return {
    games: new Map(g.map((r) => [r.user_id, { games: r.games, analyzed: !!r.analyzed, lastGame: r.last_game }])),
    blunders: new Map(b.map((r) => [r.user_id, r.n])),
    sessions: new Map(
      t.map((r) => [r.user_id, { sessions: r.sessions, lastSession: r.last_session, attempted: !!r.attempted }]),
    ),
  };
}

/** Last activity per user: newest training session start or game import. */
function lastActive(maps: ActivityMaps, userId: string): string | null {
  return maxTs(maps.sessions.get(userId)?.lastSession ?? null, maps.games.get(userId)?.lastGame ?? null);
}

/** Every profile except the owner's, with its funnel flags and counts. */
async function funnelUsers(db: D1Database, maps: ActivityMaps): Promise<FunnelUser[]> {
  const profiles = await all<{
    id: string;
    created_at: string;
    display_name: string | null;
    lichess_username: string | null;
    chesscom_username: string | null;
    connected: number;
    email: string | null;
  }>(
    db,
    `SELECT p.id, p.created_at, p.display_name, p.lichess_username, p.chesscom_username,
       (p.lichess_username IS NOT NULL OR p.chesscom_username IS NOT NULL
        OR p.last_synced_lichess_at IS NOT NULL OR p.last_synced_chesscom_at IS NOT NULL) AS connected,
       ${REAL_EMAIL_SQL} AS email
     FROM profiles p LEFT JOIN "user" u ON u.id = p.id
     WHERE lower(coalesce(u.email, '')) <> ?`,
    [KPI_EXCLUDED_EMAIL],
  );
  return profiles.map((p) => {
    const g = maps.games.get(p.id);
    const s = maps.sessions.get(p.id);
    return {
      id: p.id,
      email: p.email,
      displayName: p.display_name,
      lichessUsername: p.lichess_username,
      chesscomUsername: p.chesscom_username,
      createdAt: p.created_at,
      connected: !!p.connected,
      synced: !!g,
      foundBlunders: !!g?.analyzed,
      openedTraining: !!s,
      trained: !!s?.attempted,
      games: g?.games ?? 0,
      blunders: maps.blunders.get(p.id) ?? 0,
      trainingSessions: s?.sessions ?? 0,
      lastSessionAt: s?.lastSession ?? null,
      lastActive: lastActive(maps, p.id),
    };
  });
}

/** The row shape admin_kpis.recentSignups / admin_user_list returned (no id, no openedTraining). */
function userRowOut(u: FunnelUser) {
  return {
    email: u.email,
    displayName: u.displayName,
    lichessUsername: u.lichessUsername,
    chesscomUsername: u.chesscomUsername,
    createdAt: u.createdAt,
    connected: u.connected,
    synced: u.synced,
    foundBlunders: u.foundBlunders,
    trained: u.trained,
    games: u.games,
    blunders: u.blunders,
    trainingSessions: u.trainingSessions,
    lastSessionAt: u.lastSessionAt,
    lastActive: u.lastActive,
  };
}

// --- admin.kpis ------------------------------------------------------------------

async function adminKpis(db: D1Database, now = new Date()) {
  const maps = await activityMaps(db);
  const users = await funnelUsers(db, maps);
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

  // DAU/WAU/MAU over everyone (the owner included, as before).
  const allIds = new Set([...maps.games.keys(), ...maps.sessions.keys()]);
  const activeSince = (iso: string) => [...allIds].filter((id) => (lastActive(maps, id) ?? '') >= iso).length;

  const [platforms, sessionTimes, topTrainees, landingViews, demo, leads] = await Promise.all([
    all<{ platform: string; users: number; games: number }>(
      db,
      `SELECT platform, count(DISTINCT user_id) AS users, count(*) AS games FROM games GROUP BY platform ORDER BY games DESC`,
    ),
    all<{ started_at: string; ended_at: string | null }>(db, `SELECT started_at, ended_at FROM training_sessions`),
    all<{ email: string | null; displayName: string | null; sessions: number }>(
      db,
      `SELECT ${REAL_EMAIL_SQL} AS email, p.display_name AS displayName, t.sessions
       FROM (SELECT user_id, count(*) AS sessions FROM training_sessions GROUP BY user_id) t
       JOIN profiles p ON p.id = t.user_id JOIN "user" u ON u.id = t.user_id
       ORDER BY t.sessions DESC LIMIT 5`,
    ),
    all<{ anon_id: string; user_agent: string | null; created_at: string }>(
      db,
      `SELECT anon_id, user_agent, created_at FROM funnel_events WHERE type = 'landing_view'`,
    ),
    first<{ entered: number; converted: number }>(
      db,
      `SELECT count(DISTINCT fe.anon_id) AS entered,
         count(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM profiles p WHERE p.anon_id = fe.anon_id) THEN fe.anon_id END) AS converted
       FROM funnel_events fe WHERE fe.type = 'demo_submit'`,
    ),
    all<{ username: string; platform: string | null; attempts: number; lastSeen: string; converted: number }>(
      db,
      `SELECT fe.username, fe.platform, count(*) AS attempts, max(fe.created_at) AS lastSeen,
         max(EXISTS (SELECT 1 FROM profiles p WHERE p.anon_id = fe.anon_id)) AS converted
       FROM funnel_events fe
       WHERE fe.type = 'demo_submit' AND fe.username IS NOT NULL
       GROUP BY fe.username, fe.platform
       ORDER BY lastSeen DESC LIMIT 200`,
    ),
  ]);

  // Human landing visitors: anon ids with at least one non-bot landing view.
  const human = new Set(
    landingViews.filter((v) => v.user_agent !== null && !BOT_UA_RE.test(v.user_agent)).map((v) => v.anon_id),
  );
  const viewsPerDay = new Map<string, Set<string>>();
  for (const v of landingViews) {
    if (!human.has(v.anon_id)) continue;
    const day = utcDay(v.created_at);
    if (!viewsPerDay.has(day)) viewsPerDay.set(day, new Set());
    viewsPerDay.get(day)!.add(v.anon_id);
  }

  // Training durations: finished sessions shorter than 6 hours.
  const durations: number[] = [];
  for (const s of sessionTimes) {
    if (!s.ended_at) continue;
    const sec = (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000;
    if (sec > 0 && sec < 6 * 3600) durations.push(sec);
  }
  const since30 = since(30);

  return {
    totals: {
      signups: users.length,
      connected: users.filter((u) => u.connected).length,
      synced: users.filter((u) => u.synced).length,
      foundBlunders: users.filter((u) => u.foundBlunders).length,
      openedTraining: users.filter((u) => u.openedTraining).length,
      trained: users.filter((u) => u.trained).length,
    },
    activity: { dau: activeSince(since(1)), wau: activeSince(since(7)), mau: activeSince(since30) },
    signupsByDay: countBy(users, (u) => utcDay(u.createdAt)),
    platforms,
    recentSignups: [...users]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, 50)
      .map(userRowOut),
    landingFunnel: {
      views: human.size,
      entered: demo?.entered ?? 0,
      converted: demo?.converted ?? 0,
    },
    viewsByDay: [...viewsPerDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, ids]) => ({ date, count: ids.size })),
    leads: leads.map((l) => ({ ...l, converted: !!l.converted })),
    trainingAnalytics: {
      avgDurationSeconds: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      medianDurationSeconds: percentileCont(durations, 0.5),
      sessionsWithDuration: durations.length,
      sessionsByDay: countBy(
        sessionTimes.filter((s) => s.started_at >= since30),
        (s) => utcDay(s.started_at),
      ),
      topTrainees,
    },
  };
}

// --- admin.userList ----------------------------------------------------------------

export const USER_LIST_CATEGORIES = [
  'signups',
  'connected',
  'synced',
  'foundBlunders',
  'openedTraining',
  'trained',
  'dau',
  'wau',
  'mau',
] as const;
export type UserListCategory = (typeof USER_LIST_CATEGORIES)[number];

/** desc, nulls last */
function cmpDesc<T extends string | number>(a: T | null, b: T | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/** admin_user_list's filter + ordering (capped at 500 rows). */
export function filterUserList(users: readonly FunnelUser[], category: UserListCategory, now = new Date()): FunnelUser[] {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const keep: Record<UserListCategory, (u: FunnelUser) => boolean> = {
    signups: () => true,
    connected: (u) => u.connected,
    synced: (u) => u.synced,
    foundBlunders: (u) => u.foundBlunders,
    openedTraining: (u) => u.openedTraining,
    trained: (u) => u.trained,
    dau: (u) => (u.lastActive ?? '') >= since(1),
    wau: (u) => (u.lastActive ?? '') >= since(7),
    mau: (u) => (u.lastActive ?? '') >= since(30),
  };
  const byActivity = ['dau', 'wau', 'mau', 'synced'].includes(category);
  return users
    .filter(keep[category])
    .sort(
      (a, b) =>
        (category === 'trained'
          ? cmpDesc(a.trainingSessions, b.trainingSessions) || cmpDesc(a.lastSessionAt, b.lastSessionAt)
          : 0) ||
        (category === 'foundBlunders' ? cmpDesc(a.blunders, b.blunders) : 0) ||
        (byActivity ? cmpDesc(a.lastActive, b.lastActive) : 0) ||
        cmpDesc(a.createdAt, b.createdAt),
    )
    .slice(0, 500);
}

// --- admin.retention -----------------------------------------------------------------
//
// Industry-standard retention (the definition AppsFlyer / Adjust / Amplitude
// benchmarks use): a user is retained on day N when they were active ON day N
// after signup (signup day = day 0), in their own timezone. Bracket windows
// (Week 4 = days 22–28) count activity on any day inside the window. A user
// counts toward a window only once it has fully passed for them, so a young
// cohort shows no number instead of a falsely low one.

export interface RetentionWindow {
  key: string;
  label: string;
  /** First and last day after signup (inclusive). */
  start: number;
  end: number;
}

export const RETENTION_WINDOWS: readonly RetentionWindow[] = [
  { key: 'd1', label: 'D1', start: 1, end: 1 },
  { key: 'd7', label: 'D7', start: 7, end: 7 },
  { key: 'd30', label: 'D30', start: 30, end: 30 },
  { key: 'w1', label: 'Week 1', start: 1, end: 7 },
  { key: 'w2', label: 'Week 2', start: 8, end: 14 },
  { key: 'w4', label: 'Week 4', start: 22, end: 28 },
  { key: 'w8', label: 'Week 8', start: 50, end: 56 },
];

export interface RetentionInput {
  /** Owner excluded. `signup` and `today` are calendar days in the user's timezone. */
  users: readonly { id: string; signup: string; today: string }[];
  /** Distinct (user, local day) pairs with training activity. */
  active: readonly { user_id: string; d: string }[];
  /** today (UTC, YYYY-MM-DD), for the weekly actives. */
  today: string;
}

export interface RetentionCount {
  eligible: number;
  retained: number;
}

export interface RetentionCohortRow {
  /** `YYYY-MM` signup month, `YYYY-MM-DD` signup week (its Monday), or `all`. */
  cohort: string;
  signups: number;
  trained: number;
  trained2Days: number;
  trained5Days: number;
  windows: Record<string, RetentionCount>;
}

export function computeRetention({ users, active, today }: RetentionInput) {
  const daysByUser = new Map<string, Set<string>>();
  for (const a of active) {
    if (!daysByUser.has(a.user_id)) daysByUser.set(a.user_id, new Set());
    daysByUser.get(a.user_id)!.add(a.d);
  }
  const perUser = users.map((u) => {
    const days = daysByUser.get(u.id) ?? new Set<string>();
    return {
      ...u,
      activeDays: days.size,
      offsets: new Set([...days].map((d) => daysBetween(u.signup, d))),
      // The last day after signup that has fully ended for this user.
      elapsed: daysBetween(u.signup, u.today) - 1,
    };
  });
  type PU = (typeof perUser)[number];

  const cohortOf = (members: PU[], cohort: string): RetentionCohortRow => {
    const windows: Record<string, RetentionCount> = {};
    for (const w of RETENTION_WINDOWS) {
      const eligible = members.filter((m) => m.elapsed >= w.end);
      const retained = eligible.filter((m) => {
        for (let d = w.start; d <= w.end; d++) if (m.offsets.has(d)) return true;
        return false;
      }).length;
      windows[w.key] = { eligible: eligible.length, retained };
    }
    return {
      cohort,
      signups: members.length,
      trained: members.filter((m) => m.activeDays > 0).length,
      trained2Days: members.filter((m) => m.activeDays >= 2).length,
      trained5Days: members.filter((m) => m.activeDays >= 5).length,
      windows,
    };
  };
  const groupBy = (key: (u: PU) => string) => {
    const m = new Map<string, PU[]>();
    for (const u of perUser) {
      const k = key(u);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(u);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([c, us]) => cohortOf(us, c));
  };

  // Weekly actives over the last 12 ISO weeks; "returning" = signed up before that week.
  const signupOf = new Map(users.map((u) => [u.id, u.signup]));
  const from = addDays(mondayOf(today), -7 * 11);
  const weekMap = new Map<string, { active: Set<string>; returning: Set<string> }>();
  for (const a of active) {
    const signup = signupOf.get(a.user_id);
    if (!signup || a.d < from) continue;
    const week = mondayOf(a.d);
    if (!weekMap.has(week)) weekMap.set(week, { active: new Set(), returning: new Set() });
    const w = weekMap.get(week)!;
    w.active.add(a.user_id);
    if (signup < week) w.returning.add(a.user_id);
  }
  const weeks = [...weekMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, w]) => ({ week, active: w.active.size, returning: w.returning.size }));
  return {
    windows: RETENTION_WINDOWS,
    all: cohortOf(perUser, 'all'),
    byWeek: groupBy((u) => mondayOf(u.signup)),
    byMonth: groupBy((u) => u.signup.slice(0, 7)),
    weeks,
  };
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar day (YYYY-MM-DD) of an instant in `tz`; UTC when the zone is missing or unknown. */
export function localDay(ts: string | Date, tz: string | null | undefined): string {
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  if (!tz) return date.toISOString().slice(0, 10);
  let f = dayFormatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return date.toISOString().slice(0, 10);
    }
    dayFormatters.set(tz, f);
  }
  return f.format(date);
}

async function adminRetention(db: D1Database, now = new Date()) {
  const [users, storedDays, drillHours] = await Promise.all([
    all<{ id: string; created_at: string; timezone: string | null }>(
      db,
      `SELECT p.id, p.created_at, p.timezone FROM profiles p LEFT JOIN "user" u ON u.id = p.id
       WHERE lower(coalesce(u.email, '')) <> ?`,
      [KPI_EXCLUDED_EMAIL],
    ),
    // Drill sessions with a first-attempt position, and finished course lessons.
    all<{ user_id: string; d: string; utc_d: string }>(
      db,
      `SELECT user_id, local_date AS d, substr(started_at, 1, 10) AS utc_d FROM training_sessions
         WHERE blunders_attempted > 0
       UNION SELECT user_id, local_date AS d, substr(completed_at, 1, 10) AS utc_d FROM course_progress`,
    ),
    // Opening reviews and endgame play-outs keep only their latest drill time,
    // so they add at most one day per item (a lower bound on that activity).
    all<{ user_id: string; h: string }>(
      db,
      `SELECT user_id, substr(last_drilled_at, 1, 13) AS h FROM blunders
         WHERE last_drilled_at IS NOT NULL AND kind = 'opening'
       UNION SELECT user_id, substr(last_drilled_at, 1, 13) AS h FROM endgame_scenarios
         WHERE last_drilled_at IS NOT NULL`,
    ),
  ]);
  const tzOf = new Map(users.map((u) => [u.id, u.timezone]));
  // A player with no saved timezone is measured in UTC throughout (signup too),
  // so their stored local dates would be off by a day against it.
  const active = [
    ...storedDays.map((r) => ({ user_id: r.user_id, d: tzOf.get(r.user_id) ? r.d : r.utc_d })),
    ...drillHours.map((r) => ({ user_id: r.user_id, d: localDay(`${r.h}:30:00Z`, tzOf.get(r.user_id)) })),
  ];
  return computeRetention({
    users: users.map((u) => ({
      id: u.id,
      signup: localDay(u.created_at, u.timezone),
      today: localDay(now, u.timezone),
    })),
    active,
    today: now.toISOString().slice(0, 10),
  });
}

// --- admin.emailStats ---------------------------------------------------------------

async function adminEmailStats(db: D1Database, now = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const [acct, misc, kinds] = await Promise.all([
    all<{ email_opt_in: number; created_at: string; has_address: number; trained_7d: number }>(
      db,
      `SELECT p.email_opt_in, p.created_at,
         ((${REAL_EMAIL_SQL}) IS NOT NULL AND p.contact_email IS NULL) OR p.contact_email_verified_at IS NOT NULL AS has_address,
         EXISTS (SELECT 1 FROM training_sessions t
                 WHERE t.user_id = p.id AND t.blunders_attempted > 0 AND t.started_at >= ?) AS trained_7d
       FROM profiles p JOIN "user" u ON u.id = p.id`,
      [ago(7)],
    ),
    first<{ prompted: number; confirm_pending: number; unsubscribed: number }>(
      db,
      `SELECT
         sum(email_prompt_count > 0) AS prompted,
         sum(email_opt_in = 1 AND contact_email IS NOT NULL AND contact_email_verified_at IS NULL) AS confirm_pending,
         sum(email_unsubscribed_at >= ?) AS unsubscribed
       FROM profiles`,
      [ago(30)],
    ),
    all<{ kind: string; sent: number; returned: number }>(
      db,
      `SELECT s.kind, count(*) AS sent,
         sum(EXISTS (SELECT 1 FROM training_sessions ts
                     WHERE ts.user_id = s.user_id AND ts.blunders_attempted > 0
                       AND ts.started_at BETWEEN s.sent_at
                         AND strftime('%Y-%m-%dT%H:%M:%fZ', s.sent_at, '+1 day'))) AS returned
       FROM email_sends s
       WHERE s.sent_at >= ? AND s.kind <> 'confirm'
       GROUP BY s.kind ORDER BY s.kind`,
      [ago(30)],
    ),
  ]);
  const weekOld = ago(7);
  const group = (reachable: boolean) => {
    const rows = acct.filter((a) => a.created_at <= weekOld && (!!a.email_opt_in && !!a.has_address) === reachable);
    return { accounts: rows.length, trained: rows.filter((r) => r.trained_7d).length };
  };
  return {
    optedIn: acct.filter((a) => a.email_opt_in).length,
    reachable: acct.filter((a) => a.email_opt_in && a.has_address).length,
    noAddress: acct.filter((a) => !a.has_address).length,
    prompted: misc?.prompted ?? 0,
    confirmPending: misc?.confirm_pending ?? 0,
    unsubscribed30d: misc?.unsubscribed ?? 0,
    returnRate: { reachable: group(true), other: group(false) },
    kinds: kinds.map((k) => ({ kind: k.kind, sent: k.sent, returned: k.returned ?? 0 })),
  };
}

// --- admin.outreachLeads -------------------------------------------------------------

export const OUTREACH_SEGMENTS = [
  'demo_only',
  'signed_up_not_connected',
  'connected_no_games',
  'synced_never_trained',
  'contacted',
] as const;
export type OutreachSegment = (typeof OUTREACH_SEGMENTS)[number];

export interface OutreachProfile {
  id: string;
  created_at: string;
  anon_id: string | null;
  lichess_username: string | null;
  chesscom_username: string | null;
  email: string | null;
  has_games: boolean;
  trained: boolean;
  blunders: number;
}

export interface OutreachDemoEvent {
  anon_id: string;
  platform: string;
  username: string;
  created_at: string;
}

export interface OutreachInput {
  profiles: readonly OutreachProfile[];
  demoEvents: readonly OutreachDemoEvent[];
  outreach: readonly { lead_key: string; segment: string; contacted_at: string; note: string | null }[];
  /** user id → session start times (only needed for the contacted segment). */
  sessionStarts: ReadonlyMap<string, readonly string[]>;
}

export interface OutreachRow {
  leadKey: string;
  platform: string | null;
  username: string | null;
  email: string | null;
  since: string | null;
  lastSeen: string | null;
  attempts: number | null;
  blunders: number | null;
  contactedAt: string | null;
  note: string | null;
  signedUp: boolean;
  trainedSinceContact: boolean;
}

/** admin_outreach_leads(segment), in TS. */
export function computeOutreach(segment: OutreachSegment, input: OutreachInput) {
  const prof = input.profiles.map((p) => {
    const lichess = p.lichess_username || null;
    const chesscom = p.chesscom_username || null;
    return {
      ...p,
      lichess,
      chesscom,
      lead_key: lichess
        ? `lichess:${lichess.toLowerCase()}`
        : chesscom
          ? `chesscom:${chesscom.toLowerCase()}`
          : `user:${p.id}`,
    };
  });
  const profById = new Map(prof.map((p) => [p.id, p]));
  const handles = new Map<string, string>();
  for (const p of prof) {
    if (p.lichess && !handles.has(`lichess:${p.lichess.toLowerCase()}`)) handles.set(`lichess:${p.lichess.toLowerCase()}`, p.id);
  }
  for (const p of prof) {
    if (p.chesscom && !handles.has(`chesscom:${p.chesscom.toLowerCase()}`)) handles.set(`chesscom:${p.chesscom.toLowerCase()}`, p.id);
  }
  const signupAnon = new Set(prof.map((p) => p.anon_id).filter((a): a is string => !!a));

  // Demo submits per (platform, lower(username)).
  const demo = new Map<
    string,
    { lead_key: string; platform: string; username: string; latest: string; since: string; last_seen: string; attempts: number; converted: boolean }
  >();
  for (const e of input.demoEvents) {
    const key = `${e.platform}:${e.username.toLowerCase()}`;
    const d = demo.get(key);
    if (!d) {
      demo.set(key, {
        lead_key: key,
        platform: e.platform,
        username: e.username,
        latest: e.created_at,
        since: e.created_at,
        last_seen: e.created_at,
        attempts: 1,
        converted: signupAnon.has(e.anon_id),
      });
    } else {
      d.attempts += 1;
      d.converted ||= signupAnon.has(e.anon_id);
      if (e.created_at < d.since) d.since = e.created_at;
      if (e.created_at > d.last_seen) {
        d.last_seen = e.created_at;
        d.username = e.username;
      }
    }
  }

  type Candidate = {
    lead_key: string;
    platform: string | null;
    username: string | null;
    email: string | null;
    since: string | null;
    last_seen: string | null;
    attempts: number | null;
    blunders: number | null;
    seg: OutreachSegment | null;
    user_id: string | null;
  };
  const candidates: Candidate[] = [];
  for (const d of demo.values()) {
    if (d.converted || handles.has(d.lead_key)) continue;
    candidates.push({
      lead_key: d.lead_key,
      platform: d.platform,
      username: d.username,
      email: null,
      since: d.since,
      last_seen: d.last_seen,
      attempts: d.attempts,
      blunders: null,
      seg: 'demo_only',
      user_id: null,
    });
  }
  for (const p of prof) {
    const hasHandle = !!(p.lichess || p.chesscom);
    candidates.push({
      lead_key: p.lead_key,
      platform: p.lichess ? 'lichess' : p.chesscom ? 'chesscom' : null,
      username: p.lichess ?? p.chesscom,
      email: p.email,
      since: p.created_at,
      last_seen: p.created_at,
      attempts: null,
      blunders: p.blunders,
      seg:
        !hasHandle && !p.has_games
          ? 'signed_up_not_connected'
          : hasHandle && !p.has_games
            ? 'connected_no_games'
            : p.has_games && !p.trained
              ? 'synced_never_trained'
              : null,
      user_id: p.id,
    });
  }

  const contacted = new Map(input.outreach.map((o) => [o.lead_key, o]));

  const counts: Partial<Record<OutreachSegment, number>> = {};
  for (const c of candidates) {
    if (!c.seg) continue;
    counts[c.seg] = (counts[c.seg] ?? 0) + (contacted.has(c.lead_key) ? 0 : 1);
  }
  counts.contacted = input.outreach.length;

  let rows: OutreachRow[];
  if (segment !== 'contacted') {
    rows = candidates
      .filter((c) => c.seg === segment)
      .map((c) => {
        const o = contacted.get(c.lead_key);
        return {
          leadKey: c.lead_key,
          platform: c.platform,
          username: c.username,
          email: c.email,
          since: c.since,
          lastSeen: c.last_seen,
          attempts: c.attempts,
          blunders: c.blunders,
          contactedAt: o?.contacted_at ?? null,
          note: o?.note ?? null,
          signedUp: c.user_id !== null,
          trainedSinceContact: false,
        };
      })
      // Not-yet-contacted first, then most recently seen.
      .sort((a, b) => Number(a.contactedAt !== null) - Number(b.contactedAt !== null) || cmpDesc(a.lastSeen, b.lastSeen));
  } else {
    rows = input.outreach
      .map((o) => {
        const userId =
          handles.get(o.lead_key) ?? (o.lead_key.startsWith('user:') ? o.lead_key.slice(5) : null);
        const p = userId ? profById.get(userId) : undefined;
        const [platform, handle] = o.lead_key.split(':');
        return {
          leadKey: o.lead_key,
          platform: platform ?? null,
          username: o.lead_key.startsWith('user:') ? null : handle ?? '',
          email: p?.email ?? null,
          since: null,
          lastSeen: null,
          attempts: null,
          blunders: p ? p.blunders : null,
          contactedAt: o.contacted_at,
          note: o.note,
          signedUp: userId !== null,
          trainedSinceContact: !!userId && (input.sessionStarts.get(userId) ?? []).some((s) => s >= o.contacted_at),
        };
      })
      .sort((a, b) => cmpDesc(a.contactedAt, b.contactedAt));
  }
  return { segment, counts, rows };
}

async function adminOutreachLeads(db: D1Database, segment: OutreachSegment) {
  const [profiles, demoEvents, outreach] = await Promise.all([
    all<{
      id: string;
      created_at: string;
      anon_id: string | null;
      lichess_username: string | null;
      chesscom_username: string | null;
      email: string | null;
      has_games: number;
      trained: number;
      blunders: number;
    }>(
      db,
      `SELECT p.id, p.created_at, p.anon_id, p.lichess_username, p.chesscom_username,
         ${REAL_EMAIL_SQL} AS email,
         EXISTS (SELECT 1 FROM games g WHERE g.user_id = p.id) AS has_games,
         EXISTS (SELECT 1 FROM training_sessions t WHERE t.user_id = p.id) AS trained,
         (SELECT count(*) FROM blunders b WHERE b.user_id = p.id AND b.retired_at IS NULL) AS blunders
       FROM profiles p LEFT JOIN "user" u ON u.id = p.id`,
    ),
    all<OutreachDemoEvent>(
      db,
      `SELECT anon_id, platform, username, created_at FROM funnel_events
       WHERE type = 'demo_submit' AND username IS NOT NULL AND platform IN ('lichess', 'chesscom')`,
    ),
    all<{ lead_key: string; segment: string; contacted_at: string; note: string | null }>(
      db,
      `SELECT lead_key, segment, contacted_at, note FROM lead_outreach`,
    ),
  ]);
  const sessionStarts = new Map<string, string[]>();
  if (segment === 'contacted' && outreach.length) {
    const rows = await all<{ user_id: string; started_at: string }>(db, `SELECT user_id, started_at FROM training_sessions`);
    for (const r of rows) {
      if (!sessionStarts.has(r.user_id)) sessionStarts.set(r.user_id, []);
      sessionStarts.get(r.user_id)!.push(r.started_at);
    }
  }
  return computeOutreach(segment, {
    profiles: profiles.map((p) => ({ ...p, has_games: !!p.has_games, trained: !!p.trained })),
    demoEvents,
    outreach,
    sessionStarts,
  });
}

// --- funnel.track (anonymous) ----------------------------------------------------------

const FUNNEL_TYPES = new Set(['landing_view', 'demo_submit', 'cta_click', 'lead_return']);

function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

// --- registry -------------------------------------------------------------------------

export const handlers: RpcRegistry = {
  /**
   * Anonymous landing-funnel event (was an anon PostgREST insert). Never
   * returns data; only admin.* reads the table back.
   */
  'funnel.track': publicRpc<Record<string, unknown>>(async (ctx, args) => {
    const type = args.type;
    if (typeof type !== 'string' || !FUNNEL_TYPES.has(type)) throw badRequest('unknown event type');
    const anonId = clip(args.anon_id, 100);
    if (!anonId) throw badRequest('anon_id is required');
    await run(
      ctx.db,
      `INSERT INTO funnel_events (id, anon_id, type, platform, username, user_agent, referrer, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        anonId,
        type,
        clip(args.platform, 32),
        clip(args.username, 64),
        clip(args.user_agent, 512) ?? clip(ctx.request.headers.get('user-agent'), 512),
        clip(args.referrer, 2048),
        clip(args.source, 64),
        nowIso(),
      ],
    );
    return null;
  }),

  'admin.kpis': adminRpc(async (ctx) => adminKpis(ctx.db)),

  'admin.userList': adminRpc<{ category?: unknown }>(async (ctx, args) => {
    const category = args.category as UserListCategory;
    if (!USER_LIST_CATEGORIES.includes(category)) throw badRequest(`unknown category: ${String(args.category)}`);
    const users = await funnelUsers(ctx.db, await activityMaps(ctx.db));
    return filterUserList(users, category).map(userRowOut);
  }),

  'admin.retention': adminRpc(async (ctx) => adminRetention(ctx.db)),

  'admin.emailStats': adminRpc(async (ctx) => adminEmailStats(ctx.db)),

  'admin.outreachLeads': adminRpc<{ segment?: unknown }>(async (ctx, args) => {
    const segment = args.segment as OutreachSegment;
    if (!OUTREACH_SEGMENTS.includes(segment)) throw badRequest(`unknown segment ${String(args.segment)}`);
    return adminOutreachLeads(ctx.db, segment);
  }),

  'admin.markContacted': adminRpc<Record<string, unknown>>(async (ctx, args) => {
    const leadKey = argString(args, 'leadKey');
    const segment = argString(args, 'segment');
    const note = clip(args.note, 2000);
    await run(
      ctx.db,
      `INSERT INTO lead_outreach (lead_key, segment, contacted_at, note) VALUES (?, ?, ?, ?)
       ON CONFLICT (lead_key) DO UPDATE SET note = coalesce(excluded.note, lead_outreach.note)`,
      [leadKey, segment, nowIso(), note],
    );
    return null;
  }),

  'admin.unmarkContacted': adminRpc<Record<string, unknown>>(async (ctx, args) => {
    await run(ctx.db, `DELETE FROM lead_outreach WHERE lead_key = ?`, [argString(args, 'leadKey')]);
    return null;
  }),

  'admin.landingCtas': adminRpc<{ days?: unknown }>(async (ctx, args) => {
    const days = Math.min(Math.max(typeof args.days === 'number' && Number.isFinite(args.days) ? Math.floor(args.days) : 30, 1), 3650);
    return all<{ type: string; source: string; events: number; visitors: number }>(
      ctx.db,
      `SELECT type, coalesce(source, '(none)') AS source, count(*) AS events, count(DISTINCT anon_id) AS visitors
       FROM funnel_events
       WHERE type IN ('cta_click', 'lead_return') AND created_at >= ?
       GROUP BY type, coalesce(source, '(none)')
       ORDER BY type, events DESC`,
      [new Date(Date.now() - days * DAY_MS).toISOString()],
    );
  }),

  /** Supporter roster (snake_case rows, as the old `admin_supporters()` TABLE returned). */
  'admin.supporters': adminRpc(async (ctx) => {
    const rows = await all<Record<string, unknown>>(
      ctx.db,
      `SELECT s.user_id,
         coalesce(nullif(p.lichess_username, ''), nullif(p.chesscom_username, ''), nullif(p.display_name, ''), 'Player') AS label,
         coalesce(${REAL_EMAIL_SQL}, CASE WHEN p.contact_email_verified_at IS NOT NULL THEN p.contact_email END) AS email,
         s.status, s.first_supported_at, s.current_period_end, s.cancel_at_period_end, s.beta_invited_at
       FROM supporters s
       JOIN profiles p ON p.id = s.user_id
       JOIN "user" u ON u.id = s.user_id
       WHERE s.first_supported_at IS NOT NULL
       ORDER BY s.first_supported_at`,
    );
    return rows.map((r) => ({ ...r, cancel_at_period_end: !!r.cancel_at_period_end }));
  }),
};

export const __test = { adminKpis, adminRetention, adminEmailStats, adminOutreachLeads, funnelUsers, activityMaps };
