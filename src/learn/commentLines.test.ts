import { describe, expect, it } from 'vitest';
import { splitCommentLines } from './commentLines';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// After 1.e4 c5 2.Nf3 e6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 Bb4 6.e5 (Black to move).
const AFTER_E5 = 'rnbqk2r/pp1p1ppp/4pn2/4P3/1b1N4/2N5/PPP2PPP/R1BQKB1R b KQkq - 0 6';

const links = (text: string, fens: string[]) =>
  splitCommentLines(text, fens)
    .filter((s) => s.line)
    .map((s) => s.text);

describe('splitCommentLines', () => {
  it('finds a numbered line from the initial position', () => {
    const segs = splitCommentLines('We reach this after 1.e4 c5 2.Nf3 e6. Then...', [AFTER_E5, START]);
    const line = segs.find((s) => s.line)!;
    expect(line.text).toBe('1.e4 c5 2.Nf3 e6');
    expect(line.line!.moves.map((m) => m.san)).toEqual(['e4', 'c5', 'Nf3', 'e6']);
    expect(segs.map((s) => s.text).join('')).toBe('We reach this after 1.e4 c5 2.Nf3 e6. Then...');
  });

  it('links a legal move with "..." and leaves square names in prose alone', () => {
    expect(links('...Ne4 loses, because c3 is hanging and g7 falls.', [AFTER_E5])).toEqual(['...Ne4']);
  });

  it('skips runs that are illegal from every candidate', () => {
    expect(links('Just like Bb5 in the Spanish.', [AFTER_E5])).toEqual([]);
  });

  it('respects the move number when picking the start position', () => {
    expect(links('4...Nf6 puts pressure on e4.', [AFTER_E5, START])).toEqual([]);
  });

  it('ends a run at sentence punctuation', () => {
    expect(links('It hits e4. 5.Nc3 defends.', ['rnbqkb1r/pp1p1ppp/4pn2/8/3NP3/8/PPP2PPP/RNBQKB1R w KQkq - 2 5'])).toEqual([
      '5.Nc3',
    ]);
  });
});
