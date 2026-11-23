import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { DEFAULT_DAILY_GOALS } from '../../lib/dailyGoal';
import { detectTimezone, localDate } from '../../services/streakService';
import { TrophyIcon } from '../icons/TrophyIcon';
import { useT } from '../../i18n/useT';

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

/**
 * The summary shown when a training session finishes. "Keep training"
 * continues in the same focus (an openings session stays in openings); a
 * focus that came from /openings or /endgames also offers the way back.
 */
export function TrainingCompleteScreen({
  totalCorrect,
  totalAttempted,
  focusLabel = null,
  returnLabel = null,
  onReturn = null,
  onKeepTraining,
  onBackToDashboard,
}: {
  totalCorrect: number;
  totalAttempted: number;
  /** The session's focus ("Opening reviews", "Fork"); Keep training stays in it. */
  focusLabel?: string | null;
  /** "Back to Openings" / "Back to Endgames" when the focus has a home page. */
  returnLabel?: string | null;
  onReturn?: (() => void) | null;
  onKeepTraining: () => void;
  onBackToDashboard: () => void;
}) {
  const { profile } = useAuth();
  const t = useT();
  const queryClient = useQueryClient();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  const goal = (profile?.dailyGoals ?? DEFAULT_DAILY_GOALS).positionsPerDay;

  // The session row is written after every drill; refetch so the counts include it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['training', 'drillsToday'] });
    void queryClient.invalidateQueries({ queryKey: ['training', 'totals'] });
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
    <div className="max-w-md mx-auto card text-center flex flex-col gap-4" data-testid="training-complete">
      <TrophyIcon className="h-14 w-14 self-center text-gold-dark" />
      <h1 className="heading-lg">{planDone ? t('train.complete.planDone') : t('train.complete.sessionDone')}</h1>
      <p className="text-text-primary">
        {t('train.complete.recall', { pct, correct: totalCorrect, total: totalAttempted })}
      </p>
      {streakToday && <p className="text-text-primary">{t('train.complete.day', { count: streak })}</p>}
      {focusLabel && (
        <p className="text-sm text-text-primary" data-testid="complete-focus">
          {t('train.complete.focus', { focus: focusLabel })}
        </p>
      )}
      <button className="btn-primary" onClick={onKeepTraining}>
        {t('train.complete.keepTraining')}
      </button>
      {onReturn && returnLabel && (
        <button className="btn-outline" onClick={onReturn}>
          {returnLabel}
        </button>
      )}
      <button className="btn-outline" onClick={onBackToDashboard}>
        {t('train.complete.backToDashboard')}
      </button>
    </div>
  );
}
