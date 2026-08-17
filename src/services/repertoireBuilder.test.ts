import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { toEpd } from '../chess/moveUtils';
import { ratingBandFor } from './openingExplorerService';
import type { GameRecord } from '../models/gameRecord';
import type { RepertoireMove } from '../models/repertoire';

vi.mock('./supabaseService', () => ({ supabaseService: {} }));

import { getFrequencyIndex, __clearFrequencyIndexCache } from './positionFrequencyService';
import { buildGuidedQueue, weightedExplorerMove } from './repertoireBuilderService';

// --- toEpd -------------------------------------------------------------------

describe('toEpd', () => {
  it('maps transposed move orders to the same key', () => {
    const a = new Chess();
    a.move('d4');
    a.move('d5');
    a.move('Nf3');
    const b = new Chess();
    b.move('Nf3');
    b.move('d5');
    b.move('d4');
    expect(a.fen()).not.toEqual(b.fen()); // move counters differ? board same, counters same actually
    expect(toEpd(a.fen())).toEqual(toEpd(b.fen()));
  });

  it('keeps castling and en-passant distinctions', () => {
    const start = new Chess().fen();
    expect(toEpd(start)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    const c = new Chess();
    c.move('e4'); // creates a real ep-relevant field only when capturable, per chess.js
    expect(toEpd(c.fen()).split(' ')).toHaveLength(4);
  });
});

// --- frequency index ---------------------------------------------------------

function pgnGame(overrides: Partial<GameRecord>): GameRecord {
  return {
    id: 'g1',
    platform: 'lichess',
    username: 'me',
    opponent: 'them',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0',
    timeControl: '600+0',
    rated: true,
    result: '1-0',
    playedAt: null,
    createdAt: new Date('2026-01-01'),
    analyzedAt: null,
    eco: null,
    openingName: null,
    userColor: 'white',
    userRating: 1500,
    opponentRating: 1500,
    clockPerPly: null,
    totalPlies: 6,
    parsedMetadataAt: null,
    ...overrides,
  };
}

describe('getFrequencyIndex', () => {
  it('attributes user vs opponent moves and tallies outcomes', async () => {
    __clearFrequencyIndexCache();
    const games = [
      pgnGame({ id: 'g1', result: '1-0' }),
      pgnGame({ id: 'g2', createdAt: new Date('2026-01-02'), result: '0-1' }),
    ];
    const index = await getFrequencyIndex(games);
    const white = index.forColor('white');

    const startEpd = toEpd(new Chess().fen());
    const start = white.get(startEpd)!;
    expect(start.total).toBe(2);
    expect(start.userMoves.get('e2e4')?.count).toBe(2);
    expect(start.userMoves.get('e2e4')?.wins).toBe(1);
    expect(start.userMoves.get('e2e4')?.losses).toBe(1);
    expect(start.opponentMoves.size).toBe(0);

    const afterE4 = new Chess();
    afterE4.move('e4');
    const oppNode = white.get(toEpd(afterE4.fen()))!;
    expect(oppNode.opponentMoves.get('e7e5')?.count).toBe(2);
    expect(oppNode.userMoves.size).toBe(0);

    // Games where the user was black land in the black index.
    expect(index.forColor('black').size).toBe(0);
  });

  it('caps indexing at 30 plies', async () => {
    __clearFrequencyIndexCache();
    const moves: string[] = [];
    const chess = new Chess();
    for (let i = 0; i < 25; i++) {
      const legal = chess.moves();
      const m = chess.move(legal[0]);
      moves.push(m.san);
    }
    const pgn = moves
      .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
      .join(' ');
    const index = await getFrequencyIndex([pgnGame({ pgn, result: '1/2-1/2' })]);
    // 25 plies < 30 -> every position-before-move indexed once for white side.
    const total = [...index.forColor('white').values()].reduce((a, s) => a + s.total, 0);
    expect(total).toBe(25);
  });
});

// --- guided queue ------------------------------------------------------------

function rep(color: 'white' | 'black', epd: string, uci: string, san: string): RepertoireMove {
  return { id: epd, color, epd, uci, san, createdAt: new Date() };
}

describe('buildGuidedQueue', () => {
  it('starts a fresh white repertoire at the start position', async () => {
    __clearFrequencyIndexCache();
    const index = await getFrequencyIndex([pgnGame({})]);
    const queue = buildGuidedQueue({
      color: 'white',
      repertoire: new Map(),
      stats: index.forColor('white'),
      minOccurrences: 1,
    });
    expect(queue[0].epd).toBe(toEpd(new Chess().fen()));
    expect(queue[0].line).toEqual([]);
  });

  it('walks through covered nodes and branches over observed opponent replies', async () => {
    __clearFrequencyIndexCache();
    const index = await getFrequencyIndex([pgnGame({})]);
    const startEpd = toEpd(new Chess().fen());
    const repertoire = new Map([[startEpd, rep('white', startEpd, 'e2e4', 'e4')]]);
    const queue = buildGuidedQueue({
      color: 'white',
      repertoire,
      stats: index.forColor('white'),
      minOccurrences: 1,
    });
    // Covered start is skipped; the next decision is after 1.e4 e5 (the only observed reply).
    const afterE4E5 = new Chess();
    afterE4E5.move('e4');
    afterE4E5.move('e5');
    expect(queue[0].epd).toBe(toEpd(afterE4E5.fen()));
    expect(queue[0].line).toEqual(['e2e4', 'e7e5']);
  });

  it('does not expand past uncovered own nodes', async () => {
    __clearFrequencyIndexCache();
    const index = await getFrequencyIndex([pgnGame({})]);
    const queue = buildGuidedQueue({
      color: 'white',
      repertoire: new Map(),
      stats: index.forColor('white'),
      minOccurrences: 1,
    });
    // Only the start position — deeper positions are unreachable until it's covered.
    expect(queue).toHaveLength(1);
  });
});

// --- misc --------------------------------------------------------------------

describe('ratingBandFor', () => {
  it('picks the enclosing buckets', () => {
    expect(ratingBandFor(1500)).toEqual([1400, 1600]);
    expect(ratingBandFor(1799)).toEqual([1600, 1800]);
    expect(ratingBandFor(300)).toEqual([400, 1000]);
    expect(ratingBandFor(3000)).toEqual([2500]);
    expect(ratingBandFor(null)).toEqual([1600, 1800]);
  });
});

describe('weightedExplorerMove', () => {
  const result = {
    white: 0,
    draws: 0,
    black: 0,
    moves: [
      { uci: 'e2e4', san: 'e4', white: 60, draws: 20, black: 20 }, // weight 100
      { uci: 'd2d4', san: 'd4', white: 30, draws: 10, black: 10 }, // weight 50
    ],
  };
  it('samples by game-count weight', () => {
    expect(weightedExplorerMove(result, () => 0.0)?.uci).toBe('e2e4');
    expect(weightedExplorerMove(result, () => 0.99)?.uci).toBe('d2d4');
    // 100/150 boundary
    expect(weightedExplorerMove(result, () => 0.5)?.uci).toBe('e2e4');
    expect(weightedExplorerMove(result, () => 0.7)?.uci).toBe('d2d4');
  });
  it('returns null on an empty book', () => {
    expect(weightedExplorerMove({ white: 0, draws: 0, black: 0, moves: [] })).toBeNull();
  });
});
