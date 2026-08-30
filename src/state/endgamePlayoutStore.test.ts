import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionEval } from '../stockfish/stockfishWorkerClient';

const insertBlunders = vi.fn(async (_rows: Array<Record<string, unknown>>) => {});
vi.mock('../services/supabaseService', () => ({
  supabaseService: {
    get insertBlunders() {
      return insertBlunders;
    },
  },
}));

// Scripted engine: evals are served in FIFO order, replies likewise.
const evalQueue: PositionEval[] = [];
const replyQueue: string[] = [];
vi.mock('../hooks/useStockfish', () => ({
  getOpponentStockfish: async () => ({
    newGame: async () => {},
    setOptions: async () => {},
    evaluatePositionTimed: async (): Promise<PositionEval> => {
      const next = evalQueue.shift();
      if (!next) throw new Error('eval queue empty');
      return next;
    },
    bestMoveTimed: async () => {
      const next = replyQueue.shift();
      if (next == null) throw new Error('reply queue empty');
      return { bestMove: next };
    },
  }),
}));

import { useEndgamePlayoutStore } from './endgamePlayoutStore';

// Bare kings + white pawn: plenty of quiet legal moves, no accidental terminals.
const START_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 40';

function ev(scoreCp: number, bestMove = 'e2e4', pv: string[] = ['e2e4', 'e8d8']): PositionEval {
  return { scoreCp, bestMove, principalVariation: pv, depth: 20 };
}

async function startDrawPlayout() {
  evalQueue.push(ev(0)); // reference eval of the start position
  await useEndgamePlayoutStore.getState().start({
    startFen: START_FEN,
    userColor: 'white',
    target: 'draw',
    sourceGameId: 'game-1',
  });
}

/** One holding move: postEval equal, engine replies, next reference eval equal. */
async function playHoldingMove(from: string, to: string, reply: string) {
  evalQueue.push(ev(0)); // postEval — draw held
  replyQueue.push(reply);
  evalQueue.push(ev(0)); // next reference eval
  await useEndgamePlayoutStore.getState().processMove({ from, to });
}

/** One losing move: postEval says the opponent is winning. */
async function playLosingMove(from: string, to: string) {
  // +500 for the side to move (the opponent) — user win% ≈ 8, below the
  // draw-target fail line of 25.
  evalQueue.push(ev(500, 'e8d8', ['e8d8', 'e1f1', 'd8c7']));
  await useEndgamePlayoutStore.getState().processMove({ from, to });
}

beforeEach(() => {
  useEndgamePlayoutStore.getState().reset();
  evalQueue.length = 0;
  replyQueue.length = 0;
  insertBlunders.mockClear();
});

describe('endgamePlayoutStore slips', () => {
  it('captures hold progress on the slip and restores it on retry("slip")', async () => {
    await startDrawPlayout();
    await playHoldingMove('e1', 'd1', 'e8d8');
    expect(useEndgamePlayoutStore.getState().heldStreak).toBe(1);

    await playLosingMove('d1', 'c1');
    const state = useEndgamePlayoutStore.getState();
    expect(state.phase).toBe('failed');
    expect(state.slip?.heldStreakAtSlip).toBe(1);
    expect(state.slip?.userMovesPlayedAtSlip).toBe(1);
    expect(state.slip?.refutationPv).toEqual(['e8d8', 'e1f1', 'd8c7']);

    evalQueue.push(ev(0)); // reference eval when the retry re-enters solving
    await useEndgamePlayoutStore.getState().retry('slip');
    expect(useEndgamePlayoutStore.getState().heldStreak).toBe(1);
    expect(useEndgamePlayoutStore.getState().userMovesPlayed).toBe(1);
    expect(useEndgamePlayoutStore.getState().phase).toBe('solving');
  });

  it('resets hold progress on retry("start")', async () => {
    await startDrawPlayout();
    await playHoldingMove('e1', 'd1', 'e8d8');
    await playLosingMove('d1', 'c1');

    evalQueue.push(ev(0));
    await useEndgamePlayoutStore.getState().retry('start');
    expect(useEndgamePlayoutStore.getState().heldStreak).toBe(0);
    expect(useEndgamePlayoutStore.getState().userMovesPlayed).toBe(0);
  });

  it('does not log slips automatically; logSlip() inserts on demand', async () => {
    await startDrawPlayout();
    await playLosingMove('e1', 'd1');
    expect(useEndgamePlayoutStore.getState().phase).toBe('failed');
    expect(insertBlunders).not.toHaveBeenCalled();
    expect(useEndgamePlayoutStore.getState().slipLog).toBe('idle');

    await useEndgamePlayoutStore.getState().logSlip();
    expect(insertBlunders).toHaveBeenCalledTimes(1);
    const row = insertBlunders.mock.calls[0]![0][0]!;
    expect(row.kind).toBe('endgame');
    expect(row.game_id).toBe('game-1');
    expect(row.fen).toBe(START_FEN);
    expect(useEndgamePlayoutStore.getState().slipLog).toBe('saved');

    // Pressing again is a no-op once saved.
    await useEndgamePlayoutStore.getState().logSlip();
    expect(insertBlunders).toHaveBeenCalledTimes(1);
  });

  it('marks the log as errored when the insert fails', async () => {
    await startDrawPlayout();
    await playLosingMove('e1', 'd1');
    insertBlunders.mockRejectedValueOnce(new Error('offline'));
    await useEndgamePlayoutStore.getState().logSlip();
    expect(useEndgamePlayoutStore.getState().slipLog).toBe('error');

    // Retrying the save can still succeed.
    await useEndgamePlayoutStore.getState().logSlip();
    expect(useEndgamePlayoutStore.getState().slipLog).toBe('saved');
  });
});
