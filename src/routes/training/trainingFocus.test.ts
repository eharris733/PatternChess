import { describe, expect, it } from 'vitest';
import type { Blunder, DrillKind } from '../../models/blunder';
import {
  continueFocus,
  hasFilter,
  practiceAheadFocus,
  practiceAheadParams,
  returnPathFor,
} from './trainingFocus';

const b = (kind: DrillKind): Blunder => ({ kind }) as Blunder;

describe('returnPathFor', () => {
  it('prefers an explicit returnTo', () => {
    expect(returnPathFor({ phaseFilter: 'endgame', returnTo: '/endgames' })).toBe('/endgames');
  });
  it('infers the page from the kind focus or an all-one-kind set', () => {
    expect(returnPathFor({ kindFilter: 'opening' })).toBe('/openings');
    expect(returnPathFor({ blunderIds: ['a', 'b'] }, [b('opening'), b('opening')])).toBe('/openings');
    expect(returnPathFor({ blunderIds: ['a'] }, [b('endgame')])).toBe('/endgames');
  });
  it('has no page for the main queue, generic filters or a mixed set', () => {
    expect(returnPathFor({})).toBeNull();
    expect(returnPathFor({ motifFilter: 'missedFork' })).toBeNull();
    expect(returnPathFor({ blunderIds: ['a', 'b'] }, [b('opening'), b('tactic')])).toBeNull();
    // An unknown path from location.state is ignored.
    expect(returnPathFor({ returnTo: '/elsewhere' as never })).toBeNull();
  });
});

describe('continueFocus', () => {
  it('keeps an openings session in openings (never the main queue)', () => {
    expect(continueFocus({ kindFilter: 'opening' })).toEqual({ kindFilter: 'opening' });
    expect(continueFocus({ blunderIds: ['a'], focusLabel: 'Sicilian' }, [b('opening')])).toEqual({
      kindFilter: 'opening',
      returnTo: '/openings',
    });
  });
  it('keeps endgame and other focuses, practice-ahead included', () => {
    expect(continueFocus({ phaseFilter: 'endgame', returnTo: '/endgames' })).toEqual({
      phaseFilter: 'endgame',
      returnTo: '/endgames',
    });
    expect(continueFocus({ blunderIds: ['a'] }, [b('endgame')])).toEqual({
      phaseFilter: 'endgame',
      returnTo: '/endgames',
    });
    expect(continueFocus({ motifFilter: 'missedPin' })).toEqual({ motifFilter: 'missedPin' });
    expect(continueFocus({ practiceAhead: true })).toEqual({ practiceAhead: true });
  });
  it('sends the plain queue, a game, or a mixed set back to the picker', () => {
    expect(continueFocus({})).toBeNull();
    expect(continueFocus({ gameIds: ['g'] })).toBeNull();
    expect(continueFocus({ blunderIds: ['a', 'b'] }, [b('tactic'), b('opening')])).toBeNull();
  });
});

describe('practice ahead', () => {
  it('drops hand-picked ids and marks the focus', () => {
    expect(practiceAheadFocus({ kindFilter: 'opening', returnTo: '/openings' })).toEqual({
      kindFilter: 'opening',
      returnTo: '/openings',
      practiceAhead: true,
    });
    expect(practiceAheadFocus({ blunderIds: ['a'], focusLabel: 'x' })).toEqual({ practiceAhead: true });
    expect(hasFilter({ practiceAhead: true })).toBe(false);
  });
  it('narrows on the server by kind/phase and keeps openings out of the main batch', () => {
    expect(practiceAheadParams({})).toEqual({ kind: null, excludeKind: 'opening', phase: null, limit: 10 });
    expect(practiceAheadParams({ kindFilter: 'opening' })).toEqual({
      kind: 'opening',
      excludeKind: null,
      phase: null,
      limit: 10,
    });
    expect(practiceAheadParams({ phaseFilter: 'endgame' })).toMatchObject({ phase: 'endgame', excludeKind: 'opening' });
    // Client-side filters fetch a bigger pool to narrow afterwards.
    expect(practiceAheadParams({ motifFilter: 'missedFork' }).limit).toBe(200);
  });
});
