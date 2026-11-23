import { OPENINGS_PER_DAY, PLAYOUTS_PER_DAY } from './dailyGoal';

/**
 * Free players' daily limits (feedback round 3): once a day's plan step is
 * done, that kind of training locks until local midnight. Supporters have no
 * limits. The positions limit is the plan's Train goal (`effectiveGoals`), the
 * other two are the plan's fixed steps. Read them through `useDailyQuota()`.
 */
export type QuotaKind = 'positions' | 'openings' | 'endgames';

export const FIXED_DAILY_LIMIT: Record<Exclude<QuotaKind, 'positions'>, number> = {
  openings: OPENINGS_PER_DAY,
  endgames: PLAYOUTS_PER_DAY,
};

/** Wall-clock parts of `now` in `tz` (falls back to UTC for an unknown zone). */
function wallClock(tz: string, now: Date): { h: number; m: number; s: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);
  } catch {
    return { h: now.getUTCHours(), m: now.getUTCMinutes(), s: now.getUTCSeconds() };
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

/**
 * The next local midnight in `tz`: when today's limits reset (the plan's
 * `today` is `localDate(tz)`, so this is when it rolls over). On a DST change
 * day it can be an hour off, which only moves the countdown.
 */
export function nextLocalMidnight(tz: string, now: Date = new Date()): Date {
  const { h, m, s } = wallClock(tz, now);
  const sinceMidnightMs = ((h * 60 + m) * 60 + s) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() + 86_400_000 - sinceMidnightMs);
}

/** "4h 12m", "12m 05s", "45s": the time left until a limit resets. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
