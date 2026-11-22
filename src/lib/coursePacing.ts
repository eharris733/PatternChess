// Course pacing: one new lesson per local date. Day 1 is open from the start;
// day N+1 opens on the first local date after day N was completed. Pure and
// shared by the app and the courses RPCs, which enforce the same rule.

export interface DayDone {
  day: number;
  /** The player's local date (YYYY-MM-DD) when they completed the day. */
  localDate: string;
}

/** done: completed · open: watch it now · tomorrow: opens next local date · locked: earlier days first. */
export type DayStatus = 'done' | 'open' | 'tomorrow' | 'locked';

export function isLocalDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Status of days 1..total, in order. */
export function dayStatuses(total: number, done: readonly DayDone[], today: string): DayStatus[] {
  const byDay = new Map(done.map((d) => [d.day, d]));
  const out: DayStatus[] = [];
  for (let n = 1; n <= total; n++) {
    if (byDay.has(n)) {
      out.push('done');
      continue;
    }
    if (n === 1) {
      out.push('open');
      continue;
    }
    const prev = byDay.get(n - 1);
    out.push(!prev ? 'locked' : prev.localDate < today ? 'open' : 'tomorrow');
  }
  return out;
}

export function dayStatus(day: number, total: number, done: readonly DayDone[], today: string): DayStatus {
  if (day < 1 || day > total) return 'locked';
  return dayStatuses(total, done, today)[day - 1];
}

/** The first day not yet completed and its status, or null once the course is finished. */
export function nextDay(total: number, done: readonly DayDone[], today: string): { day: number; status: DayStatus } | null {
  const statuses = dayStatuses(total, done, today);
  const i = statuses.findIndex((s) => s !== 'done');
  return i < 0 ? null : { day: i + 1, status: statuses[i] };
}

/** Whether a day may be watched / marked complete today (completed days stay open). */
export function dayOpen(day: number, total: number, done: readonly DayDone[], today: string): boolean {
  const s = dayStatus(day, total, done, today);
  return s === 'open' || s === 'done';
}

export function completedOn(done: readonly DayDone[], today: string): boolean {
  return done.some((d) => d.localDate === today);
}
