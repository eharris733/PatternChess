import { create } from 'zustand';
import type { DrawShape } from 'chessground/draw';
import { parseUciMove, toKey } from '../chess/moveUtils';
import { BAD_MOVE_NAGS, type LearnChapter, type LearnNode } from '../models/learn';

/**
 * "Drill the line" for a /learn chapter: the user plays the chapter's
 * orientation side from the start position, the opponent auto-plays the main
 * line. Accepted: the main-line move, or any sideline the author didn't mark
 * ? / ?? / ?! (then we note the main move). A wrong move snaps back with a red
 * arrow; the second miss at the same position shows the main move as a hint.
 * No SR — progress is a localStorage "completed" flag per chapter.
 */

export type LearnDrillPhase = 'idle' | 'yourMove' | 'opponent' | 'done';

const OPPONENT_DELAY_MS = 450;

function arrow(uci: string, brush: string): DrawShape {
  const m = parseUciMove(uci);
  return { orig: toKey(m.from), dest: toKey(m.to), brush };
}

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

interface LearnDrillState {
  chapter: LearnChapter | null;
  /** Moves played so far along the tree. */
  path: LearnNode[];
  phase: LearnDrillPhase;
  missesHere: number;
  totalMisses: number;
  shapes: DrawShape[];
  message: string | null;
  start: (chapter: LearnChapter) => void;
  reset: () => void;
  play: (uci: string) => void;
}

let opponentTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer() {
  if (opponentTimer) clearTimeout(opponentTimer);
  opponentTimer = null;
}

export function drillFen(s: Pick<LearnDrillState, 'chapter' | 'path'>): string {
  return s.path.at(-1)?.fen ?? s.chapter?.startFen ?? '';
}

function childrenAt(s: Pick<LearnDrillState, 'chapter' | 'path'>): LearnNode[] {
  return s.path.at(-1)?.children ?? s.chapter?.moves ?? [];
}

export const useLearnDrillStore = create<LearnDrillState>((set, get) => {
  /** After a move lands: finish, wait for the user, or schedule the reply. */
  const advance = () => {
    const s = get();
    if (!s.chapter) return;
    const next = childrenAt(s);
    if (next.length === 0) {
      set({ phase: 'done', shapes: [] });
      return;
    }
    if (sideToMove(drillFen(s)) === s.chapter.orientation) {
      set({ phase: 'yourMove', missesHere: 0 });
      return;
    }
    set({ phase: 'opponent' });
    clearTimer();
    opponentTimer = setTimeout(() => {
      opponentTimer = null;
      const cur = get();
      if (cur.phase !== 'opponent') return;
      set({ path: [...cur.path, childrenAt(cur)[0]], shapes: [] });
      advance();
    }, OPPONENT_DELAY_MS);
  };

  return {
    chapter: null,
    path: [],
    phase: 'idle',
    missesHere: 0,
    totalMisses: 0,
    shapes: [],
    message: null,

    start: (chapter) => {
      clearTimer();
      set({
        chapter,
        path: [],
        phase: 'idle',
        missesHere: 0,
        totalMisses: 0,
        shapes: [],
        message: null,
      });
      advance();
    },

    reset: () => {
      clearTimer();
      set({ chapter: null, path: [], phase: 'idle', shapes: [], message: null });
    },

    play: (uci) => {
      const s = get();
      if (s.phase !== 'yourMove') return;
      const options = childrenAt(s);
      const main = options[0];
      const hit = options.find((n) => n.uci === uci);
      const acceptable =
        hit && (hit === main || !(hit.nags ?? []).some((n) => BAD_MOVE_NAGS.has(n)));

      if (!hit || !acceptable) {
        const misses = s.missesHere + 1;
        set({
          missesHere: misses,
          totalMisses: s.totalMisses + 1,
          // Always a fresh array: re-sets the board so the wrong move snaps back.
          shapes: [arrow(uci, 'red'), ...(misses >= 2 && main ? [arrow(main.uci, 'green')] : [])],
          message: hit?.comment
            ? hit.comment
            : misses >= 2
              ? `Try ${main?.san}.`
              : 'Not the move the study recommends. Try again.',
        });
        return;
      }

      set({
        path: [...s.path, hit],
        shapes: hit.shapes ?? [],
        message:
          hit === main
            ? (hit.comment ?? null)
            : `Also good. The study's main move is ${main.san}.${hit.comment ? ` ${hit.comment}` : ''}`,
      });
      advance();
    },
  };
});

const DONE_KEY = (slug: string) => `pc.learn.done.${slug}`;

export function completedChapters(slug: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY(slug)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markChapterCompleted(slug: string, chapterId: string): void {
  try {
    const done = completedChapters(slug);
    done.add(chapterId);
    localStorage.setItem(DONE_KEY(slug), JSON.stringify([...done]));
  } catch {
    /* storage unavailable — progress is a convenience only */
  }
}
