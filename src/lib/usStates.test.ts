import { describe, expect, it } from 'vitest';
import { guessStateFromTimezone, isUsStateCode, US_STATES, usStateName } from './usStates';

describe('US_STATES', () => {
  it('lists the 50 states plus DC, each code once', () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51);
    expect(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.code))).toBe(true);
  });

  it('names codes and validates them', () => {
    expect(usStateName('MA')).toBe('Massachusetts');
    expect(usStateName('DC')).toBe('District of Columbia');
    expect(isUsStateCode('WY')).toBe(true);
    expect(isUsStateCode('wy')).toBe(false);
    expect(isUsStateCode('PR')).toBe(false);
    expect(isUsStateCode(null)).toBe(false);
  });
});

describe('guessStateFromTimezone', () => {
  it('maps single-state zones exactly', () => {
    expect(guessStateFromTimezone('America/Phoenix')).toBe('AZ');
    expect(guessStateFromTimezone('Pacific/Honolulu')).toBe('HI');
    expect(guessStateFromTimezone('America/Juneau')).toBe('AK');
    expect(guessStateFromTimezone('America/Boise')).toBe('ID');
    expect(guessStateFromTimezone('America/Detroit')).toBe('MI');
    expect(guessStateFromTimezone('America/Indiana/Knox')).toBe('IN');
    expect(guessStateFromTimezone('America/Kentucky/Monticello')).toBe('KY');
    expect(guessStateFromTimezone('America/North_Dakota/Center')).toBe('ND');
  });

  it("falls back to the zone's own city for shared zones", () => {
    expect(guessStateFromTimezone('America/New_York')).toBe('NY');
    expect(guessStateFromTimezone('America/Chicago')).toBe('IL');
    expect(guessStateFromTimezone('America/Denver')).toBe('CO');
    expect(guessStateFromTimezone('America/Los_Angeles')).toBe('CA');
  });

  it('returns null outside the US', () => {
    for (const tz of ['Europe/London', 'America/Toronto', 'America/Sao_Paulo', 'UTC', '', null, undefined]) {
      expect(guessStateFromTimezone(tz)).toBeNull();
    }
  });

  it('every guess is a listed state', () => {
    for (const tz of ['America/Phoenix', 'America/New_York', 'US/Hawaii', 'America/Adak']) {
      expect(isUsStateCode(guessStateFromTimezone(tz))).toBe(true);
    }
  });
});
