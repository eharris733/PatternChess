import { describe, expect, it } from 'vitest';
import { completedOn, dayOpen, dayStatuses, isLocalDate, nextDay } from './coursePacing';

describe('coursePacing', () => {
  it('opens only day 1 on a fresh course', () => {
    expect(dayStatuses(4, [], '2026-11-22')).toEqual(['open', 'locked', 'locked', 'locked']);
    expect(nextDay(4, [], '2026-11-22')).toEqual({ day: 1, status: 'open' });
  });

  it('opens the next day on the next local date', () => {
    const done = [{ day: 1, localDate: '2026-11-22' }];
    expect(dayStatuses(3, done, '2026-11-22')).toEqual(['done', 'tomorrow', 'locked']);
    expect(dayStatuses(3, done, '2026-11-23')).toEqual(['done', 'open', 'locked']);
    // A long break doesn't open more than one new day.
    expect(dayStatuses(3, done, '2026-12-30')).toEqual(['done', 'open', 'locked']);
  });

  it('keeps finished days open and reports the course finished', () => {
    const done = [
      { day: 1, localDate: '2026-11-20' },
      { day: 2, localDate: '2026-11-21' },
    ];
    expect(dayOpen(1, 2, done, '2026-11-21')).toBe(true);
    expect(nextDay(2, done, '2026-11-22')).toBeNull();
  });

  it('rejects days out of range', () => {
    expect(dayOpen(0, 3, [], '2026-11-22')).toBe(false);
    expect(dayOpen(4, 3, [], '2026-11-22')).toBe(false);
  });

  it('validates local dates', () => {
    expect(isLocalDate('2026-11-22')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-11-22T00:00')).toBe(false);
    expect(isLocalDate(20261122)).toBe(false);
  });

  it('knows whether a lesson was finished today', () => {
    expect(completedOn([{ day: 1, localDate: '2026-11-22' }], '2026-11-22')).toBe(true);
    expect(completedOn([{ day: 1, localDate: '2026-11-21' }], '2026-11-22')).toBe(false);
  });
});
