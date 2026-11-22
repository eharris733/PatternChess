import { describe, expect, it } from 'vitest';
import { COMMITMENT_PRESETS, DEFAULT_DAILY_GOALS, dailyGoalsFromJson, goalsFor } from './dailyGoal';

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
