/**
 * Daily training goal — the number of drills (first-attempt position attempts)
 * that count as "done for today". Drives the dashboard daily-habit card and the
 * come-back-tomorrow streak loop. Fixed at 10 for now.
 */
export const DAILY_GOAL = 10;

export interface DailyGoalProgress {
  done: number;
  goal: number;
  remaining: number;
  fraction: number;
  met: boolean;
}

export function dailyGoalProgress(done: number, goal: number = DAILY_GOAL): DailyGoalProgress {
  const safeGoal = Math.max(1, goal);
  const clampedDone = Math.max(0, done);
  return {
    done: clampedDone,
    goal: safeGoal,
    remaining: Math.max(0, safeGoal - clampedDone),
    fraction: Math.min(1, clampedDone / safeGoal),
    met: clampedDone >= safeGoal,
  };
}
