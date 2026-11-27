import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { BAD_MOVE_NAGS, type LearnChapter, type LearnNode } from '../models/learn';
import { chapterRuns, RUN_BAD_MOVE_NAGS } from './lessonRuns';

/** Build a node from `fen` by SAN, with optional children/nags/comment. */
function node(fen: string, san: string, extra: { nags?: number[]; comment?: string; children?: (f: string) => LearnNode[] } = {}): LearnNode {
  const chess = new Chess(fen);
  const m = chess.move(san);
  const after = chess.fen();
  return {
    id: san,
    san,
    uci: `${m.from}${m.to}`,
    fen: after,
    nags: extra.nags,
    comment: extra.comment,
    children: extra.children?.(after) ?? [],
  };
}

const START = new Chess().fen();

function chapter(moves: (f: string) => LearnNode[]): LearnChapter {
  return { id: 'c', name: 'c', url: '', annotator: null, orientation: 'white', startFen: START, gamebook: false, moves: moves(START) };
}

describe('chapterRuns', () => {
  it('keeps its bad-move set in step with BAD_MOVE_NAGS', () => {
    expect([...RUN_BAD_MOVE_NAGS].sort()).toEqual([...BAD_MOVE_NAGS].sort());
  });

  it('makes a run of each opponent sideline with a note or continuation', () => {
    const ch = chapter((f) => [
      node(f, 'e4', {
        children: (f2) => [
          node(f2, 'e5', { children: (f3) => [node(f3, 'Nf3')] }),
          node(f2, 'c5', { comment: 'The Sicilian', children: (f3) => [node(f3, 'Nf3')] }),
        ],
      }),
    ]);
    expect(chapterRuns(ch).map((r) => r.path.map((n) => n.san).join(' '))).toEqual(['', 'e4 c5']);
  });

  it('never drills from under a learner move marked as a mistake', () => {
    const ch = chapter((f) => [
      node(f, 'e4', { children: (f2) => [node(f2, 'e5')] }),
      // 1.f3? is the refutation line: its sidelines are not lessons.
      node(f, 'f3', {
        nags: [2],
        children: (f2) => [
          node(f2, 'e5', { children: (f3) => [node(f3, 'g4')] }),
          node(f2, 'd5', { comment: 'also strong', children: (f3) => [node(f3, 'g4')] }),
        ],
      }),
    ]);
    expect(chapterRuns(ch).map((r) => r.path.map((n) => n.san).join(' '))).toEqual(['']);
  });
});
