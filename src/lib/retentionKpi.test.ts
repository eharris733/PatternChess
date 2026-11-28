import { describe, expect, it } from 'vitest';
import type { RetentionCohort, RetentionCount } from '../hooks/useAdminRetention';
import { releasesInWeek, scaleReadout, wilson } from './retentionKpi';

const c = (retained: number, eligible: number): RetentionCount => ({ retained, eligible });
const zero = c(0, 0);

function cohort(w4: RetentionCount, w8: RetentionCount): RetentionCohort {
  return {
    cohort: 'all',
    signups: 300,
    trained: 200,
    trained2Days: 100,
    trained5Days: 40,
    windows: { d1: zero, d7: zero, d30: zero, w1: zero, w2: zero, w4, w8 },
  };
}

describe('wilson', () => {
  it('brackets the rate', () => {
    const w = wilson(c(20, 100))!;
    expect(w.low).toBeGreaterThan(0.12);
    expect(w.low).toBeLessThan(0.2);
    expect(w.high).toBeGreaterThan(0.2);
    expect(w.high).toBeLessThan(0.3);
    expect(wilson(zero)).toBeNull();
  });
});

describe('scaleReadout', () => {
  it('waits on too few users', () => {
    expect(scaleReadout(cohort(c(10, 20), zero)).verdict).toBe('wait');
  });
  it('says fix when Week 4 is clearly under target', () => {
    expect(scaleReadout(cohort(c(9, 134), zero)).verdict).toBe('fix');
  });
  it('says fix when the curve keeps sliding', () => {
    // Week 4 30%, Week 8 15% → ratio 0.5.
    expect(scaleReadout(cohort(c(60, 200), c(15, 100))).verdict).toBe('fix');
  });
  it('says scale when Week 4 clears target and the curve holds', () => {
    const r = scaleReadout(cohort(c(60, 200), c(27, 100)));
    expect(r.flattening).toBeCloseTo(0.9);
    expect(r.verdict).toBe('scale');
  });
  it('waits for Week 8 before saying scale', () => {
    expect(scaleReadout(cohort(c(60, 200), c(2, 10))).verdict).toBe('wait');
  });
});

describe('releasesInWeek', () => {
  it('lists releases inside the signup week', () => {
    expect(releasesInWeek('2026-11-23')).toHaveLength(2);
    expect(releasesInWeek('2026-11-16')).toHaveLength(2);
    expect(releasesInWeek('2026-11-02')).toHaveLength(0);
  });
});
