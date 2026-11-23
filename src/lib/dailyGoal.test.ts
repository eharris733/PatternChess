import { describe, expect, it } from 'vitest';
import {
  COMMITMENT_PRESETS,
  DEFAULT_DAILY_GOALS,
  dailyGoalsFromJson,
  goalsFor,
  planSummary,
  FREE_MAX_POSITIONS,
  effectiveGoals,
  needsSupporter,
} from './dailyGoal';

describe('goalsFor', () => {
  it('returns the preset numbers', () => {
    expect(goalsFor('serious')).toEqual({ level: 'serious', ...COMMITMENT_PRESETS.serious });
  });

  it('clamps custom values to the column bounds', () => {
    expect(goalsFor('custom', { positionsPerDay: 500, gamesPerDay: -3 })).toEqual({
      level: 'custom',
      positionsPerDay: 100,
      gamesPerDay: 0,
    });
  });
});

describe('dailyGoalsFromJson', () => {
  it('falls back to the default for profiles without the columns', () => {
    expect(dailyGoalsFromJson({})).toEqual(DEFAULT_DAILY_GOALS);
  });

  it('keeps the stored numbers and label', () => {
    expect(
      dailyGoalsFromJson({ commitment_level: 'casual', daily_positions_goal: 7, daily_games_goal: 2 }),
    ).toEqual({ level: 'casual', positionsPerDay: 7, gamesPerDay: 2 });
  });

  it('ignores an unknown level', () => {
    expect(
      dailyGoalsFromJson({ commitment_level: 'hardcore', daily_positions_goal: 12, daily_games_goal: 1 }).level,
    ).toBe('regular');
  });
});

describe('planSummary', () => {
  it('describes the whole day in plan order', () => {
    expect(planSummary(COMMITMENT_PRESETS.regular)).toBe('10 positions, 3 opening reviews, 2 endgames, 1 game');
    expect(planSummary(COMMITMENT_PRESETS.obsessed)).toBe('30 positions, 3 opening reviews, 2 endgames, 3 games');
  });

  it('leaves out the game when the plan has none, and pluralizes one position', () => {
    expect(planSummary({ positionsPerDay: 1, gamesPerDay: 0 })).toBe('1 position, 3 opening reviews, 2 endgames');
  });
});

describe('supporter plans', () => {
  it('Obsessed and custom goals past 20 need Supporter', () => {
    expect(needsSupporter(goalsFor('obsessed'))).toBe(true);
    expect(needsSupporter(goalsFor('serious'))).toBe(false);
    expect(needsSupporter(goalsFor('custom', { positionsPerDay: FREE_MAX_POSITIONS, gamesPerDay: 1 }))).toBe(false);
    expect(needsSupporter(goalsFor('custom', { positionsPerDay: FREE_MAX_POSITIONS + 1, gamesPerDay: 1 }))).toBe(true);
  });

  it("a free player's stored supporter plan reads as its free cap", () => {
    expect(effectiveGoals(goalsFor('obsessed'), false)).toEqual(goalsFor('serious'));
    expect(effectiveGoals(goalsFor('custom', { positionsPerDay: 50, gamesPerDay: 4 }), false)).toEqual({
      level: 'custom',
      positionsPerDay: FREE_MAX_POSITIONS,
      gamesPerDay: 4,
    });
    expect(effectiveGoals(goalsFor('obsessed'), true)).toEqual(goalsFor('obsessed'));
    expect(effectiveGoals(goalsFor('regular'), false)).toEqual(goalsFor('regular'));
  });
});
