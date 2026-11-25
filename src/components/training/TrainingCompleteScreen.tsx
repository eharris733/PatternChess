import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { useDailyPlan, type PlanStepId } from '../../hooks/useDailyPlan';
import { stepAfter, usePlanStepStart } from '../../hooks/usePlanStepStart';
import type { TrainingFocus } from '../../routes/training/trainingFocus';
import { refreshPlanCounts } from '../../state/trainingStore';
import { TrophyIcon } from '../icons/TrophyIcon';
import { PlanRunNext } from '../insights/PlanRunNext';
import { useT } from '../../i18n/useT';
import { openDailyLimit } from '../../state/supporterUnlockStore';
import { FIXED_DAILY_LIMIT } from '../../lib/dailyLimit';
import { DailyLimitCountdown } from '../supporter/DailyLimitCountdown';

// The first session that finishes the whole plan says so; later ones say "Session done".
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
 * The headline reads "Today's plan: done" only when every plan step is done
 * (the same `useDailyPlan` verdict as the dashboard checklist); otherwise it
 * says "Session done" and points at the next unfinished step.
 *
 * A plan run (`planRun`, started from the plan card) headlines the finished
 * step and moves on to the next unfinished one by itself (`PlanRunNext`).
 */
export function TrainingCompleteScreen({
  totalCorrect,
  totalAttempted,
  focusLabel = null,
  returnLabel = null,
  onReturn = null,
  onKeepTraining,
  onBackToDashboard,
  onStartFocus,
  sessionFocused = false,
  cappedOut = false,
  cappedKind = null,
  limitResetsAt = null,
  planRun = false,
  runStep = null,
  unlimited = false,
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
  /** Start another /training focus in place (the "Next" nudge for the Train and Openings steps). */
  onStartFocus: (focus: TrainingFocus) => void;
  /** The session had a focus, so "Keep training" doesn't continue the main queue. */
  sessionFocused?: boolean;
  /**
   * A free player reached today's Train goal (trainingStore.cappedOut): the
   * day's positions are done, more training is a Supporter perk.
   */
  cappedOut?: boolean;
  /** Which daily limit capped the session (trainingStore.cappedKind). */
  cappedKind?: 'positions' | 'openings' | null;
  /** When the limits reset (useDailyQuota().resetsAt), for the countdown. */
  limitResetsAt?: number | null;
  /** The session was a step of today's plan run: move on to the next step. */
  planRun?: boolean;
  /** Which plan step the session drilled (Train or Openings). */
  runStep?: Extract<PlanStepId, 'train' | 'openings'> | null;
  /** A supporter: a capped plan-run step is just the plan, never a limit. */
  unlimited?: boolean;
}) {
  const { profile } = useAuth();
  const t = useT();
  const plan = useDailyPlan();
  const today = plan.today;

  // Every drill write lands first, then the plan's counts refetch, so the
  // verdict (and the next session's caps) include this session.
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    let live = true;
    void refreshPlanCounts().finally(() => {
      if (live) setRefreshed(true);
    });
    return () => {
      live = false;
    };
  }, []);
  // Judge the plan only once its counts have caught up with this session.
  const fetchingTraining = useIsFetching({ queryKey: ['training'] });
  const fetchingBlunders = useIsFetching({ queryKey: ['blunders'] });
  const settled = refreshed && !plan.pending && fetchingTraining === 0 && fetchingBlunders === 0;
  const [planDone, setPlanDone] = useState(false);
  useEffect(() => {
    if (settled && plan.allDone && claimPlanDone(today)) setPlanDone(true);
  }, [settled, plan.allDone, today]);

  // Whether the run's step is done, from the refreshed counts (a capped
  // session isn't proof: the counts are what the plan card shows).
  const stepFinished =
    settled && planRun && runStep != null && (runStep === 'train' ? plan.trainDone : plan.openingsDone);
  // The next unfinished step, unless "Keep training" already is it (or the
  // Train step is capped for today). A plan run always moves on.
  const nextStep = settled && !plan.allDone ? stepAfter(plan, planRun ? runStep : null, stepFinished) : null;
  const nudge =
    nextStep && (planRun || !(nextStep === 'train' && (!sessionFocused || cappedOut))) ? nextStep : null;
  const startStep = usePlanStepStart(plan, onStartFocus);

  const streak = profile?.currentStreakDays ?? 0;
  const streakToday = streak > 0 && profile?.lastDrillLocalDate === today;

  const limitKind = cappedKind ?? 'positions';
  const limitCount = limitKind === 'positions' ? plan.goals.positionsPerDay : FIXED_DAILY_LIMIT.openings;

  const pct = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  return (
    <div className="max-w-md mx-auto card text-center flex flex-col gap-4" data-testid="training-complete">
      <TrophyIcon className="h-14 w-14 self-center text-gold-dark" />
      <h1 className="heading-lg">
        {planDone
          ? t('train.complete.planDone')
          : (planRun ? stepFinished : cappedOut)
            ? t((runStep ?? limitKind) === 'openings' ? 'limit.title.openings' : 'limit.title.positions')
            : t('train.complete.sessionDone')}
      </h1>
      {totalAttempted > 0 && (
        <p className="text-text-primary">
          {t('train.complete.recall', { pct, correct: totalCorrect, total: totalAttempted })}
        </p>
      )}
      {cappedOut && !planRun && !unlimited && (
        <div className="flex flex-col items-center gap-2" data-testid="training-capped">
          <p className="text-text-primary">
            {t(limitKind === 'positions' ? 'limit.body.positions' : 'limit.body.openings', { count: limitCount })}
          </p>
          {limitResetsAt != null && <DailyLimitCountdown resetsAt={limitResetsAt} className="text-sm" />}
        </div>
      )}
      {streakToday && <p className="text-text-primary">{t('train.complete.day', { count: streak })}</p>}
      {focusLabel && (
        <p className="text-sm text-text-primary" data-testid="complete-focus">
          {t('train.complete.focus', { focus: focusLabel })}
        </p>
      )}
      {settled && plan.allDone && !planDone && (
        <p className="text-sm text-text-primary" data-testid="complete-plan-done">
          {t('plan.allDone')}
        </p>
      )}
      {nudge && <PlanRunNext plan={plan} step={nudge} onGo={startStep} auto={planRun} />}
      {cappedOut && !unlimited ? (
        <button
          className={planRun && nudge ? 'btn-outline' : 'btn-primary'}
          data-testid="training-capped-upsell"
          onClick={() =>
            openDailyLimit({ kind: limitKind, limit: limitCount, resetsAt: limitResetsAt ?? Date.now() })
          }
        >
          {t('limit.cta')}
        </button>
      ) : (
        <button className={planRun && nudge ? 'btn-outline' : 'btn-primary'} onClick={onKeepTraining}>
          {t('train.complete.keepTraining')}
        </button>
      )}
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
