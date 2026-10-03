import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';

vi.mock('../services/supabaseService', () => ({ supabaseService: {} }));

import type { BookMove, BookPosition } from '../services/openingBookService';
import {
  MAX_THEORY_PLIES,
  PAST_BOOK_MAX_EVAL_CP,
  epdOf,
  findDeviation,
  pastBookGate,
  stayedInBookThrough,
  summarizeDeviations,
  theoryMovesAt,
  walkFens,
  costlyExitGames,
  headlineOpening,
  trainableLeaks,
  typicalExitMove,
  type DeviationLeak,
  type OpeningDeviation,
  type OpeningSummary,
} from './openingDeviation';
import { moveToUci } from './moveUtils';

type MoveSpec = Omit<BookMove, 'uci'>;

/** Book move with `games` split into white/draw/black by the given win % for white. */
function mv(
  san: string,
  games: number,
  whitePct = 40,
  blackPct = 30,
  extra: Partial<MoveSpec> = {},
): MoveSpec {
  const white = Math.round((games * whitePct) / 100);
  const black = Math.round((games * blackPct) / 100);
  return { san, white, black, draws: games - white - black, titled: 0, cp: null, sound: null, ...extra };
}

/** A book position at `fen`; each move's UCI is derived from its SAN there. */
function at(fen: string, moves: MoveSpec[], tier: BookPosition['tier'] = 'otb'): BookPosition {
  const withUci: BookMove[] = moves.map((m) => ({ ...m, uci: moveToUci(new Chess(fen).move(m.san)) }));
  return {
    tier,
    cp: null,
    depth: null,
    white: withUci.reduce((s, m) => s + m.white, 0),
    draws: withUci.reduce((s, m) => s + m.draws, 0),
    black: withUci.reduce((s, m) => s + m.black, 0),
    moves: withUci,
  };
}

/**
 * Lookup keyed by the SAN path that reaches each position. `null` = not in
 * the book, 'error' = a failed lookup; unlisted paths are not in the book.
 */
function lookupFrom(tree: Record<string, MoveSpec[] | null | 'error'>, tier: BookPosition['tier'] = 'otb') {
  const byFen = new Map<string, BookPosition | null | 'error'>();
  for (const [path, spec] of Object.entries(tree)) {
    const c = new Chess();
    for (const san of path.split(' ').filter(Boolean)) c.move(san);
    byFen.set(c.fen(), spec === null || spec === 'error' ? spec : at(c.fen(), spec, tier));
  }
  return async (fen: string) => (byFen.has(fen) ? byFen.get(fen)! : null);
}

describe('findDeviation', () => {
  it('flags the user move that is not in the masters DB', async () => {
    const lookup = lookupFrom({
      '': [mv('e4', 1000), mv('d4', 800)],
      e4: [mv('c5', 500), mv('e5', 400)],
      'e4 e5': [mv('Nf3', 400), mv('Bc4', 50)],
    });
    const walk = await findDeviation(['e4', 'e5', 'Qh5', 'Nc6'], 'white', lookup);
    expect(walk).not.toBe('retry');
    if (walk === 'retry') return;
    expect(walk.status).toBe('user_left');
    expect(walk.reason).toBe('not_in_book');
    expect(walk.ply).toBe(2);
    expect(walk.moveNumber).toBe(2);
    expect(walk.playedSan).toBe('Qh5');
    expect(walk.playedUci).toBe('d1h5');
    expect(walk.theoryMoves.map((t) => t.san)).toEqual(['Nf3', 'Bc4']);
  });

  it('reports opponent_left when the opponent leaves first', async () => {
    const lookup = lookupFrom({
      '': [mv('e4', 1000)],
      e4: [mv('c5', 500), mv('e5', 400)],
    });
    const walk = await findDeviation(['e4', 'a5', 'd4'], 'white', lookup);
    expect(walk !== 'retry' && walk.status).toBe('opponent_left');
    // The engine takes over from the user's next move.
    expect(walk !== 'retry' && walk.bookEndPly).toBe(2);
  });

  it('stops at theory_end without blaming anyone', async () => {
    const lookup = lookupFrom({
      '': [mv('e4', 1000)],
      e4: [mv('e5', 6)], // only 6 games reach this position
    });
    const walk = await findDeviation(['e4', 'e5', 'Ke2'], 'black', lookup);
    expect(walk !== 'retry' && walk.status).toBe('theory_end');
    expect(walk !== 'retry' && walk.bookEndPly).toBe(1);
  });

  it('flags a known-but-losing line only with enough games', async () => {
    const losing = lookupFrom({
      '': [mv('e4', 1000)],
      // Black wins 5% of 40 games after ...f6 → losing_line for black.
      e4: [mv('e5', 500), mv('f6', 40, 70, 5)],
    });
    const walk = await findDeviation(['e4', 'f6'], 'black', losing);
    expect(walk !== 'retry' && walk.status).toBe('user_left');
    expect(walk !== 'retry' && walk.reason).toBe('losing_line');

    const tiny = lookupFrom({
      '': [mv('e4', 1000)],
      // Same 5% rate but only 10 games — below the sample floor.
      e4: [mv('e5', 500), mv('f6', 10, 70, 5)],
      'e4 f6': [mv('d4', 10)],
    });
    const walk2 = await findDeviation(['e4', 'f6'], 'black', tiny);
    expect(walk2 !== 'retry' && walk2.status).toBe('in_book');
  });

  it('returns retry when a lookup fails', async () => {
    const lookup = lookupFrom({ '': [mv('e4', 1000)], e4: 'error' });
    expect(await findDeviation(['e4', 'e5'], 'white', lookup)).toBe('retry');
  });

  it('returns in_book when the game stays in theory', async () => {
    const lookup = lookupFrom({
      '': [mv('e4', 1000)],
      e4: [mv('e5', 500)],
    });
    const walk = await findDeviation(['e4', 'e5'], 'white', lookup);
    expect(walk !== 'retry' && walk.status).toBe('in_book');
  });

  it('treats a position missing from the book as the end of theory', async () => {
    const lookup = lookupFrom({ '': [mv('e4', 1000)] }); // nothing after 1.e4
    const walk = await findDeviation(['e4', 'e5', 'Nf3'], 'white', lookup);
    expect(walk !== 'retry' && walk.status).toBe('theory_end');
    expect(walk !== 'retry' && walk.positionGames).toBe(0);
  });

  it('flags a popular move the engine vet rejected, and never teaches it', async () => {
    const lookup = lookupFrom({
      '': [mv('e4', 1000)],
      e4: [mv('e5', 500)],
      // 2.Qh5 is common enough but unsound; Nf3 is the vetted theory move.
      'e4 e5': [mv('Nf3', 400, 40, 30, { sound: true }), mv('Qh5', 120, 40, 30, { sound: false })],
    });
    const walk = await findDeviation(['e4', 'e5', 'Qh5'], 'white', lookup);
    expect(walk !== 'retry' && walk.status).toBe('user_left');
    expect(walk !== 'retry' && walk.reason).toBe('engine_rejected');
    expect(walk !== 'retry' && walk.theoryMoves.map((t) => t.san)).toEqual(['Nf3']);
  });

  it('keeps an unevaluated book move (sound: null) in theory', async () => {
    const lookup = lookupFrom({
      '': [mv('e4', 1000)],
      e4: [mv('e5', 500, 40, 30, { sound: null })],
    });
    const walk = await findDeviation(['e4', 'e5'], 'black', lookup);
    expect(walk !== 'retry' && walk.status).toBe('in_book');
  });

  it('reports the tier that answered and the stored eval of the exit position', async () => {
    const lookup = async (fen: string) => {
      const c = new Chess();
      if (fen === c.fen()) return { ...at(fen, [mv('e4', 50)], 'elite'), cp: 25, depth: 40 };
      return null;
    };
    const walk = await findDeviation(['a3'], 'white', lookup);
    expect(walk !== 'retry' && walk.bookTier).toBe('elite');
    expect(walk !== 'retry' && walk.bookEvalCp).toBe(25);
    expect(walk !== 'retry' && walk.bookEvalDepth).toBe(40);
  });
});

describe('walkFens', () => {
  it('lists the position before every move, stopping at an illegal one', () => {
    const fens = walkFens(['e4', 'e5', 'Ke3']);
    expect(fens).toHaveLength(3);
    expect(fens[0]).toBe(new Chess().fen());
  });
});

describe('theoryMovesAt', () => {
  it('converts castling to king-to-g-file UCI and drops rare moves', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const castleFen = 'r1bqk2r/pppp1ppp/2n2n2/1Bb1p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5';
    expect(theoryMovesAt(fen, at(fen, [mv('a6', 900), mv('Nf6', 600), mv('g5', 2)])).map((t) => t.san)).toEqual([
      'a6',
      'Nf6',
    ]);
    expect(theoryMovesAt(castleFen, at(castleFen, [mv('O-O', 500)]))[0].uci).toBe('e1g1');
  });

  it('carries the titled-player share and tier', () => {
    const fen = new Chess().fen();
    const [e4, d4] = theoryMovesAt(
      fen,
      at(fen, [mv('e4', 600, 40, 30, { titled: 30 }), mv('d4', 400, 40, 30, { titled: 70 })]),
    );
    expect(e4.titledShare).toBeCloseTo(30);
    expect(d4.titledShare).toBeCloseTo(70);
    expect(e4.tier).toBe('otb');
  });
});

function row(o: Partial<OpeningDeviation>): OpeningDeviation {
  return {
    id: Math.random().toString(36),
    gameId: 'g',
    status: 'user_left',
    ply: 2,
    moveNumber: 2,
    userColor: 'white',
    fenBefore: 'fen w - - 0 2',
    epdBefore: 'fen w - -',
    playedUci: 'd1h5',
    playedSan: 'Qh5',
    reason: 'not_in_book',
    theoryMoves: [],
    positionGames: 100,
    playedGames: 0,
    playedMoverWinPct: null,
    evalBefore: 30,
    evalAfter: 20,
    chancesLost: 12,
    classification: 'inaccuracy',
    evaluatedAt: new Date(),
    bookTier: 'otb',
    bookEndPly: null,
    pastBookCheckedAt: null,
    blunderId: null,
    openingFamily: 'King\'s Pawn Game',
    openingName: null,
    eco: null,
    createdAt: new Date(),
    ...o,
  };
}

describe('summarizeDeviations', () => {
  it('collapses transposed exits into one leak and ranks families', () => {
    const rows = [
      row({ gameId: 'a', fenBefore: 'fen w - - 0 2' }),
      row({ gameId: 'b', fenBefore: 'fen w - - 4 4' }), // same EPD, other counters
      row({ gameId: 'c', status: 'opponent_left', playedUci: null, moveNumber: 3 }),
      row({ gameId: 'd', openingFamily: 'Sicilian Defense', chancesLost: 3, classification: 'good' }),
    ];
    const [first, second] = summarizeDeviations(rows);
    expect(first.family).toBe("King's Pawn Game");
    expect(first.games).toBe(3);
    expect(first.costlyExits).toBe(2);
    expect(first.leaks).toHaveLength(1);
    expect(first.leaks[0].count).toBe(2);
    expect(first.leaks[0].gameIds).toEqual(['a', 'b']);
    expect(first.avgExitMove).toBeCloseTo(7 / 3);
    expect(second.family).toBe('Sicilian Defense');
    expect(second.costlyExits).toBe(0);
  });

  it('epdOf drops the move counters', () => {
    expect(epdOf('8/8/8/8/8/8/8/K6k w - - 12 40')).toBe('8/8/8/8/8/8/8/K6k w - -');
  });
});

describe('opening window', () => {
  it('is 13 full moves', () => {
    expect(MAX_THEORY_PLIES).toBe(26);
  });

  it('pastBookGate stops judging once the position is lopsided for either side', () => {
    expect(pastBookGate(0)).toBe(true);
    expect(pastBookGate(PAST_BOOK_MAX_EVAL_CP)).toBe(true);
    expect(pastBookGate(-PAST_BOOK_MAX_EVAL_CP)).toBe(true);
    expect(pastBookGate(PAST_BOOK_MAX_EVAL_CP + 1)).toBe(false);
    expect(pastBookGate(-450)).toBe(false);
  });
});

describe('stayedInBookThrough', () => {
  const base = { reason: null, ply: null, bookEndPly: null } as const;
  it('counts a game that never left the book', () => {
    expect(stayedInBookThrough({ ...base, status: 'in_book' })).toBe(true);
  });
  it('uses the user exit ply for book exits', () => {
    expect(stayedInBookThrough({ ...base, status: 'user_left', reason: 'not_in_book', ply: 20 })).toBe(true);
    expect(stayedInBookThrough({ ...base, status: 'user_left', reason: 'not_in_book', ply: 19 })).toBe(false);
  });
  it('uses where the book ended for past-book mistakes, not the later slip', () => {
    expect(
      stayedInBookThrough({ status: 'user_left', reason: 'past_book', ply: 24, bookEndPly: 12 }),
    ).toBe(false);
    expect(
      stayedInBookThrough({ status: 'user_left', reason: 'past_book', ply: 24, bookEndPly: 21 }),
    ).toBe(true);
  });
  it('counts theory running out late (or past the window) but not early', () => {
    expect(stayedInBookThrough({ ...base, status: 'theory_end', bookEndPly: 8 })).toBe(false);
    expect(stayedInBookThrough({ ...base, status: 'theory_end', bookEndPly: null })).toBe(true);
    expect(stayedInBookThrough({ ...base, status: 'opponent_left', bookEndPly: 22 })).toBe(true);
  });
  it('never counts skipped games', () => {
    expect(stayedInBookThrough({ ...base, status: 'skipped' })).toBe(false);
  });
});

describe('headline helpers', () => {
  const leak = (over: Partial<DeviationLeak>): DeviationLeak => ({
    key: Math.random().toString(),
    fenBefore: new Chess().fen(),
    moveNumber: 5,
    playedSan: 'a3',
    playedUci: 'a2a3',
    reason: 'not_in_book',
    count: 1,
    avgChancesLost: 20,
    worst: 'mistake',
    theoryMoves: [],
    gameIds: ['g'],
    blunderId: null,
    score: 20,
    ...over,
  });
  const summary = (family: string, leaks: DeviationLeak[], games = 10): OpeningSummary => ({
    family,
    color: 'black',
    dominantName: null,
    dominantEco: null,
    games,
    userLeft: leaks.length,
    opponentLeft: 0,
    theoryEnd: 0,
    inBook: 0,
    avgExitMove: null,
    costlyExits: leaks.length,
    pendingEvals: 0,
    leaks,
  });

  it('weights the typical exit move by repeats and ignores sound exits', () => {
    const s = summary('X', [
      leak({ moveNumber: 4, count: 3 }),
      leak({ moveNumber: 8, count: 1 }),
      leak({ moveNumber: 2, count: 5, worst: 'good' }),
    ]);
    expect(costlyExitGames(s)).toBe(4);
    expect(typicalExitMove(s)).toBe(5);
    expect(trainableLeaks(s)).toHaveLength(2);
  });

  it('leads with the opening that cost the most games', () => {
    const a = summary('A', [leak({ count: 2 })]);
    const b = summary('B', [leak({ count: 3 }), leak({ count: 1 })]);
    const clean = summary('C', [leak({ worst: 'good', count: 9 })], 50);
    expect(headlineOpening([a, b, clean])?.family).toBe('B');
    expect(headlineOpening([clean])).toBeNull();
  });
});
