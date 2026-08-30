import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Blunder } from '../../models/blunder';
import { SPACED_REPETITION_DAYS } from '../../models/blunder';

vi.mock('../../services/supabaseService', () => ({
  supabaseService: {
    updateBlunderAfterDrill: vi.fn(() => Promise.resolve()),
  },
}));

import { applyDrillResult } from './applyDrillResult';
import { supabaseService } from '../../services/supabaseService';

function makeBlunder(overrides: Partial<Blunder> = {}): Blunder {
  return {
    id: 'b1',
    gameId: 'g1',
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    moveNumber: 10,
    playedMove: 'e2e4',
    correctMoves: [{ move: 'd2d4', eval: 50 }],
    evalBefore: 50,
    evalAfter: -200,
    evalSwing: 20,
    sideToMove: 'white',
    cycleNumber: 0,
    lastDrilledAt: null,
    nextDrillAt: null,
    timesCorrect: 0,
    timesAttempted: 0,
    lastDrillFailed: false,
    createdAt: new Date('2026-01-01'),
    phase: 'middlegame',
    solutionLine: null,
    motifs: [],
    kind: 'tactic',
    drillData: null,
    analysisDepth: null,
    ...overrides,
  };
}

const deps = { trackWrite: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyDrillResult', () => {
  it('first-attempt success advances the cycle and clears lastDrillFailed', () => {
    const b = makeBlunder({ cycleNumber: 2, lastDrillFailed: true });
    applyDrillResult(b, { success: true, isFirstAttempt: true }, deps);
    expect(b.cycleNumber).toBe(3);
    expect(b.lastDrillFailed).toBe(false);
    expect(b.timesCorrect).toBe(1);
    expect(b.timesAttempted).toBe(1);
    expect(b.lastDrilledAt).toBeInstanceOf(Date);
  });

  it('caps the cycle at the ladder length (mastery)', () => {
    const b = makeBlunder({ cycleNumber: SPACED_REPETITION_DAYS.length });
    applyDrillResult(b, { success: true, isFirstAttempt: true }, deps);
    expect(b.cycleNumber).toBe(SPACED_REPETITION_DAYS.length);
  });

  it('first-attempt failure resets the cycle and flags lastDrillFailed', () => {
    const b = makeBlunder({ cycleNumber: 4, timesCorrect: 6, timesAttempted: 6 });
    applyDrillResult(b, { success: false, isFirstAttempt: true }, deps);
    expect(b.cycleNumber).toBe(0);
    expect(b.lastDrillFailed).toBe(true);
    expect(b.timesCorrect).toBe(6);
    expect(b.timesAttempted).toBe(7);
  });

  it('retry success counts the attempt but leaves the ladder untouched', () => {
    const b = makeBlunder({ cycleNumber: 0, lastDrillFailed: true, timesAttempted: 1 });
    applyDrillResult(b, { success: true, isFirstAttempt: false }, deps);
    expect(b.cycleNumber).toBe(0);
    expect(b.lastDrillFailed).toBe(true);
    expect(b.timesCorrect).toBe(1);
    expect(b.timesAttempted).toBe(2);
  });

  it('retry failure leaves the ladder untouched', () => {
    const b = makeBlunder({ cycleNumber: 3, timesAttempted: 5, timesCorrect: 4 });
    applyDrillResult(b, { success: false, isFirstAttempt: false }, deps);
    expect(b.cycleNumber).toBe(3);
    expect(b.lastDrillFailed).toBe(false);
    expect(b.timesAttempted).toBe(6);
  });

  it('schedules exactly one tracked Supabase write per call', () => {
    const b = makeBlunder();
    applyDrillResult(b, { success: true, isFirstAttempt: true }, deps);
    expect(deps.trackWrite).toHaveBeenCalledTimes(1);
    expect(supabaseService.updateBlunderAfterDrill).toHaveBeenCalledWith(b);
  });
});
