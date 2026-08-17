import { create } from 'zustand';
import { Chess } from 'chess.js';
import { RepertoireColor, RepertoireMove } from '../models/repertoire';
import { PositionStats } from '../services/positionFrequencyService';
import { OpponentBand, sampleOpponentMove } from '../services/opponentMoveSampler';
import { supabaseService } from '../services/supabaseService';
import { getStockfish } from '../hooks/useStockfish';
import { winPercent } from '../chess/winningChances';
import { CASTLING_NORMALIZE, parseUciMove, toEpd, uciToSan } from '../chess/moveUtils';

export type OpeningTrainerPhase =
  | 'idle'
  | 'loading'
  | 'solving'
  | 'thinking'
  | 'evaluating'
  | 'mistake'
  | 'out-of-book'
  | 'line-complete';

export interface OpeningTrainerDeps {
  color: RepertoireColor;
  repertoire: Map<string, RepertoireMove>;
  stats: Map<string, PositionStats> | null;
  band: OpponentBand;
  userRating: number | null;
}

export interface OpeningMistake {
  fenBefore: string;
  playedUci: string;
  playedSan: string | null;
  bookUci: string;
  bookSan: string | null;
  chancesLost: number;
}

export interface OpeningLineResult {
  success: boolean;
  endReason: 'mistake' | 'out-of-book' | 'line-complete';
  mistake: OpeningMistake | null;
}

export interface OpeningStartOptions {
  deps: OpeningTrainerDeps;
  /** Defaults to the standard start position (practice mode). */
  startFen?: string;
  /**
   * Expected move at the start position when the live repertoire no longer
   * covers it (unified-queue drills store the move they were logged against).
   */
  expectedOverride?: { epd: string; uci: string } | null;
  /** Persist mistakes as opening-kind SR items. */
  logMistakes: boolean;
  onFinish?: (result: OpeningLineResult) => void;
}

/** Accept rule for off-book moves, same bar as the tactic trainer. */
const TOLERANCE_PCT = 5;
const JUDGE_DEPTH = 18;

interface OpeningTrainerState {
  phase: OpeningTrainerPhase;
  fen: string;
  lastMove: [string, string] | null;
  /** UCIs played from startFen (breadcrumb / deep-link). */
  line: string[];
  color: RepertoireColor;
  /** Book move expected at the current solving position. */
  currentExpectedUci: string | null;
  /** Transient "fine move, but your book move is X" note. */
  toleratedNote: string | null;
  mistake: OpeningMistake | null;
  /** EPD of the uncovered position that ended the line (out-of-book). */
  outOfBookEpd: string | null;
  userMovesPlayed: number;
  engineError: string | null;

  start: (opts: OpeningStartOptions) => Promise<void>;
  processMove: (move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }) => Promise<void>;
  reset: () => void;
}

let nextToken = 0;
let activeToken = 0;
let activeOpts: OpeningStartOptions | null = null;

function fullmoveFromFen(fen: string): number {
  return Number.parseInt(fen.split(' ')[5] ?? '1', 10) || 1;
}

function applyUci(fen: string, uci: string): { fen: string; san: string } | null {
  try {
    const chess = new Chess(fen);
    const m = parseUciMove(CASTLING_NORMALIZE[uci] ?? uci);
    const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    return r ? { fen: chess.fen(), san: r.san } : null;
  } catch {
    return null;
  }
}

function logMistakeBlunder(mistake: OpeningMistake, refCp: number, postCp: number, postPv: string[]): void {
  const opts = activeOpts;
  if (!opts?.logMistakes) return;
  void supabaseService
    .insertBlunders([
      {
        kind: 'opening',
        game_id: null,
        fen: mistake.fenBefore,
        move_number: fullmoveFromFen(mistake.fenBefore),
        played_move: mistake.playedUci,
        correct_moves: [{ move: mistake.bookUci, eval: refCp }],
        eval_before: refCp,
        eval_after: postCp,
        eval_swing: Math.round(mistake.chancesLost),
        side_to_move: opts.deps.color,
        phase: 'opening',
        solution_line: { pv: [mistake.bookUci], playedPv: postPv, v: 1 },
        motifs: [],
        drill_data: { color: opts.deps.color, repertoireMove: mistake.bookUci, v: 1 },
      },
    ])
    .catch((err) => console.warn('[openings] failed to log mistake', err));
}

export const useOpeningTrainerStore = create<OpeningTrainerState>((set, get) => {
  function expectedAt(epd: string): string | null {
    const opts = activeOpts;
    if (!opts) return null;
    const fromRepertoire = opts.deps.repertoire.get(epd)?.uci ?? null;
    if (fromRepertoire) return fromRepertoire;
    if (opts.expectedOverride && opts.expectedOverride.epd === epd) return opts.expectedOverride.uci;
    return null;
  }

  function finish(result: OpeningLineResult): void {
    activeOpts?.onFinish?.(result);
  }

  /** Landed on a position with the user to move. */
  function enterOwnNode(fen: string): void {
    const epd = toEpd(fen);
    const expected = expectedAt(epd);
    if (!expected) {
      set({ phase: 'out-of-book', outOfBookEpd: epd, currentExpectedUci: null });
      finish({ success: true, endReason: 'out-of-book', mistake: null });
      return;
    }
    set({ phase: 'solving', currentExpectedUci: expected });
  }

  /** Landed on a position with the opponent to move — sample and play a reply. */
  async function opponentTurn(fen: string, token: number): Promise<void> {
    const opts = activeOpts;
    if (!opts) return;
    try {
      const chess = new Chess(fen);
      if (chess.isGameOver()) {
        set({ phase: 'line-complete' });
        finish({ success: true, endReason: 'line-complete', mistake: null });
        return;
      }
    } catch {
      /* keep going; sampler re-checks legality */
    }
    set({ phase: 'thinking' });
    const sampled = await sampleOpponentMove({
      fen,
      stats: opts.deps.stats ?? undefined,
      band: opts.deps.band,
      userRating: opts.deps.userRating,
    });
    if (activeToken !== token) return;
    if (!sampled) {
      set({ phase: 'line-complete' });
      finish({ success: true, endReason: 'line-complete', mistake: null });
      return;
    }
    const applied = applyUci(fen, sampled.uci);
    if (!applied) {
      set({ phase: 'line-complete' });
      finish({ success: true, endReason: 'line-complete', mistake: null });
      return;
    }
    const m = parseUciMove(CASTLING_NORMALIZE[sampled.uci] ?? sampled.uci);
    set((s) => ({
      fen: applied.fen,
      lastMove: [m.from, m.to],
      line: [...s.line, sampled.uci],
    }));
    enterOwnNode(applied.fen);
  }

  return {
    phase: 'idle',
    fen: '',
    lastMove: null,
    line: [],
    color: 'white',
    currentExpectedUci: null,
    toleratedNote: null,
    mistake: null,
    outOfBookEpd: null,
    userMovesPlayed: 0,
    engineError: null,

    start: async (opts) => {
      const token = ++nextToken;
      activeToken = token;
      activeOpts = opts;
      const startFen = opts.startFen ?? new Chess().fen();
      set({
        phase: 'loading',
        fen: startFen,
        lastMove: null,
        line: [],
        color: opts.deps.color,
        currentExpectedUci: null,
        toleratedNote: null,
        mistake: null,
        outOfBookEpd: null,
        userMovesPlayed: 0,
        engineError: null,
      });
      const sideToMove = startFen.split(' ')[1] === 'w' ? 'white' : 'black';
      if (sideToMove === opts.deps.color) enterOwnNode(startFen);
      else await opponentTurn(startFen, token);
    },

    processMove: async (move) => {
      const state = get();
      if (state.phase !== 'solving') return;
      const opts = activeOpts;
      if (!opts) return;
      const token = activeToken;
      const preFen = state.fen;
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;

      const applied = applyUci(preFen, uci);
      if (!applied) {
        set({ fen: preFen, lastMove: state.lastMove });
        return;
      }

      const expected = state.currentExpectedUci;
      const normalized = CASTLING_NORMALIZE[uci] ?? uci;
      const isBook =
        expected !== null && (normalized === (CASTLING_NORMALIZE[expected] ?? expected));

      set((s) => ({
        fen: applied.fen,
        lastMove: [move.from, move.to],
        toleratedNote: null,
        userMovesPlayed: s.userMovesPlayed + 1,
        line: [...s.line, uci],
      }));

      if (isBook) {
        await opponentTurn(applied.fen, token);
        return;
      }

      // Off-book: engine-tolerant judgment against the position's own eval.
      set({ phase: 'evaluating' });
      let chancesLost = 100;
      let refCp = 0;
      let postCp = 0;
      let postPv: string[] = [];
      let judged = false;
      try {
        const sf = await getStockfish();
        const refEv = await sf.evaluatePositionFull(preFen, JUDGE_DEPTH);
        const postEv = await sf.evaluatePositionFull(applied.fen, JUDGE_DEPTH);
        if (activeToken !== token) return;
        refCp = refEv.scoreCp;
        postCp = postEv.scoreCp;
        postPv = postEv.principalVariation;
        chancesLost = winPercent(refCp) - winPercent(-postCp);
        judged = true;
      } catch (err) {
        if (activeToken !== token) return;
        // Engine unavailable: strict-book fallback — treat as a mistake with
        // unknown severity rather than silently accepting anything.
        set({ engineError: err instanceof Error ? err.message : String(err) });
      }

      const bookSan = expected ? uciToSan(preFen, expected) : null;
      if (Math.abs(chancesLost) <= TOLERANCE_PCT) {
        set({
          toleratedNote: bookSan ? `Fine move — your book move here is ${bookSan}` : null,
        });
        await opponentTurn(applied.fen, token);
        return;
      }

      const mistake: OpeningMistake = {
        fenBefore: preFen,
        playedUci: uci,
        playedSan: applied.san,
        bookUci: expected ?? '',
        bookSan,
        chancesLost,
      };
      // Only persist properly-judged mistakes — an engine outage shouldn't
      // write bogus eval data into the SR queue.
      if (expected && judged) logMistakeBlunder(mistake, refCp, postCp, postPv);
      set({ phase: 'mistake', mistake });
      finish({ success: false, endReason: 'mistake', mistake });
    },

    reset: () => {
      activeToken = ++nextToken;
      activeOpts = null;
      set({
        phase: 'idle',
        fen: '',
        lastMove: null,
        line: [],
        currentExpectedUci: null,
        toleratedNote: null,
        mistake: null,
        outOfBookEpd: null,
        userMovesPlayed: 0,
        engineError: null,
      });
    },
  };
});
