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
  ...over,
});

describe('advanceSr', () => {
  it('climbs one rung on a first-attempt solve and caps at mastery', () => {
    const s = fresh({ cycleNumber: SPACED_REPETITION_DAYS.length - 1 });
    advanceSr(s, { success: true, isFirstAttempt: true });
    expect(s.cycleNumber).toBe(SPACED_REPETITION_DAYS.length);
    advanceSr(s, { success: true, isFirstAttempt: true });
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
});
