import type { LearnChapter, LearnNode } from '../models/learn';

// A chapter is drilled as one or more *runs*. The first run is the main line
// from the chapter's start. Every opponent sideline the author wrote (the
// creator's "if Black instead plays X…") becomes its own run: the board
// autoplays the moves up to and including that sideline move, then the drill
// continues from there, so the learner trains the answer too. A sideline with
// no continuation is a run with nothing to play: its note is shown, then the
// next run starts. Pure: shared by learnDrillStore and scripts/check-course.ts.

export interface LessonRun {
  /** Moves autoplayed from the chapter start; the last one is the opponent's sideline. Empty for the main line. */
  path: LearnNode[];
}

/**
 * ?, ??, ?! — the same set as BAD_MOVE_NAGS in src/models/learn.ts (kept here
 * because scripts/check-course.ts loads this file with plain `node`, which
 * can't resolve an extensionless value import; lessonRuns.test.ts checks they match).
 */
export const RUN_BAD_MOVE_NAGS: ReadonlySet<number> = new Set([2, 4, 6]);

function isBadLearnerMove(n: LearnNode, learnerMoved: boolean): boolean {
  return learnerMoved && (n.nags ?? []).some((x) => RUN_BAD_MOVE_NAGS.has(x));
}

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** The side that moves into `node` (the side to move before it). */
function moverOf(parentFen: string): 'white' | 'black' {
  return sideToMove(parentFen);
}

/**
 * Every run in `chapter`: the main line first, then sidelines in move order
 * (the earliest branch first, the way a creator walks through the options;
 * ties keep tree order).
 */
export function chapterRuns(chapter: LearnChapter): LessonRun[] {
  const runs: LessonRun[] = [];
  const walk = (parentFen: string, nodes: LearnNode[], path: LearnNode[]) => {
    const opponentMoves = moverOf(parentFen) !== chapter.orientation;
    nodes.forEach((n, i) => {
      // A learner move the author marked as a mistake is a refutation line:
      // never drill from the position it leaves.
      if (isBadLearnerMove(n, !opponentMoves)) return;
      const here = [...path, n];
      if (opponentMoves && i > 0 && (n.children.length > 0 || n.comment)) runs.push({ path: here });
      walk(n.fen, n.children, here);
    });
  };
  walk(chapter.startFen, chapter.moves, []);
  return [{ path: [] }, ...runs.sort((a, b) => a.path.length - b.path.length)];
}

/** The position a run's drill starts from, and the moves to drill from there. */
export function runStart(chapter: LearnChapter, run: LessonRun): { fen: string; nodes: LearnNode[] } {
  const last = run.path.at(-1);
  return last ? { fen: last.fen, nodes: last.children } : { fen: chapter.startFen, nodes: chapter.moves };
}

/**
 * Learner decisions along a run when the learner plays the main move each
 * time and the opponent replies with `children[0]`.
 */
export function runDecisions(chapter: LearnChapter, run: LessonRun): number {
  let { fen, nodes } = runStart(chapter, run);
  let count = 0;
  while (nodes.length) {
    if (sideToMove(fen) === chapter.orientation) count++;
    const next = nodes[0];
    fen = next.fen;
    nodes = next.children;
  }
  return count;
}

/** Learner decisions across every run of a chapter. */
export function chapterDecisions(chapter: LearnChapter): number {
  return chapterRuns(chapter).reduce((n, r) => n + runDecisions(chapter, r), 0);
}
