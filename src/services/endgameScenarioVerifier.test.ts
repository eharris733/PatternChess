import { describe, expect, it } from 'vitest';
import { toUserPov, verdictFor } from './endgameScenarioVerifier';

describe('verdictFor', () => {
  it('keeps a dead-level dropped draw', () => {
    expect(verdictFor('draw', 0)).toBe('keep');
    expect(verdictFor('draw', -60)).toBe('keep');
    expect(verdictFor('draw', 120)).toBe('keep');
  });

  it('retires a dropped draw that is already clearly worse at depth', () => {
    expect(verdictFor('draw', -160)).toBe('retire');
    expect(verdictFor('draw', -280)).toBe('retire'); // inside the old ±300 band
  });

  it('retires a "draw" that is actually winning (not a hold, a conversion)', () => {
    expect(verdictFor('draw', 400)).toBe('retire');
  });

  it('keeps a dropped win only when it is still clearly winning', () => {
    expect(verdictFor('win', 300)).toBe('keep');
    expect(verdictFor('win', 900)).toBe('keep');
    expect(verdictFor('win', 250)).toBe('retire');
    expect(verdictFor('win', -50)).toBe('retire');
  });
});

describe('toUserPov', () => {
  const whiteToMove = '8/8/8/4k3/8/4K3/4P3/8 w - - 0 50';
  const blackToMove = '8/8/8/4k3/8/4K3/4P3/8 b - - 0 50';

  it('keeps the sign when the user is on move', () => {
    expect(toUserPov(whiteToMove, 'white', 80)).toBe(80);
    expect(toUserPov(blackToMove, 'black', -30)).toBe(-30);
  });

  it('flips the sign when the opponent is on move', () => {
    expect(toUserPov(whiteToMove, 'black', 80)).toBe(-80);
    expect(toUserPov(blackToMove, 'white', -30)).toBe(30);
  });
});
