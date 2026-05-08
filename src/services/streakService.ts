/**
 * Date / TZ helpers for streak math. All operations work on `YYYY-MM-DD`
 * strings in the user's IANA timezone, so DST rollovers don't shift the
 * boundary by an hour.
 */

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function localDate(tz: string, date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: tz });
}

export function addDays(yyyymmdd: string, days: number): string {
  const parts = yyyymmdd.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return yyyymmdd;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export interface StreakInputs {
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string | null;
  timezone: string | null;
}

export interface StreakComputation {
  changed: boolean;
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string;
  timezone: string;
}

/** Apply the streak update rule given the user's profile + a freshly completed drill. */
export function computeNextStreak(
  inputs: StreakInputs,
  now: Date = new Date(),
): StreakComputation {
  const tz = inputs.timezone ?? detectTimezone();
  const today = localDate(tz, now);
  const yesterday = addDays(today, -1);

  let current = inputs.currentStreakDays;
  let last = inputs.lastDrillLocalDate;
  let changed = inputs.timezone !== tz;

  if (last === today) {
    // already counted for today
  } else if (last === yesterday) {
    current = current + 1;
    last = today;
    changed = true;
  } else {
    current = 1;
    last = today;
    changed = true;
  }

  const longest = Math.max(inputs.longestStreakDays, current);
  if (longest !== inputs.longestStreakDays) changed = true;

  return {
    changed,
    currentStreakDays: current,
    longestStreakDays: longest,
    lastDrillLocalDate: last ?? today,
    timezone: tz,
  };
}
