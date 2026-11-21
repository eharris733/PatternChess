import { computeNextStreak, type StreakComputation, type StreakInputs } from './streakService';
import { updateProfileStreak } from './db/profiles';
import { useStreakNoticeStore } from '../state/streakNoticeStore';

/**
 * Count a completed drill toward the daily streak: apply the streak rule
 * (freezes included), persist it, and raise a notice when a freeze was spent
 * or earned. Every drill surface calls this — /training (via trainingStore)
 * and /endgames play-outs — so any training keeps the streak alive.
 * Network failures are non-fatal: the streak resyncs on the next drill.
 */
export async function recordStreakActivity(inputs: StreakInputs): Promise<StreakComputation | null> {
  const next = computeNextStreak(inputs);
  if (!next.changed) return next;
  if (next.freezesUsed > 0) {
    useStreakNoticeStore.getState().show({ kind: 'freezeUsed', days: next.currentStreakDays, freezes: next.freezesUsed });
  } else if (next.freezeEarned) {
    useStreakNoticeStore.getState().show({ kind: 'freezeEarned', days: next.currentStreakDays, freezes: next.streakFreezes });
  }
  try {
    await updateProfileStreak({
      currentStreakDays: next.currentStreakDays,
      longestStreakDays: next.longestStreakDays,
      lastDrillLocalDate: next.lastDrillLocalDate,
      timezone: next.timezone,
      streakFreezes: next.streakFreezes,
      freezesUsed: next.freezesUsed,
    });
    return next;
  } catch {
    return null;
  }
}
