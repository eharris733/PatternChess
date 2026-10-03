import { describe, expect, it } from 'vitest';
import { framesFromMoves } from './gif';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('framesFromMoves', () => {
  it('accepts SAN and UCI and highlights each move', () => {
    const frames = framesFromMoves(START, ['e4', 'e7e5', 'Nf3']);
    expect(frames).toHaveLength(4);
    expect(frames[0].lastMove).toBeNull();
    expect(frames[2].lastMove).toEqual(['e7', 'e5']);
    expect(frames[3].fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b')).toBe(true);
  });

  it('stops at the first illegal move instead of throwing', () => {
    expect(framesFromMoves(START, ['e4', 'Ke3', 'e5'])).toHaveLength(2);
  });
});
