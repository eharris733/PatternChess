// US states (50 + DC) for the OTB events features: the dashboard's Upcoming
// OTB events card, `profiles.events_state` (validated server-side in
// PROFILE_WRITABLE) and the weekly email's "Events near you" section (the
// notifier keeps a copy in workers/notifier/src/usStates.ts; a test asserts
// they match). Codes match `clubs.state` on events.patternchess.com.

export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const;

export type UsStateCode = (typeof US_STATES)[number]['code'];

export const US_STATE_CODES: readonly UsStateCode[] = US_STATES.map((s) => s.code);

const NAMES = new Map<string, string>(US_STATES.map((s) => [s.code, s.name]));

export function isUsStateCode(v: unknown): v is UsStateCode {
  return typeof v === 'string' && NAMES.has(v);
}

export function usStateName(code: string): string {
  return NAMES.get(code) ?? code;
}

/** Zones that belong to one state only. */
const ZONE_STATE: Record<string, UsStateCode> = {
  'America/Phoenix': 'AZ',
  'US/Arizona': 'AZ',
  'Pacific/Honolulu': 'HI',
  'US/Hawaii': 'HI',
  'America/Anchorage': 'AK',
  'America/Juneau': 'AK',
  'America/Sitka': 'AK',
  'America/Nome': 'AK',
  'America/Yakutat': 'AK',
  'America/Metlakatla': 'AK',
  'America/Adak': 'AK',
  'US/Alaska': 'AK',
  'America/Boise': 'ID',
  'America/Detroit': 'MI',
  'America/Menominee': 'MI',
  'US/Michigan': 'MI',
  'America/Indianapolis': 'IN',
  'America/Fort_Wayne': 'IN',
  'US/East-Indiana': 'IN',
  'America/Louisville': 'KY',
  // Zones shared by many states: the zone's own city. A guess the card
  // shows with a picker next to it; it is never saved without the player.
  'America/New_York': 'NY',
  'US/Eastern': 'NY',
  'America/Chicago': 'IL',
  'US/Central': 'IL',
  'America/Denver': 'CO',
  'US/Mountain': 'CO',
  'America/Los_Angeles': 'CA',
  'US/Pacific': 'CA',
};

/** A US state for an IANA timezone, or null outside the US. */
export function guessStateFromTimezone(tz: string | null | undefined): UsStateCode | null {
  if (!tz) return null;
  if (tz.startsWith('America/Indiana/')) return 'IN';
  if (tz.startsWith('America/Kentucky/')) return 'KY';
  if (tz.startsWith('America/North_Dakota/')) return 'ND';
  return ZONE_STATE[tz] ?? null;
}
