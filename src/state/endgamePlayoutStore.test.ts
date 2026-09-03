import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionEval, SmartEvalOptions } from '../stockfish/stockfishWorkerClient';
import { FINISH_RULES, HOLD_RULES } from '../chess/adjudication';

const insertBlunders = vi.fn(async (_rows: Array<Record<string, unknown>>) => {});
vi.mock('../services/supabaseService', () => ({
  supabaseService: {
    get insertBlunders() {
      return insertBlunders;
    },
  },
}));

// Scripted engine. Judging/reference evals (they carry a decided-score stop)
// come from evalQueue in FIFO order; replies (no decided stop) from replyQueue.
// Either queue may hold a promise so a test can hold an eval in flight.
const evalQueue: Array<PositionEval | Promise<PositionEval>> = [];
const replyQueue: string[] = [];
const stopOpponentSearch = vi.fn();
vi.mock('../hooks/useStockfish', () => ({
  getOpponentStockfish: async () => ({
    newGame: async () => {},
    setOptions: async () => {},
    evaluateSmart: async (_fen: string, opts: SmartEvalOptions): Promise<PositionEval> => {
      if (opts.decidedCp == null) {
        const next = replyQueue.shift();
        if (next == null) throw new Error('reply queue empty');
        return { scoreCp: 0, bestMove: next, principalVariation: [next], depth: 20 };
      }
      const next = evalQueue.shift();
      if (!next) throw new Error('eval queue empty');
      return await next;
    },
  }),
  get stopOpponentSearch() {
    return stopOpponentSearch;
  },
}));

import { useEndgamePlayoutStore } from './endgamePlayoutStore';

const getState = () => useEndgamePlayoutStore.getState();

// Bare kings + white pawn: plenty of quiet legal moves, no accidental terminals.
const START_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 40';
// Same, 15 quiet plies already on the clock — one more quiet move reaches the
// draw-acceptance spell.
const QUIET_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 15 40';
// White queen vs bare king, nothing attacked: a long, non-terminal win.
const QUEEN_FEN = 'k7/8/8/8/8/8/8/K5Q1 w - - 0 1';

function ev(scoreCp: number, bestMove = 'e2e4', pv: string[] = ['e2e4', 'e8d8']): PositionEval {
  return { scoreCp, bestMove, principalVariation: pv, depth: 20 };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Wait for the background reference eval of the current position to land. */
async function awaitRef() {
  await vi.waitFor(() => expect(getState().refPending).toBe(false));
}

async function startPlayout(
  overrides: Partial<Parameters<ReturnType<typeof getState>['start']>[0]> = {},
) {
  evalQueue.push(ev(0)); // reference eval of the start position
  await getState().start({
    startFen: START_FEN,
    userColor: 'white',
    target: 'draw',
    sourceGameId: 'game-1',
    rules: HOLD_RULES,
    ...overrides,
  });
  await awaitRef();
}

/** One holding move: postEval equal, engine replies, next reference eval equal. */
async function playHoldingMove(from: string, to: string, reply: string, score = 0) {
  evalQueue.push(ev(score)); // postEval — result held
  replyQueue.push(reply);
  evalQueue.push(ev(-score)); // next reference eval (user to move)
  await getState().processMove({ from, to });
  await awaitRef();
}

/** One losing move: postEval says the opponent is winning. */
async function playLosingMove(from: string, to: string) {
  // +500 for the side to move (the opponent) — user win% ≈ 8, below the
  // draw-target fail line of 25.
  evalQueue.push(ev(500, 'e8d8', ['e8d8', 'e1f1', 'd8c7']));
  await getState().processMove({ from, to });
}

beforeEach(() => {
  getState().reset();
  evalQueue.length = 0;
  replyQueue.length = 0;
  insertBlunders.mockClear();
  stopOpponentSearch.mockClear();
});

describe('endgamePlayoutStore slips', () => {
  it('captures hold progress on the slip and restores it on retry("slip") without a new eval', async () => {
    await startPlayout();
    await playHoldingMove('e1', 'd1', 'e8d8');
    expect(getState().heldStreak).toBe(1);

    await playLosingMove('d1', 'c1');
    const state = getState();
    expect(state.phase).toBe('failed');
    expect(state.slip?.heldStreakAtSlip).toBe(1);
    expect(state.slip?.userMovesPlayedAtSlip).toBe(1);
    expect(state.slip?.refutationPv).toEqual(['e8d8', 'e1f1', 'd8c7']);

    await getState().retry('slip');
    expect(getState().phase).toBe('solving');
    expect(getState().heldStreak).toBe(1);
    expect(getState().userMovesPlayed).toBe(1);
    expect(getState().refPending).toBe(false);
    expect(getState().refEval).not.toBeNull();
    expect(evalQueue).toHaveLength(0);
  });

  it('resets hold progress on retry("start") and reuses the start eval', async () => {
    await startPlayout();
    await playHoldingMove('e1', 'd1', 'e8d8');
    await playLosingMove('d1', 'c1');

    await getState().retry('start');
    expect(getState().heldStreak).toBe(0);
    expect(getState().userMovesPlayed).toBe(0);
    expect(getState().fen).toBe(START_FEN);
    expect(getState().refPending).toBe(false);
    expect(getState().history).toEqual([]);
  });

  it('does not log slips automatically; logSlip() inserts on demand', async () => {
    await startPlayout();
    await playLosingMove('e1', 'd1');
    expect(getState().phase).toBe('failed');
    expect(insertBlunders).not.toHaveBeenCalled();
    expect(getState().slipLog).toBe('idle');

    await getState().logSlip();
    expect(insertBlunders).toHaveBeenCalledTimes(1);
    const row = insertBlunders.mock.calls[0]![0][0]!;
    expect(row.kind).toBe('endgame');
    expect(row.game_id).toBe('game-1');
    expect(row.fen).toBe(START_FEN);
    expect(getState().slipLog).toBe('saved');

    // Pressing again is a no-op once saved.
    await getState().logSlip();
    expect(insertBlunders).toHaveBeenCalledTimes(1);
  });

  it('marks the log as errored when the insert fails', async () => {
    await startPlayout();
    await playLosingMove('e1', 'd1');
    insertBlunders.mockRejectedValueOnce(new Error('offline'));
    await getState().logSlip();
    expect(getState().slipLog).toBe('error');

    // Retrying the save can still succeed.
    await getState().logSlip();
    expect(getState().slipLog).toBe('saved');
  });
});

describe('endgamePlayoutStore setup and background evals', () => {
  it('is playable immediately while the reference eval is still running', async () => {
    const ref = deferred<PositionEval>();
    evalQueue.push(ref.promise);
    await getState().start({
      startFen: START_FEN,
      userColor: 'white',
      target: 'draw',
      sourceGameId: null,
      rules: HOLD_RULES,
    });
    expect(getState().phase).toBe('solving');
    expect(getState().fen).toBe(START_FEN);
    expect(getState().refEval).toBeNull();
    expect(getState().refPending).toBe(true);

    ref.resolve(ev(0));
    await awaitRef();
    expect(getState().refEval?.scoreCp).toBe(0);
  });

  it('judges a move played before the reference eval landed, and patches history', async () => {
    const ref = deferred<PositionEval>();
    evalQueue.push(ref.promise);
    await getState().start({
      startFen: START_FEN,
      userColor: 'white',
      target: 'draw',
      sourceGameId: null,
      rules: HOLD_RULES,
    });
    evalQueue.push(ev(0)); // postEval
    replyQueue.push('e8d8');
    evalQueue.push(ev(0)); // next reference eval
    const moving = getState().processMove({ from: 'e1', to: 'd1' });
    expect(getState().phase).toBe('judging');
    ref.resolve(ev(0, 'e1f1'));
    await moving;
    await awaitRef();
    expect(getState().phase).toBe('solving');
    expect(getState().heldStreak).toBe(1);
    expect(getState().history[0]?.refEval?.bestMove).toBe('e1f1');
  });

  it('commits the engine reply before the next reference eval lands', async () => {
    await startPlayout();
    const nextRef = deferred<PositionEval>();
    evalQueue.push(ev(0));
    replyQueue.push('e8d8');
    evalQueue.push(nextRef.promise);
    await getState().processMove({ from: 'e1', to: 'd1' });
    expect(getState().phase).toBe('solving');
    expect(getState().lastMove).toEqual(['e8', 'd8']);
    expect(getState().fen.split(' ')[1]).toBe('w');
    expect(getState().refPending).toBe(true);
    nextRef.resolve(ev(0));
    await awaitRef();
    expect(getState().refEval).not.toBeNull();
  });
});

describe('endgamePlayoutStore take-back', () => {
  it('is a no-op unless allowed, and with no history', async () => {
    await startPlayout();
    getState().takeBack();
    expect(getState().fen).toBe(START_FEN);
    await playHoldingMove('e1', 'd1', 'e8d8');
    const fenAfter = getState().fen;
    getState().takeBack();
    expect(getState().fen).toBe(fenAfter);
  });

  it('rewinds the move pair and restores the cached eval, ignoring a late background eval', async () => {
    await startPlayout({ rules: FINISH_RULES, allowTakeBack: true });
    const startRef = getState().refEval;
    const nextRef = deferred<PositionEval>();
    evalQueue.push(ev(0));
    replyQueue.push('e8d8');
    evalQueue.push(nextRef.promise);
    await getState().processMove({ from: 'e1', to: 'd1' });
    expect(getState().history).toHaveLength(1);
    expect(getState().userMovesPlayed).toBe(1);

    getState().takeBack();
    expect(stopOpponentSearch).toHaveBeenCalled();
    expect(getState().fen).toBe(START_FEN);
    expect(getState().lastMove).toBeNull();
    expect(getState().history).toEqual([]);
    expect(getState().heldStreak).toBe(0);
    expect(getState().userMovesPlayed).toBe(0);
    expect(getState().refEval).toBe(startRef);
    expect(getState().refPending).toBe(false);

    nextRef.resolve(ev(777));
    await Promise.resolve();
    await Promise.resolve();
    expect(getState().refEval).toBe(startRef);
  });

  it('cannot run while the move is being judged', async () => {
    await startPlayout({ rules: FINISH_RULES, allowTakeBack: true });
    const post = deferred<PositionEval>();
    evalQueue.push(post.promise);
    replyQueue.push('e8d8');
    evalQueue.push(ev(0));
    const moving = getState().processMove({ from: 'e1', to: 'd1' });
    expect(getState().phase).toBe('judging');
    getState().takeBack();
    expect(getState().phase).toBe('judging');
    post.resolve(ev(0));
    await moving;
    await awaitRef();
    expect(getState().userMovesPlayed).toBe(1);
  });
});

describe('endgamePlayoutStore finish mode', () => {
  it('draw target: the engine accepts the draw after the quiet spell', async () => {
    const results: Array<{ success: boolean; ending: string }> = [];
    await startPlayout({
      startFen: QUIET_FEN,
      rules: FINISH_RULES,
      onFinish: (r) => results.push({ success: r.success, ending: r.ending }),
    });
    evalQueue.push(ev(0)); // postEval — level at depth 20, clock now 16
    await getState().processMove({ from: 'e1', to: 'd1' });
    expect(getState().phase).toBe('passed');
    expect(results).toEqual([{ success: true, ending: 'adjudicated' }]);
    expect(replyQueue).toHaveLength(0);
  });

  it('draw target: keeps playing while the quiet spell is short', async () => {
    await startPlayout({ rules: FINISH_RULES });
    await playHoldingMove('e1', 'd1', 'e8d8');
    expect(getState().phase).toBe('solving');
    expect(getState().holdTarget).toBeNull();
  });

  it('win target: never adjudicates on a hold, unlike hold mode', async () => {
    const walk: Array<[string, string, string]> = [
      ['g1', 'g2', 'a8b8'],
      ['g2', 'g3', 'b8a8'],
      ['g3', 'g4', 'a8b8'],
      ['g4', 'g5', 'b8a8'],
    ];
    await startPlayout({ startFen: QUEEN_FEN, target: 'win', rules: FINISH_RULES });
    for (const [from, to, reply] of walk) await playHoldingMove(from, to, reply, -900);
    expect(getState().phase).toBe('solving');
    expect(getState().heldStreak).toBe(4);

    getState().reset();
    await startPlayout({ startFen: QUEEN_FEN, target: 'win', rules: { mode: 'hold', holdMoves: 3 } });
    for (const [from, to, reply] of walk.slice(0, 2)) await playHoldingMove(from, to, reply, -900);
    evalQueue.push(ev(-900));
    await getState().processMove({ from: 'g3', to: 'g4' });
    expect(getState().phase).toBe('passed');
  });

  it('win target: a threefold repetition is a draw by rule, which fails the win', async () => {
    const results: Array<{ success: boolean; terminal: string | null }> = [];
    await startPlayout({
      startFen: QUEEN_FEN,
      target: 'win',
      rules: FINISH_RULES,
      onFinish: (r) => results.push({ success: r.success, terminal: r.terminal }),
    });
    const shuffle: Array<[string, string, string]> = [
      ['g1', 'g2', 'a8b8'],
      ['g2', 'g1', 'b8a8'], // start position, 2nd time
      ['g1', 'g2', 'a8b8'],
    ];
    for (const [from, to, reply] of shuffle) await playHoldingMove(from, to, reply, -900);
    expect(getState().phase).toBe('solving');
    evalQueue.push(ev(-900));
    replyQueue.push('b8a8'); // start position, 3rd time
    await getState().processMove({ from: 'g2', to: 'g1' });
    expect(getState().phase).toBe('failed');
    expect(results).toEqual([{ success: false, terminal: 'draw-rule' }]);
  });
});
