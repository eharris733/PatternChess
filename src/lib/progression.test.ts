import { describe, expect, it } from 'vitest';
import { pathProgress, pathRungs, rungOpen, type ArticleMeta } from './progression';

const art = (slug: string, unlockAt: number): ArticleMeta => ({ slug, title: slug, unlockAt, teaserHtml: '' });

describe('pathRungs', () => {
  it('attaches each article to the rung matching its unlockAt', () => {
    const rungs = pathRungs([art('a', 10), art('b', 50)]);
    expect(rungs.find((r) => r.at === 10)?.article?.slug).toBe('a');
    expect(rungs.find((r) => r.at === 25)?.article).toBeNull();
    expect(rungs.find((r) => r.at === 50)?.article?.slug).toBe('b');
  });
});

describe('pathProgress', () => {
  const rungs = pathRungs([]);
  it('starts at the first rung', () => {
    expect(pathProgress(0, rungs)).toMatchObject({ reached: 0, remaining: 10 });
  });
  it('counts a rung reached exactly at its number', () => {
    expect(pathProgress(25, rungs)).toMatchObject({ reached: 2, remaining: 25 });
    expect(pathProgress(25, rungs).next?.at).toBe(50);
  });
  it('has nothing left at the top', () => {
    expect(pathProgress(5000, rungs)).toMatchObject({ reached: rungs.length, next: null, remaining: null });
  });
});

describe('rungOpen', () => {
  it('opens reached rungs, and every rung for supporters', () => {
    expect(rungOpen(100, 99, false)).toBe(false);
    expect(rungOpen(100, 100, false)).toBe(true);
    expect(rungOpen(1000, 0, true)).toBe(true);
  });
});
