import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { findRepertoireExit, introLineTo, type LinePosition } from './openingLine';
import { buildRepertoireMap } from '../models/repertoire';
import { bookEpd } from './bookFormat';

function line(sans: string[]): LinePosition[] {
  const c = new Chess();
  const out: LinePosition[] = [];
  for (const san of sans) {
    const fen = c.fen();
    const side = c.turn() === 'w' ? 'white' : 'black';
    const m = c.move(san);
    out.push({ fen, uciMove: m.from + m.to + (m.promotion ?? ''), sanMove: m.san, sideToMove: side });
  }
  out.push({ fen: c.fen(), uciMove: null, sanMove: null, sideToMove: c.turn() === 'w' ? 'white' : 'black' });
  return out;
}

function fenAfter(sans: string[]): string {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
}

describe('introLineTo', () => {
  it('replays up to the drill position', () => {
    const game = line(['e4', 'c5', 'Nf3', 'd6', 'd4']);
    const intro = introLineTo(game, fenAfter(['e4', 'c5', 'Nf3']));
    expect(intro?.fens).toHaveLength(4);
    expect(intro?.lastMoves[0]).toBeNull();
    expect(intro?.lastMoves[3]).toEqual(['g1', 'f3']);
  });

  it('finds the position through a transposition', () => {
    const game = line(['Nf3', 'c5', 'e4', 'd6']);
    const intro = introLineTo(game, fenAfter(['e4', 'c5', 'Nf3']));
    expect(intro?.fens).toHaveLength(4);
    expect(intro?.lastMoves[3]).toEqual(['e2', 'e4']);
  });

  it('returns null when the game never reaches it, or for the start position', () => {
    const game = line(['d4', 'd5']);
    expect(introLineTo(game, fenAfter(['e4']))).toBeNull();
    expect(introLineTo(game, new Chess().fen())).toBeNull();
    expect(introLineTo([], fenAfter(['e4']))).toBeNull();
  });
});

describe('findRepertoireExit', () => {
  const rep = (color: 'white' | 'black', before: string[], san: string) => {
    const c = new Chess(fenAfter(before));
    const fen = c.fen();
    const m = c.move(san);
    return { id: san, color, epd: bookEpd(fen), uci: m.from + m.to, san: m.san, createdAt: new Date(0) };
  };

  it('flags the first move that differs from the repertoire', () => {
    const map = buildRepertoireMap([rep('black', ['e4'], 'c5'), rep('black', ['e4', 'c5', 'Nf3'], 'd6')]);
    const exit = findRepertoireExit(line(['e4', 'c5', 'Nf3', 'Nc6', 'd4']), 'black', map);
    expect(exit?.ply).toBe(3);
    expect(exit?.playedSan).toBe('Nc6');
    expect(exit?.expected.san).toBe('d6');
  });

  it('ignores the other colour and games that follow the repertoire', () => {
    const map = buildRepertoireMap([rep('white', [], 'e4')]);
    expect(findRepertoireExit(line(['e4', 'e5']), 'white', map)).toBeNull();
    expect(findRepertoireExit(line(['d4', 'd5']), 'black', map)).toBeNull();
    expect(findRepertoireExit(line(['d4', 'd5']), 'white', map)?.playedSan).toBe('d4');
  });
});
