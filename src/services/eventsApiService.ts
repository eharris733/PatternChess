// Upcoming OTB tournaments from the sibling ChessEventsData service
// (events.patternchess.com). Public read API, no auth. The API sends
// Cross-Origin-Resource-Policy: cross-origin so the fetch survives this
// app's COEP isolation.

import { fetchWithRetry } from './chessApiService';

export const EVENTS_SITE_URL = 'https://events.patternchess.com';

/** The events service now covers all US states; the dashboard card stays
 * MA-scoped until a per-user state preference exists. */
const EVENTS_STATE = 'MA';

/** One meeting day of an event. Weekly multi-round Swisses expand to one
 * occurrence per round; a contiguous weekend block stays one occurrence
 * spanning date..endDate. */
export interface OtbOccurrence {
  /** YYYY-MM-DD */
  date: string;
  /** = date except for contiguous multi-day blocks */
  endDate: string;
  round: number | null;
  totalRounds: number | null;
}

export interface OtbEvent {
  id: number;
  title: string;
  clubName: string;
  clubCity: string | null;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, equals startDate for single-day events */
  endDate: string;
  /** HH:MM 24h */
  startTime: string | null;
  /** Individual meeting days, in date order (never empty). */
  occurrences: OtbOccurrence[];
  sections: string[] | null;
  entryFee: string | null;
  timeControl: string | null;
  /** Event page on events.patternchess.com */
  eventUrl: string;
  registrationUrl: string | null;
}

interface ApiEventRow {
  id: number;
  title: string;
  club_name: string;
  club_city: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  occurrences?: Array<{
    date: string;
    end_date: string;
    round: number | null;
    total_rounds: number | null;
  }>;
  sections: string | null; // JSON array
  entry_fee: string | null;
  time_control: string | null;
  registration_url: string | null;
}

const DAY_MS = 86_400_000;

/** Fallback when the API predates the `occurrences` field — same rule the
 * events site uses: spans divisible by 7 (≤ 12 weeks) are weekly series with
 * one round per week; anything else stays a single block. */
function expandOccurrences(start: string, end: string): OtbOccurrence[] {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const spanDays = Math.round((Date.parse(`${end}T00:00:00Z`) - startMs) / DAY_MS);
  if (spanDays > 0 && spanDays % 7 === 0 && spanDays / 7 + 1 <= 12) {
    const total = spanDays / 7 + 1;
    return Array.from({ length: total }, (_, i) => {
      const date = new Date(startMs + i * 7 * DAY_MS).toISOString().slice(0, 10);
      return { date, endDate: date, round: i + 1, totalRounds: total };
    });
  }
  return [{ date: start, endDate: end, round: null, totalRounds: null }];
}

function parseSections(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : null;
  } catch {
    return null;
  }
}

export async function fetchUpcomingEvents(): Promise<OtbEvent[]> {
  const res = await fetchWithRetry(
    `${EVENTS_SITE_URL}/api/events?state=${EVENTS_STATE}`,
    undefined,
    'PatternChess Events',
  );
  if (!res.ok) throw new Error(`events API ${res.status}`);
  const body = (await res.json()) as { data: ApiEventRow[] };
  return body.data.map((row) => ({
    id: row.id,
    title: row.title,
    clubName: row.club_name,
    clubCity: row.club_city,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    occurrences: row.occurrences?.length
      ? row.occurrences.map((o) => ({
          date: o.date,
          endDate: o.end_date,
          round: o.round,
          totalRounds: o.total_rounds,
        }))
      : expandOccurrences(row.start_date, row.end_date),
    sections: parseSections(row.sections),
    entryFee: row.entry_fee,
    timeControl: row.time_control,
    eventUrl: `${EVENTS_SITE_URL}/events/${row.id}`,
    registrationUrl: row.registration_url,
  }));
}
