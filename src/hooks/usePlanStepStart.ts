import { useNavigate } from 'react-router-dom';
import type { DailyPlan, PlanStepId } from './useDailyPlan';
import type { TrainingFocus } from '../routes/training/trainingFocus';

/** Location state /endgames reads to start a plan run (its due play-outs, then the next step). */
export interface EndgamesPlanRunState {
  planRun: true;
}

export function isEndgamesPlanRunState(v: unknown): v is EndgamesPlanRunState {
  return !!v && typeof v === 'object' && (v as { planRun?: unknown }).planRun === true;
}

/** The /training focus that runs a plan step (Train or Openings), or null for the other steps. */
export function planStepFocus(step: PlanStepId, plan: DailyPlan): TrainingFocus | null {
  if (step === 'train') return { planRun: true, ...(plan.practiceNext ? { practiceAhead: true } : {}) };
  if (step === 'openings') {
    return {
      kindFilter: 'opening',
      returnTo: '/openings',
      planRun: true,
      ...(plan.openingsDue > 0 ? {} : { practiceAhead: true }),
    };
  }
  return null;
}

/**
 * Where a plan run goes after a session of `current`: the same step again
 * while it still needs more (its due queue ran out first, so practice ahead),
 * else the first unfinished step. `currentDone` says the session finished the
 * step even if the plan's counts haven't caught up yet.
 */
export function stepAfter(plan: DailyPlan, current: PlanStepId | null, currentDone = false): PlanStepId | null {
  if (plan.pending) return null;
  if (current && !currentDone && plan.unfinished.includes(current)) return current;
  return plan.unfinished.find((s) => s !== current) ?? null;
}

/**
 * `start(step)`: open a plan step as part of a plan run. Train and Openings
 * start a /training focus (through `startTraining` when already on /training,
 * so the session restarts in place), Endgames opens /endgames on its due
 * play-outs, the lesson opens the course day. Play is an external link, so
 * callers render it as one.
 */
export function usePlanStepStart(
  plan: DailyPlan,
  startTraining?: (focus: TrainingFocus) => void,
): (step: PlanStepId) => void {
  const navigate = useNavigate();
  return (step) => {
    const focus = planStepFocus(step, plan);
    if (focus) {
      if (startTraining) startTraining(focus);
      else navigate('/training', { state: focus });
      return;
    }
    if (step === 'endgames') {
      const state: EndgamesPlanRunState = { planRun: true };
      navigate('/endgames', { state });
    } else if (step === 'lesson' && plan.lessonTarget) {
      navigate(plan.lessonTarget);
    }
  };
}
