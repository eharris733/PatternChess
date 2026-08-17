import { Blunder, SPACED_REPETITION_DAYS } from '../../models/blunder';
import { supabaseService } from '../../services/supabaseService';

export interface DrillResultDeps {
  /** Bridge to the caller's pending-writes tracker (fire-and-forget + flushable). */
  trackWrite: (p: Promise<unknown>) => void;
}

/**
 * Canonical SR advancement for any drill kind. Mutates `blunder` in place
 * (matching the training store's optimistic-update style) and schedules the
 * Supabase write.
 *
 * Only the session's FIRST attempt at an item moves the ladder: success bumps
 * `cycleNumber` (capped at mastery), failure resets it to 0 and flags
 * `lastDrillFailed`. Retries within the same session still count attempts but
 * leave the ladder untouched.
 */
export function applyDrillResult(
  blunder: Blunder,
  opts: { success: boolean; isFirstAttempt: boolean },
  deps: DrillResultDeps,
): void {
  if (opts.success) blunder.timesCorrect++;
  blunder.timesAttempted++;
  blunder.lastDrilledAt = new Date();
  if (opts.isFirstAttempt) {
    if (opts.success) {
      blunder.cycleNumber = Math.min(blunder.cycleNumber + 1, SPACED_REPETITION_DAYS.length);
      blunder.lastDrillFailed = false;
    } else {
      blunder.cycleNumber = 0;
      blunder.lastDrillFailed = true;
    }
  }
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
