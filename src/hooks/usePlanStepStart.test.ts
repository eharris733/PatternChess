import { describe, expect, it } from 'vitest';
import { planStepFocus, stepAfter } from './usePlanStepStart';
import type { DailyPlan } from './useDailyPlan';

const plan = (over: Partial<DailyPlan>): DailyPlan =>
  ({ pending: false, unfinished: [], practiceNext: false, openingsDue: 0, ...over }) as DailyPlan;

describe('stepAfter', () => {
  it('skips the step just finished while its count catches up', () => {
    expect(stepAfter(plan({ unfinished: ['openings', 'endgames', 'play'] }), 'openings', true)).toBe('endgames');
    expect(stepAfter(plan({ unfinished: ['endgames', 'play'] }), 'openings', true)).toBe('endgames');
    expect(stepAfter(plan({ unfinished: ['train'] }), null)).toBe('train');
  });
  it('stays on a step that still needs more, else takes the first unfinished one', () => {
    expect(stepAfter(plan({ unfinished: ['train', 'openings', 'play'] }), 'openings')).toBe('openings');
    expect(stepAfter(plan({ unfinished: ['train', 'play'] }), 'openings')).toBe('train');
  });
  it('is null when everything is done or the plan is loading', () => {
    expect(stepAfter(plan({ unfinished: ['openings'] }), 'openings', true)).toBeNull();
    expect(stepAfter(plan({ pending: true, unfinished: ['play'] }), null)).toBeNull();
  });
});

describe('planStepFocus', () => {
  it('runs Train and Openings in /training, practice ahead when nothing is due', () => {
    expect(planStepFocus('train', plan({}))).toEqual({ planRun: true });
    expect(planStepFocus('train', plan({ practiceNext: true }))).toEqual({ planRun: true, practiceAhead: true });
    expect(planStepFocus('openings', plan({ openingsDue: 2 }))).toEqual({
      kindFilter: 'opening',
      returnTo: '/openings',
      planRun: true,
    });
    expect(planStepFocus('openings', plan({}))).toMatchObject({ practiceAhead: true, planRun: true });
    expect(planStepFocus('endgames', plan({}))).toBeNull();
  });
});
