import { create } from 'zustand';
import { Chess } from 'chess.js';
import { ParsedPosition, parseGame } from '../services/pgnParserService';
import { GameRecord } from '../models/gameRecord';
import {
  annotationKey,
  GameAnnotation,
  MoveAnnotation,
  MoveGrade,
} from '../models/gameAnnotation';
import { supabaseService } from '../services/supabaseService';
import { fetchMasters, isBookMove } from '../services/openingExplorerService';
import { getStockfish } from '../hooks/useStockfish';
import { winningChancesLost, classify } from '../chess/winningChances';

export type ReviewPhase = 'human' | 'engine';

interface EngineEval {
  before: number;
  after: number;
  bestMove: string;
}

interface ReviewState {
  loading: boolean;
  error: string | null;
  game: GameRecord | null;
  positions: ParsedPosition[];
  currentIndex: number;
  orientation: 'white' | 'black';
  annotations: Record<string, MoveAnnotation>;
  bookMoves: Record<number, boolean>;
  lastBookMoveIndex: number | null;
  phase: ReviewPhase;
  engineEvals: Record<number, EngineEval>;
  evaluating: boolean;
  saveTimer: number | null;

  load: (gameId: string) => Promise<void>;
  setIndex: (i: number) => void;
  prev: () => void;
  next: () => void;
  first: () => void;
  last: () => void;
  flip: () => void;
  setGrade: (grade: MoveGrade | null) => void;
  setText: (text: string) => void;
  prefetchBook: () => Promise<void>;
  setPhase: (phase: ReviewPhase) => void;
  evaluateCurrent: () => Promise<void>;
  reset: () => void;
}

const SAVE_DEBOUNCE_MS = 2000;

function defaultOrientation(game: GameRecord | null): 'white' | 'black' {
  if (!game) return 'white';
  const u = game.username.toLowerCase();
  // We can't know without parsing the PGN, but the player imported the game so default to white.
  return u ? 'white' : 'white';
}

function moveAnnotationsToList(map: Record<string, MoveAnnotation>): MoveAnnotation[] {
  return Object.values(map);
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  loading: false,
  error: null,
  game: null,
  positions: [],
  currentIndex: 0,
  orientation: 'white',
  annotations: {},
  bookMoves: {},
  lastBookMoveIndex: null,
  phase: 'human',
  engineEvals: {},
  evaluating: false,
  saveTimer: null,

  reset: () =>
    set({
      loading: false,
      error: null,
      game: null,
      positions: [],
      currentIndex: 0,
      annotations: {},
      bookMoves: {},
      lastBookMoveIndex: null,
      phase: 'human',
      engineEvals: {},
      evaluating: false,
    }),

  load: async (gameId) => {
    set({ loading: true, error: null });
    try {
      const [game, savedAnnotations] = await Promise.all([
        supabaseService.getGame(gameId),
        supabaseService.getAnnotations(gameId),
      ]);
      const positions = parseGame(game.pgn);
      const annotations: Record<string, MoveAnnotation> = {};
      const list: GameAnnotation['annotations'] = savedAnnotations?.annotations ?? [];
      for (const a of list) {
        annotations[annotationKey(a.moveNumber, a.side)] = a;
      }
      set({
        loading: false,
        game,
        positions,
        currentIndex: 0,
        orientation: defaultOrientation(game),
        annotations,
        bookMoves: {},
        lastBookMoveIndex: null,
        engineEvals: {},
      });
      void get().prefetchBook();
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load game' });
    }
  },

  setIndex: (i) => {
    const { positions } = get();
    const max = Math.max(0, positions.length - 2);
    if (i < 0 || i > max) return;
    set({ currentIndex: i });
  },
  prev: () => set((s) => ({ currentIndex: Math.max(0, s.currentIndex - 1) })),
  next: () =>
    set((s) => ({
      currentIndex: Math.min(Math.max(0, s.positions.length - 2), s.currentIndex + 1),
    })),
  first: () => set({ currentIndex: 0 }),
  last: () => set((s) => ({ currentIndex: Math.max(0, s.positions.length - 2) })),
  flip: () => set((s) => ({ orientation: s.orientation === 'white' ? 'black' : 'white' })),

  setGrade: (grade) => {
    const { positions, currentIndex, annotations, game } = get();
    if (!game) return;
    const pos = positions[currentIndex];
    if (!pos.uciMove || !pos.sanMove) return;
    const key = annotationKey(pos.moveNumber, pos.sideToMove);
    const existing = annotations[key];
    const next: MoveAnnotation = {
      moveNumber: pos.moveNumber,
      side: pos.sideToMove,
      san: pos.sanMove,
      classification: grade,
      text: existing?.text ?? null,
    };
    const newAnnotations = { ...annotations, [key]: next };
    set({ annotations: newAnnotations });
    scheduleSave(set, get, game.id);
  },

  setText: (text) => {
    const { positions, currentIndex, annotations, game } = get();
    if (!game) return;
    const pos = positions[currentIndex];
    if (!pos.uciMove || !pos.sanMove) return;
    const key = annotationKey(pos.moveNumber, pos.sideToMove);
    const existing = annotations[key];
    const next: MoveAnnotation = {
      moveNumber: pos.moveNumber,
      side: pos.sideToMove,
      san: pos.sanMove,
      classification: existing?.classification ?? null,
      text: text.trim() || null,
    };
    const newAnnotations = { ...annotations, [key]: next };
    set({ annotations: newAnnotations });
    scheduleSave(set, get, game.id);
  },

  prefetchBook: async () => {
    const { positions } = get();
    let lastBook: number | null = null;
    for (let i = 0; i < Math.min(positions.length - 1, 22); i++) {
      const pos = positions[i];
      if (!pos.uciMove) break;
      const result = await fetchMasters(pos.fen);
      if (!result) break;
      const inBook = isBookMove(result, pos.uciMove);
      const map = { ...get().bookMoves, [i]: inBook };
      set({ bookMoves: map });
      if (inBook) lastBook = i;
      else {
        set({ lastBookMoveIndex: lastBook });
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    set({ lastBookMoveIndex: lastBook });
  },

  setPhase: (phase) => set({ phase }),

  evaluateCurrent: async () => {
    const { positions, currentIndex, engineEvals } = get();
    if (currentIndex >= positions.length - 1) return;
    if (engineEvals[currentIndex]) return;
    set({ evaluating: true });
    try {
      const sf = await getStockfish();
      const before = await sf.evaluatePositionFull(positions[currentIndex].fen, 16);
      const after = await sf.evaluatePositionFull(positions[currentIndex + 1].fen, 16);
      set({
        engineEvals: {
          ...get().engineEvals,
          [currentIndex]: {
            before: before.scoreCp,
            after: after.scoreCp,
            bestMove: before.bestMove,
          },
        },
      });
    } catch (e) {
      console.error(e);
    } finally {
      set({ evaluating: false });
    }
  },
}));

function scheduleSave(
  set: (s: Partial<ReviewState>) => void,
  get: () => ReviewState,
  gameId: string,
) {
  const existing = get().saveTimer;
  if (existing !== null) window.clearTimeout(existing);
  const handle = window.setTimeout(async () => {
    try {
      await supabaseService.saveAnnotations(gameId, moveAnnotationsToList(get().annotations));
    } catch (e) {
      console.error('Annotation save failed', e);
    } finally {
      set({ saveTimer: null });
    }
  }, SAVE_DEBOUNCE_MS);
  set({ saveTimer: handle });
}

/** Helper for the engine phase: classify the swing given evals. */
export function classifySwing(evalBefore: number, evalAfter: number) {
  const cl = winningChancesLost(evalBefore, evalAfter);
  return { chancesLost: cl, classification: classify(cl) };
}

void Chess; // ensure side-effect import
