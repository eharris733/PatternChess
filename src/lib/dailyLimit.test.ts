import { describe, expect, it } from 'vitest';
import { formatCountdown, nextLocalMidnight, quotaKindsFor } from './dailyLimit';

describe('nextLocalMidnight', () => {
  it('is the coming midnight in the player timezone', () => {
    // 22:30 in New York (UTC-5 in January) → 01:30 UTC next day → midnight NY = 05:00 UTC.
    const now = new Date('2026-01-15T03:30:00.000Z');
    expect(nextLocalMidnight('America/New_York', now).toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(nextLocalMidnight('UTC', now).toISOString()).toBe('2026-01-16T00:00:00.000Z');
    expect(nextLocalMidnight('Asia/Tokyo', now).toISOString()).toBe('2026-01-15T15:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    const now = new Date('2026-01-15T03:30:00.000Z');
    expect(nextLocalMidnight('Not/AZone', now).toISOString()).toBe('2026-01-16T00:00:00.000Z');
  });
});

describe('quotaKindsFor', () => {
  it('maps a focus to the limits it draws on', () => {
    expect(quotaKindsFor({})).toEqual(['positions']);
    expect(quotaKindsFor({ kindFilter: 'opening' })).toEqual(['openings']);
    expect(quotaKindsFor({ phaseFilter: 'endgame' })).toEqual(['positions', 'endgames']);
    expect(quotaKindsFor({ phaseFilter: 'middlegame' })).toEqual(['positions']);
  });
});

describe('formatCountdown', () => {
  it('shows hours + minutes, then minutes + seconds, then seconds', () => {
    expect(formatCountdown((4 * 3600 + 12 * 60 + 30) * 1000)).toBe('4h 12m');
    expect(formatCountdown((12 * 60 + 5) * 1000)).toBe('12m 05s');
    expect(formatCountdown(45_000)).toBe('45s');
    expect(formatCountdown(-5)).toBe('0s');
  });
});
