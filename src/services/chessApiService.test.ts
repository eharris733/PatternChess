import { describe, expect, it } from 'vitest';
import { extractLichessGameId, isLichessRated } from './chessApiService';

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

describe('extractLichessGameId', () => {
  it('reads the current /game/<id> Site URL', () => {
    expect(extractLichessGameId('https://lichess.org/game/DeidrzEq')).toBe('DeidrzEq');
  });

  it('still reads the bare legacy URL', () => {
    expect(extractLichessGameId('https://lichess.org/DeidrzEq')).toBe('DeidrzEq');
    expect(extractLichessGameId('https://lichess.org/DeidrzEq/black')).toBe('DeidrzEq');
  });

  it('rejects non-game URLs', () => {
    expect(extractLichessGameId('https://lichess.org/study/abcdefgh')).toBeNull();
    expect(extractLichessGameId('https://example.com/DeidrzEq')).toBeNull();
    expect(extractLichessGameId(undefined)).toBeNull();
  });
});
