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

/** Whole days from `a` to `b` (both `YYYY-MM-DD`); negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const diff = (toUtc(b) - toUtc(a)) / 86_400_000;
  return Number.isNaN(diff) ? 0 : Math.round(diff);
}

/** A freeze is earned each time the streak reaches a multiple of this. */
export const STREAK_FREEZE_EVERY_DAYS = 7;
/** Most freezes a player can bank (matches the profiles check constraint). */
export const MAX_STREAK_FREEZES = 2;

export interface StreakInputs {
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string | null;
  timezone: string | null;
  /** Banked freezes; omitted = 0 (no freezes to spend). */
  streakFreezes?: number;
}

export interface StreakComputation {
  changed: boolean;
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string;
  timezone: string;
  streakFreezes: number;
  /** Freezes this update spent to bridge missed days (0 when none). */
  freezesUsed: number;
  /** True when this update banked a new freeze. */
  freezeEarned: boolean;
}

/**
 * Apply the streak update rule given the user's profile + a freshly completed
 * drill. Missed days are bridged by banked freezes (one per day) when there
 * are enough of them; otherwise the streak restarts at 1. Frozen days keep the
 * streak alive but don't add to it.
 */
export function computeNextStreak(
  inputs: StreakInputs,
  now: Date = new Date(),
): StreakComputation {
  const tz = inputs.timezone ?? detectTimezone();
  const today = localDate(tz, now);
  const startFreezes = Math.max(0, Math.min(MAX_STREAK_FREEZES, inputs.streakFreezes ?? 0));

  let current = inputs.currentStreakDays;
  let last = inputs.lastDrillLocalDate;
  let freezes = startFreezes;
  let freezesUsed = 0;
  let changed = inputs.timezone !== tz;

  const missedSinceLast = last ? daysBetween(last, today) - 1 : Infinity;
  if (last === today || missedSinceLast < 0) {
    // Already counted for today (or a timezone change put the last drill
    // "tomorrow" — never reset a streak for that).
  } else {
    const missed = missedSinceLast;
    if (missed === 0) {
      current = current + 1;
    } else if (current > 0 && missed > 0 && missed <= freezes) {
      freezes -= missed;
      freezesUsed = missed;
      current = current + 1;
    } else {
      current = 1;
    }
    last = today;
    changed = true;
  }

  // Bank a freeze each time the streak grows onto a multiple of 7.
  let freezeEarned = false;
  if (
    current !== inputs.currentStreakDays &&
    current > 1 &&
    current % STREAK_FREEZE_EVERY_DAYS === 0 &&
    freezes < MAX_STREAK_FREEZES
  ) {
    freezes += 1;
    freezeEarned = true;
  }
  if (freezes !== startFreezes) changed = true;

  const longest = Math.max(inputs.longestStreakDays, current);
  if (longest !== inputs.longestStreakDays) changed = true;

  return {
    changed,
    currentStreakDays: current,
    longestStreakDays: longest,
    lastDrillLocalDate: last ?? today,
    timezone: tz,
    streakFreezes: freezes,
    freezesUsed,
    freezeEarned,
  };
}

/**
 * Read-only view of a stored streak for display: whether it's still alive
 * today (counting banked freezes), and how many freezes a drill today would
 * spend. Mirrors computeNextStreak without mutating anything.
 */
export function streakStatus(
  inputs: Pick<StreakInputs, 'currentStreakDays' | 'lastDrillLocalDate' | 'timezone' | 'streakFreezes'>,
  now: Date = new Date(),
): { alive: boolean; trainedToday: boolean; freezesNeeded: number } {
  const tz = inputs.timezone ?? detectTimezone();
  const today = localDate(tz, now);
  const last = inputs.lastDrillLocalDate;
  if (!last || inputs.currentStreakDays <= 0) return { alive: false, trainedToday: false, freezesNeeded: 0 };
  if (last === today) return { alive: true, trainedToday: true, freezesNeeded: 0 };
  const missed = daysBetween(last, today) - 1;
  if (missed < 0) return { alive: true, trainedToday: true, freezesNeeded: 0 };
  const freezes = inputs.streakFreezes ?? 0;
  return { alive: missed <= freezes, trainedToday: false, freezesNeeded: Math.max(0, missed) };
}
