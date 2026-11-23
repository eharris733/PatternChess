import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/supabaseService', () => ({ supabaseService: {} }));

import { advanceSr, type SrState } from './applyDrillResult';
import { SPACED_REPETITION_DAYS } from '../../models/blunder';

const fresh = (over: Partial<SrState> = {}): SrState => ({
  cycleNumber: 0,
  timesCorrect: 0,
  timesAttempted: 0,
  lastDrillFailed: false,
  lastDrilledAt: null,
  nextDrillAt: null,
  ...over,
});

describe('advanceSr', () => {
  it('climbs one rung on a first-attempt solve and caps at mastery', () => {
    const s = fresh({ cycleNumber: SPACED_REPETITION_DAYS.length - 1 });
    advanceSr(s, { success: true, isFirstAttempt: true });
    expect(s.cycleNumber).toBe(SPACED_REPETITION_DAYS.length);
    // Next review, once it's due again.
    advanceSr(s, { success: true, isFirstAttempt: true }, new Date(s.nextDrillAt!.getTime() + 1));
    expect(s.cycleNumber).toBe(SPACED_REPETITION_DAYS.length);
    expect(s.timesCorrect).toBe(2);
    expect(s.timesAttempted).toBe(2);
  });

  it('resets on a first-attempt fail and flags it', () => {
    const s = fresh({ cycleNumber: 3 });
    advanceSr(s, { success: false, isFirstAttempt: true });
    expect(s.cycleNumber).toBe(0);
    expect(s.lastDrillFailed).toBe(true);
  });

  it('retries count attempts but never move the ladder', () => {
    const s = fresh({ cycleNumber: 2, lastDrillFailed: true });
    const at = new Date('2026-10-02T12:00:00Z');
    advanceSr(s, { success: true, isFirstAttempt: false }, at);
    expect(s.cycleNumber).toBe(2);
    expect(s.lastDrillFailed).toBe(true);
    expect(s.timesAttempted).toBe(1);
    expect(s.lastDrilledAt).toEqual(at);
  });

  it('a first-attempt solve reschedules from now', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const s = fresh({ cycleNumber: 1, nextDrillAt: new Date('2026-11-22T12:00:00Z') });
    const out = advanceSr(s, { success: true, isFirstAttempt: true }, now);
    expect(out.practice).toBe(false);
    expect(s.cycleNumber).toBe(2);
    const expected = new Date(now);
    expected.setDate(expected.getDate() + SPACED_REPETITION_DAYS[2]);
    expect(s.nextDrillAt).toEqual(expected);
  });

  describe('a position that is not due yet', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const later = new Date('2026-11-30T12:00:00Z');

    it('an early solve is practice: no rung, no stats, same due date', () => {
      const s = fresh({ cycleNumber: 2, timesCorrect: 2, timesAttempted: 2, nextDrillAt: later });
      const out = advanceSr(s, { success: true, isFirstAttempt: true }, now);
      expect(out.practice).toBe(true);
      expect(s.cycleNumber).toBe(2);
      expect(s.timesCorrect).toBe(2);
      expect(s.timesAttempted).toBe(2);
      expect(s.nextDrillAt).toEqual(later);
      expect(s.lastDrilledAt).toEqual(now);
    });

    it('drilling it again and again never masters it', () => {
      const s = fresh({ cycleNumber: 1, nextDrillAt: later });
      for (let i = 0; i < 10; i++) {
        advanceSr(s, { success: true, isFirstAttempt: true }, new Date(now.getTime() + i * 60_000));
      }
      expect(s.cycleNumber).toBe(1);
    });

    it('an early miss resets it like any miss', () => {
      const s = fresh({ cycleNumber: 3, nextDrillAt: later });
      const out = advanceSr(s, { success: false, isFirstAttempt: true }, now);
      expect(out.practice).toBe(false);
      expect(s.cycleNumber).toBe(0);
      expect(s.lastDrillFailed).toBe(true);
      expect(s.timesAttempted).toBe(1);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + SPACED_REPETITION_DAYS[0]);
      expect(s.nextDrillAt).toEqual(tomorrow);
    });
  });
});
