import { describe, expect, it } from 'vitest';
import type { DeviationWalk } from '../chess/openingDeviation';
import type { BlunderCandidate } from '../stockfish/stockfishWorkerClient';
import { buildDemoPlan, endgameDrops, formatPoints, mostPlayedOpening, sanWithMoveNumber, type DemoPlanGame } from './demoPlan';

const ENDGAME_FEN = '8/5k2/8/3K4/8/8/5P2/8 w - - 0 50'; // 3 pieces
const MIDDLEGAME_FEN = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9';

function blunder(over: Partial<BlunderCandidate>): BlunderCandidate {
  return {
    fen: MIDDLEGAME_FEN,
    moveNumber: 20,
    playedMove: 'e2e4',
    sideToMove: 'white',
    evalBefore: 0,
    evalAfter: 400,
    evalSwing: 40,
    correctMoves: [],
    solutionPv: [],
    playedRefutationPv: [],
    ...over,
  };
}

function walk(over: Partial<DeviationWalk>): DeviationWalk {
  return {
    status: 'in_book',
    ply: null,
    moveNumber: null,
    fenBefore: null,
    playedSan: null,
    playedUci: null,
    reason: null,
    theoryMoves: [],
    positionGames: null,
    playedGames: null,
    playedMoverWinPct: null,
    bookTier: 'otb',
    bookEndPly: null,
    bookEvalCp: null,
    bookEvalDepth: null,
    ...over,
  };
}

function game(over: Partial<DemoPlanGame>): DemoPlanGame {
  return { family: 'Sicilian Defense', color: 'black', result: '1-0', blunders: [], walk: null, ...over };
}

const theory = (san: string) => ({ uci: 'g8f6', san, games: 120, share: 60, moverWinPct: 30, titledShare: null, tier: 'otb' as const });

describe('mostPlayedOpening', () => {
  it('picks the most-played family with its share and the earliest theory exit', () => {
    const stat = mostPlayedOpening([
      game({ walk: walk({ status: 'user_left', ply: 13, moveNumber: 7, playedSan: 'Qb6', theoryMoves: [theory('Nf6')] }) }),
      game({ family: 'French Defense', walk: walk({}) }),
      game({ walk: walk({ status: 'user_left', ply: 9, moveNumber: 5, playedSan: 'h6', theoryMoves: [theory('Nc6')] }) }),
      game({ walk: walk({ status: 'opponent_left', ply: 6, moveNumber: 4, bookEndPly: 7 }) }),
      game({ family: null }),
    ]);
    expect(stat).toMatchObject({
      family: 'Sicilian Defense',
      games: 3,
      total: 5,
      sharePct: 60,
      checkedGames: 3,
      exitGames: 2,
      exit: { moveNumber: 5, playedSan: '5...h6', theorySan: '5...Nc6', tier: 'otb' },
    });
  });

  it('has no exit when the book failed or the visitor stayed in theory', () => {
    const stat = mostPlayedOpening([game({ walk: null }), game({ walk: walk({}) })]);
    expect(stat).toMatchObject({ games: 2, checkedGames: 1, exitGames: 0, exit: null });
  });

  it('does not count walks the book knew nothing about', () => {
    const stat = mostPlayedOpening([
      game({ walk: walk({ status: 'theory_end', ply: 0, moveNumber: 1, bookEndPly: 0 }) }),
      game({ walk: walk({ status: 'skipped', bookTier: null }) }),
    ]);
    expect(stat).toMatchObject({ games: 2, checkedGames: 0, exitGames: 0, exit: null });
  });

  it('is null when nothing classified', () => {
    expect(mostPlayedOpening([game({ family: null })])).toBeNull();
    expect(mostPlayedOpening([])).toBeNull();
  });

  it('breaks ties toward the most recent game', () => {
    expect(mostPlayedOpening([game({ family: 'Caro-Kann Defense' }), game({ family: 'French Defense' })])?.family).toBe(
      'Caro-Kann Defense',
    );
  });
});

describe('endgameDrops', () => {
  it('counts a won endgame that was lost (1) and a level one that was lost (0.5), once per game', () => {
    const stat = endgameDrops([
      // White, winning endgame (+5), lost the game: 1 point.
      game({
        color: 'white',
        result: '0-1',
        blunders: [blunder({ fen: ENDGAME_FEN, moveNumber: 50, evalBefore: 500 }), blunder({ fen: ENDGAME_FEN, moveNumber: 55, evalBefore: 0 })],
      }),
      // Black, level endgame, lost: 0.5.
      game({ color: 'black', result: '1-0', blunders: [blunder({ fen: ENDGAME_FEN, moveNumber: 45, evalBefore: 0 })] }),
      // Won endgame that was drawn: 0.5.
      game({ color: 'black', result: '1/2-1/2', blunders: [blunder({ fen: ENDGAME_FEN, moveNumber: 45, evalBefore: 600 })] }),
      // Endgame blunder in a game they won: no drop, still counted as a blunder.
      game({ color: 'white', result: '1-0', blunders: [blunder({ fen: ENDGAME_FEN, moveNumber: 45, evalBefore: 0 })] }),
      // Middlegame blunders never count.
      game({ color: 'white', result: '0-1', blunders: [blunder({ evalBefore: 600 })] }),
    ]);
    expect(stat).toEqual({ blunders: 5, pointsDropped: 2, gamesWithDrops: 3 });
  });

  it('ignores games where the visitor was already losing', () => {
    const stat = endgameDrops([
      game({ color: 'white', result: '0-1', blunders: [blunder({ fen: ENDGAME_FEN, moveNumber: 45, evalBefore: -600 })] }),
    ]);
    expect(stat).toEqual({ blunders: 1, pointsDropped: 0, gamesWithDrops: 0 });
  });
});

describe('formatting', () => {
  it('numbers moves for each side', () => {
    expect(sanWithMoveNumber(7, 'white', 'Nf3')).toBe('7. Nf3');
    expect(sanWithMoveNumber(7, 'black', 'Nf6')).toBe('7...Nf6');
  });

  it('formats points', () => {
    expect(formatPoints(1)).toBe('1 point');
    expect(formatPoints(1.5)).toBe('1.5 points');
    expect(formatPoints(0)).toBe('0 points');
  });

  it('builds both parts', () => {
    const plan = buildDemoPlan([game({})]);
    expect(plan.opening?.family).toBe('Sicilian Defense');
    expect(plan.endgame.pointsDropped).toBe(0);
  });
});
