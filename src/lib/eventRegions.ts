// Where OTB events are listed for (feedback round 2: country first, not just
// US states). A region is a country, plus a state inside the US. Countries are
// the ones events.patternchess.com covers (ChessEventsData
// shared/src/countries.ts, mirrored here; the notifier keeps its own copy in
// workers/notifier/src/eventCountries.ts and a test asserts they match). Codes
// are `clubs.country` values: ISO 3166-1 alpha-2, except the UK home nations,
// which FIDE treats as separate federations (GB-ENG, GB-SCT, GB-WLS).
//
// Pure module: the server validates `profiles.events_country` with it.

import { isUsStateCode, usStateName, type UsStateCode } from './usStates';

export interface EventCountry {
  code: string;
  name: string;
  /** Page on events.patternchess.com (/<slug>); the US uses /<state> pages. */
  slug: string | null;
  /** Primary IANA zone, for the timezone guess. */
  tz: string | null;
}

export const US_COUNTRY = 'US';

export const EVENT_COUNTRIES: readonly EventCountry[] = [
  { code: 'US', name: 'United States', slug: null, tz: null },
  { code: 'CA', name: 'Canada', slug: 'canada', tz: 'America/Toronto' },
  { code: 'GB-ENG', name: 'England', slug: 'england', tz: 'Europe/London' },
  { code: 'GB-SCT', name: 'Scotland', slug: 'scotland', tz: null },
  { code: 'GB-WLS', name: 'Wales', slug: 'wales', tz: null },
  { code: 'IE', name: 'Ireland', slug: 'ireland', tz: 'Europe/Dublin' },
  { code: 'AU', name: 'Australia', slug: 'australia', tz: 'Australia/Sydney' },
  { code: 'NZ', name: 'New Zealand', slug: 'new-zealand', tz: 'Pacific/Auckland' },
  { code: 'IN', name: 'India', slug: 'india', tz: 'Asia/Kolkata' },
  { code: 'ZA', name: 'South Africa', slug: 'south-africa', tz: 'Africa/Johannesburg' },
  { code: 'DE', name: 'Germany', slug: 'germany', tz: 'Europe/Berlin' },
  { code: 'FR', name: 'France', slug: 'france', tz: 'Europe/Paris' },
  { code: 'ES', name: 'Spain', slug: 'spain', tz: 'Europe/Madrid' },
  { code: 'NL', name: 'Netherlands', slug: 'netherlands', tz: 'Europe/Amsterdam' },
];

export const EVENT_COUNTRY_CODES: readonly string[] = EVENT_COUNTRIES.map((c) => c.code);

const BY_CODE = new Map(EVENT_COUNTRIES.map((c) => [c.code, c]));

export function isEventCountryCode(v: unknown): v is string {
  return typeof v === 'string' && BY_CODE.has(v);
}

export function eventCountry(code: string | null | undefined): EventCountry | null {
  return code ? (BY_CODE.get(code) ?? null) : null;
}

/** UK home nations from Cloudflare's `regionCode` (ISO 3166-2:GB). */
const GB_NATIONS: Record<string, string> = { ENG: 'GB-ENG', SCT: 'GB-SCT', WLS: 'GB-WLS' };

/**
 * The events country for a request's Cloudflare location (`cf.country`,
 * `cf.regionCode`): a covered country's code, or the plain ISO country for
 * places with no listings yet ('BR'), or null when unknown.
 */
export function eventCountryFromLocation(country: string | null, regionCode: string | null): string | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if (c === 'GB') return GB_NATIONS[(regionCode ?? '').toUpperCase()] ?? 'GB-ENG';
  return c;
}

/** A covered country from an IANA zone (non-US only; usStates handles US zones). */
export function eventCountryFromTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  return EVENT_COUNTRIES.find((c) => c.tz === tz)?.code ?? null;
}

export interface EventsRegion {
  /** An events country code, or any ISO country (no listings) for a guess. */
  country: string;
  /** US state when `country` is US; null elsewhere (and for a US guess without one). */
  state: UsStateCode | null;
}

/** Whether events can be fetched for the region (a covered country; a state in the US). */
export function regionHasListings(r: EventsRegion | null): r is EventsRegion {
  if (!r || !isEventCountryCode(r.country)) return false;
  return r.country !== US_COUNTRY || r.state !== null;
}

/** The events API query for a region: `state=MA` in the US, `country=CA` elsewhere. */
export function eventsApiQuery(r: EventsRegion): string {
  return r.country === US_COUNTRY && r.state
    ? `state=${encodeURIComponent(r.state)}`
    : `country=${encodeURIComponent(r.country)}`;
}

/** The region's page on events.patternchess.com (/ma, /canada). */
export function eventsRegionPath(r: EventsRegion): string {
  if (r.country === US_COUNTRY && r.state) return `/${r.state.toLowerCase()}`;
  return `/${eventCountry(r.country)?.slug ?? ''}`;
}

/** "Massachusetts", "Canada", or a plain country name for places without listings ("Brazil"). */
export function regionName(r: EventsRegion): string {
  if (r.country === US_COUNTRY && isUsStateCode(r.state)) return usStateName(r.state);
  const known = eventCountry(r.country);
  if (known) return known.name;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(r.country) ?? r.country;
  } catch {
    return r.country;
  }
}

/**
 * The saved region from the profile columns: `events_country` (+
 * `events_state` for the US). Rows from before countries existed have only a
 * US state, which means the US.
 */
export function savedRegion(eventsCountry: string | null, eventsState: string | null): EventsRegion | null {
  const state = isUsStateCode(eventsState) ? eventsState : null;
  if (isEventCountryCode(eventsCountry)) {
    return { country: eventsCountry, state: eventsCountry === US_COUNTRY ? state : null };
  }
  return state ? { country: US_COUNTRY, state } : null;
}
