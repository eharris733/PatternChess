import { EVENT_COUNTRY } from './eventCountries';
import { US_STATE_NAME } from './usStates';

// "Events near you" for the weekly_report email: upcoming OTB tournaments in
// the player's saved region — a US state (`profiles.events_state`) or a
// whole country elsewhere (`events_country`) — read from the public
// events.patternchess.com API at send time. Listings only (title, date,
// club, link). A slow or failing API drops the section; it never blocks or
// fails the email.

export const EVENTS_SITE = 'https://events.patternchess.com';
/** Days ahead the section covers, today included. */
export const EVENTS_WINDOW_DAYS = 14;
/** Tournaments listed at most (one line each, at its next meeting day). */
export const EVENTS_MAX = 5;
const FETCH_TIMEOUT_MS = 4000;

/**
 * A region as one string (cache key, OutboxData.eventsRegion): `US-MA` for a
 * US state, the events country code elsewhere (`CA`, `GB-ENG`). Country codes
 * never start with `US-`, so the two can't collide (California vs Canada).
 */
export type RegionKey = string;

export function usRegion(state: string): RegionKey {
  return `US-${state}`;
}

/** The US state of a key, or null for a country key. */
export function regionState(key: RegionKey): string | null {
  return key.startsWith('US-') ? key.slice(3) : null;
}

/** "Massachusetts" / "Canada"; null for an unknown key. */
export function regionName(key: RegionKey): string | null {
  const state = regionState(key);
  if (state) return US_STATE_NAME[state] ?? null;
  return EVENT_COUNTRY[key]?.name ?? null;
}
/** A contiguous "occurrence" longer than this is a season-long listing (some
 * aggregator rows span months), not a tournament day: left out. */
const MAX_BLOCK_DAYS = 31;

/** The fields of an /api/events row the email reads. */
export interface EventApiRow {
  id: number;
  title: string;
  club_name: string;
  club_city: string | null;
  /** Aggregator rows (US Chess TLA, FIDE) carry the town here instead. */
  event_city?: string | null;
  start_date: string;
  end_date: string;
  /** HH:MM, 24h */
  start_time: string | null;
  status?: string | null;
  occurrences?: Array<{ date: string; end_date: string; round: number | null; total_rounds: number | null }>;
}

export interface NearbyEvent {
  title: string;
  /** "Sat, Nov 29 · 10:00 AM", "Rd 2 of 6 · Tue, Dec 2 · 6:30 PM" */
  when: string;
  /** "Boylston Chess Foundation · Boston" */
  where: string;
  url: string;
}

/** Loads the listing for a region; null = unavailable (the section is left out). */
export type EventsLoader = (region: RegionKey, today: string) => Promise<NearbyEvent[] | null>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** "2026-11-29" → "Sun, Nov 29" */
export function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${MONTHS[m - 1]} ${d}`;
}

/** "19:30" → "7:30 PM"; anything unparseable → null. */
export function formatTime(hhmm: string | null | undefined): string | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The API request for a region's tournaments starting by the end of the window. */
export function eventsApiUrl(base: string, region: RegionKey, today: string): string {
  const state = regionState(region);
  const where = state ? `state=${encodeURIComponent(state)}` : `country=${encodeURIComponent(region)}`;
  return `${base}/api/events?${where}&to=${addDays(today, EVENTS_WINDOW_DAYS - 1)}`;
}

/** The region's page: /ma for a US state, /canada for a country. */
export function regionEventsUrl(base: string, region: RegionKey): string {
  const state = regionState(region);
  return `${base}/${state ? state.toLowerCase() : (EVENT_COUNTRY[region]?.slug ?? '')}`;
}

/**
 * The section's lines: each tournament once, at its next meeting day inside
 * [today, today + EVENTS_WINDOW_DAYS), nearest first, at most EVENTS_MAX.
 * Cancelled rows are dropped.
 */
export function nearbyEvents(rows: EventApiRow[], today: string, base = EVENTS_SITE): NearbyEvent[] {
  const end = addDays(today, EVENTS_WINDOW_DAYS);
  const picked: Array<{ row: EventApiRow; date: string; endDate: string; round: number | null; total: number | null }> = [];
  for (const row of rows) {
    if (!row || row.status === 'cancelled' || typeof row.title !== 'string') continue;
    const occ = row.occurrences?.length
      ? row.occurrences
      : [{ date: row.start_date, end_date: row.end_date, round: null, total_rounds: null }];
    const next = occ.find((o) => o.end_date >= today);
    if (!next || next.date >= end || daysBetween(next.date, next.end_date) > MAX_BLOCK_DAYS) continue;
    picked.push({ row, date: next.date, endDate: next.end_date, round: next.round, total: next.total_rounds });
  }
  // A block already under way sorts as today.
  const from = (d: string) => (d < today ? today : d);
  picked.sort(
    (a, b) =>
      from(a.date).localeCompare(from(b.date)) || (a.row.start_time ?? '99').localeCompare(b.row.start_time ?? '99'),
  );
  return picked.slice(0, EVENTS_MAX).map(({ row, date, endDate, round, total }) => {
    const day = endDate > date ? `${formatDay(date)} to ${formatDay(endDate)}` : formatDay(date);
    const when = [round != null && total != null ? `Rd ${round} of ${total}` : null, day, formatTime(row.start_time)]
      .filter(Boolean)
      .join(' · ');
    const where = [row.club_name, row.event_city || row.club_city].filter(Boolean).join(' · ');
    return { title: row.title, when, where, url: `${base}/events/${row.id}` };
  });
}

/**
 * An EventsLoader over `fetchImpl` that asks the API once per region per run
 * (many players share one) and turns every failure (network, timeout,
 * non-2xx, bad JSON) into null.
 */
export function regionEventsLoader(fetchImpl: typeof fetch, base = EVENTS_SITE, timeoutMs = FETCH_TIMEOUT_MS): EventsLoader {
  const cache = new Map<string, Promise<NearbyEvent[] | null>>();
  return (region, today) => {
    const key = `${region}|${today}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = (async () => {
        try {
          const res = await fetchImpl(eventsApiUrl(base, region, today), {
            headers: { Accept: 'application/json', 'User-Agent': 'PatternChess-Notifier' },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) throw new Error(`events API ${res.status}`);
          const body = (await res.json()) as { data?: unknown };
          if (!Array.isArray(body.data)) throw new Error('events API: no data array');
          return nearbyEvents(body.data as EventApiRow[], today, base);
        } catch (err) {
          console.warn('[notifier] events unavailable', region, err instanceof Error ? err.message : String(err));
          return null;
        }
      })();
      cache.set(key, hit);
    }
    return hit;
  };
}
