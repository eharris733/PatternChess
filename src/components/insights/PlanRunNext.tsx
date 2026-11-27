import { useEffect, useRef, useState } from 'react';
import type { DailyPlan, PlanStepId } from '../../hooks/useDailyPlan';
import { useT, type Translator } from '../../i18n/useT';
import { PlayLinks } from '../PlayLinks';

/** Seconds a plan run waits on the "Next in today's plan" card before moving on. */
export const PLAN_RUN_AUTO_SECONDS = 3;

/** The "Next in today's plan" card: the step's title and its button label. */
export function nextStepCopy(step: PlanStepId, plan: DailyPlan, t: Translator): { title: string; action: string } {
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
 * "Next in today's plan" with its button. With `auto` (a plan run), an in-app
 * step starts by itself after a short countdown, which "Stay here" cancels.
 * Play opens the chess site, so it never starts by itself.
 */
export function PlanRunNext({
  plan,
  step,
  onGo,
  auto = false,
}: {
  plan: DailyPlan;
  step: PlanStepId;
  onGo: (step: PlanStepId) => void;
  auto?: boolean;
}) {
  const t = useT();
  const copy = nextStepCopy(step, plan, t);
  const external = step === 'play';
  const counting = auto && !external;
  const [left, setLeft] = useState(PLAN_RUN_AUTO_SECONDS);
  const [stopped, setStopped] = useState(false);
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;

  useEffect(() => {
    setLeft(PLAN_RUN_AUTO_SECONDS);
    setStopped(false);
  }, [step]);

  useEffect(() => {
    if (!counting || stopped) return;
    if (left <= 0) {
      onGoRef.current(step);
      return;
    }
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [counting, stopped, left, step]);

  return (
    <div
      className="flex items-center justify-between gap-3 border-2 border-text-primary/15 px-3 py-2 text-left"
      data-testid="complete-next"
    >
      <span className="flex min-w-0 flex-col">
        <span className="label">{t('train.complete.next')}</span>
        <span className="text-sm text-text-primary">{copy.title}</span>
        {counting && !stopped && (
          <span className="font-mono text-xs text-text-primary tabular-nums" data-testid="plan-run-countdown">
            {t('planRun.startingIn', { seconds: String(Math.max(0, left)) })}{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-gold-dark"
              onClick={() => setStopped(true)}
              data-testid="plan-run-stay"
            >
              {t('planRun.stay')}
            </button>
          </span>
        )}
      </span>
      {external && plan.play.length > 1 ? (
        <PlayLinks targets={plan.play} />
      ) : external && plan.play.length === 1 ? (
        <a
          href={plan.play[0].href}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline h-9 px-4 text-xs shrink-0 whitespace-nowrap"
        >
          {copy.action}
        </a>
      ) : (
        <button
          type="button"
          className={`${counting && !stopped ? 'btn-primary' : 'btn-outline'} h-9 px-4 text-xs shrink-0 whitespace-nowrap`}
          onClick={() => onGo(step)}
          data-testid="plan-run-go"
        >
          {copy.action}
        </button>
      )}
    </div>
  );
}
