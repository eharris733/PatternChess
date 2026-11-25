import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnChapter, LearnNode, LearnStudy } from '../models/learn';
import { countChapterMoments, drillFen, useLearnDrillStore } from '../state/learnDrillStore';

// Every built course lesson plays through: each chapter, every run (main line
// and opponent sidelines), with the learner playing the main move. Covers the
// committed free-day lessons and, when present locally, the supporter-day
// builds (gitignored content/supporter/courses/built/).

const root = join(__dirname, '..', '..');
const dirs = [
  join(root, 'src/generated/course-lessons'),
  join(root, 'src/generated/courses'),
  join(root, 'content/supporter/courses/built'),
];
const lessons: Array<{ file: string; study: LearnStudy }> = dirs
  .filter((d) => existsSync(d))
  .flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: f, study: JSON.parse(readFileSync(join(d, f), 'utf8')) as LearnStudy })),
  );

const s = () => useLearnDrillStore.getState();

/** Drive the current run to its end; returns false if it gets stuck. */
function playRun(chapter: LearnChapter): boolean {
  for (let guard = 0; guard < 400; guard++) {
    const st = s();
    if (st.phase === 'done') return true;
    if (st.phase === 'explain') st.next();
    else if (st.phase === 'yourMove') {
      const options: LearnNode[] = st.path.at(-1)?.children ?? chapter.moves;
      const before = st.path.length;
      st.play(options[0].uci);
      if (s().path.length !== before + 1) throw new Error(`main move ${options[0].san} rejected at ${drillFen(st)}`);
    } else vi.advanceTimersByTime(500);
  }
  return false;
}

describe.each(lessons.length ? lessons : [{ file: '(none)', study: null as unknown as LearnStudy }])('lesson $file', ({ study }) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    s().reset();
    vi.useRealTimers();
  });

  it.skipIf(!study)('plays every chapter through every line', () => {
    for (const chapter of study.chapterData) {
      s().start(chapter, { runs: true });
      const runs = s().runs.length;
      for (let r = 0; r < runs; r++) {
        if (r > 0) expect(s().nextRun()).toBe(true);
        expect(playRun(chapter), `${chapter.name} line ${r + 1}`).toBe(true);
      }
      expect(s().nextRun()).toBe(false);
      expect(s().momentsDone).toBe(countChapterMoments(chapter, true));
    }
  });
});
