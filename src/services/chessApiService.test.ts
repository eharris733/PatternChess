import { describe, expect, it } from 'vitest';
import { isLichessRated } from './chessApiService';

describe('isLichessRated', () => {
  it('reads the lowercase Event lichess writes', () => {
    expect(isLichessRated({ Event: 'rated blitz game' })).toBe(true);
    expect(isLichessRated({ Event: 'Rated Blitz game' })).toBe(true);
    expect(isLichessRated({ Event: 'casual rapid game' })).toBe(false);
  });

  it('falls back to RatingDiff for arena games', () => {
    expect(isLichessRated({ Event: 'SuperBlitz Increment', WhiteRatingDiff: '+6' })).toBe(true);
    expect(isLichessRated({ Event: 'Daily Rapid Arena' })).toBe(false);
  });
});
