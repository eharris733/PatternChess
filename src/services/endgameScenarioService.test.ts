import { describe, expect, it, vi } from 'vitest';
import type { Blunder } from '../models/blunder';
import type { GameRecord } from '../models/gameRecord';

vi.mock('./supabaseService', () => ({ supabaseService: {} }));

import { deriveScenarioCandidates } from './endgameScenarioService';

function makeGame(overrides: Partial<GameRecord>): GameRecord {
  return {
    id: 'g1',
    platform: 'lichess',
    username: 'me',
    opponent: 'them',
    pgn: '',
    timeControl: '600+0',
    rated: true,
    result: '0-1',
    playedAt: null,
    createdAt: new Date('2026-01-01'),
    analyzedAt: new Date('2026-01-02'),
    eco: null,
    openingName: null,
    userColor: 'white',
    userRating: 1500,
    opponentRating: 1500,
    clockPerPly: null,
    totalPlies: 60,
    parsedMetadataAt: null,
    ...overrides,
  };
}

function makeBlunder(overrides: Partial<Blunder>): Blunder {
  return {
    id: 'b1',
    gameId: 'g1',
    fen: '8/8/4k3/8/8/4K3/4P3/8 w - - 0 40',
    moveNumber: 40,
    playedMove: 'e3d3',
    correctMoves: [{ move: 'e3e4', eval: 500 }],
    evalBefore: 500,
    evalAfter: 0,
    evalSwing: 30,
    sideToMove: 'white',
    cycleNumber: 0,
    lastDrilledAt: null,
    nextDrillAt: null,
    timesCorrect: 0,
    timesAttempted: 0,
    lastDrillFailed: false,
    createdAt: new Date('2026-01-02'),
    phase: 'endgame',
    solutionLine: null,
    motifs: [],
    kind: 'tactic',
    drillData: null,
    analysisDepth: null,
    ...overrides,
  };
}

describe('deriveScenarioCandidates', () => {
  it('flags a winning endgame blunder in a lost game as a dropped win', () => {
    // +500cp -> win% well above 75
    const out = deriveScenarioCandidates([makeGame({ result: '0-1' })], [makeBlunder({})]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      gameId: 'g1',
      deservedResult: 'win',
      actualResult: 'loss',
      startFen: makeBlunder({}).fen,
    });
  });

  it('flags a winning endgame blunder in a drawn game as a dropped win', () => {
    const out = deriveScenarioCandidates(
      [makeGame({ result: '1/2-1/2' })],
      [makeBlunder({})],
    );
    expect(out).toHaveLength(1);
    expect(out[0].deservedResult).toBe('win');
    expect(out[0].actualResult).toBe('draw');
  });

  it('flags an equal-position endgame blunder only in lost games (dropped draw)', () => {
    const equal = makeBlunder({ evalBefore: 0 });
    expect(deriveScenarioCandidates([makeGame({ result: '0-1' })], [equal])).toHaveLength(1);
    expect(
      deriveScenarioCandidates([makeGame({ result: '0-1' })], [equal])[0].deservedResult,
    ).toBe('draw');
    // A draw from an equal position is the fair result — nothing dropped.
    expect(deriveScenarioCandidates([makeGame({ result: '1/2-1/2' })], [equal])).toHaveLength(0);
  });

  it('skips already-losing positions and won games', () => {
    const losing = makeBlunder({ evalBefore: -400 });
    expect(deriveScenarioCandidates([makeGame({ result: '0-1' })], [losing])).toHaveLength(0);
    expect(deriveScenarioCandidates([makeGame({ result: '1-0' })], [makeBlunder({})])).toHaveLength(0);
  });

  it('takes the FIRST qualifying blunder per game in move order', () => {
    const later = makeBlunder({ id: 'b-late', moveNumber: 50, fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 50' });
    const earlier = makeBlunder({ id: 'b-early', moveNumber: 42 });
    const out = deriveScenarioCandidates([makeGame({})], [later, earlier]);
    expect(out).toHaveLength(1);
    expect(out[0].blunderId).toBe('b-early');
  });

  it('normalizes chess.com per-player result codes', () => {
    const g = makeGame({ platform: 'chess.com', result: 'timeout' }); // user timed out -> loss
    expect(deriveScenarioCandidates([g], [makeBlunder({})])).toHaveLength(1);
  });

  it('skips games with unknown user color', () => {
    const g = makeGame({ userColor: null });
    expect(deriveScenarioCandidates([g], [makeBlunder({})])).toHaveLength(0);
  });
});
