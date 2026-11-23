import { describe, expect, it } from 'vitest';
import { evaluateFlairs } from './flair';

const unlocked = (flairs: ReturnType<typeof evaluateFlairs>) =>
  flairs.filter((f) => f.unlocked).map((f) => f.id);

describe('evaluateFlairs: supporter track', () => {
  it('keeps supporter flairs locked for non-supporters', () => {
    expect(unlocked(evaluateFlairs([]))).toEqual([]);
  });
  it('unlocks every flair for an active supporter', () => {
    const all = evaluateFlairs([], { active: true, early: true });
    expect(all.every((f) => f.unlocked)).toBe(true);
  });
  it('leaves a lapsed supporter only Early Supporter', () => {
    expect(unlocked(evaluateFlairs([], { active: false, early: true }))).toEqual(['early-supporter']);
  });
});
