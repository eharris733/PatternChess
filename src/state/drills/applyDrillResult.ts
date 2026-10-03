import { Blunder, SPACED_REPETITION_DAYS } from '../../models/blunder';
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
}

/**
 * The ladder step itself, pure apart from mutating `item` in place. Only the
 * session's FIRST attempt at an item moves the ladder: success bumps
 * `cycleNumber` (capped at mastery), failure resets it to 0 and flags
 * `lastDrillFailed`. Retries within the same session still count attempts but
 * leave the ladder untouched.
 */
export function advanceSr(
  item: SrState,
  opts: { success: boolean; isFirstAttempt: boolean },
  now: Date = new Date(),
): void {
  if (opts.success) item.timesCorrect++;
  item.timesAttempted++;
  item.lastDrilledAt = now;
  if (opts.isFirstAttempt) {
    if (opts.success) {
      item.cycleNumber = Math.min(item.cycleNumber + 1, SPACED_REPETITION_DAYS.length);
      item.lastDrillFailed = false;
    } else {
      item.cycleNumber = 0;
      item.lastDrillFailed = true;
    }
  }
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
): void {
  advanceSr(blunder, opts);
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
}

/**
 * The same ladder for /endgames play-outs. Mutates `scenario` (SR fields plus
 * the play-out status/attempts) and returns the write, so the caller can
 * refresh its list once it lands.
 */
export function applyScenarioResult(
  scenario: EndgameScenario,
  opts: { success: boolean; isFirstAttempt: boolean },
): Promise<void> {
  advanceSr(scenario, opts);
  // A pass is sticky (the rescue achievement counts it); a later fail only
  // moves the ladder.
  scenario.status = opts.success || scenario.status === 'passed' ? 'passed' : 'failed';
  scenario.attempts += 1;
  scenario.lastPlayedAt = scenario.lastDrilledAt;
  return supabaseService.updateEndgameScenarioSr(scenario);
}
