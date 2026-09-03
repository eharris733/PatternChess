import { create } from 'zustand';
import { Chess } from 'chess.js';
import {
  AdjudicationRules,
  engineAcceptsDraw,
  judgeTerminal,
  judgeUserMove,
  PlayoutTarget,
  TerminalKind,
  terminalState,
} from '../chess/adjudication';
import { cpForColor, winPercent, winningChancesLost } from '../chess/winningChances';
import { uciToSan } from '../chess/moveUtils';
import { getOpponentStockfish, stopOpponentSearch } from '../hooks/useStockfish';
import type { PositionEval, SmartEvalOptions } from '../stockfish/stockfishWorkerClient';
import { supabaseService } from '../services/supabaseService';

/**
 * - `solving`: user to move. The board is live as soon as the FEN is set —
 *   the reference eval for this position may still be in flight (`refPending`).
 * - `judging`: the user's move is on the board and the engine is scoring it.
 * - `thinking`: the move passed; the engine is choosing its reply.
 */
export type PlayoutPhase = 'idle' | 'solving' | 'judging' | 'thinking' | 'passed' | 'failed';

export interface PlayoutSlip {
  fenBefore: string;
  /** Full-move number of the position the slip was played from. */
  moveNumber: number;
  playedUci: string;
  playedSan: string | null;
  bestUci: string;
  bestSan: string | null;
  /** Winning chances lost by the slip (percent, user perspective). Null on terminal fails. */
  chancesLost: number | null;
  /** Engine PV from the position AFTER the slip — why the move fails. */
  refutationPv: string[];
  /** Hold progress at the moment of the slip, restored by retry('slip'). */
  heldStreakAtSlip: number;
  userMovesPlayedAtSlip: number;
  /** Reference eval of `fenBefore`, so retry('slip') needs no fresh engine call. */
  refEvalAtSlip: PositionEval | null;
  /** History length at the slip, so retry('slip') keeps take-back working. */
  historyLenAtSlip: number;
}

export type SlipLogStatus = 'idle' | 'unavailable' | 'saving' | 'saved' | 'error';

export interface PlayoutResult {
  success: boolean;
  slip: PlayoutSlip | null;
  /** How the play-out ended, for feedback copy. */
  ending: 'terminal' | 'adjudicated' | 'slip';
  terminal: TerminalKind | null;
}

export interface PlayoutStartOptions {
  startFen: string;
  userColor: 'white' | 'black';
  target: PlayoutTarget;
  /** Game the position traces back to; stamped onto logged slips. */
  sourceGameId: string | null;
  /** Hold-N-moves (training queue) or play-to-the-finish (Endgames tab). */
  rules: AdjudicationRules;
  /** Offer take-back (Endgames tab only — it's a practice tool, not a measurement). */
  allowTakeBack?: boolean;
  onFinish?: (result: PlayoutResult) => void;
}

interface BoardMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

/** Snapshot of a user-to-move position, pushed before each user move. */
export interface PlayoutHistoryEntry {
  fen: string;
  /** Highlight shown at that position (the previous engine reply). */
  lastMove: [string, string] | null;
  /** Cached reference eval; patched in once a still-pending eval lands. */
  refEval: PositionEval | null;
  heldStreak: number;
  userMovesPlayed: number;
  /** Repetition-tracker truncation point. */
  positionKeysLen: number;
}

interface EndgamePlayoutState {
  phase: PlayoutPhase;
  fen: string;
  startFen: string;
  userColor: 'white' | 'black';
  target: PlayoutTarget;
  rules: AdjudicationRules;
  lastMove: [string, string] | null;
  heldStreak: number;
  /** Hold target in hold mode; null when playing to the finish. */
  holdTarget: number | null;
  userMovesPlayed: number;
  /** Timed eval of the current user-to-move position (stm = user). */
  refEval: PositionEval | null;
  /** True while the reference eval for the current position is still running. */
  refPending: boolean;
  slip: PlayoutSlip | null;
  terminal: TerminalKind | null;
  engineError: string | null;
  /** Opt-in "add to training queue" state for the current slip. */
  slipLog: SlipLogStatus;
  history: PlayoutHistoryEntry[];
  allowTakeBack: boolean;

  start: (opts: PlayoutStartOptions) => Promise<void>;
  processMove: (move: BoardMove) => Promise<void>;
  retry: (from: 'start' | 'slip') => Promise<void>;
  /** Rewind the last user move and the engine's reply (solving phase only). */
  takeBack: () => void;
  /** Insert the current slip into the blunders table as an endgame-kind SR item. */
  logSlip: () => Promise<void>;
  reset: () => void;
}

// Monotonic staleness guard — engine replies are async and slow, so every await
// re-checks the token before mutating state (same pattern as trainingStore's
// sequenceToken, which uses it for its fixed 450ms reply timer).
let nextToken = 0;
let activeToken = 0;
let activeOpts: PlayoutStartOptions | null = null;

// Smart-depth budgets. Time-based caps rather than a fixed depth: a hard depth
// (12) stops far short of the horizon in deep endgames and the jittery evals
// crossed the adjudication bands and produced false slips. The depth cap lets
// simple endings (which hit depth 28 in a fraction of a second) return early,
// and the decided-score stop skips the rest of the think once the position is
// clearly won or lost. `decidedCp` is deliberately high for judging: ref and
// post evals must be comparable, and at ±10 pawns a deeper look would have to
// fall to ~4 pawns before the 15% drop rule could trip.
const REF_EVAL_OPTS: SmartEvalOptions = {
  movetimeMs: 2500,
  maxDepth: 28,
  decidedCp: 1000,
  decidedMinDepth: 18,
  pvMoves: 10,
};
const JUDGE_EVAL_OPTS = REF_EVAL_OPTS;
// No decided-score stop for the reply: we want the engine's best move, not
// just a confirmation that it's winning.
const REPLY_OPTS: SmartEvalOptions = { movetimeMs: 1000, maxDepth: 24, pvMoves: 5 };

function fullmoveFromFen(fen: string): number {
  return Number.parseInt(fen.split(' ')[5] ?? '1', 10) || 1;
}

/** Board + side to move + castling + en passant — what threefold repetition compares. */
function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Every position committed to the board (start, after each user move, after
// each engine reply) — chess.js built from a bare FEN can't see repetition.
let positionKeys: string[] = [];

function repetitions(fen: string): number {
  const key = positionKey(fen);
  let n = 0;
  for (const k of positionKeys) if (k === key) n += 1;
  return n;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Everything the opt-in "add to training queue" insert needs, captured at slip
// time — logSlip() runs after the play-out finished (or was even reset), so it
// must not read live store/option state.
interface SlipLogPayload {
  slip: PlayoutSlip;
  refEval: PositionEval;
  postEval: PositionEval | null;
  sourceGameId: string | null;
  userColor: 'white' | 'black';
  target: PlayoutTarget;
}

let pendingSlipLog: SlipLogPayload | null = null;

function stashSlipLog(slip: PlayoutSlip, refEval: PositionEval | null, postEval: PositionEval | null): SlipLogStatus {
  const opts = activeOpts;
  if (!opts || !slip.bestUci || !refEval) {
    pendingSlipLog = null;
    return 'unavailable';
  }
  pendingSlipLog = {
    slip,
    refEval,
    postEval,
    sourceGameId: opts.sourceGameId,
    userColor: opts.userColor,
    target: opts.target,
  };
  return 'idle';
}

async function insertSlipBlunder(payload: SlipLogPayload): Promise<void> {
  const { slip, refEval, postEval } = payload;
  await supabaseService.insertBlunders([
    {
      kind: 'endgame',
      game_id: payload.sourceGameId,
      fen: slip.fenBefore,
      move_number: fullmoveFromFen(slip.fenBefore),
      played_move: slip.playedUci,
      correct_moves: [{ move: refEval.bestMove, eval: refEval.scoreCp }],
      eval_before: refEval.scoreCp,
      eval_after: postEval?.scoreCp ?? 0,
      eval_swing: Math.round(
        slip.chancesLost ?? winningChancesLost(refEval.scoreCp, postEval?.scoreCp ?? 0),
      ),
      side_to_move: payload.userColor,
      phase: 'endgame',
      analysis_depth: refEval.depth,
      solution_line: {
        pv: refEval.principalVariation,
        playedPv: postEval?.principalVariation ?? [],
        v: 1,
      },
      motifs: [],
      drill_data: { deservedResult: payload.target, sourceGameId: payload.sourceGameId, v: 1 },
    },
  ]);
}

// The in-flight reference eval for the current user-to-move position. It runs
// in the background so the board is live immediately; processMove awaits it
// (usually already resolved) before judging.
interface PendingRef {
  token: number;
  fen: string;
  promise: Promise<PositionEval | null>;
}
let pendingRef: PendingRef | null = null;

export const useEndgamePlayoutStore = create<EndgamePlayoutState>((set, get) => {
  function finish(result: PlayoutResult): void {
    set({
      phase: result.success ? 'passed' : 'failed',
      slip: result.slip,
      terminal: result.terminal,
    });
    activeOpts?.onFinish?.(result);
  }

  async function warmupEngine() {
    const sf = await getOpponentStockfish();
    await sf.newGame();
    // The opponent singleton may be weakened by other users of setoption;
    // ucinewgame does NOT clear option state, so force full strength.
    await sf.setOptions({ UCI_LimitStrength: 'false' });
    return sf;
  }

  function kickRefEval(fen: string, token: number, warmup: boolean): Promise<PositionEval | null> {
    const promise: Promise<PositionEval | null> = (async () => {
      const sf = warmup ? await warmupEngine() : await getOpponentStockfish();
      return sf.evaluateSmart(fen, REF_EVAL_OPTS);
    })().then(
      (ev) => {
        if (activeToken === token && pendingRef?.promise === promise) {
          pendingRef = null;
          set({ refEval: ev, refPending: false });
        }
        return ev;
      },
      (err: unknown) => {
        if (activeToken === token && pendingRef?.promise === promise) {
          pendingRef = null;
          set({ refPending: false, engineError: errorMessage(err) });
        }
        return null;
      },
    );
    pendingRef = { token, fen, promise };
    return promise;
  }

  /**
   * Put `fen` on the board and enter `solving` right away. The reference eval
   * (needed only to judge the move, not to make it) runs in the background
   * unless a cached one is supplied.
   */
  function beginFrom(fen: string, token: number, restoredRef: PositionEval | null): void {
    if (!activeOpts) return;
    pendingSlipLog = null;
    pendingRef = null;
    set({
      phase: 'solving',
      fen,
      lastMove: null,
      slip: null,
      terminal: null,
      engineError: null,
      slipLog: 'idle',
      refEval: restoredRef,
      refPending: restoredRef === null,
    });
    if (restoredRef === null) {
      void kickRefEval(fen, token, true);
    } else {
      void warmupEngine().catch((err) => {
        if (activeToken === token) set({ engineError: errorMessage(err) });
      });
    }
  }

  return {
    phase: 'idle',
    fen: '',
    startFen: '',
    userColor: 'white',
    target: 'win',
    rules: { mode: 'finish' },
    lastMove: null,
    heldStreak: 0,
    holdTarget: null,
    userMovesPlayed: 0,
    refEval: null,
    refPending: false,
    slip: null,
    terminal: null,
    engineError: null,
    slipLog: 'idle',
    history: [],
    allowTakeBack: false,

    start: async (opts) => {
      const token = ++nextToken;
      activeToken = token;
      activeOpts = opts;
      stopOpponentSearch();
      positionKeys = [positionKey(opts.startFen)];
      set({
        startFen: opts.startFen,
        userColor: opts.userColor,
        target: opts.target,
        rules: opts.rules,
        holdTarget: opts.rules.mode === 'hold' ? opts.rules.holdMoves : null,
        allowTakeBack: opts.allowTakeBack ?? false,
        heldStreak: 0,
        userMovesPlayed: 0,
        history: [],
      });
      beginFrom(opts.startFen, token, null);
    },

    processMove: async (move) => {
      const state = get();
      if (state.phase !== 'solving') return;
      const token = activeToken;
      const {
        fen: preFen,
        lastMove: preLastMove,
        userColor,
        target,
        rules,
        heldStreak,
        userMovesPlayed,
      } = state;

      const chess = new Chess(preFen);
      let result;
      try {
        result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      } catch {
        // Illegal (stale drag/animation race) — snap back.
        set({ fen: preFen, lastMove: preLastMove });
        return;
      }
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      const afterFen = chess.fen();
      const entry: PlayoutHistoryEntry = {
        fen: preFen,
        lastMove: preLastMove,
        refEval: state.refEval,
        heldStreak,
        userMovesPlayed,
        positionKeysLen: positionKeys.length,
      };
      const historyLen = state.history.length;
      positionKeys.push(positionKey(afterFen));
      set({
        fen: afterFen,
        lastMove: [move.from, move.to],
        phase: 'judging',
        history: [...state.history, entry],
      });

      try {
        // The reference eval normally landed while the user was thinking; if
        // they moved first, wait for the remainder.
        let refEval = state.refEval;
        if (!refEval && pendingRef && pendingRef.token === token && pendingRef.fen === preFen) {
          refEval = await pendingRef.promise;
          if (activeToken !== token) return;
        }
        // Patch the snapshot so take-back restores a cached eval, not a wait.
        entry.refEval = refEval;

        // Terminal before any engine call — parseEvalCp's 0 is ambiguous there.
        const term = terminalState(afterFen, userColor, repetitions(afterFen));
        if (term) {
          const outcome = judgeTerminal(term, target);
          if (outcome === 'fail' && refEval) {
            // e.g. stalemating from a winning position — a real, loggable slip.
            const slip: PlayoutSlip = {
              fenBefore: preFen,
              moveNumber: fullmoveFromFen(preFen),
              playedUci: uci,
              playedSan: result.san,
              bestUci: refEval.bestMove,
              bestSan: uciToSan(preFen, refEval.bestMove),
              chancesLost: null,
              refutationPv: [],
              heldStreakAtSlip: heldStreak,
              userMovesPlayedAtSlip: userMovesPlayed,
              refEvalAtSlip: refEval,
              historyLenAtSlip: historyLen,
            };
            set({ slipLog: stashSlipLog(slip, refEval, null) });
            finish({ success: false, slip, ending: 'terminal', terminal: term });
          } else {
            finish({ success: outcome === 'success', slip: null, ending: 'terminal', terminal: term });
          }
          return;
        }

        const sf = await getOpponentStockfish();
        const postEval = await sf.evaluateSmart(afterFen, JUDGE_EVAL_OPTS);
        if (activeToken !== token) return;

        // refEval position has the user to move; afterFen has the opponent.
        const userWinPctBefore = refEval
          ? winPercent(cpForColor(refEval.scoreCp, userColor, userColor))
          : winPercent(cpForColor(-postEval.scoreCp, userColor, userColor));
        const userWinPctAfter = winPercent(-postEval.scoreCp);
        const judged = judgeUserMove({ target, userWinPctBefore, userWinPctAfter, heldStreak, rules });

        if (judged.verdict === 'fail') {
          const slip: PlayoutSlip = {
            fenBefore: preFen,
            moveNumber: fullmoveFromFen(preFen),
            playedUci: uci,
            playedSan: result.san,
            bestUci: refEval?.bestMove ?? '',
            bestSan: refEval ? uciToSan(preFen, refEval.bestMove) : null,
            chancesLost: userWinPctBefore - userWinPctAfter,
            refutationPv: postEval.principalVariation,
            heldStreakAtSlip: heldStreak,
            userMovesPlayedAtSlip: userMovesPlayed,
            refEvalAtSlip: refEval,
            historyLenAtSlip: historyLen,
          };
          set({ slipLog: stashSlipLog(slip, refEval, postEval) });
          finish({ success: false, slip, ending: 'slip', terminal: null });
          return;
        }
        if (judged.verdict === 'adjudicated-success') {
          set({ heldStreak: judged.heldStreak, userMovesPlayed: userMovesPlayed + 1 });
          finish({ success: true, slip: null, ending: 'adjudicated', terminal: null });
          return;
        }
        if (
          rules.mode === 'finish' &&
          target === 'draw' &&
          engineAcceptsDraw({ fen: afterFen, scoreCp: postEval.scoreCp, depth: postEval.depth })
        ) {
          set({ heldStreak: judged.heldStreak, userMovesPlayed: userMovesPlayed + 1 });
          finish({ success: true, slip: null, ending: 'adjudicated', terminal: null });
          return;
        }

        set({
          heldStreak: judged.heldStreak,
          userMovesPlayed: userMovesPlayed + 1,
          phase: 'thinking',
        });

        // Engine reply.
        const reply = await sf.evaluateSmart(afterFen, REPLY_OPTS);
        if (activeToken !== token) return;
        if (!reply.bestMove) {
          // Defensive: engine sees no move — re-check terminal.
          const t = terminalState(afterFen, userColor, repetitions(afterFen));
          if (t) finish({ success: judgeTerminal(t, target) === 'success', slip: null, ending: 'terminal', terminal: t });
          return;
        }
        const replyChess = new Chess(afterFen);
        const replyUci = reply.bestMove;
        try {
          replyChess.move({
            from: replyUci.slice(0, 2),
            to: replyUci.slice(2, 4),
            promotion: (replyUci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined,
          });
        } catch {
          set({ engineError: `Engine played an illegal move (${replyUci})`, phase: 'solving' });
          return;
        }
        const replyFen = replyChess.fen();
        const replyMove: [string, string] = [replyUci.slice(0, 2), replyUci.slice(2, 4)];
        positionKeys.push(positionKey(replyFen));

        const replyTerm = terminalState(replyFen, userColor, repetitions(replyFen));
        if (replyTerm) {
          set({ fen: replyFen, lastMove: replyMove });
          finish({
            success: judgeTerminal(replyTerm, target) === 'success',
            slip: null,
            ending: 'terminal',
            terminal: replyTerm,
          });
          return;
        }

        // Show the reply now; the reference eval for the next user move (the
        // judge's "before" and the correct_moves source if they slip) runs in
        // the background while the user thinks.
        set({
          phase: 'solving',
          fen: replyFen,
          lastMove: replyMove,
          refEval: null,
          refPending: true,
        });
        void kickRefEval(replyFen, token, false);
      } catch (err) {
        if (activeToken !== token) return;
        positionKeys.length = entry.positionKeysLen;
        set({
          phase: 'solving',
          fen: preFen,
          lastMove: preLastMove,
          engineError: errorMessage(err),
          history: get().history.filter((e) => e !== entry),
        });
      }
    },

    retry: async (from) => {
      const opts = activeOpts;
      if (!opts) return;
      const state = get();
      const slip = from === 'slip' ? state.slip : null;
      const token = ++nextToken;
      activeToken = token;
      stopOpponentSearch();
      if (slip) {
        // Retrying from the mistake keeps the hold progress earned before it
        // and the cached reference eval, so there's no wait.
        const slipEntry = state.history[slip.historyLenAtSlip];
        positionKeys.length = slipEntry?.positionKeysLen ?? positionKeys.length;
        set({
          heldStreak: slip.heldStreakAtSlip,
          userMovesPlayed: slip.userMovesPlayedAtSlip,
          history: state.history.slice(0, slip.historyLenAtSlip),
        });
        beginFrom(slip.fenBefore, token, slip.refEvalAtSlip);
        return;
      }
      // Restarting the play-out starts the count over.
      const startRef =
        state.history[0]?.fen === opts.startFen
          ? state.history[0].refEval
          : state.slip?.fenBefore === opts.startFen
            ? state.slip.refEvalAtSlip
            : null;
      positionKeys = [positionKey(opts.startFen)];
      set({ heldStreak: 0, userMovesPlayed: 0, history: [] });
      beginFrom(opts.startFen, token, startRef);
    },

    takeBack: () => {
      const state = get();
      if (!state.allowTakeBack || state.phase !== 'solving' || state.history.length === 0) return;
      const entry = state.history[state.history.length - 1];
      // Abandon the background eval for the position we're leaving.
      stopOpponentSearch();
      const token = ++nextToken;
      activeToken = token;
      pendingRef = null;
      positionKeys.length = entry.positionKeysLen;
      set({
        fen: entry.fen,
        lastMove: entry.lastMove,
        refEval: entry.refEval,
        refPending: entry.refEval === null,
        heldStreak: entry.heldStreak,
        userMovesPlayed: entry.userMovesPlayed,
        engineError: null,
        history: state.history.slice(0, -1),
      });
      if (entry.refEval === null) void kickRefEval(entry.fen, token, false);
    },

    logSlip: async () => {
      const payload = pendingSlipLog;
      const status = get().slipLog;
      if (!payload || status === 'saving' || status === 'saved') return;
      set({ slipLog: 'saving' });
      try {
        await insertSlipBlunder(payload);
        // Only report success for the slip the user asked about — a new
        // play-out may have replaced it while the insert was in flight.
        if (pendingSlipLog === payload) set({ slipLog: 'saved' });
      } catch (err) {
        console.warn('[endgame] failed to log slip', err);
        if (pendingSlipLog === payload) set({ slipLog: 'error' });
      }
    },

    reset: () => {
      activeToken = ++nextToken;
      activeOpts = null;
      pendingSlipLog = null;
      pendingRef = null;
      positionKeys = [];
      stopOpponentSearch();
      set({
        phase: 'idle',
        fen: '',
        startFen: '',
        lastMove: null,
        heldStreak: 0,
        holdTarget: null,
        userMovesPlayed: 0,
        refEval: null,
        refPending: false,
        slip: null,
        terminal: null,
        engineError: null,
        slipLog: 'idle',
        history: [],
        allowTakeBack: false,
      });
    },
  };
});
