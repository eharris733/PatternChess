/**
 * The "can we scale yet?" rule for the admin Retention card, plus the outside
 * benchmarks it is read against. Pure, so it is unit-tested.
 *
 * KPI: Week 4 retention = share of signups who trained on any day 22–28 after
 * signup (their own timezone). It is the bracket form of D30: steady at a few
 * hundred users where an exact-day D30 swings by a few people.
 *
 * Gate (our judgment, set from the benchmarks below): scale paid acquisition
 * when (1) Week 4 retention is at or above WEEK4_TARGET with the whole 95%
 * interval above it, and (2) the curve has flattened: Week 8 holds at least
 * FLATTEN_RATIO of Week 4. A curve that keeps sliding to zero means every new
 * user eventually leaves, however good the early weeks look.
 */
import type { RetentionCohort, RetentionCount } from '../hooks/useAdminRetention';

export const WEEK4_TARGET = 0.15;
export const FLATTEN_RATIO = 0.7;
/** Fewer eligible users than this and the window reads as noise. */
export const MIN_RELIABLE_N = 30;

/**
 * Published classic-retention benchmarks (active on exactly day N). Ranges,
 * because the sources measure different app sets.
 */
export const RETENTION_BENCHMARKS: {
  label: string;
  d1: string;
  d7: string;
  d30: string;
}[] = [
  // Business of Apps 2025 / AppsFlyer-derived (low end) to OneSignal 2024 (high end).
  { label: 'Education apps', d1: '14–28%', d7: '~18%', d30: '2–8%' },
  // AppMagic estimate via Udonis (not a Duolingo disclosure).
  { label: 'Duolingo (est.)', d1: '38%', d7: '21%', d30: '12%' },
];

/** Releases worth reading the weekly cohorts against (signup weeks containing them get a marker). */
export const RETENTION_RELEASES: { date: string; label: string }[] = [
  { date: '2026-11-20', label: 'Daily plan + commitment levels' },
  { date: '2026-11-22', label: 'Cloudflare backend' },
  { date: '2026-11-23', label: 'Free daily limits, Lichess email gate' },
  { date: '2026-11-24', label: 'Plan runs, course lessons' },
];

export function rate(c: RetentionCount): number | null {
  return c.eligible > 0 ? c.retained / c.eligible : null;
}

/** 95% Wilson score interval for retained / eligible. */
export function wilson(c: RetentionCount): { low: number; high: number } | null {
  const n = c.eligible;
  if (n === 0) return null;
  const z = 1.96;
  const p = c.retained / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type ScaleVerdict = 'scale' | 'fix' | 'wait';

export interface ScaleReadout {
  verdict: ScaleVerdict;
  week4: RetentionCount;
  week4Rate: number | null;
  week4Interval: { low: number; high: number } | null;
  /** Week 8 ÷ Week 4 over the users eligible for both; null until enough are. */
  flattening: number | null;
}

export function scaleReadout(all: RetentionCohort): ScaleReadout {
  const week4 = all.windows.w4;
  const week8 = all.windows.w8;
  const week4Rate = rate(week4);
  const week4Interval = wilson(week4);
  const r8 = rate(week8);
  // Week 8 users are a subset (older signups) of Week 4's, so compare rates.
  const flattening =
    week8.eligible >= MIN_RELIABLE_N && week4Rate && r8 !== null ? r8 / week4Rate : null;

  let verdict: ScaleVerdict = 'wait';
  if (week4Interval && week4.eligible >= MIN_RELIABLE_N) {
    if (week4Interval.high < WEEK4_TARGET) verdict = 'fix'; // clearly below target
    else if (flattening !== null && flattening < FLATTEN_RATIO) verdict = 'fix'; // still leaking
    else if (week4Interval.low >= WEEK4_TARGET && flattening !== null) verdict = 'scale';
  }
  return { verdict, week4, week4Rate, week4Interval, flattening };
}

/** Releases whose date falls in the signup week starting `monday` (YYYY-MM-DD). */
export function releasesInWeek(monday: string): string[] {
  const start = Date.parse(`${monday}T00:00:00Z`);
  const end = start + 7 * 86400_000;
  return RETENTION_RELEASES.filter((r) => {
    const t = Date.parse(`${r.date}T00:00:00Z`);
    return t >= start && t < end;
  }).map((r) => r.label);
}
