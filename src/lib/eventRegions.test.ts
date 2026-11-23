import { describe, expect, it } from 'vitest';
import {
  EVENT_COUNTRIES,
  eventCountryFromLocation,
  eventCountryFromTimezone,
  eventsApiQuery,
  eventsRegionPath,
  regionHasListings,
  regionName,
  savedRegion,
} from './eventRegions';

describe('event regions', () => {
  it('maps Cloudflare locations, with UK home nations', () => {
    expect(eventCountryFromLocation('GB', 'SCT')).toBe('GB-SCT');
    expect(eventCountryFromLocation('GB', null)).toBe('GB-ENG');
    expect(eventCountryFromLocation('ca', 'ON')).toBe('CA');
    expect(eventCountryFromLocation('BR', 'SP')).toBe('BR');
    expect(eventCountryFromLocation(null, null)).toBeNull();
  });

  it('guesses a covered country from its primary zone', () => {
    expect(eventCountryFromTimezone('Europe/Berlin')).toBe('DE');
    expect(eventCountryFromTimezone('America/New_York')).toBeNull();
  });

  it('builds API queries and page paths', () => {
    expect(eventsApiQuery({ country: 'US', state: 'MA' })).toBe('state=MA');
    expect(eventsApiQuery({ country: 'GB-ENG', state: null })).toBe('country=GB-ENG');
    expect(eventsRegionPath({ country: 'US', state: 'MA' })).toBe('/ma');
    expect(eventsRegionPath({ country: 'NZ', state: null })).toBe('/new-zealand');
  });

  it('knows which regions have listings', () => {
    expect(regionHasListings({ country: 'US', state: null })).toBe(false);
    expect(regionHasListings({ country: 'US', state: 'NY' })).toBe(true);
    expect(regionHasListings({ country: 'CA', state: null })).toBe(true);
    expect(regionHasListings({ country: 'BR', state: null })).toBe(false);
  });

  it('names regions, including uncovered countries', () => {
    expect(regionName({ country: 'US', state: 'MA' })).toBe('Massachusetts');
    expect(regionName({ country: 'GB-WLS', state: null })).toBe('Wales');
    expect(regionName({ country: 'BR', state: null })).toBe('Brazil');
  });

  it('reads saved columns; a lone US state means the US', () => {
    expect(savedRegion(null, 'MA')).toEqual({ country: 'US', state: 'MA' });
    expect(savedRegion('CA', 'MA')).toEqual({ country: 'CA', state: null });
    expect(savedRegion(null, null)).toBeNull();
    expect(savedRegion('XX', null)).toBeNull();
  });

  it('matches the events site country list (ChessEventsData shared/src/countries.ts)', () => {
    expect(EVENT_COUNTRIES.map((c) => c.code)).toEqual([
      'US', 'CA', 'GB-ENG', 'GB-SCT', 'GB-WLS', 'IE', 'AU', 'NZ', 'IN', 'ZA', 'DE', 'FR', 'ES', 'NL',
    ]);
  });
});
