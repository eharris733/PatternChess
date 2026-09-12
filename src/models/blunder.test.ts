import { describe, expect, it } from 'vitest';
import {
  Blunder,
  MASTERED_REVIEW_DAYS,
  SPACED_REPETITION_DAYS,
  intervalDaysForCycle,
  nextDrillDate,
  nextIntervalDaysIfSolved,
  sortDueQueue,
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

describe('sortDueQueue', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  it('ranks pressing (learning/tryAgain) items ahead of mastered maintenance and new items', () => {
    const mastered = makeBlunder({
      id: 'mastered',
      cycleNumber: 4,
      timesAttempted: 5,
      lastDrillFailed: false,
      nextDrillAt: daysAgo(60), // very overdue in absolute terms, but a long interval
    });
    const learning = makeBlunder({
      id: 'learning',
      cycleNumber: 1,
      timesAttempted: 2,
      lastDrillFailed: false,
      nextDrillAt: daysAgo(1), // barely overdue on a short interval
    });
    const fresh = makeBlunder({
      id: 'new',
      cycleNumber: 0,
      timesAttempted: 0,
      lastDrillFailed: false,
      createdAt: daysAgo(30),
      nextDrillAt: daysAgo(29), // a stale "new" item would look wildly overdue on a 1-day interval
    });

    const order = sortDueQueue([mastered, fresh, learning], now).map((b) => b.id);
    expect(order).toEqual(['learning', 'mastered', 'new']);
  });

  it('within the pressing tier, ranks by relative overdue-ness (overdue days ÷ interval) not raw cycle or days', () => {
    const barelyOverdueShortInterval = makeBlunder({
      id: 'try-again',
      cycleNumber: 0,
      timesAttempted: 1,
      lastDrillFailed: true, // 1-day interval
      nextDrillAt: daysAgo(0.5), // 50% overdue
    });
    const deeplyOverdueLongInterval = makeBlunder({
      id: 'learning-cycle3',
      cycleNumber: 3,
      timesAttempted: 4,
      lastDrillFailed: false, // 21-day interval
      nextDrillAt: daysAgo(5), // ~24% overdue
    });

    const order = sortDueQueue([deeplyOverdueLongInterval, barelyOverdueShortInterval], now).map(
      (b) => b.id,
    );
    expect(order).toEqual(['try-again', 'learning-cycle3']);
  });

  it('sorts new (never-attempted) items chronologically by createdAt, ignoring overdue fraction', () => {
    const olderNew = makeBlunder({
      id: 'older-new',
      timesAttempted: 0,
      createdAt: daysAgo(10),
      nextDrillAt: daysAgo(9),
    });
    const newerNew = makeBlunder({
      id: 'newer-new',
      timesAttempted: 0,
      createdAt: daysAgo(2),
      nextDrillAt: daysAgo(1),
    });

    const order = sortDueQueue([newerNew, olderNew], now).map((b) => b.id);
    expect(order).toEqual(['older-new', 'newer-new']);
  });

  it('breaks a tie in relative overdue-ness by nextDrillAt ascending', () => {
    // Same relative overdue-ness (2x interval) via different cycle/interval combos.
    const shortIntervalRecentlyDue = makeBlunder({
      id: 'short-interval',
      cycleNumber: 0,
      timesAttempted: 1,
      nextDrillAt: daysAgo(2), // 2 days overdue on a 1-day interval = 2x
    });
    const longIntervalLongOverdue = makeBlunder({
      id: 'long-interval',
      cycleNumber: 1,
      timesAttempted: 2,
      nextDrillAt: daysAgo(6), // 6 days overdue on a 3-day interval = 2x
    });

    const order = sortDueQueue([shortIntervalRecentlyDue, longIntervalLongOverdue], now).map(
      (b) => b.id,
    );
    // Equal relative overdue-ness, so the earlier (more stale) due date wins the tiebreak.
    expect(order).toEqual(['long-interval', 'short-interval']);
  });
});
