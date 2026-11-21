import { describe, expect, it } from 'vitest';
import {
  MAX_STREAK_FREEZES,
  addDays,
  computeNextStreak,
  daysBetween,
  localDate,
  streakStatus,
} from './streakService';

const TZ = 'America/New_York';
// Noon local on 2026-11-20 — far from any day boundary.
const NOW = new Date('2026-11-20T17:00:00Z');
const TODAY = localDate(TZ, NOW);

function inputs(over: Partial<Parameters<typeof computeNextStreak>[0]> = {}) {
  return {
    currentStreakDays: 5,
    longestStreakDays: 5,
    lastDrillLocalDate: addDays(TODAY, -1),
    timezone: TZ,
    streakFreezes: 0,
    ...over,
  };
}

describe('daysBetween', () => {
  it('counts whole days across month and DST boundaries', () => {
    expect(daysBetween('2026-11-19', '2026-11-20')).toBe(1);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-11-20', '2026-11-18')).toBe(-2);
  });
});

describe('computeNextStreak', () => {
  it('does nothing for a second drill on the same day', () => {
    const r = computeNextStreak(inputs({ lastDrillLocalDate: TODAY }), NOW);
    expect(r.changed).toBe(false);
    expect(r.currentStreakDays).toBe(5);
  });

  it('extends the streak after yesterday', () => {
    const r = computeNextStreak(inputs(), NOW);
    expect(r.currentStreakDays).toBe(6);
    expect(r.freezesUsed).toBe(0);
    expect(r.lastDrillLocalDate).toBe(TODAY);
  });

  it('resets after a missed day with no freezes', () => {
    const r = computeNextStreak(inputs({ lastDrillLocalDate: addDays(TODAY, -2) }), NOW);
    expect(r.currentStreakDays).toBe(1);
    expect(r.freezesUsed).toBe(0);
  });

  it('spends one freeze per missed day to keep the streak', () => {
    const r = computeNextStreak(
      inputs({ lastDrillLocalDate: addDays(TODAY, -3), streakFreezes: 2 }),
      NOW,
    );
    expect(r.currentStreakDays).toBe(6);
    expect(r.freezesUsed).toBe(2);
    expect(r.streakFreezes).toBe(0);
    expect(r.changed).toBe(true);
  });

  it('resets when the gap is longer than the banked freezes', () => {
    const r = computeNextStreak(
      inputs({ lastDrillLocalDate: addDays(TODAY, -4), streakFreezes: 2 }),
      NOW,
    );
    expect(r.currentStreakDays).toBe(1);
    expect(r.freezesUsed).toBe(0);
    expect(r.streakFreezes).toBe(2);
  });

  it('earns a freeze when the streak reaches a multiple of 7', () => {
    const r = computeNextStreak(inputs({ currentStreakDays: 6, longestStreakDays: 6 }), NOW);
    expect(r.currentStreakDays).toBe(7);
    expect(r.freezeEarned).toBe(true);
    expect(r.streakFreezes).toBe(1);
    expect(r.longestStreakDays).toBe(7);
  });

  it('never banks more than the cap', () => {
    const r = computeNextStreak(
      inputs({ currentStreakDays: 13, longestStreakDays: 13, streakFreezes: MAX_STREAK_FREEZES }),
      NOW,
    );
    expect(r.currentStreakDays).toBe(14);
    expect(r.freezeEarned).toBe(false);
    expect(r.streakFreezes).toBe(MAX_STREAK_FREEZES);
  });

  it('does not earn a freeze on a same-day repeat at a multiple of 7', () => {
    const r = computeNextStreak(
      inputs({ currentStreakDays: 7, longestStreakDays: 7, lastDrillLocalDate: TODAY }),
      NOW,
    );
    expect(r.freezeEarned).toBe(false);
    expect(r.changed).toBe(false);
  });

  it('starts a first streak at 1 without spending freezes', () => {
    const r = computeNextStreak(
      inputs({ currentStreakDays: 0, longestStreakDays: 0, lastDrillLocalDate: null, streakFreezes: 1 }),
      NOW,
    );
    expect(r.currentStreakDays).toBe(1);
    expect(r.freezesUsed).toBe(0);
    expect(r.streakFreezes).toBe(1);
  });

  it('never resets when a timezone change puts the last drill in the future', () => {
    const r = computeNextStreak(inputs({ lastDrillLocalDate: addDays(TODAY, 1) }), NOW);
    expect(r.currentStreakDays).toBe(5);
  });
});

describe('streakStatus', () => {
  it('is alive and done when trained today', () => {
    expect(streakStatus(inputs({ lastDrillLocalDate: TODAY }), NOW)).toEqual({
      alive: true,
      trainedToday: true,
      freezesNeeded: 0,
    });
  });

  it('is alive after yesterday', () => {
    expect(streakStatus(inputs(), NOW).alive).toBe(true);
  });

  it('stays alive over a gap covered by freezes', () => {
    const s = streakStatus(inputs({ lastDrillLocalDate: addDays(TODAY, -2), streakFreezes: 1 }), NOW);
    expect(s).toEqual({ alive: true, trainedToday: false, freezesNeeded: 1 });
  });

  it('is lapsed over a gap the freezes cannot cover', () => {
    expect(streakStatus(inputs({ lastDrillLocalDate: addDays(TODAY, -3), streakFreezes: 1 }), NOW).alive).toBe(false);
  });
});
