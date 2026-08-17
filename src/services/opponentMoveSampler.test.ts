import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { toEpd } from '../chess/moveUtils';
import type { PositionStats } from './positionFrequencyService';

vi.mock('./supabaseService', () => ({ supabaseService: {} }));
vi.mock('./openingExplorerService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openingExplorerService')>();
  return { ...actual, fetchExplorer: vi.fn() };
});
vi.mock('../hooks/useStockfish', () => ({
  getOpponentStockfish: vi.fn(),
}));

import { bandFromGames, sampleOpponentMove } from './opponentMoveSampler';
import { fetchExplorer } from './openingExplorerService';
import { getOpponentStockfish } from '../hooks/useStockfish';

const START = new Chess().fen();
const BAND = { ratings: [1400, 1600], speeds: ['blitz'] };

function statsWith(
  fen: string,
  opponentMoves: Array<[string, number]>,
): Map<string, PositionStats> {
  const m = new Map<string, PositionStats>();
  m.set(toEpd(fen), {
    total: opponentMoves.reduce((a, [, n]) => a + n, 0),
    userMoves: new Map(),
    opponentMoves: new Map(
      opponentMoves.map(([uci, count]) => [uci, { count, wins: 0, draws: 0, losses: 0 }]),
    ),
  });
  return m;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sampleOpponentMove', () => {
  it('uses real opponent frequencies when the sample is big enough', async () => {
    const stats = statsWith(START, [
      ['e2e4', 8],
      ['d2d4', 2],
    ]);
    const out = await sampleOpponentMove({
      fen: START,
      stats,
      band: BAND,
      userRating: 1500,
      rng: () => 0.0, // first weighted bucket
    });
    expect(out).toEqual({ uci: 'e2e4', source: 'games' });
    expect(fetchExplorer).not.toHaveBeenCalled();
  });

  it('falls back to the rating-band explorer below the sample threshold', async () => {
    const stats = statsWith(START, [['e2e4', 3]]); // < 5 samples
    vi.mocked(fetchExplorer).mockResolvedValue({
      white: 0,
      draws: 0,
      black: 0,
      moves: [{ uci: 'd2d4', san: 'd4', white: 50, draws: 25, black: 25 }],
    });
    const out = await sampleOpponentMove({
      fen: START,
      stats,
      band: BAND,
      userRating: 1500,
      rng: () => 0.5,
    });
    expect(out).toEqual({ uci: 'd2d4', source: 'explorer' });
    expect(fetchExplorer).toHaveBeenCalledWith(START, {
      db: 'lichess',
      ratings: [1400, 1600],
      speeds: ['blitz'],
    });
  });

  it('falls back to a strength-limited engine when the explorer is unavailable', async () => {
    vi.mocked(fetchExplorer).mockResolvedValue(null);
    const setOptions = vi.fn(() => Promise.resolve());
    const bestMoveTimed = vi.fn(() =>
      Promise.resolve({ scoreCp: 20, bestMove: 'g1f3', principalVariation: [] }),
    );
    vi.mocked(getOpponentStockfish).mockResolvedValue({ setOptions, bestMoveTimed } as any);

    const out = await sampleOpponentMove({
      fen: START,
      band: BAND,
      userRating: 900, // below Stockfish's floor -> clamped
    });
    expect(out).toEqual({ uci: 'g1f3', source: 'engine' });
    expect(setOptions).toHaveBeenCalledWith({ UCI_LimitStrength: 'true', UCI_Elo: 1320 });
  });

  it('returns null at terminal positions', async () => {
    // Stalemate: black to move, no legal moves.
    const out = await sampleOpponentMove({
      fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
      band: BAND,
      userRating: 1500,
    });
    expect(out).toBeNull();
    expect(fetchExplorer).not.toHaveBeenCalled();
  });

  it('filters explorer moves to legal ones', async () => {
    vi.mocked(fetchExplorer).mockResolvedValue({
      white: 0,
      draws: 0,
      black: 0,
      moves: [
        { uci: 'e2e5', san: '??', white: 99, draws: 0, black: 0 }, // illegal
        { uci: 'e2e4', san: 'e4', white: 1, draws: 0, black: 0 },
      ],
    });
    const out = await sampleOpponentMove({
      fen: START,
      band: BAND,
      userRating: 1500,
      rng: () => 0.0,
    });
    expect(out).toEqual({ uci: 'e2e4', source: 'explorer' });
  });
});

describe('bandFromGames', () => {
  it('derives rating band and dominant speed from recent games', () => {
    const games = [
      { userRating: 1550, timeControl: '300+0' },
      { userRating: 1500, timeControl: '300+3' },
      { userRating: null, timeControl: '900+10' },
    ] as any[];
    const band = bandFromGames(games);
    expect(band.ratings).toEqual([1400, 1600]);
    expect(band.speeds).toEqual(['blitz']);
    expect(band.userRating).toBe(1550);
  });

  it('defaults sensibly with no games', () => {
    const band = bandFromGames([]);
    expect(band.ratings).toEqual([1600, 1800]);
    expect(band.speeds).toEqual(['blitz', 'rapid']);
    expect(band.userRating).toBeNull();
  });
});
