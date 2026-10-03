import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@mliebelt/pgn-parser';
import { chapterFromGame, cleanComment, isStandardChapter, type ParsedGame } from './pgnToTree';

const pgn = readFileSync(new URL('./__fixtures__/sample-study.pgn', import.meta.url), 'utf8');
const games = parse(pgn, { startRule: 'games' }) as unknown as ParsedGame[];

describe('chapterFromGame', () => {
  it('builds the main line with nested variations as siblings', () => {
    const ch = chapterFromGame(games[0], 0);
    expect(ch.id).toBe('ch1');
    expect(ch.name).toBe('Italian basics');
    expect(ch.annotator).toBe('SampleAuthor');
    expect(ch.intro).toBe('The Italian starts here.');
    expect(ch.introShapes).toEqual([{ orig: 'e4', brush: 'green' }]);

    const e4 = ch.moves[0];
    expect(e4.san).toBe('e4');
    expect(e4.uci).toBe('e2e4');
    expect(e4.comment).toBe('Claim the centre.');
    expect(e4.shapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'green' },
      { orig: 'd7', dest: 'd5', brush: 'red' },
    ]);

    // After 2...Nc6: 3.Bc4 (main) and 3.Bb5 (variation).
    const afterNc6 = e4.children[0].children[0].children[0];
    expect(afterNc6.children.map((n) => n.san)).toEqual(['Bc4', 'Bb5']);
    const [bc4, bb5] = afterNc6.children;
    expect(bc4.nags).toEqual([1]);
    expect(bc4.children.map((n) => n.san)).toEqual(['Bc5', 'Nf6']);
    expect(bc4.children[1].nags).toEqual([6]);
    // Nested: 3.Bb5 a6 with 3...Nf6 as the alternative.
    expect(bb5.children.map((n) => n.san)).toEqual(['a6', 'Nf6']);
    expect(bb5.children[1].comment).toBe('Berlin.');
  });

  it('handles set-up positions, black to move, and gamebook mode', () => {
    expect(isStandardChapter(games[1])).toBe(true);
    const ch = chapterFromGame(games[1], 1);
    expect(ch.gamebook).toBe(true);
    expect(ch.orientation).toBe('black');
    expect(ch.startFen).toBe('8/8/8/8/8/2k5/3r4/K7 b - - 0 1');
    expect(ch.moves[0].san).toBe('Kb3');
    expect(ch.moves[0].children[0].children[0].san).toBe('Rd1#');
  });

  it('ids are unique within a chapter', () => {
    const ch = chapterFromGame(games[0], 0);
    const ids: string[] = [];
    const walk = (nodes: typeof ch.moves) => nodes.forEach((n) => (ids.push(n.id), walk(n.children)));
    walk(ch.moves);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('cleanComment', () => {
  it('strips Lichess commands', () => {
    expect(cleanComment('[%clk 0:05:00] Nice [%eval 0.3] move')).toBe('Nice move');
    expect(cleanComment('[%anno "x", x]')).toBeUndefined();
  });
});
