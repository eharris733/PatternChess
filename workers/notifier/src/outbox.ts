// Pure pieces of the notifier: turning an outbox / candidate row (store.ts,
// decided by rules.ts) into template data and links, and the test-mode
// recipient gate. No I/O here, so it is unit-tested directly.

import { EVENTS_SITE, stateEventsUrl, type NearbyEvent } from './events';
import { MOTIF_LABEL } from './motifLabels';
import { US_STATE_NAME } from './usStates';
import type { EmailData, EmailKind, EmailLinks } from './templates';

export const EMAIL_KINDS: EmailKind[] = ['welcome', 'ready', 'streak_at_risk', 'daily_plan', 'weekly_report', 'confirm'];

export interface OutboxData {
  firstName: string | null;
  streak: number;
  streakFreezes: number;
  /** YYYY-MM-DD in the player's timezone, or null if they never trained. */
  lastDrillLocalDate: string | null;
  localToday: string;
  dueNow: number;
  liveTotal: number;
  positionsGoal: number;
  gamesGoal: number;
  freshBlunders: number;
  communityElo: number;
  report?: {
    solved: number;
    attempted: number;
    minutes: number;
    activeDays: number;
    newlyMastered: number;
    gamesPlayed: number;
    eloChange: number | null;
    leaderboardRank: number | null;
    /** Motif id; mapped through MOTIF_LABEL. */
    topMotif: string | null;
  };
  /** Saved state for "Events near you" (weekly_report only; rules.ts eventsStateFor). */
  eventsState?: string | null;
  /** Its listing, fetched at send time; null = the events API was unavailable. */
  events?: NearbyEvent[] | null;
}

export interface OutboxRow {
  user_id: string;
  kind: EmailKind | null;
  to_email: string | null;
  unsub_token: string;
  data: OutboxData;
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Which of the last 7 local days (oldest first, today last) fall inside the
 * current streak. The streak is the run of days ending at the last training
 * day, so this matches the streak count shown next to it (a day covered by a
 * streak freeze shows as kept, the same as in the app).
 */
export function lastSevenDays(lastDrill: string | null, streak: number, today: string): boolean[] {
  const t = dayNumber(today);
  if (!lastDrill || streak <= 0) return Array(7).fill(false);
  const end = dayNumber(lastDrill);
  const start = end - streak + 1;
  return Array.from({ length: 7 }, (_, i) => {
    const day = t - 6 + i;
    return day >= start && day <= end;
  });
}

export function toEmailData(d: OutboxData): EmailData {
  const report = d.report
    ? {
        ...d.report,
        solved: Number(d.report.solved) || 0,
        attempted: Number(d.report.attempted) || 0,
        minutes: Number(d.report.minutes) || 0,
        topMotif: d.report.topMotif ? (MOTIF_LABEL[d.report.topMotif] ?? null) : null,
      }
    : undefined;
  return {
    firstName: d.firstName,
    streak: d.streak,
    streakFreezes: d.streakFreezes,
    last7: lastSevenDays(d.lastDrillLocalDate, d.streak, d.localToday),
    dueNow: d.dueNow,
    positionsGoal: d.positionsGoal,
    gamesGoal: d.gamesGoal,
    freshBlunders: d.freshBlunders,
    communityElo: d.communityElo,
    report,
    nearbyEvents:
      d.eventsState && US_STATE_NAME[d.eventsState] && d.events?.length
        ? {
            stateName: US_STATE_NAME[d.eventsState],
            items: d.events,
            seeAllUrl: stateEventsUrl(EVENTS_SITE, d.eventsState),
          }
        : undefined,
  };
}

export interface LinkBases {
  /** The app, e.g. https://patternchess.com */
  app: string;
  /** This Worker's public origin, e.g. https://email.patternchess.com */
  email: string;
}

export function buildLinks(bases: LinkBases, kind: EmailKind, unsubToken: string, confirmToken?: string): EmailLinks {
  const utm = `utm_source=email&utm_medium=email&utm_campaign=${kind}`;
  return {
    train: `${bases.app}/training?${utm}`,
    dashboard: `${bases.app}/dashboard?${utm}`,
    settings: `${bases.email}/settings?t=${unsubToken}`,
    unsubscribe: `${bases.email}/unsubscribe?t=${unsubToken}`,
    confirm: confirmToken ? `${bases.email}/confirm?c=${confirmToken}` : undefined,
  };
}

/** RFC 8058 one-click unsubscribe headers. */
export function unsubscribeHeaders(links: EmailLinks): Record<string, string> {
  return {
    'List-Unsubscribe': `<${links.unsubscribe}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export function parseRecipients(list: string | undefined): Set<string> {
  return new Set(
    (list ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Until SEND_MODE is "live", only addresses in TEST_RECIPIENTS get mail; every
 * other outbox row is reported as skipped and nothing is logged for it, so the
 * real send happens normally once live mode is switched on.
 */
export function mayReceive(mode: string | undefined, allow: Set<string>, to: string): boolean {
  return mode === 'live' || allow.has(to.toLowerCase());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string | null | undefined): s is string {
  return !!s && UUID.test(s);
}
