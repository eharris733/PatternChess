// The email rules engine: which email (if any) each player gets this hour.
// A TypeScript port of the Postgres email_candidates() function (Supabase
// migration 20261122120000), which the D1 move retired. The SQL side
// (store.ts) only gathers per-player facts; every decision lives here, pure,
// so outbox.test.ts covers each rule.
//
// Rules, in order (the first that applies wins):
//   confirm         a typed-in contact address is unconfirmed: send the
//                   confirmation at most every 23 h; nothing else goes out.
//   (no address)    nothing (Lichess sign-ins without a contact address).
//   welcome         account < 2 days old, nothing sent yet, and either has
//                   positions or is >= 3 h old. Any hour.
//   -- below here only at the player's local email_hour, and never within
//   -- 20 h of the previous (non-confirm) email --
//   ready           positions exist, never trained, no ready yet, account
//                   20 h .. 14 days old.
//   weekly_report   reports on, has trained, local Sunday, none in 6 days.
//   streak_at_risk  reminders on, streak >= 2, last trained local yesterday,
//                   < 6 unanswered reminders.
//   daily_plan      reminders on, tactic/endgame positions due, not trained
//                   local today, account >= 20 h old, < 6 unanswered, and the
//                   last reminder older than 20 h (few_days: 2 d 20 h; after
//                   3 unanswered: 6 d 20 h — the weekly back-off).
//
// Content rules (what goes inside an email, not which one is sent):
//   events near you  weekly_report only, and only for a state the player
//                    saved (profiles.events_state); see eventsStateFor.

import type { EmailKind } from './templates';
import { isUsStateCode } from './usStates';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Reminder kinds: they count toward "unanswered" and the reminder spacing. */
export const REMINDER_KINDS = ['ready', 'reminder', 'daily_plan', 'streak_at_risk'] as const;
export const REPORT_KINDS = ['report', 'weekly_report'] as const;

/** Lichess sign-ins get this placeholder in better-auth's `user.email`: no address. */
export const PLACEHOLDER_EMAIL_DOMAIN = '@lichess.invalid';

export function realEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN) ? null : email;
}

/** Per-player facts gathered by store.ts (snake_case = straight from SQL). */
export interface CandidateFacts {
  id: string;
  created_at: string | null;
  email_reminders: string;
  email_reports: string;
  email_hour: number;
  email_unsub_token: string;
  current_streak_days: number;
  last_drill_local_date: string | null;
  contact_email: string | null;
  contact_email_verified_at: string | null;
  streak_freezes: number;
  positions_goal: number;
  games_goal: number;
  /** better-auth user.email (placeholder for Lichess = no address). */
  auth_email: string | null;
  display_name: string | null;
  lichess_username: string | null;
  chesscom_username: string | null;
  timezone: string | null;
  /** Saved US state for OTB events (profiles.events_state); null = never picked. */
  events_state: string | null;
  due_now: number;
  live_total: number;
  last_trained: string | null;
  last_any: string | null;
  last_reminder: string | null;
  last_report: string | null;
  last_confirm: string | null;
  ready_sent: boolean | number;
  welcome_sent: boolean | number;
  /** Reminder-kind sends after the last training (all of them if never trained). */
  unanswered: number;
  /** Live tactic/endgame positions created since max(last email (or 1 day ago), 7 days ago). */
  fresh_blunders: number;
}

export interface LocalTime {
  tz: string;
  hour: number;
  /** YYYY-MM-DD */
  today: string;
  yesterday: string;
  /** ISO day of week, 1 = Monday … 7 = Sunday. */
  isoDow: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  const hit = formatters.get(tz);
  if (hit) return hit;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    formatters.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

/** A known IANA zone, else UTC (Postgres checked pg_timezone_names). */
export function validTimezone(tz: string | null | undefined): string {
  return tz && formatter(tz) ? tz : 'UTC';
}

const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function ymd(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

/** `now` on the wall clock of `tz` (invalid zones fall back to UTC). */
export function localTime(now: Date, tzIn: string | null | undefined): LocalTime {
  const tz = validTimezone(tzIn);
  const parts: Record<string, string> = {};
  for (const p of formatter(tz)!.formatToParts(now)) parts[p.type] = p.value;
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  return {
    tz,
    hour: Number(parts.hour) % 24,
    today: ymd(y, m, d),
    yesterday: ymd(y, m, d - 1),
    isoDow: DOW[parts.weekday] ?? 0,
  };
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** SQL `ts > p_now - interval`: false when ts is NULL. */
function newerThan(iso: string | null, now: number, ago: number): boolean {
  const t = ms(iso);
  return t !== null && t > now - ago;
}

/** SQL `ts <= p_now - interval`: false when ts is NULL. */
function atLeastAgo(iso: string | null, now: number, ago: number): boolean {
  const t = ms(iso);
  return t !== null && t <= now - ago;
}

/** SQL `ts IS NULL OR ts < p_now - interval`. */
function nullOrOlderThan(iso: string | null, now: number, ago: number): boolean {
  const t = ms(iso);
  return t === null || t < now - ago;
}

export interface Decision {
  kind: EmailKind | null;
  to_email: string | null;
  local: LocalTime;
  /** The streak shown in emails: 0 unless the player trained today or yesterday. */
  streak: number;
  firstName: string | null;
}

export function firstNameOf(f: Pick<CandidateFacts, 'display_name' | 'lichess_username' | 'chesscom_username'>): string | null {
  const first = f.display_name == null ? null : f.display_name.split(' ')[0] || null;
  return first ?? f.lichess_username ?? f.chesscom_username ?? null;
}

/**
 * The state whose OTB tournaments the email lists under "Events near you":
 * weekly reports only, and only a state the player picked themselves (the
 * app's location guess is never saved). Null = no section.
 */
export function eventsStateFor(kind: EmailKind | null, f: Pick<CandidateFacts, 'events_state'>): string | null {
  return kind === 'weekly_report' && isUsStateCode(f.events_state) ? f.events_state : null;
}

export function decide(f: CandidateFacts, nowDate: Date): Decision {
  const now = nowDate.getTime();
  const local = localTime(nowDate, f.timezone);
  const atHour = local.hour === f.email_hour;
  const sendTo = f.contact_email != null ? (f.contact_email_verified_at != null ? f.contact_email : null) : realEmail(f.auth_email);
  const streak = f.last_drill_local_date === local.today || f.last_drill_local_date === local.yesterday ? f.current_streak_days : 0;
  const unanswered = Number(f.unanswered) || 0;
  const remindersOn = f.email_reminders !== 'off';

  let kind: EmailKind | null = null;
  if (f.contact_email != null && f.contact_email_verified_at == null) {
    kind = nullOrOlderThan(f.last_confirm, now, 23 * HOUR) ? 'confirm' : null;
  } else if (sendTo == null) {
    kind = null;
  } else if (
    !f.welcome_sent &&
    f.last_any == null &&
    newerThan(f.created_at, now, 2 * DAY) &&
    (f.live_total > 0 || atLeastAgo(f.created_at, now, 3 * HOUR))
  ) {
    kind = 'welcome';
  } else if (!atHour) {
    kind = null;
  } else if (f.last_any != null && newerThan(f.last_any, now, 20 * HOUR)) {
    kind = null;
  } else if (
    f.last_trained == null &&
    !f.ready_sent &&
    f.live_total > 0 &&
    atLeastAgo(f.created_at, now, 20 * HOUR) &&
    newerThan(f.created_at, now, 14 * DAY)
  ) {
    kind = 'ready';
  } else if (
    f.email_reports !== 'off' &&
    f.last_trained != null &&
    local.isoDow === 7 &&
    nullOrOlderThan(f.last_report, now, 6 * DAY)
  ) {
    kind = 'weekly_report';
  } else if (remindersOn && streak >= 2 && f.last_drill_local_date === local.yesterday && unanswered < 6) {
    kind = 'streak_at_risk';
  } else if (
    remindersOn &&
    f.due_now > 0 &&
    (f.last_drill_local_date ?? '') !== local.today &&
    atLeastAgo(f.created_at, now, 20 * HOUR) &&
    unanswered < 6 &&
    nullOrOlderThan(
      f.last_reminder,
      now,
      unanswered >= 3 ? 6 * DAY + 20 * HOUR : f.email_reminders === 'few_days' ? 2 * DAY + 20 * HOUR : 20 * HOUR,
    )
  ) {
    kind = 'daily_plan';
  }

  return {
    kind,
    to_email: kind === 'confirm' ? f.contact_email : (sendTo ?? f.contact_email),
    local,
    streak,
    firstName: firstNameOf(f),
  };
}
