import { describe, expect, it } from 'vitest';
import { ALL_COURSES, visibleCourses } from './courseCatalog';

describe('visibleCourses (production permission gate)', () => {
  it('ships only granted courses when the preview flag is off', () => {
    const shown = visibleCourses(ALL_COURSES, false);
    expect(shown.every((c) => c.permission.status === 'granted')).toBe(true);
    const granted = ALL_COURSES.filter((c) => c.permission.status === 'granted');
    expect(shown).toHaveLength(granted.length);
  });

  it('adds pending courses only with the preview flag, never declined ones', () => {
    const shown = visibleCourses(ALL_COURSES, true);
    expect(shown.some((c) => c.permission.status === 'declined')).toBe(false);
    const pending = ALL_COURSES.filter((c) => c.permission.status === 'pending');
    for (const c of pending) expect(shown).toContain(c);
  });
});
