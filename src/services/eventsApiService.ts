// Upcoming OTB tournaments from the sibling ChessEventsData service
// (events.patternchess.com). Public read API, no auth. The API sends
// Cross-Origin-Resource-Policy: cross-origin so the fetch survives this
// app's COEP isolation.

import { fetchWithRetry } from './chessApiService';

export const EVENTS_SITE_URL = 'https://events.patternchess.com';

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
  sections: string | null; // JSON array
  entry_fee: string | null;
  time_control: string | null;
  registration_url: string | null;
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
  const res = await fetchWithRetry(`${EVENTS_SITE_URL}/api/events`, undefined, 'PatternChess Events');
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
    sections: parseSections(row.sections),
    entryFee: row.entry_fee,
    timeControl: row.time_control,
    eventUrl: `${EVENTS_SITE_URL}/events/${row.id}`,
    registrationUrl: row.registration_url,
  }));
}
