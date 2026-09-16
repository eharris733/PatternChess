import { describe, expect, it } from 'vitest';
import book from '../generated/openingBook.json';
import {
  MIN_CLASSIFY_PLIES,
  classifyMoves,
  classifyPgnWithBook,
  openingFamilyOf,
  type OpeningBook,
} from './openingClassifier';

const BOOK = book as unknown as OpeningBook;

describe('openingFamilyOf', () => {
  it('takes the name up to the first colon', () => {
    expect(openingFamilyOf('Sicilian Defense: Najdorf Variation')).toBe('Sicilian Defense');
    expect(openingFamilyOf('Italian Game')).toBe('Italian Game');
  });
});

describe('classifyMoves', () => {
  it('names a mainline opening', () => {
    const open = classifyMoves(BOOK, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6']);
    expect(open?.family).toBe('Sicilian Defense');
    expect(open?.eco.startsWith('B')).toBe(true);
  });

  it('lands transpositions on the same opening whatever the move order', () => {
    // 1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 and 1. c4 Nf6 2. Nc3 e6 3. d4 Bb4 reach the
    // same position by different routes.
    const direct = classifyMoves(BOOK, ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4']);
    const transposed = classifyMoves(BOOK, ['c4', 'Nf6', 'Nc3', 'e6', 'd4', 'Bb4']);
    expect(direct?.family).toBe('Nimzo-Indian Defense');
    expect(transposed).toEqual(direct);
  });

  it('follows the game to the deepest opening it reaches', () => {
    // The same first four plies, continued into the Ruy Lopez: the later
    // position must win over the one matched earlier in the walk.
    const shallow = classifyMoves(BOOK, ['e4', 'e5', 'Nf3', 'Nc6']);
    const deeper = classifyMoves(BOOK, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
    expect(shallow?.family).toBeTruthy();
    expect(shallow?.family).not.toBe('Ruy Lopez');
    expect(deeper?.family).toBe('Ruy Lopez');
  });

  it('ignores aborted games below the minimum length', () => {
    expect(MIN_CLASSIFY_PLIES).toBeGreaterThan(1);
    expect(classifyMoves(BOOK, ['e4'])).toBeNull();
    expect(classifyMoves(BOOK, ['e4', 'c5'])).toBeNull();
  });
});

describe('classifyPgnWithBook', () => {
  it('classifies a PGN with headers and clock comments', () => {
    const pgn = [
      '[Event "Live Chess"]',
      '[Site "Chess.com"]',
      '[White "a"]',
      '[Black "b"]',
      '[Result "1-0"]',
      '',
      '1. e4 {[%clk 0:10:00]} c6 {[%clk 0:10:00]} 2. d4 {[%clk 0:09:58]} d5 {[%clk 0:09:57]}',
      '3. e5 {[%clk 0:09:55]} Bf5 {[%clk 0:09:54]} 1-0',
    ].join('\n');
    const open = classifyPgnWithBook(BOOK, pgn);
    expect(open?.family).toBe('Caro-Kann Defense');
    expect(open?.name).toContain('Advance');
  });

  it('returns null for an unparsable PGN', () => {
    expect(classifyPgnWithBook(BOOK, 'not a pgn at all')).toBeNull();
  });
});
