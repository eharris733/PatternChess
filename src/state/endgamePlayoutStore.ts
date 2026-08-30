import { create } from 'zustand';
import { Chess } from 'chess.js';
import {
  HOLD_MOVES,
  judgeTerminal,
  judgeUserMove,
  PlayoutTarget,
  TerminalKind,
  terminalState,
} from '../chess/adjudication';
import { cpForColor, winPercent, winningChancesLost } from '../chess/winningChances';
import { uciToSan } from '../chess/moveUtils';
import { getOpponentStockfish } from '../hooks/useStockfish';
import type { PositionEval } from '../stockfish/stockfishWorkerClient';
import { supabaseService } from '../services/supabaseService';

export type PlayoutPhase = 'idle' | 'loading' | 'solving' | 'thinking' | 'passed' | 'failed';

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
  onFinish?: (result: PlayoutResult) => void;
}

interface BoardMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

interface EndgamePlayoutState {
  phase: PlayoutPhase;
  fen: string;
  startFen: string;
  userColor: 'white' | 'black';
  target: PlayoutTarget;
  lastMove: [string, string] | null;
  heldStreak: number;
  holdTarget: number;
  userMovesPlayed: number;
  /** Timed eval of the current user-to-move position (stm = user). */
  refEval: PositionEval | null;
  evaluating: boolean;
  slip: PlayoutSlip | null;
  terminal: TerminalKind | null;
  engineError: string | null;
  /** Opt-in "add to training queue" state for the current slip. */
  slipLog: SlipLogStatus;

  start: (opts: PlayoutStartOptions) => Promise<void>;
  processMove: (move: BoardMove) => Promise<void>;
  retry: (from: 'start' | 'slip') => Promise<void>;
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

const ENGINE_REPLY_MOVETIME_MS = 1000;
// Fixed thinking time, not fixed depth: a hard depth (12) stops far short of
// the horizon in deep endgames, and the jittery evals crossed the adjudication
// bands and produced false slips. The judging budget is deliberately generous
// (~5s perceived wait per user move: postEval + reply, nextRef hidden behind
// the reply animation) — shallow adjudication produced unfair slips, and the
// achieved depth is surfaced in the play-out panel.
const EVAL_MOVETIME_MS = 2500;

function fullmoveFromFen(fen: string): number {
  return Number.parseInt(fen.split(' ')[5] ?? '1', 10) || 1;
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

export const useEndgamePlayoutStore = create<EndgamePlayoutState>((set, get) => {
  function finish(result: PlayoutResult): void {
    set({
      phase: result.success ? 'passed' : 'failed',
      slip: result.slip,
      terminal: result.terminal,
    });
    activeOpts?.onFinish?.(result);
  }

  async function beginFrom(fen: string, token: number): Promise<void> {
    const opts = activeOpts;
    if (!opts) return;
    pendingSlipLog = null;
    set({
      phase: 'loading',
      fen,
      lastMove: null,
      slip: null,
      terminal: null,
      engineError: null,
      evaluating: false,
      slipLog: 'idle',
    });
    try {
      const sf = await getOpponentStockfish();
      await sf.newGame();
      // The opponent singleton may be weakened by other users of setoption;
      // ucinewgame does NOT clear option state, so force full strength.
      await sf.setOptions({ UCI_LimitStrength: 'false' });
      const refEval = await sf.evaluatePositionTimed(fen, EVAL_MOVETIME_MS, 10);
      if (activeToken !== token) return;
      set({ phase: 'solving', refEval });
    } catch (err) {
      if (activeToken !== token) return;
      set({
        phase: 'solving',
        refEval: null,
        engineError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    phase: 'idle',
    fen: '',
    startFen: '',
    userColor: 'white',
    target: 'win',
    lastMove: null,
    heldStreak: 0,
    holdTarget: HOLD_MOVES,
    userMovesPlayed: 0,
    refEval: null,
    evaluating: false,
    slip: null,
    terminal: null,
    engineError: null,
    slipLog: 'idle',

    start: async (opts) => {
      const token = ++nextToken;
      activeToken = token;
      activeOpts = opts;
      set({
        startFen: opts.startFen,
        userColor: opts.userColor,
        target: opts.target,
        heldStreak: 0,
        userMovesPlayed: 0,
        refEval: null,
      });
      await beginFrom(opts.startFen, token);
    },

    processMove: async (move) => {
      const state = get();
      if (state.phase !== 'solving' || state.evaluating) return;
      const token = activeToken;
      const { fen: preFen, userColor, target, refEval, heldStreak } = state;

      const chess = new Chess(preFen);
      let result;
      try {
        result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      } catch {
        // Illegal (stale drag/animation race) — snap back.
        set({ fen: preFen, lastMove: state.lastMove });
        return;
      }
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      const afterFen = chess.fen();
      set({ fen: afterFen, lastMove: [move.from, move.to], evaluating: true });

      try {
        // Terminal before any engine call — parseEvalCp's 0 is ambiguous there.
        const term = terminalState(afterFen, userColor);
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
              userMovesPlayedAtSlip: state.userMovesPlayed,
            };
            set({ slipLog: stashSlipLog(slip, refEval, null) });
            finish({ success: false, slip, ending: 'terminal', terminal: term });
          } else {
            finish({ success: outcome === 'success', slip: null, ending: 'terminal', terminal: term });
          }
          return;
        }

        const sf = await getOpponentStockfish();
        const postEval = await sf.evaluatePositionTimed(afterFen, EVAL_MOVETIME_MS, 10);
        if (activeToken !== token) return;

        // refEval position has the user to move; afterFen has the opponent.
        const userWinPctBefore = refEval
          ? winPercent(cpForColor(refEval.scoreCp, userColor, userColor))
          : winPercent(cpForColor(-postEval.scoreCp, userColor, userColor));
        const userWinPctAfter = winPercent(-postEval.scoreCp);
        const judged = judgeUserMove({ target, userWinPctBefore, userWinPctAfter, heldStreak });

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
            userMovesPlayedAtSlip: state.userMovesPlayed,
          };
          set({ slipLog: stashSlipLog(slip, refEval, postEval) });
          finish({ success: false, slip, ending: 'slip', terminal: null });
          return;
        }
        if (judged.verdict === 'adjudicated-success') {
          set({ heldStreak: judged.heldStreak, userMovesPlayed: state.userMovesPlayed + 1 });
          finish({ success: true, slip: null, ending: 'adjudicated', terminal: null });
          return;
        }

        set({
          heldStreak: judged.heldStreak,
          userMovesPlayed: state.userMovesPlayed + 1,
          phase: 'thinking',
        });

        // Engine reply.
        const reply = await sf.bestMoveTimed(afterFen, ENGINE_REPLY_MOVETIME_MS);
        if (activeToken !== token) return;
        if (!reply.bestMove) {
          // Defensive: engine sees no move — re-check terminal.
          const t = terminalState(afterFen, userColor);
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

        const replyTerm = terminalState(replyFen, userColor);
        if (replyTerm) {
          if (activeToken !== token) return;
          set({ fen: replyFen, lastMove: [replyUci.slice(0, 2), replyUci.slice(2, 4)] });
          finish({
            success: judgeTerminal(replyTerm, target) === 'success',
            slip: null,
            ending: 'terminal',
            terminal: replyTerm,
          });
          return;
        }

        // Pre-eval the next user position: it's the reference for judging the
        // user's next move AND the correct_moves source if they slip.
        const nextRef = await sf.evaluatePositionTimed(replyFen, EVAL_MOVETIME_MS, 10);
        if (activeToken !== token) return;
        set({
          phase: 'solving',
          fen: replyFen,
          lastMove: [replyUci.slice(0, 2), replyUci.slice(2, 4)],
          refEval: nextRef,
        });
      } catch (err) {
        if (activeToken !== token) return;
        set({
          phase: 'solving',
          fen: preFen,
          lastMove: state.lastMove,
          engineError: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (activeToken === token) set({ evaluating: false });
      }
    },

    retry: async (from) => {
      const opts = activeOpts;
      if (!opts) return;
      const state = get();
      const slip = from === 'slip' ? state.slip : null;
      const fen = slip ? slip.fenBefore : opts.startFen;
      const token = ++nextToken;
      activeToken = token;
      // Retrying from the mistake keeps the hold progress earned before it;
      // restarting the play-out starts the count over.
      set({
        heldStreak: slip?.heldStreakAtSlip ?? 0,
        userMovesPlayed: slip?.userMovesPlayedAtSlip ?? 0,
        refEval: null,
      });
      await beginFrom(fen, token);
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
      set({
        phase: 'idle',
        fen: '',
        startFen: '',
        lastMove: null,
        heldStreak: 0,
        userMovesPlayed: 0,
        refEval: null,
        evaluating: false,
        slip: null,
        terminal: null,
        engineError: null,
        slipLog: 'idle',
      });
    },
  };
});
