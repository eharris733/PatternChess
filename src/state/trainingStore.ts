import { create } from 'zustand';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { Blunder, CorrectMove, isCorrectMove } from '../models/blunder';
import { applyDrillResult } from './drills/applyDrillResult';
import { GameRecord } from '../models/gameRecord';
import { UserProfile } from '../models/userProfile';
import { supabaseService } from '../services/supabaseService';
import { getStockfish } from '../hooks/useStockfish';
import {
  classify,
  inaccuracyThresholdPercent,
  winPercent,
  winningChancesLost,
} from '../chess/winningChances';
import {
  BlunderContext,
  ContextFilter,
  computeBlunderContext,
} from '../chess/blunderContext';
import { CASTLING_NORMALIZE, moveToUci, parseUciMove } from '../chess/moveUtils';
import {
  buildLineMoves,
  buildRefutationPairs,
  type ReviewMove,
} from '../chess/refutationLines';
import { computeDrillLine } from '../chess/solutionLine';
import type { MovePair } from '../components/MoveSequencePanel';
import { computeNextStreak, detectTimezone, localDate } from '../services/streakService';
import { queryClient } from '../lib/queryClient';

// Per-drill SR writes are fire-and-forget, but leaving a session (e.g. to change
// the theme) must not drop them or re-serve a stale "due" list on return. Track
// every in-flight write so we can flush before invalidating caches.
const pendingDrillWrites = new Set<Promise<unknown>>();
function trackDrillWrite(p: Promise<unknown>): void {
  pendingDrillWrites.add(p);
  void p.finally(() => pendingDrillWrites.delete(p));
}

// Await all pending drill writes, then drop the cached due-blunders list so the
// next training entry refetches true post-drill state instead of replaying
// just-solved puzzles. Fire-and-forget by callers; safe to run while unmounted.
async function flushDrillWritesAndRefreshDue(): Promise<void> {
  if (pendingDrillWrites.size > 0) {
    await Promise.allSettled([...pendingDrillWrites]);
  }
  queryClient.removeQueries({ queryKey: ['blunders', 'due'] });
  queryClient.removeQueries({ queryKey: ['blunders', 'forGames'] });
  void queryClient.invalidateQueries({ queryKey: ['blunders'], refetchType: 'all' });
}

export type TrainingPhase =
  | 'loading'
  | 'reviewing'
  | 'solving'
  | 'correct'
  | 'incorrect'
  | 'complete'
  | 'empty';

export interface IncorrectFeedback {
  message: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export interface StreakSnapshot {
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string | null;
  timezone: string | null;
}

export interface TrainingStateShape {
  phase: TrainingPhase;
  blunders: Blunder[];
  currentIndex: number;
  totalCorrect: number;
  totalAttempted: number;
  attemptedBlunderIds: Set<string>;
  fen: string;
  orientation: 'white' | 'black';
  movableFor: 'white' | 'black' | 'both' | null;
  lastMove: [string, string] | null;
  shapes: DrawShape[];
  blunderSan: string;
  refutationMoves: ReviewMove[];
  refutationPairs: MovePair[];
  activeRefutationIndex: number | null;
  /** Engine refutation of the wrong move the user just played (incorrect phase). */
  playedRefutationMoves: ReviewMove[];
  playedRefutationPairs: MovePair[];
  activePlayedRefutationIndex: number | null;
  postCorrectMoves: ReviewMove[];
  postCorrectPairs: MovePair[];
  activePostCorrectIndex: number | null;
  postCorrectStartsWithWhite: boolean;
  incorrectFeedback: IncorrectFeedback | null;
  /**
   * When true, the incorrect-phase action requeues the position later in the
   * session; when false (a "good but not best" nudge) it retries in place.
   */
  incorrectRequeue: boolean;
  evaluating: boolean;
  game: GameRecord | null;
  currentContext: BlunderContext | null;
  contextFilter: ContextFilter | null;
  showWhatYouPlayed: boolean;
  hintLevel: 0 | 1 | 2;
  sessionId: string | null;
  streakSnapshot: StreakSnapshot | null;
  streakApplied: boolean;
  /**
   * UI flag: show the "Try again / You missed this last time" banner + suppress
   * the literal "Try again" SR pill label. Active only at the *initial presentation*
   * of a previously-failed position within a drill session — cleared as soon as
   * the user makes any move (correct, incorrect, or "good but not best").
   * Decoupled from `blunder.lastDrillFailed`, which persists across sessions.
   */
  pendingTryAgain: boolean;
  /** Blunders the user has made at least one move on this session — used to gate `pendingTryAgain` across retries. */
  interactedBlunderIds: Set<string>;
  playedMovesFromBlunder: string[];
  /**
   * The current drill's solution sequence (see computeDrillLine): even indices
   * are the user's moves, odd indices auto-played opponent replies. A single
   * entry (or the legacy no-line fallback) makes the drill single-move.
   */
  drillPlies: string[];
  /** Index into drillPlies of the user ply being solved (0, 2, 4 …). */
  drillPly: number;
  userMovesRequired: number;
  /** Transient mid-sequence feedback ("Correct — keep going") shown while solving. */
  stepFeedback: string | null;
  /**
   * Monotonic token guarding the delayed opponent auto-reply: bumped on every
   * load/reset so a pending setTimeout from a stale drill can never mutate the
   * board of the one that replaced it.
   */
  sequenceToken: number;
  /**
   * Profile preference (mirrored in by TrainingRoute): show the review step
   * (played move + refutation) before solving. When false — the default — new
   * and retry positions go straight to solving, and the review content is
   * revealed only after the attempt via ensureBlunderRefutation().
   */
  revealBeforeSolve: boolean;

  setRevealBeforeSolve: (value: boolean) => void;
  ensureBlunderRefutation: () => Promise<void>;
  setBlunders: (blunders: Blunder[]) => void;
  setContextFilter: (filter: ContextFilter | null) => void;
  beginSession: (profile: UserProfile) => Promise<void>;
  loadCurrentBlunder: () => Promise<void>;
  proceedFromReview: () => void;
  processMove: (move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }) => Promise<void>;
  /**
   * Record the outcome of a drill whose board interaction ran OUTSIDE this
   * store (e.g. the endgame play-out panel). Applies the same SR advancement,
   * session totals, and streak handling as processMove, then enters the
   * correct/incorrect phase so the standard Next/Continue flow applies.
   */
  completeExternalDrill: (opts: { success: boolean; feedback?: IncorrectFeedback | null }) => void;
  /**
   * Forfeit the clean first attempt on the current item from an external drill
   * (e.g. taking a hint in the endgame play-out) — mirrors showHint's counting.
   */
  markExternalAttempt: () => void;
  advance: () => void;
  retry: () => void;
  requeueAndAdvance: () => void;
  deleteCurrent: () => Promise<DeleteResult>;
  toggleShowWhatYouPlayed: () => void;
  showHint: () => void;
  selectRefutationIndex: (idx: number) => void;
  selectPlayedRefutationIndex: (idx: number) => void;
  selectPostCorrectIndex: (idx: number) => void;
  reset: () => void;
}

type InitialShape = Omit<TrainingStateShape,
  | 'setRevealBeforeSolve'
  | 'ensureBlunderRefutation'
  | 'setBlunders'
  | 'setContextFilter'
  | 'beginSession'
  | 'loadCurrentBlunder'
  | 'proceedFromReview'
  | 'processMove'
  | 'completeExternalDrill'
  | 'markExternalAttempt'
  | 'advance'
  | 'retry'
  | 'requeueAndAdvance'
  | 'deleteCurrent'
  | 'toggleShowWhatYouPlayed'
  | 'showHint'
  | 'selectRefutationIndex'
  | 'selectPlayedRefutationIndex'
  | 'selectPostCorrectIndex'
  | 'reset'>;

function makeInitial(): InitialShape {
  return {
    phase: 'loading',
    blunders: [],
    currentIndex: 0,
    totalCorrect: 0,
    totalAttempted: 0,
    attemptedBlunderIds: new Set<string>(),
    fen: new Chess().fen(),
    orientation: 'white',
    movableFor: null,
    lastMove: null,
    shapes: [],
    blunderSan: '',
    refutationMoves: [],
    refutationPairs: [],
    activeRefutationIndex: null,
    playedRefutationMoves: [],
    playedRefutationPairs: [],
    activePlayedRefutationIndex: null,
    postCorrectMoves: [],
    postCorrectPairs: [],
    activePostCorrectIndex: null,
    postCorrectStartsWithWhite: true,
    incorrectFeedback: null,
    evaluating: false,
    game: null,
    currentContext: null,
    contextFilter: null,
    showWhatYouPlayed: false,
    hintLevel: 0,
    sessionId: null,
    streakSnapshot: null,
    streakApplied: false,
    pendingTryAgain: false,
    interactedBlunderIds: new Set<string>(),
    playedMovesFromBlunder: [],
    drillPlies: [],
    drillPly: 0,
    userMovesRequired: 1,
    stepFeedback: null,
    sequenceToken: 0,
    incorrectRequeue: false,
    revealBeforeSolve: false,
  };
}

// Monotonic source for sequenceToken — module-level so a reset (which zeroes
// the state token) can never recycle a value a pending timeout still holds.
let nextSequenceToken = 0;

/** Replay a UCI prefix from a base FEN; null if any ply fails to apply. */
function replayFen(baseFen: string, plies: string[]): string | null {
  let chess: Chess;
  try {
    chess = new Chess(baseFen);
  } catch {
    return null;
  }
  for (const uci of plies) {
    const std = CASTLING_NORMALIZE[uci] ?? uci;
    const m = parseUciMove(std);
    try {
      if (!chess.move({ from: m.from, to: m.to, promotion: m.promotion })) return null;
    } catch {
      return null;
    }
  }
  return chess.fen();
}

function endActiveSession(state: TrainingStateShape): void {
  if (!state.sessionId) return;
  if (state.totalAttempted === 0) return;
  void supabaseService
    .updateTrainingSession(state.sessionId, {
      blundersAttempted: state.totalAttempted,
      blundersCorrect: state.totalCorrect,
      endedAt: new Date(),
    })
    .catch((err) => console.warn('[training] endActiveSession failed', err));
}

async function applyStreakUpdate(snapshot: StreakSnapshot): Promise<void> {
  const next = computeNextStreak({
    currentStreakDays: snapshot.currentStreakDays,
    longestStreakDays: snapshot.longestStreakDays,
    lastDrillLocalDate: snapshot.lastDrillLocalDate,
    timezone: snapshot.timezone,
  });
  if (!next.changed) return;
  try {
    await supabaseService.updateProfileStreak({
      currentStreakDays: next.currentStreakDays,
      longestStreakDays: next.longestStreakDays,
      lastDrillLocalDate: next.lastDrillLocalDate,
      timezone: next.timezone,
    });
  } catch {
    /* network failures are non-fatal — streak resyncs next drill */
  }
}

const gameCache = new Map<string, GameRecord>();

function tryMoveSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = parseUciMove(uci);
    const result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    return result?.san ?? null;
  } catch {
    return null;
  }
}

function sanFromUci(fen: string, uci: string): string {
  const direct = tryMoveSan(fen, uci);
  if (direct) return direct;
  const normalized = CASTLING_NORMALIZE[uci];
  if (normalized) {
    const san = tryMoveSan(fen, normalized);
    if (san) return san;
  }
  return uci;
}

function classifyShortLabel(b: Blunder): 'Blunder' | 'Mistake' | 'Inaccuracy' {
  const cl = winningChancesLost(b.evalBefore, b.evalAfter);
  const c = classify(cl);
  if (c === 'blunder') return 'Blunder';
  if (c === 'inaccuracy') return 'Inaccuracy';
  return 'Mistake';
}

/**
 * Replay the original blunder and ask the engine why it fails. Shared by the
 * pre-solve review step and the post-attempt reveal (hidden mode). Returns
 * null when the stored move can't be replayed or the engine is unavailable.
 */
async function computeOriginalRefutation(
  blunder: Blunder,
  blunderSan: string,
  currentContext: BlunderContext | null,
): Promise<{ pairs: MovePair[]; movesPlusFirst: ReviewMove[] } | null> {
  let afterFen: string;
  try {
    const chess = new Chess(blunder.fen);
    const stdUci = CASTLING_NORMALIZE[blunder.playedMove] ?? blunder.playedMove;
    const stdM = parseUciMove(stdUci);
    const result = chess.move({ from: stdM.from, to: stdM.to, promotion: stdM.promotion });
    if (!result) return null;
    afterFen = chess.fen();
  } catch {
    return null;
  }

  try {
    const sf = await getStockfish();
    const ev = await sf.evaluatePositionFull(afterFen, 18);
    const pvMoves = buildLineMoves(afterFen, ev.principalVariation);
    // The move row carries a single tag notating the move. Prefer the
    // game-state context (it's the more specific signal); for a roughly
    // equal position fall back to the blunder classification so the row is
    // never left untagged.
    const moveTag =
      currentContext?.gameState === 'missedWin'
        ? 'Missed win'
        : currentContext?.gameState === 'alreadyLosing'
          ? 'Already losing'
          : classifyShortLabel(blunder).toUpperCase();
    return buildRefutationPairs({
      fen: blunder.fen,
      moveNumber: blunder.moveNumber,
      sideToMove: blunder.sideToMove,
      firstSan: blunderSan,
      firstUci: blunder.playedMove,
      contextTags: [moveTag],
      pvMoves,
    });
  } catch {
    return null;
  }
}

function buildPostCorrectPairs(
  preCorrectFen: string,
  correctSan: string,
  correctUci: string,
  pvMoves: ReviewMove[],
): { pairs: MovePair[]; movesPlusCorrect: ReviewMove[]; startsWithWhite: boolean; startMoveNum: number } {
  const startsWithWhite = preCorrectFen.split(' ')[1] === 'w';
  const fullmoves = Number.parseInt(preCorrectFen.split(' ')[5] ?? '1', 10);
  const moves: ReviewMove[] = [
    { fenBefore: preCorrectFen, san: correctSan, uci: correctUci },
    ...pvMoves,
  ];

  const pairs: MovePair[] = [];
  if (startsWithWhite) {
    pairs.push({
      moveNumber: fullmoves,
      white: { san: correctSan, key: 'p0', tag: 'CORRECT' },
      black: moves[1] ? { san: moves[1].san, key: 'p1' } : undefined,
    });
    for (let i = 2; i < moves.length; i += 2) {
      pairs.push({
        moveNumber: fullmoves + Math.floor(i / 2),
        white: { san: moves[i].san, key: `p${i}` },
        black: moves[i + 1] ? { san: moves[i + 1].san, key: `p${i + 1}` } : undefined,
      });
    }
  } else {
    pairs.push({
      moveNumber: fullmoves,
      white: undefined,
      black: { san: correctSan, key: 'p0', tag: 'CORRECT' },
    });
    for (let i = 1; i < moves.length; i += 2) {
      pairs.push({
        moveNumber: fullmoves + Math.floor((i + 1) / 2),
        white: { san: moves[i].san, key: `p${i}` },
        black: moves[i + 1] ? { san: moves[i + 1].san, key: `p${i + 1}` } : undefined,
      });
    }
  }
  return { pairs, movesPlusCorrect: moves, startsWithWhite, startMoveNum: fullmoves };
}

export const useTrainingStore = create<TrainingStateShape>((set, get) => ({
  ...makeInitial(),

  reset: () => {
    endActiveSession(get());
    void flushDrillWritesAndRefreshDue();
    // revealBeforeSolve is a user preference, not session state — survive resets.
    set({ ...makeInitial(), revealBeforeSolve: get().revealBeforeSolve });
  },

  beginSession: async (profile) => {
    const tz = profile.timezone ?? detectTimezone();
    const snapshot: StreakSnapshot = {
      currentStreakDays: profile.currentStreakDays,
      longestStreakDays: profile.longestStreakDays,
      lastDrillLocalDate: profile.lastDrillLocalDate,
      timezone: profile.timezone,
    };
    set({ streakSnapshot: snapshot, streakApplied: false });
    try {
      const session = await supabaseService.createTrainingSession({
        localDate: localDate(tz),
      });
      if (session) set({ sessionId: session.id });
    } catch {
      /* session persistence is best-effort */
    }
  },

  setBlunders: (blunders) => {
    if (blunders.length === 0) {
      set({
        ...makeInitial(),
        phase: 'empty',
        contextFilter: get().contextFilter,
        revealBeforeSolve: get().revealBeforeSolve,
      });
      return;
    }
    set({
      blunders,
      currentIndex: 0,
      totalCorrect: 0,
      totalAttempted: 0,
      attemptedBlunderIds: new Set<string>(),
      phase: 'loading',
    });
    void get().loadCurrentBlunder();
  },

  setContextFilter: (filter) => {
    set({ contextFilter: filter });
  },

  setRevealBeforeSolve: (value) => {
    set({ revealBeforeSolve: value });
  },

  /**
   * Lazily fetch the original-blunder refutation for the post-attempt reveal.
   * No-op when it's already loaded (e.g. the review step ran). Leaves the
   * board (fen/shapes) and activeRefutationIndex untouched so the user stays
   * on the post-attempt position until they click into the line.
   */
  ensureBlunderRefutation: async () => {
    const state = get();
    if (state.refutationPairs.length > 0) return;
    const blunder = state.blunders[state.currentIndex];
    if (!blunder) return;
    const blunderId = blunder.id;

    const refutation = await computeOriginalRefutation(
      blunder,
      state.blunderSan,
      state.currentContext,
    );
    if (!refutation) return;

    // The user may have advanced or retried while the engine was thinking.
    const cur = get();
    const curBlunder = cur.blunders[cur.currentIndex];
    if (!curBlunder || curBlunder.id !== blunderId) return;
    if (cur.phase !== 'correct' && cur.phase !== 'incorrect') return;
    set({
      refutationMoves: refutation.movesPlusFirst,
      refutationPairs: refutation.pairs,
    });
  },

  loadCurrentBlunder: async () => {
    const { blunders, currentIndex } = get();
    const blunder = blunders[currentIndex];
    if (!blunder) {
      set({ phase: 'complete' });
      return;
    }

    // Prefetch the next blunder's game so advancing to it is instant (the
    // network fetch is the visible gap in the 'loading' phase).
    const upcoming = blunders[currentIndex + 1];
    const upcomingGameId = upcoming?.gameId ?? null;
    if (upcomingGameId && !gameCache.has(upcomingGameId)) {
      void supabaseService
        .getGame(upcomingGameId)
        .then((g) => gameCache.set(upcomingGameId, g))
        .catch(() => {});
    }

    let game: GameRecord | null = blunder.gameId ? (gameCache.get(blunder.gameId) ?? null) : null;
    if (!game && blunder.gameId) {
      try {
        game = await supabaseService.getGame(blunder.gameId);
        gameCache.set(blunder.gameId, game);
      } catch {
        game = null;
      }
    }

    const blunderSan = sanFromUci(blunder.fen, blunder.playedMove);
    const playerSide: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';
    const currentContext = computeBlunderContext(blunder, game);

    // Multi-move sequence from the stored solution line; legacy rows (no line)
    // fall back to the single stored best move — exactly the one-move drill.
    const drill = computeDrillLine(blunder.fen, blunder.solutionLine, blunder.evalBefore);
    const drillPlies =
      drill.plies.length > 0
        ? drill.plies
        : blunder.correctMoves[0]
          ? [blunder.correctMoves[0].move]
          : [];
    const userMovesRequired = drill.plies.length > 0 ? drill.userMoveCount : 1;
    const sequenceToken = ++nextSequenceToken;
    const isNewBlunder = blunder.cycleNumber === 0 && blunder.timesAttempted === 0;
    const isRetry = blunder.lastDrillFailed;
    const pendingTryAgain = isRetry && !get().interactedBlunderIds.has(blunder.id);

    // Try to pre-play the blunder so we can show the position after the bad move.
    // If the FEN or move can't be parsed (corrupt data, exotic encoding), skip the
    // reviewing step entirely and fall through to solving — never leave phase='loading'.
    // The review step is opt-in (revealBeforeSolve); by default every position is
    // a blind test and the review content is revealed after the attempt.
    let preplay: { afterFen: string; lastMove: [string, string]; from: string; to: string } | null = null;
    if ((isNewBlunder || isRetry) && get().revealBeforeSolve) {
      try {
        const chess = new Chess(blunder.fen);
        const rawM = parseUciMove(blunder.playedMove);
        const stdUci = CASTLING_NORMALIZE[blunder.playedMove] ?? blunder.playedMove;
        const stdM = parseUciMove(stdUci);
        const result = chess.move({ from: stdM.from, to: stdM.to, promotion: stdM.promotion });
        if (result) {
          preplay = {
            afterFen: chess.fen(),
            lastMove: [rawM.from, rawM.to],
            from: rawM.from,
            to: rawM.to,
          };
        }
      } catch (err) {
        console.warn('[training] blunder rejected by preplay validator', {
          id: blunder.id,
          fen: blunder.fen,
          playedMove: blunder.playedMove,
          err,
        });
        preplay = null;
      }
    }

    if (preplay) {
      set({
        phase: 'reviewing',
        fen: preplay.afterFen,
        orientation: playerSide,
        movableFor: null,
        lastMove: preplay.lastMove,
        shapes: [{ orig: preplay.from as any, dest: preplay.to as any, brush: 'red' }],
        blunderSan,
        game,
        currentContext,
        pendingTryAgain,
        drillPlies,
        drillPly: 0,
        userMovesRequired,
        stepFeedback: null,
        sequenceToken,
        playedMovesFromBlunder: [blunder.playedMove],
        refutationMoves: [],
        refutationPairs: [],
        activeRefutationIndex: 0,
        postCorrectMoves: [],
        postCorrectPairs: [],
        activePostCorrectIndex: null,
        incorrectFeedback: null,
        showWhatYouPlayed: false,
        hintLevel: 0,
      });

      const refutation = await computeOriginalRefutation(blunder, blunderSan, currentContext);
      if (refutation) {
        set({
          refutationMoves: refutation.movesPlusFirst,
          refutationPairs: refutation.pairs,
          activeRefutationIndex: 0,
        });
      }
    } else {
      set({
        phase: 'solving',
        fen: blunder.fen,
        orientation: playerSide,
        movableFor: playerSide,
        lastMove: null,
        shapes: [],
        blunderSan,
        game,
        currentContext,
        pendingTryAgain,
        drillPlies,
        drillPly: 0,
        userMovesRequired,
        stepFeedback: null,
        sequenceToken,
        playedMovesFromBlunder: [],
        refutationMoves: [],
        refutationPairs: [],
        activeRefutationIndex: null,
        postCorrectMoves: [],
        postCorrectPairs: [],
        activePostCorrectIndex: null,
        incorrectFeedback: null,
        showWhatYouPlayed: false,
        hintLevel: 0,
      });
    }
  },

  proceedFromReview: () => {
    const { blunders, currentIndex } = get();
    const blunder = blunders[currentIndex];
    if (!blunder) return;
    const playerSide: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';
    set({
      phase: 'solving',
      fen: blunder.fen,
      orientation: playerSide,
      movableFor: playerSide,
      lastMove: null,
      shapes: [],
      drillPly: 0,
      stepFeedback: null,
      playedMovesFromBlunder: [],
      refutationMoves: [],
      refutationPairs: [],
      activeRefutationIndex: null,
      postCorrectMoves: [],
      postCorrectPairs: [],
      activePostCorrectIndex: null,
      incorrectFeedback: null,
      showWhatYouPlayed: false,
      hintLevel: 0,
    });
  },

  processMove: async (move) => {
    const state = get();
    if (state.phase !== 'solving' || state.evaluating) return;
    const blunder = state.blunders[state.currentIndex];
    if (!blunder) return;

    const { drillPlies, drillPly, sequenceToken } = state;
    const isStep0 = drillPly === 0;
    // Position being solved: the blunder FEN with the sequence so far applied.
    const stepFen = isStep0 ? blunder.fen : replayFen(blunder.fen, drillPlies.slice(0, drillPly));
    if (!stepFen) return;
    const isLastStep = drillPly >= drillPlies.length - 1;
    const playerSide: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';

    const uci = moveToUci(move);
    const isRepeatedBlunder = isStep0 && uci === blunder.playedMove;
    const expectedRaw = drillPlies[drillPly] ?? null;
    const expected = expectedRaw ? (CASTLING_NORMALIZE[expectedRaw] ?? expectedRaw) : null;
    const matchesExpected =
      expected !== null && (uci === expected || (CASTLING_NORMALIZE[uci] ?? uci) === expected);
    // Step 0 also accepts every stored alternative first move; later steps
    // demand the line's move (or an engine-approved deviation, below).
    let isCorrect = matchesExpected || (isStep0 && isCorrectMove(blunder, uci));

    // Apply move locally to compute next FEN. chess.js v1 throws on illegal
    // moves; treat any throw as "no-op" and snap the board back to the
    // current FEN (chessground may briefly display the bad piece position
    // after a drag, e.g. from a stale dests/animation race).
    const chess = new Chess(stepFen);
    let result;
    try {
      result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    } catch (err) {
      console.warn('[training] processMove rejected illegal move', {
        fen: stepFen,
        move,
        err,
      });
      set({ fen: state.fen, lastMove: state.lastMove });
      return;
    }
    const newFen = chess.fen();

    set({
      fen: newFen,
      lastMove: [move.from, move.to],
      movableFor: null,
      shapes: [],
      showWhatYouPlayed: false,
    });

    let chancesLost: number | null = null;
    let playedPv: string[] | null = null;
    // An engine-approved deviation from the stored line completes the drill
    // early — its continuation is unknown, so there is nothing left to solve.
    let acceptedDeviation = false;

    // On-the-fly engine verification for non-stored moves. The reference eval
    // works at any step: a PV nominally preserves the root eval, so
    // correctMoves[0].eval is the bar the user's position must stay within.
    if (!isCorrect && blunder.correctMoves.length > 0) {
      set({ evaluating: true });
      try {
        const sf = await getStockfish();
        const ev = await sf.evaluatePositionFull(newFen, 18);
        playedPv = ev.principalVariation;
        const bestEval = blunder.correctMoves[0].eval;
        const bestWinPct = winPercent(bestEval);
        const moveWinPct = winPercent(-ev.scoreCp);
        chancesLost = bestWinPct - moveWinPct;
        if (Math.abs(chancesLost) <= 5) {
          isCorrect = true;
          acceptedDeviation = true;
          // correctMoves are alternative *first* moves — only step-0 finds persist.
          if (isStep0) {
            const newCorrect: CorrectMove = { move: uci, eval: -ev.scoreCp };
            const updated = [...blunder.correctMoves];
            if (!updated.some((cm) => cm.move === uci)) updated.push(newCorrect);
            blunder.correctMoves = updated;
            void supabaseService
              .appendCorrectMove(blunder.id, updated)
              .catch((err) => console.warn('[training] appendCorrectMove failed', err));
          }
        }
      } catch {
        /* engine optional */
      } finally {
        set({ evaluating: false });
      }
    }

    // "Good but not best" — chancesLost in (5, 10). Engine classifies as 'good'
    // but it didn't pass the on-the-fly accept rule (≤5%). Treat as a no-op
    // gentle nudge: show feedback so the user can keep looking, but DON'T touch
    // any SR counters, the cycle, lastDrillFailed, session totals, or Supabase.
    // Also doesn't count as an "attempt" — the next move is still first-attempt.
    if (
      !isCorrect &&
      chancesLost !== null &&
      chancesLost < inaccuracyThresholdPercent
    ) {
      if (!isStep0) {
        // Mid-sequence: snap the board back to the step position and keep
        // solving — the incorrect-phase retry flow would restart the sequence.
        const prevReply = parseUciMove(
          CASTLING_NORMALIZE[drillPlies[drillPly - 1]] ?? drillPlies[drillPly - 1],
        );
        set((s) => ({
          fen: stepFen,
          lastMove: [prevReply.from, prevReply.to],
          movableFor: playerSide,
          shapes: [],
          interactedBlunderIds: new Set(s.interactedBlunderIds).add(blunder.id),
          stepFeedback: 'Good move, but keep looking for the best one',
        }));
        return;
      }
      set((s) => ({
        phase: 'incorrect',
        pendingTryAgain: false,
        interactedBlunderIds: new Set(s.interactedBlunderIds).add(blunder.id),
        shapes: [],
        playedRefutationMoves: [],
        playedRefutationPairs: [],
        activePlayedRefutationIndex: null,
        incorrectRequeue: false,
        incorrectFeedback: {
          message: 'Good move, but keep looking for the best one',
          tone: 'success',
        },
        playedMovesFromBlunder: [uci],
      }));
      return;
    }

    // Correct on an intermediate step: no SR/session writes — auto-play the
    // opponent's reply after a beat and prompt for the next move. An accepted
    // deviation skips this (the stored line no longer applies) and finishes
    // the drill below instead.
    if (isCorrect && !isLastStep && !acceptedDeviation) {
      const playedSoFar = [...drillPlies.slice(0, drillPly), uci];
      set((s) => ({
        shapes: [{ orig: move.from as any, dest: move.to as any, brush: 'green' }],
        interactedBlunderIds: new Set(s.interactedBlunderIds).add(blunder.id),
        pendingTryAgain: false,
        stepFeedback: 'Correct — keep going',
        playedMovesFromBlunder: playedSoFar,
      }));
      setTimeout(() => {
        const cur = get();
        if (cur.sequenceToken !== sequenceToken || cur.phase !== 'solving') return;
        const replyRaw = drillPlies[drillPly + 1];
        const replyFen = replayFen(blunder.fen, drillPlies.slice(0, drillPly + 2));
        if (!replyFen) return;
        const reply = parseUciMove(CASTLING_NORMALIZE[replyRaw] ?? replyRaw);
        set({
          fen: replyFen,
          lastMove: [reply.from, reply.to],
          movableFor: playerSide,
          shapes: [],
          drillPly: drillPly + 2,
          stepFeedback: null,
          hintLevel: 0,
          playedMovesFromBlunder: drillPlies.slice(0, drillPly + 2),
        });
      }, 450);
      return;
    }

    const firstAttemptRecalled = isCorrect;
    const isFirstAttempt = !state.attemptedBlunderIds.has(blunder.id);

    if (isCorrect) {
      applyDrillResult(blunder, { success: true, isFirstAttempt }, { trackWrite: trackDrillWrite });

      const playedSequence = [...drillPlies.slice(0, drillPly), uci];
      set((s) => {
        const nextAttempted = isFirstAttempt
          ? new Set(s.attemptedBlunderIds).add(blunder.id)
          : s.attemptedBlunderIds;
        return {
          phase: 'correct',
          pendingTryAgain: false,
          interactedBlunderIds: new Set(s.interactedBlunderIds).add(blunder.id),
          totalCorrect: isFirstAttempt && firstAttemptRecalled ? s.totalCorrect + 1 : s.totalCorrect,
          totalAttempted: isFirstAttempt ? s.totalAttempted + 1 : s.totalAttempted,
          attemptedBlunderIds: nextAttempted,
          shapes: [{ orig: move.from as any, dest: move.to as any, brush: 'green' }],
          incorrectFeedback: null,
          stepFeedback: null,
          playedMovesFromBlunder: playedSequence,
          // Keep refutationMoves/refutationPairs: the correct phase now shows
          // the original blunder's refutation (already loaded in reveal mode,
          // fetched below otherwise). Reset to the post-attempt board view.
          activeRefutationIndex: null,
          postCorrectMoves: [],
          postCorrectPairs: [],
          activePostCorrectIndex: null,
        };
      });

      const afterCorrect = get();
      if (afterCorrect.sessionId) {
        void supabaseService
          .updateTrainingSession(afterCorrect.sessionId, {
            blundersAttempted: afterCorrect.totalAttempted,
            blundersCorrect: afterCorrect.totalCorrect,
          })
          .catch((err) => console.warn('[training] updateTrainingSession (correct) failed', err));
      }
      if (!afterCorrect.streakApplied && afterCorrect.streakSnapshot) {
        set({ streakApplied: true });
        void applyStreakUpdate(afterCorrect.streakSnapshot);
      }

      // Engine continuation from the post-correct position. The panel's line
      // starts with the sequence the user actually played (one move in the
      // single-move drill) and continues with the engine's PV from its end.
      try {
        const sf = await getStockfish();
        const ev = await sf.evaluatePositionFull(newFen, 18);
        const firstUci = playedSequence[0];
        const firstSan = playedSequence.length === 1 ? result.san : sanFromUci(blunder.fen, firstUci);
        const fenAfterFirst = replayFen(blunder.fen, [firstUci]) ?? newFen;
        const pvMoves = buildLineMoves(fenAfterFirst, [
          ...playedSequence.slice(1),
          ...ev.principalVariation,
        ]);
        const { pairs, movesPlusCorrect, startsWithWhite } = buildPostCorrectPairs(
          blunder.fen,
          firstSan,
          firstUci,
          pvMoves,
        );
        set({
          postCorrectMoves: movesPlusCorrect,
          postCorrectPairs: pairs,
          activePostCorrectIndex: 0,
          postCorrectStartsWithWhite: startsWithWhite,
        });
      } catch {
        /* leave empty */
      }

      // Post-attempt reveal: load the original blunder's refutation (no-op if
      // the review step already fetched it). Sequenced after the continuation
      // eval so the panel the user sees first isn't delayed.
      void get().ensureBlunderRefutation();
    } else {
      applyDrillResult(blunder, { success: false, isFirstAttempt }, { trackWrite: trackDrillWrite });

      let feedback: IncorrectFeedback;
      if (isRepeatedBlunder) {
        feedback = { message: 'This was the move you played in the game', tone: 'danger' };
      } else if (chancesLost !== null) {
        const cl = classify(chancesLost);
        feedback =
          cl === 'blunder'
            ? { message: "That's a blunder", tone: 'danger' }
            : cl === 'mistake'
              ? { message: "That's a mistake", tone: 'warning' }
              : { message: "That's an inaccuracy", tone: 'info' };
      } else {
        feedback = { message: 'Incorrect', tone: 'danger' };
      }

      // Engine refutation of the move the user just played — the PV from the
      // position after their move is exactly why it fails. Anchored at the
      // step position, so a mid-sequence fail shows the right move number.
      const stepMoveNumber = isStep0
        ? blunder.moveNumber
        : Number.parseInt(stepFen.split(' ')[5] ?? '1', 10);
      const playedRefutation =
        playedPv && playedPv.length > 0
          ? buildRefutationPairs({
              fen: stepFen,
              moveNumber: stepMoveNumber,
              sideToMove: blunder.sideToMove,
              firstSan: result.san,
              firstUci: uci,
              tag: (chancesLost !== null ? classify(chancesLost) : 'blunder').toUpperCase(),
              pvMoves: buildLineMoves(newFen, playedPv),
            })
          : null;

      const afterIncorrect = get();
      if (afterIncorrect.sessionId && isFirstAttempt) {
        void supabaseService
          .updateTrainingSession(afterIncorrect.sessionId, {
            blundersAttempted: afterIncorrect.totalAttempted + 1,
            blundersCorrect: afterIncorrect.totalCorrect + (firstAttemptRecalled ? 1 : 0),
          })
          .catch((err) => console.warn('[training] updateTrainingSession (incorrect) failed', err));
      }

      set((s) => {
        const nextAttempted = isFirstAttempt
          ? new Set(s.attemptedBlunderIds).add(blunder.id)
          : s.attemptedBlunderIds;
        return {
          phase: 'incorrect',
          pendingTryAgain: false,
          interactedBlunderIds: new Set(s.interactedBlunderIds).add(blunder.id),
          totalCorrect: isFirstAttempt && firstAttemptRecalled ? s.totalCorrect + 1 : s.totalCorrect,
          totalAttempted: isFirstAttempt ? s.totalAttempted + 1 : s.totalAttempted,
          attemptedBlunderIds: nextAttempted,
          shapes: [],
          incorrectRequeue: true,
          incorrectFeedback: feedback,
          stepFeedback: null,
          playedRefutationMoves: playedRefutation ? playedRefutation.movesPlusFirst : [],
          playedRefutationPairs: playedRefutation ? playedRefutation.pairs : [],
          activePlayedRefutationIndex: playedRefutation ? 0 : null,
          playedMovesFromBlunder: [...drillPlies.slice(0, drillPly), uci],
        };
      });

      // Post-attempt reveal of the original blunder's refutation (no-op when
      // the review step already fetched it).
      void get().ensureBlunderRefutation();
    }
  },

  completeExternalDrill: (opts) => {
    const state = get();
    if (state.phase !== 'solving') return;
    const blunder = state.blunders[state.currentIndex];
    if (!blunder) return;

    const isFirstAttempt = !state.attemptedBlunderIds.has(blunder.id);
    applyDrillResult(
      blunder,
      { success: opts.success, isFirstAttempt },
      { trackWrite: trackDrillWrite },
    );

    set((s) => {
      const nextAttempted = isFirstAttempt
        ? new Set(s.attemptedBlunderIds).add(blunder.id)
        : s.attemptedBlunderIds;
      return {
        phase: opts.success ? 'correct' : 'incorrect',
        pendingTryAgain: false,
        interactedBlunderIds: new Set(s.interactedBlunderIds).add(blunder.id),
        totalCorrect: isFirstAttempt && opts.success ? s.totalCorrect + 1 : s.totalCorrect,
        totalAttempted: isFirstAttempt ? s.totalAttempted + 1 : s.totalAttempted,
        attemptedBlunderIds: nextAttempted,
        shapes: [],
        incorrectRequeue: true,
        incorrectFeedback: opts.success
          ? null
          : (opts.feedback ?? { message: 'Incorrect', tone: 'danger' }),
        stepFeedback: null,
      };
    });

    const after = get();
    if (after.sessionId) {
      void supabaseService
        .updateTrainingSession(after.sessionId, {
          blundersAttempted: after.totalAttempted,
          blundersCorrect: after.totalCorrect,
        })
        .catch((err) => console.warn('[training] updateTrainingSession (external) failed', err));
    }
    if (!after.streakApplied && after.streakSnapshot) {
      set({ streakApplied: true });
      void applyStreakUpdate(after.streakSnapshot);
    }
  },

  markExternalAttempt: () => {
    const state = get();
    if (state.phase !== 'solving') return;
    const blunder = state.blunders[state.currentIndex];
    if (!blunder || state.attemptedBlunderIds.has(blunder.id)) return;
    set((s) => ({
      totalAttempted: s.totalAttempted + 1,
      attemptedBlunderIds: new Set(s.attemptedBlunderIds).add(blunder.id),
    }));
  },

  advance: () => {
    if (get().phase !== 'correct') return;
    set((s) => ({ currentIndex: s.currentIndex + 1, phase: 'loading' }));
    const { currentIndex, blunders } = get();
    if (currentIndex >= blunders.length) {
      set({ phase: 'complete' });
      return;
    }
    void get().loadCurrentBlunder();
  },

  retry: () => {
    if (get().phase !== 'incorrect') return;
    set({ phase: 'loading' });
    void get().loadCurrentBlunder();
  },

  requeueAndAdvance: () => {
    const { phase, blunders, currentIndex } = get();
    if (phase !== 'incorrect') return;
    // Move the just-failed position 3-7 spots later so it returns within the
    // session (Anki-style relearning) rather than an immediate in-place retry.
    const q = [...blunders];
    const [item] = q.splice(currentIndex, 1);
    if (item) {
      const offset = 3 + Math.floor(Math.random() * 5); // 3..7
      q.splice(Math.min(currentIndex + offset, q.length), 0, item);
    }
    set({ blunders: q, phase: 'loading' });
    void get().loadCurrentBlunder();
  },

  deleteCurrent: async () => {
    const { blunders, currentIndex } = get();
    const target = blunders[currentIndex];
    if (!target) return { ok: false, error: 'No position selected.' };

    // Delete the row first and only drop it from the session if it actually
    // went away. A 0-row delete (e.g. blocked by a row-level policy) reports no
    // error in Supabase, so the position used to vanish from the queue yet
    // reappear next session — exactly the "delete doesn't work" symptom.
    let deleted = 0;
    try {
      deleted = await supabaseService.deleteBlunder(target.id);
    } catch (err) {
      console.error('Failed to delete blunder', err);
      return { ok: false, error: err instanceof Error ? err.message : 'Delete failed.' };
    }
    if (deleted === 0) {
      return {
        ok: false,
        error: "That position couldn't be deleted — it may be a permissions issue. Nothing was removed.",
      };
    }

    // Gone for good — refresh derived caches so dashboard/vault counts drop and
    // a future training entry won't replay it.
    queryClient.removeQueries({ queryKey: ['blunders', 'due'] });
    void queryClient.invalidateQueries({ queryKey: ['blunders'], refetchType: 'all' });
    void queryClient.invalidateQueries({ queryKey: ['blunderCounts'], refetchType: 'all' });

    // Drop from the in-session queue. Removing the current item shifts the next
    // one into `currentIndex`, so the index stays put.
    const q = [...get().blunders];
    const idx = get().currentIndex;
    q.splice(idx, 1);
    set({ blunders: q, phase: 'loading' });

    if (get().currentIndex >= get().blunders.length) {
      set({ phase: 'complete' });
      return { ok: true };
    }
    void get().loadCurrentBlunder();
    return { ok: true };
  },

  toggleShowWhatYouPlayed: () => set((s) => {
    const showing = !s.showWhatYouPlayed;
    const otherShapes = s.shapes.filter((sh) => sh.brush !== 'red');
    if (!showing) {
      return { showWhatYouPlayed: false, shapes: otherShapes };
    }
    const b = s.blunders[s.currentIndex];
    const uci = b?.playedMove;
    if (!uci || uci.length < 4) {
      return { showWhatYouPlayed: true };
    }
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const playedShape: DrawShape = { orig: from as any, dest: to as any, brush: 'red' };
    return { showWhatYouPlayed: true, shapes: [...otherShapes, playedShape] };
  }),

  showHint: () => {
    const state = get();
    if (state.phase !== 'solving') return;
    const b = state.blunders[state.currentIndex];
    if (!b) return;
    // Hint the current step's expected move (falls back to the stored best
    // move for legacy single-move rows).
    const uci = state.drillPlies[state.drillPly] ?? b.correctMoves[0]?.move;
    if (!uci) return;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);

    const playedShapes = state.shapes.filter((sh) => sh.brush === 'red');

    if (state.hintLevel === 0) {
      const isFirstAttempt = !state.attemptedBlunderIds.has(b.id);
      set((s) => ({
        hintLevel: 1,
        shapes: [{ orig: from as any, brush: 'blue' }, ...playedShapes],
        ...(isFirstAttempt
          ? {
              totalAttempted: s.totalAttempted + 1,
              attemptedBlunderIds: new Set(s.attemptedBlunderIds).add(b.id),
            }
          : {}),
      }));
    } else if (state.hintLevel === 1) {
      set({
        hintLevel: 2,
        shapes: [{ orig: from as any, dest: to as any, brush: 'blue' }, ...playedShapes],
      });
    }
  },

  selectRefutationIndex: (idx) => {
    const { refutationMoves } = get();
    if (idx < 0 || idx >= refutationMoves.length) return;
    const rm = refutationMoves[idx];
    const chess = new Chess(rm.fenBefore);
    const m = parseUciMove(rm.uci);
    try {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch (err) {
      console.warn('[training] selectRefutationIndex skipped illegal stored move', {
        fenBefore: rm.fenBefore,
        uci: rm.uci,
        err,
      });
      return;
    }
    set({
      fen: chess.fen(),
      lastMove: [m.from, m.to],
      shapes: [{ orig: m.from as any, dest: m.to as any, brush: 'red' }],
      activeRefutationIndex: idx,
      activePlayedRefutationIndex: null,
      activePostCorrectIndex: null,
      playedMovesFromBlunder: refutationMoves.slice(0, idx + 1).map((rm) => rm.uci),
    });
  },

  selectPlayedRefutationIndex: (idx) => {
    const { playedRefutationMoves } = get();
    if (idx < 0 || idx >= playedRefutationMoves.length) return;
    const rm = playedRefutationMoves[idx];
    const chess = new Chess(rm.fenBefore);
    const m = parseUciMove(rm.uci);
    try {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch (err) {
      console.warn('[training] selectPlayedRefutationIndex skipped illegal stored move', {
        fenBefore: rm.fenBefore,
        uci: rm.uci,
        err,
      });
      return;
    }
    set({
      fen: chess.fen(),
      lastMove: [m.from, m.to],
      shapes: [{ orig: m.from as any, dest: m.to as any, brush: 'red' }],
      activePlayedRefutationIndex: idx,
      activeRefutationIndex: null,
      playedMovesFromBlunder: playedRefutationMoves.slice(0, idx + 1).map((rm) => rm.uci),
    });
  },

  selectPostCorrectIndex: (idx) => {
    const { postCorrectMoves, blunders, currentIndex } = get();
    if (idx < -1 || idx >= postCorrectMoves.length) return;
    if (idx === -1) {
      const blunder = blunders[currentIndex];
      if (!blunder) return;
      set({
        fen: blunder.fen,
        lastMove: null,
        shapes: [],
        activePostCorrectIndex: -1,
        activeRefutationIndex: null,
        playedMovesFromBlunder: [],
      });
      return;
    }
    const rm = postCorrectMoves[idx];
    const chess = new Chess(rm.fenBefore);
    const m = parseUciMove(rm.uci);
    try {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch (err) {
      console.warn('[training] selectPostCorrectIndex skipped illegal stored move', {
        fenBefore: rm.fenBefore,
        uci: rm.uci,
        err,
      });
      return;
    }
    set({
      fen: chess.fen(),
      lastMove: [m.from, m.to],
      shapes: [{ orig: m.from as any, dest: m.to as any, brush: 'green' }],
      activePostCorrectIndex: idx,
      activeRefutationIndex: null,
      playedMovesFromBlunder: postCorrectMoves.slice(0, idx + 1).map((rm) => rm.uci),
    });
  },
}));
