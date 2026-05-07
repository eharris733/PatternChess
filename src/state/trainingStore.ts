import { create } from 'zustand';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { Blunder, CorrectMove, isCorrectMove, nextDrillDate } from '../models/blunder';
import { GameRecord } from '../models/gameRecord';
import { supabaseService } from '../services/supabaseService';
import { getStockfish } from '../hooks/useStockfish';
import {
  classify,
  inaccuracyThresholdPercent,
  winPercent,
  winningChancesLost,
} from '../chess/winningChances';
import { moveToUci, parseUciMove } from '../chess/moveUtils';
import type { MovePair } from '../components/MoveSequencePanel';

export type TrainingPhase =
  | 'loading'
  | 'reviewing'
  | 'solving'
  | 'correct'
  | 'incorrect'
  | 'complete'
  | 'empty';

interface ReviewMove {
  fenBefore: string;
  san: string;
  uci: string;
}

export interface IncorrectFeedback {
  message: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
}

export interface TrainingStateShape {
  phase: TrainingPhase;
  blunders: Blunder[];
  currentIndex: number;
  currentCycle: number;
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
  postCorrectMoves: ReviewMove[];
  postCorrectPairs: MovePair[];
  activePostCorrectIndex: number | null;
  postCorrectStartsWithWhite: boolean;
  incorrectFeedback: IncorrectFeedback | null;
  evaluating: boolean;
  game: GameRecord | null;
  showWhatYouPlayed: boolean;

  loadBlunders: (input: { gameIds?: string[]; userId?: string }) => Promise<void>;
  loadCurrentBlunder: () => Promise<void>;
  proceedFromReview: () => void;
  processMove: (move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }) => Promise<void>;
  advance: () => void;
  retry: () => void;
  toggleShowWhatYouPlayed: () => void;
  showHint: () => void;
  selectRefutationIndex: (idx: number) => void;
  selectPostCorrectIndex: (idx: number) => void;
  reset: () => void;
}

type InitialShape = Omit<TrainingStateShape,
  | 'loadBlunders'
  | 'loadCurrentBlunder'
  | 'proceedFromReview'
  | 'processMove'
  | 'advance'
  | 'retry'
  | 'toggleShowWhatYouPlayed'
  | 'showHint'
  | 'selectRefutationIndex'
  | 'selectPostCorrectIndex'
  | 'reset'>;

function makeInitial(): InitialShape {
  return {
    phase: 'loading',
    blunders: [],
    currentIndex: 0,
    currentCycle: 0,
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
    postCorrectMoves: [],
    postCorrectPairs: [],
    activePostCorrectIndex: null,
    postCorrectStartsWithWhite: true,
    incorrectFeedback: null,
    evaluating: false,
    game: null,
    showWhatYouPlayed: false,
  };
}

const gameCache = new Map<string, GameRecord>();

function sanFromUci(fen: string, uci: string): string {
  const chess = new Chess(fen);
  const m = parseUciMove(uci);
  const result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  return result?.san ?? uci;
}

function classifyShortLabel(b: Blunder): 'Blunder' | 'Mistake' | 'Inaccuracy' {
  const cl = winningChancesLost(b.evalBefore, b.evalAfter);
  const c = classify(cl);
  if (c === 'blunder') return 'Blunder';
  if (c === 'inaccuracy') return 'Inaccuracy';
  return 'Mistake';
}

function buildLineMoves(initialFen: string, uciList: string[]): ReviewMove[] {
  const out: ReviewMove[] = [];
  const chess = new Chess(initialFen);
  for (const uci of uciList) {
    const m = parseUciMove(uci);
    const fenBefore = chess.fen();
    const result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    if (!result) break;
    out.push({ fenBefore, san: result.san, uci });
  }
  return out;
}

function buildRefutationPairs(
  blunder: Blunder,
  blunderSan: string,
  pvMoves: ReviewMove[],
): { pairs: MovePair[]; movesPlusBlunder: ReviewMove[] } {
  const moves: ReviewMove[] = [
    { fenBefore: blunder.fen, san: blunderSan, uci: blunder.playedMove },
    ...pvMoves,
  ];
  const startMoveNum = blunder.moveNumber;
  const blunderIsWhite = blunder.sideToMove === 'white';
  const grade = classifyShortLabel(blunder);
  const tag = grade.toUpperCase();

  const pairs: MovePair[] = [];
  if (blunderIsWhite) {
    pairs.push({
      moveNumber: startMoveNum,
      white: { san: blunderSan, key: 'r0', tag },
      black: moves[1] ? { san: moves[1].san, key: 'r1' } : undefined,
    });
    for (let i = 2; i < moves.length; i += 2) {
      pairs.push({
        moveNumber: startMoveNum + Math.floor(i / 2),
        white: { san: moves[i].san, key: `r${i}` },
        black: moves[i + 1] ? { san: moves[i + 1].san, key: `r${i + 1}` } : undefined,
      });
    }
  } else {
    pairs.push({
      moveNumber: startMoveNum,
      white: undefined,
      black: { san: blunderSan, key: 'r0', tag },
    });
    for (let i = 1; i < moves.length; i += 2) {
      pairs.push({
        moveNumber: startMoveNum + Math.floor((i + 1) / 2),
        white: { san: moves[i].san, key: `r${i}` },
        black: moves[i + 1] ? { san: moves[i + 1].san, key: `r${i + 1}` } : undefined,
      });
    }
  }
  return { pairs, movesPlusBlunder: moves };
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

  reset: () => set(makeInitial()),

  loadBlunders: async ({ gameIds, userId }) => {
    set({ phase: 'loading', totalCorrect: 0, totalAttempted: 0, attemptedBlunderIds: new Set<string>() });
    try {
      const blunders =
        gameIds && gameIds.length > 0
          ? await supabaseService.getBlundersForGames(gameIds)
          : await supabaseService.getDueBlunders({ userId });
      if (blunders.length === 0) {
        set({ ...makeInitial(), phase: 'empty' });
        return;
      }
      set({ blunders, currentIndex: 0 });
      await get().loadCurrentBlunder();
    } catch (e) {
      console.error(e);
      set({ phase: 'empty' });
    }
  },

  loadCurrentBlunder: async () => {
    const { blunders, currentIndex } = get();
    const blunder = blunders[currentIndex];
    if (!blunder) {
      set({ phase: 'complete' });
      return;
    }

    let game: GameRecord | null = gameCache.get(blunder.gameId) ?? null;
    if (!game) {
      try {
        game = await supabaseService.getGame(blunder.gameId);
        gameCache.set(blunder.gameId, game);
      } catch {
        game = null;
      }
    }

    const blunderSan = sanFromUci(blunder.fen, blunder.playedMove);
    const playerSide: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';

    if (blunder.cycleNumber === 0 && blunder.timesAttempted === 0) {
      // First-time review: pre-play the blunder, then fetch refutation PV
      const chess = new Chess(blunder.fen);
      const m = parseUciMove(blunder.playedMove);
      let lastMove: [string, string] | null = null;
      if (chess.move({ from: m.from, to: m.to, promotion: m.promotion })) {
        lastMove = [m.from, m.to];
      }
      const afterBlunderFen = chess.fen();

      set({
        phase: 'reviewing',
        fen: afterBlunderFen,
        orientation: playerSide,
        movableFor: null,
        lastMove,
        shapes: [{ orig: m.from as any, dest: m.to as any, brush: 'red' }],
        blunderSan,
        game,
        refutationMoves: [],
        refutationPairs: [],
        activeRefutationIndex: 0,
        postCorrectMoves: [],
        postCorrectPairs: [],
        activePostCorrectIndex: null,
        incorrectFeedback: null,
        showWhatYouPlayed: false,
      });

      try {
        const sf = await getStockfish();
        const result = await sf.evaluatePositionFull(afterBlunderFen, 18);
        const pvMoves = buildLineMoves(afterBlunderFen, result.principalVariation);
        const { pairs, movesPlusBlunder } = buildRefutationPairs(blunder, blunderSan, pvMoves);
        set({
          refutationMoves: movesPlusBlunder,
          refutationPairs: pairs,
          activeRefutationIndex: 0,
        });
      } catch {
        /* engine optional during review */
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
        refutationMoves: [],
        refutationPairs: [],
        activeRefutationIndex: null,
        postCorrectMoves: [],
        postCorrectPairs: [],
        activePostCorrectIndex: null,
        incorrectFeedback: null,
        showWhatYouPlayed: false,
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
      refutationMoves: [],
      refutationPairs: [],
      activeRefutationIndex: null,
      postCorrectMoves: [],
      postCorrectPairs: [],
      activePostCorrectIndex: null,
      incorrectFeedback: null,
      showWhatYouPlayed: false,
    });
  },

  processMove: async (move) => {
    const state = get();
    if (state.phase !== 'solving' || state.evaluating) return;
    const blunder = state.blunders[state.currentIndex];
    if (!blunder) return;

    const uci = moveToUci(move);
    const isRepeatedBlunder = uci === blunder.playedMove;
    let isCorrect = isCorrectMove(blunder, uci);

    // Apply move locally to compute next FEN
    const chess = new Chess(blunder.fen);
    const result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!result) return;
    const newFen = chess.fen();

    set({
      fen: newFen,
      lastMove: [move.from, move.to],
      movableFor: null,
    });

    let chancesLost: number | null = null;

    // On-the-fly engine verification for non-stored moves
    if (!isCorrect && blunder.correctMoves.length > 0) {
      set({ evaluating: true });
      try {
        const sf = await getStockfish();
        const ev = await sf.evaluatePositionFull(newFen, 18);
        const bestEval = blunder.correctMoves[0].eval;
        const bestWinPct = winPercent(bestEval);
        const moveWinPct = winPercent(-ev.scoreCp);
        chancesLost = bestWinPct - moveWinPct;
        if (Math.abs(chancesLost) <= 5) {
          isCorrect = true;
          const newCorrect: CorrectMove = { move: uci, eval: -ev.scoreCp };
          const updated = [...blunder.correctMoves];
          if (!updated.some((cm) => cm.move === uci)) updated.push(newCorrect);
          blunder.correctMoves = updated;
          void supabaseService.appendCorrectMove(blunder.id, updated).catch(() => {});
        }
      } catch {
        /* engine optional */
      } finally {
        set({ evaluating: false });
      }
    }

    const firstAttemptRecalled =
      isCorrect ||
      (chancesLost !== null && chancesLost < inaccuracyThresholdPercent);
    const isFirstAttempt = !state.attemptedBlunderIds.has(blunder.id);

    if (isCorrect) {
      blunder.timesCorrect++;
      blunder.timesAttempted++;
      blunder.lastDrilledAt = new Date();
      void supabaseService.updateBlunderAfterDrill(blunder).catch(() => {});

      set((s) => {
        const nextAttempted = isFirstAttempt
          ? new Set(s.attemptedBlunderIds).add(blunder.id)
          : s.attemptedBlunderIds;
        return {
          phase: 'correct',
          totalCorrect: isFirstAttempt && firstAttemptRecalled ? s.totalCorrect + 1 : s.totalCorrect,
          totalAttempted: isFirstAttempt ? s.totalAttempted + 1 : s.totalAttempted,
          attemptedBlunderIds: nextAttempted,
          shapes: [{ orig: move.from as any, dest: move.to as any, brush: 'green' }],
          incorrectFeedback: null,
          refutationMoves: [],
          refutationPairs: [],
          activeRefutationIndex: null,
          postCorrectMoves: [],
          postCorrectPairs: [],
          activePostCorrectIndex: null,
        };
      });

      // Engine continuation from the post-correct position
      const correctSan = result.san;
      try {
        const sf = await getStockfish();
        const ev = await sf.evaluatePositionFull(newFen, 18);
        const pvMoves = buildLineMoves(newFen, ev.principalVariation);
        const { pairs, movesPlusCorrect, startsWithWhite } = buildPostCorrectPairs(
          blunder.fen,
          correctSan,
          uci,
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
    } else {
      blunder.timesAttempted++;
      void supabaseService.updateBlunderAfterDrill(blunder).catch(() => {});

      let feedback: IncorrectFeedback;
      if (isRepeatedBlunder) {
        feedback = { message: 'This was the move you played in the game', tone: 'danger' };
      } else if (chancesLost !== null) {
        const cl = classify(chancesLost);
        feedback =
          cl === 'blunder'
            ? { message: "That's a blunder, try again", tone: 'danger' }
            : cl === 'mistake'
              ? { message: "That's a mistake, try again", tone: 'warning' }
              : cl === 'inaccuracy'
                ? { message: "That's an inaccuracy, try again", tone: 'info' }
                : { message: 'Good move, but keep looking for the best one', tone: 'success' };
      } else {
        feedback = { message: 'Incorrect, try again', tone: 'danger' };
      }

      set((s) => {
        const nextAttempted = isFirstAttempt
          ? new Set(s.attemptedBlunderIds).add(blunder.id)
          : s.attemptedBlunderIds;
        return {
          phase: 'incorrect',
          totalCorrect: isFirstAttempt && firstAttemptRecalled ? s.totalCorrect + 1 : s.totalCorrect,
          totalAttempted: isFirstAttempt ? s.totalAttempted + 1 : s.totalAttempted,
          attemptedBlunderIds: nextAttempted,
          shapes: [],
          incorrectFeedback: feedback,
        };
      });
    }
  },

  advance: () => {
    set((s) => ({ currentIndex: s.currentIndex + 1 }));
    const { currentIndex, blunders } = get();
    if (currentIndex >= blunders.length) {
      set({ phase: 'complete' });
      return;
    }
    void get().loadCurrentBlunder();
  },

  retry: () => {
    void get().loadCurrentBlunder();
  },

  toggleShowWhatYouPlayed: () => set((s) => ({ showWhatYouPlayed: !s.showWhatYouPlayed })),

  showHint: () => {
    const state = get();
    const b = state.blunders[state.currentIndex];
    if (!b || b.correctMoves.length === 0) return;
    const uci = b.correctMoves[0].move;
    set({
      shapes: [{ orig: uci.slice(0, 2) as any, dest: uci.slice(2, 4) as any, brush: 'green' }],
    });
  },

  selectRefutationIndex: (idx) => {
    const { refutationMoves } = get();
    if (idx < 0 || idx >= refutationMoves.length) return;
    const rm = refutationMoves[idx];
    const chess = new Chess(rm.fenBefore);
    const m = parseUciMove(rm.uci);
    const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    if (!r) return;
    set({
      fen: chess.fen(),
      lastMove: [m.from, m.to],
      shapes: [{ orig: m.from as any, dest: m.to as any, brush: 'red' }],
      activeRefutationIndex: idx,
      activePostCorrectIndex: null,
    });
  },

  selectPostCorrectIndex: (idx) => {
    const { postCorrectMoves } = get();
    if (idx < 0 || idx >= postCorrectMoves.length) return;
    const rm = postCorrectMoves[idx];
    const chess = new Chess(rm.fenBefore);
    const m = parseUciMove(rm.uci);
    const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    if (!r) return;
    set({
      fen: chess.fen(),
      lastMove: [m.from, m.to],
      shapes: [{ orig: m.from as any, dest: m.to as any, brush: 'green' }],
      activePostCorrectIndex: idx,
      activeRefutationIndex: null,
    });
  },
}));

void nextDrillDate;
