import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useDailyPlan, type DailyPlan, type PlanStepId } from '../../hooks/useDailyPlan';
import type { TrainingFocus } from '../../routes/training/trainingFocus';
import { TrophyIcon } from '../icons/TrophyIcon';
import { useT, type Translator } from '../../i18n/useT';

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

/** The "Next in today's plan" nudge: the step's title and its button label. */
function nextStepCopy(step: PlanStepId, plan: DailyPlan, t: Translator): { title: string; action: string } {
  switch (step) {
    case 'lesson':
      return { title: t('plan.lesson.title'), action: t('plan.lesson.start') };
    case 'train':
      return {
        title: t('plan.train.title', { count: plan.goals.positionsPerDay }),
        action: plan.practiceNext ? t('plan.practiceAhead') : t('common.train'),
      };
    case 'openings':
      return {
        title: t('plan.openings.title', { count: plan.openingsGoal }),
        action: plan.openingsDue > 0 ? t('common.review') : t('plan.practice'),
      };
    case 'endgames':
      return { title: t('plan.endgames.title', { count: plan.endgamesGoal }), action: t('common.play') };
    case 'play':
      return { title: t('plan.play.title', { count: plan.goals.gamesPerDay }), action: t('common.play') };
  }
}

/**
 * The summary shown when a training session finishes. "Keep training"
 * continues in the same focus (an openings session stays in openings); a
 * focus that came from /openings or /endgames also offers the way back.
 * The headline reads "Today's plan: done" only when every plan step is done
 * (the same `useDailyPlan` verdict as the dashboard checklist); otherwise it
 * says "Session done" and points at the next unfinished step.
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
}) {
  const { profile } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const plan = useDailyPlan();
  const today = plan.today;

  // The session row is written after every drill; refetch so the counts include it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['training', 'drillsToday'] });
    void queryClient.invalidateQueries({ queryKey: ['training', 'totals'] });
  }, [queryClient]);
  // Judge the plan only once its counts have caught up with this session.
  const fetchingTraining = useIsFetching({ queryKey: ['training'] });
  const fetchingBlunders = useIsFetching({ queryKey: ['blunders'] });
  const settled = !plan.pending && fetchingTraining === 0 && fetchingBlunders === 0;
  const [planDone, setPlanDone] = useState(false);
  useEffect(() => {
    if (settled && plan.allDone && claimPlanDone(today)) setPlanDone(true);
  }, [settled, plan.allDone, today]);

  // The next unfinished step, unless "Keep training" already is it.
  const nextStep = settled && !plan.allDone ? plan.nextStep : null;
  const nudge = nextStep && !(nextStep === 'train' && !sessionFocused) ? nextStep : null;
  const nudgeCopy = nudge ? nextStepCopy(nudge, plan, t) : null;
  const goNext = () => {
    if (nudge === 'lesson' && plan.lessonTarget) navigate(plan.lessonTarget);
    else if (nudge === 'train') onStartFocus(plan.practiceNext ? { practiceAhead: true } : {});
    else if (nudge === 'openings')
      onStartFocus({ kindFilter: 'opening', returnTo: '/openings', ...(plan.openingsDue > 0 ? {} : { practiceAhead: true }) });
    else if (nudge === 'endgames') navigate('/endgames');
  };

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
      {settled && plan.allDone && !planDone && (
        <p className="text-sm text-text-primary" data-testid="complete-plan-done">
          {t('plan.allDone')}
        </p>
      )}
      {nudge && nudgeCopy && (
        <div
          className="flex items-center justify-between gap-3 border-2 border-text-primary/15 px-3 py-2 text-left"
          data-testid="complete-next"
        >
          <span className="flex min-w-0 flex-col">
            <span className="label">{t('train.complete.next')}</span>
            <span className="text-sm text-text-primary">{nudgeCopy.title}</span>
          </span>
          {nudge === 'play' && plan.playHref ? (
            <a
              href={plan.playHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline h-9 px-4 text-xs shrink-0 whitespace-nowrap"
            >
              {nudgeCopy.action}
            </a>
          ) : (
            <button type="button" className="btn-outline h-9 px-4 text-xs shrink-0 whitespace-nowrap" onClick={goNext}>
              {nudgeCopy.action}
            </button>
          )}
        </div>
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
