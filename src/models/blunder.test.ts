import { describe, expect, it } from 'vitest';
import {
  Blunder,
  MASTERED_REVIEW_DAYS,
  SPACED_REPETITION_DAYS,
  intervalDaysForCycle,
  nextDrillDate,
  nextIntervalDaysIfSolved,
  srBucket,
} from './blunder';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeBlunder(overrides: Partial<Blunder> = {}): Blunder {
  return {
    id: 'b1',
    gameId: null,
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    moveNumber: 1,
    playedMove: 'e2e4',
    correctMoves: [],
    evalBefore: 0,
    evalAfter: 0,
    evalSwing: 0,
    sideToMove: 'w',
    cycleNumber: 0,
    lastDrilledAt: null,
    nextDrillAt: null,
    timesCorrect: 0,
    timesAttempted: 0,
    lastDrillFailed: false,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    phase: 'middlegame',
    solutionLine: null,
    motifs: [],
    kind: 'tactic',
    drillData: null,
    analysisDepth: null,
    ...overrides,
  } as Blunder;
}

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

describe('spaced-repetition ladder', () => {
  it('is the shortened 4-rung expanding ladder', () => {
    expect([...SPACED_REPETITION_DAYS]).toEqual([1, 3, 7, 21]);
    expect(MASTERED_REVIEW_DAYS).toBe(56);
  });

  it('intervalDaysForCycle walks the rungs then holds at the maintenance interval', () => {
    expect(intervalDaysForCycle(0)).toBe(1);
    expect(intervalDaysForCycle(1)).toBe(3);
    expect(intervalDaysForCycle(2)).toBe(7);
    expect(intervalDaysForCycle(3)).toBe(21);
    expect(intervalDaysForCycle(4)).toBe(MASTERED_REVIEW_DAYS);
    expect(intervalDaysForCycle(9)).toBe(MASTERED_REVIEW_DAYS);
  });

  it('nextDrillDate schedules from lastDrilledAt using the current cycle', () => {
    const drilled = new Date('2026-09-02T09:00:00Z');
    for (const [cycle, days] of [
      [0, 1],
      [1, 3],
      [2, 7],
      [3, 21],
      [4, 56],
    ] as const) {
      const b = makeBlunder({ cycleNumber: cycle, lastDrilledAt: drilled });
      expect(daysBetween(drilled, nextDrillDate(b))).toBe(days);
    }
  });

  it('nextDrillDate falls back to createdAt for never-drilled positions', () => {
    const b = makeBlunder();
    expect(daysBetween(b.createdAt, nextDrillDate(b))).toBe(1);
  });

  it('nextIntervalDaysIfSolved previews the post-solve interval', () => {
    expect(nextIntervalDaysIfSolved({ cycleNumber: 0 })).toBe(3);
    expect(nextIntervalDaysIfSolved({ cycleNumber: 2 })).toBe(21);
    expect(nextIntervalDaysIfSolved({ cycleNumber: 3 })).toBe(MASTERED_REVIEW_DAYS);
  });

  it('srBucket masters at the ladder length', () => {
    expect(srBucket({ cycleNumber: 3, timesAttempted: 3, lastDrillFailed: false })).toBe('learning');
    expect(srBucket({ cycleNumber: 4, timesAttempted: 4, lastDrillFailed: false })).toBe('mastered');
    expect(srBucket({ cycleNumber: 7, timesAttempted: 7, lastDrillFailed: false })).toBe('mastered');
  });
});
