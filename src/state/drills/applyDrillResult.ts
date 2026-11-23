import { Blunder, SPACED_REPETITION_DAYS, intervalDaysForCycle } from '../../models/blunder';
import type { EndgameScenario } from '../../models/endgameScenario';
import { supabaseService } from '../../services/supabaseService';

export interface DrillResultDeps {
  /** Bridge to the caller's pending-writes tracker (fire-and-forget + flushable). */
  trackWrite: (p: Promise<unknown>) => void;
}

/** The SR fields every trainable item carries (blunders and endgame scenarios). */
export interface SrState {
  cycleNumber: number;
  timesCorrect: number;
  timesAttempted: number;
  lastDrillFailed: boolean;
  lastDrilledAt: Date | null;
  /** When the item is next due; null = due now (never scheduled). */
  nextDrillAt: Date | null;
}

/** What one drill did to the ladder. */
export interface SrOutcome {
  /**
   * True when the item wasn't due yet and the drill left mastery alone: an
   * early solve is practice (it still counts toward the day's goal, never
   * toward the ladder or recall stats).
   */
  practice: boolean;
}

/** Whether an item is due for review at `now` (null = never scheduled = due). */
export function isSrDue(item: Pick<SrState, 'nextDrillAt'>, now: Date = new Date()): boolean {
  return !item.nextDrillAt || item.nextDrillAt.getTime() <= now.getTime();
}

function scheduleFrom(now: Date, cycleNumber: number): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + intervalDaysForCycle(cycleNumber));
  return next;
}

/**
 * The ladder step itself, pure apart from mutating `item` in place.
 *
 * - Only the session's FIRST attempt at an item moves the ladder; retries
 *   within the session (which only follow a miss) count attempts but leave it
 *   alone.
 * - Due item: success bumps `cycleNumber` (capped at mastery), failure resets
 *   it to 0 and flags `lastDrillFailed`; either way `nextDrillAt` is
 *   rescheduled from now.
 * - Not due yet (practice ahead, a Vault/Openings/Course drill, a replay): a
 *   solve changes nothing but `lastDrilledAt` (so drilling a position over and
 *   over can't master it), while a first-attempt miss still resets it like any
 *   miss — forgetting is real evidence whenever it shows up.
 */
export function advanceSr(
  item: SrState,
  opts: { success: boolean; isFirstAttempt: boolean },
  now: Date = new Date(),
): SrOutcome {
  const early = opts.isFirstAttempt && opts.success && !isSrDue(item, now);
  item.lastDrilledAt = now;
  if (early) return { practice: true };
  if (opts.success) item.timesCorrect++;
  item.timesAttempted++;
  if (opts.isFirstAttempt) {
    if (opts.success) {
      item.cycleNumber = Math.min(item.cycleNumber + 1, SPACED_REPETITION_DAYS.length);
      item.lastDrillFailed = false;
    } else {
      item.cycleNumber = 0;
      item.lastDrillFailed = true;
    }
    item.nextDrillAt = scheduleFrom(now, item.cycleNumber);
  }
  return { practice: false };
}

/**
 * Canonical SR advancement for any blunder-backed drill kind. Mutates
 * `blunder` in place (matching the training store's optimistic-update style)
 * and schedules the Supabase write.
 */
export function applyDrillResult(
  blunder: Blunder,
  opts: { success: boolean; isFirstAttempt: boolean },
  deps: DrillResultDeps,
): SrOutcome {
  const outcome = advanceSr(blunder, opts);
  deps.trackWrite(
    supabaseService
      .updateBlunderAfterDrill(blunder)
      .catch((err) =>
        console.warn(
          `[training] updateBlunderAfterDrill (${opts.success ? 'correct' : 'incorrect'}) failed`,
          err,
        ),
      ),
  );
  return outcome;
}

/**
 * The same ladder for /endgames play-outs. Mutates `scenario` (SR fields plus
 * the play-out status/attempts) and returns the outcome plus the write, so the
 * caller can say "practice" and refresh its list once the write lands.
 */
export function applyScenarioResult(
  scenario: EndgameScenario,
  opts: { success: boolean; isFirstAttempt: boolean },
): { outcome: SrOutcome; write: Promise<void> } {
  const outcome = advanceSr(scenario, opts);
  // A pass is sticky (the rescue achievement counts it); a later fail only
  // moves the ladder.
  scenario.status = opts.success || scenario.status === 'passed' ? 'passed' : 'failed';
  scenario.attempts += 1;
  scenario.lastPlayedAt = scenario.lastDrilledAt;
  return { outcome, write: supabaseService.updateEndgameScenarioSr(scenario) };
}
