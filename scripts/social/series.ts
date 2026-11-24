// The posting schedule: which series fills which daily slot, and when Buffer
// publishes it. The one daily run (17:00 UTC) hands both slots to Buffer; the
// evening slot is simply scheduled further out.
export type Series = 'puzzle' | 'pro';

export interface Slot {
  slot: 0 | 1;
  series: Series;
  /** HH:MM UTC Buffer publishes at (or 10 minutes after the run, if later). */
  postAtUtc: string;
}

export const SLOTS: readonly Slot[] = [
  // ~12:10 ET: the puzzle (blunder of the day / "would you fall for this?").
  { slot: 0, series: 'puzzle', postAtUtc: '17:10' },
  // ~18:30 ET: "Blunders decide games" (a famous player's deciding blunder).
  { slot: 1, series: 'pro', postAtUtc: '23:30' },
];

export function slotConfig(slot: number): Slot {
  const s = SLOTS.find((x) => x.slot === slot);
  if (!s) throw new Error(`unknown slot ${slot}`);
  return s;
}

/** Minimum lead time Buffer needs to fetch the video. */
export const MIN_LEAD_MS = 10 * 60_000;

/** When Buffer should publish `slot` on `day`: its time of day, never sooner than now + 10 minutes. */
export function dueAtFor(day: string, slot: number, now = new Date()): string {
  const at = Date.parse(`${day}T${slotConfig(slot).postAtUtc}:00Z`);
  return new Date(Math.max(at, now.getTime() + MIN_LEAD_MS)).toISOString();
}
