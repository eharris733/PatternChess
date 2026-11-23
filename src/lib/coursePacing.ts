// Course pacing: lessons open in order, with no waiting between them. Day 1 is
// open from the start and day N+1 opens as soon as day N is finished. The
// player's local date is stored with each finished lesson so the daily plan's
// "Today's lesson" step can tell whether one was done today. Pure and shared
// by the app and the courses RPCs, which enforce the same rule.

export interface DayDone {
  day: number;
  /** The player's local date (YYYY-MM-DD) when they completed the day. */
  localDate: string;
}

/** done: completed · open: ready now · locked: finish the earlier days first. */
export type DayStatus = 'done' | 'open' | 'locked';

export function isLocalDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Status of days 1..total, in order. */
export function dayStatuses(total: number, done: readonly DayDone[]): DayStatus[] {
  const finished = new Set(done.map((d) => d.day));
  const out: DayStatus[] = [];
  for (let n = 1; n <= total; n++) {
    if (finished.has(n)) out.push('done');
    else out.push(n === 1 || finished.has(n - 1) ? 'open' : 'locked');
  }
  return out;
}

export function dayStatus(day: number, total: number, done: readonly DayDone[]): DayStatus {
  if (day < 1 || day > total) return 'locked';
  return dayStatuses(total, done)[day - 1];
}

/** The first day not yet completed and its status, or null once the course is finished. */
export function nextDay(total: number, done: readonly DayDone[]): { day: number; status: DayStatus } | null {
  const statuses = dayStatuses(total, done);
  const i = statuses.findIndex((s) => s !== 'done');
  return i < 0 ? null : { day: i + 1, status: statuses[i] };
}

/** Whether a day may be watched / marked complete now (completed days stay open). */
export function dayOpen(day: number, total: number, done: readonly DayDone[]): boolean {
  const s = dayStatus(day, total, done);
  return s === 'open' || s === 'done';
}

/** Whether any lesson was finished on the player's local date `today`. */
export function completedOn(done: readonly DayDone[], today: string): boolean {
  return done.some((d) => d.localDate === today);
}
