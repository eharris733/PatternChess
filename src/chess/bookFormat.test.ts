import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import parity from '../../tests/fixtures/epd-parity.json';
import {
  BOOK_TIER_MIN_ELO,
  bookKey,
  bookPlayersLabel,
  parseBookRequest,
  pickTier,
  rowToPosition,
  type BookRow,
} from './bookFormat';
import { epdOf } from './openingDeviation';

const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

function row(tier: number, games: number): BookRow {
  return { tier, w: games, d: 0, b: 0, cp: 20, depth: 30, moves: '[["e2e4","e4",5,3,2,4,31,1],["g1f3","Nf3",2,0,0,0,null,null]]' };
}

describe('bookKey', () => {
  it('matches epd_key in tools/book-builder (53-bit SHA-1 prefix)', async () => {
    expect(await bookKey(START_EPD)).toBe(3_614_949_416_266_703);
    expect(Number.isSafeInteger(await bookKey(START_EPD))).toBe(true);
  });
});

describe('EPD parity fixture', () => {
  // tools/book-builder asserts the same fixture with shakmaty (cargo test).
  it('chess.js still produces the EPDs the book was keyed with', () => {
    for (const c of parity as { name: string; startFen?: string; moves: string[]; epd: string }[]) {
      const chess = c.startFen ? new Chess(c.startFen) : new Chess();
      for (const m of c.moves) chess.move(m);
      expect(epdOf(chess.fen()), c.name).toBe(c.epd);
    }
  });
});

describe('pickTier', () => {
  it('prefers OTB with enough games, else Elite, else thin OTB', () => {
    expect(pickTier([row(0, 12), row(1, 900)])?.tier).toBe(0);
    expect(pickTier([row(0, 6), row(1, 900)])?.tier).toBe(1);
    expect(pickTier([row(0, 6)])?.tier).toBe(0);
    expect(pickTier([])).toBeNull();
  });
});

describe('rowToPosition', () => {
  it('decodes the compact move tuples', () => {
    const p = rowToPosition(row(1, 10));
    expect(p.tier).toBe('elite');
    expect(p.moves[0]).toEqual({ uci: 'e2e4', san: 'e4', white: 5, draws: 3, black: 2, titled: 4, cp: 31, sound: true });
    expect(p.moves[1].sound).toBeNull();
    expect(p.moves[1].cp).toBeNull();
  });
});

describe('parseBookRequest', () => {
  it('validates and dedupes FENs', () => {
    const fen = new Chess().fen();
    expect(parseBookRequest({ fens: [fen, fen] })).toEqual([fen]);
    expect(parseBookRequest({ fens: ['nope'] })).toBe('bad fen');
    expect(parseBookRequest({})).toMatch(/non-empty/);
    expect(parseBookRequest({ fens: Array(65).fill(fen) })).toMatch(/at most/);
  });
});

describe('bookPlayersLabel', () => {
  it('names each tier by its rating floor', () => {
    expect(bookPlayersLabel('otb')).toBe(`players rated ${BOOK_TIER_MIN_ELO.otb}+ (OTB)`);
    expect(bookPlayersLabel('elite')).toBe(`players rated ${BOOK_TIER_MIN_ELO.elite}+ on Lichess`);
    expect(BOOK_TIER_MIN_ELO).toEqual({ otb: 2200, elite: 2300 });
  });
});
