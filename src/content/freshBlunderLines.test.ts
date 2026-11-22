import { describe, expect, it } from 'vitest';
import { freshBlunderLine } from './freshBlunderLines';

describe('freshBlunderLine', () => {
  it('fills both placeholders', () => {
    for (let seed = 0; seed < 30; seed++) {
      const line = freshBlunderLine(5, 3, seed);
      expect(line).not.toMatch(/\{n\}|\{games\}/);
    }
  });

  it('uses the singular and zero variants', () => {
    expect(freshBlunderLine(1, 2, 0)).toBe('One new blunder. Small, but it counts.');
    expect(freshBlunderLine(0, 4, 0)).toContain('4 games, zero trainable blunders');
  });

  it('never says "1 games"', () => {
    for (let seed = 0; seed < 30; seed++) expect(freshBlunderLine(3, 1, seed)).not.toContain('1 games');
  });

  it('is stable for a seed', () => {
    expect(freshBlunderLine(4, 2, 7)).toBe(freshBlunderLine(4, 2, 7));
  });
});
