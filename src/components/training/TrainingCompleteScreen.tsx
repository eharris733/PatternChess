import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { DEFAULT_DAILY_GOALS } from '../../lib/dailyGoal';
import { detectTimezone, localDate } from '../../services/streakService';
import { TrophyIcon } from '../icons/TrophyIcon';

// The first session that meets today's goal says so; later ones say "Session done".
const PLAN_DONE_KEY = 'pc:plan-done-shown';

function claimPlanDone(today: string): boolean {
  try {
    if (window.localStorage.getItem(PLAN_DONE_KEY) === today) return false;
    window.localStorage.setItem(PLAN_DONE_KEY, today);
    return true;
  } catch {
    return false;
  }
}

/** The summary shown when a training session finishes. */
export function TrainingCompleteScreen({
  totalCorrect,
  totalAttempted,
  onKeepTraining,
  onBackToDashboard,
}: {
  totalCorrect: number;
  totalAttempted: number;
  onKeepTraining: () => void;
  onBackToDashboard: () => void;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  const goal = (profile?.dailyGoals ?? DEFAULT_DAILY_GOALS).positionsPerDay;

  // The session row is written after every drill; refetch so the count includes it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['training', 'drillsToday'] });
  }, [queryClient]);
  const drills = useDrillsToday();
  const [planDone, setPlanDone] = useState(false);
  useEffect(() => {
    if (!drills.isFetching && (drills.data ?? 0) >= goal && claimPlanDone(today)) setPlanDone(true);
  }, [drills.isFetching, drills.data, goal, today]);

  const streak = profile?.currentStreakDays ?? 0;
  const streakToday = streak > 0 && profile?.lastDrillLocalDate === today;

  const pct = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  return (
    <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
      <TrophyIcon className="h-14 w-14 self-center text-gold-dark" />
      <h1 className="heading-lg">{planDone ? "Today's plan: done" : 'Session done'}</h1>
      <p className="text-text-secondary">
        {pct}% recall · {totalCorrect}/{totalAttempted} correct
      </p>
      {streakToday && <p className="text-text-primary">Day {streak} in the books.</p>}
      <button className="btn-primary" onClick={onKeepTraining}>
        Keep training
      </button>
      <button className="btn-outline" onClick={onBackToDashboard}>
        Back to dashboard
      </button>
    </div>
  );
}
