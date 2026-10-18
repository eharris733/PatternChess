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
 * A sideline the author left unmarked but gave no continuation is a "good
 * move, find the main one" nudge: retry in place, not counted as a miss.
 *
 * Explanations are beats: the chapter intro, a comment on an opponent move,
 * or a comment on the learner's correct move pause in phase `explain` until
 * `next()` (the Continue button), so the text is read before play goes on.
 * No SR — progress is a localStorage "completed" flag per chapter.
 */

export type LearnDrillPhase = 'idle' | 'explain' | 'yourMove' | 'opponent' | 'done';

/**
 * Interactive moments along a chapter's main line: the intro, every learner
 * move, and every commented opponent move. `momentsDone` counts the same way.
 */
export function countMoments(chapter: LearnChapter): number {
  let n = chapter.intro ? 1 : 0;
  let nodes = chapter.moves;
  let fen = chapter.startFen;
  while (nodes.length > 0) {
    const main = nodes[0];
    if (sideToMove(fen) === chapter.orientation || main.comment) n++;
    fen = main.fen;
    nodes = main.children;
  }
  return n;
}

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
  /** Source-video timestamp (seconds) of the moment `message` explains. */
  messageTs: number | null;
  /** Moments completed so far (see countMoments). */
  momentsDone: number;
  start: (chapter: LearnChapter) => void;
  reset: () => void;
  play: (uci: string) => void;
  /** Leave an `explain` beat. */
  next: () => void;
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
      const reply = childrenAt(cur)[0];
      if (reply.comment) {
        // A beat: show the author's note on the opponent's move and wait.
        set({
          path: [...cur.path, reply],
          shapes: reply.shapes ?? [],
          message: reply.comment,
          messageTs: reply.ts ?? null,
          phase: 'explain',
        });
        return;
      }
      set({ path: [...cur.path, reply], shapes: [] });
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
    messageTs: null,
    momentsDone: 0,

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
        messageTs: null,
        momentsDone: 0,
      });
      if (chapter.intro) {
        set({
          phase: 'explain',
          message: chapter.intro,
          messageTs: chapter.introTs ?? null,
          shapes: chapter.introShapes ?? [],
        });
        return;
      }
      advance();
    },

    reset: () => {
      clearTimer();
      set({ chapter: null, path: [], phase: 'idle', shapes: [], message: null, messageTs: null, momentsDone: 0 });
    },

    next: () => {
      const s = get();
      if (s.phase !== 'explain') return;
      // Intro and opponent beats are moments of their own; the note after
      // the learner's move was already counted with the move.
      const last = s.path.at(-1);
      const learnerNote = last != null && sideToMove(drillFen(s)) !== s.chapter?.orientation;
      set({ momentsDone: s.momentsDone + (learnerNote ? 0 : 1) });
      advance();
    },

    play: (uci) => {
      const s = get();
      if (s.phase !== 'yourMove') return;
      const options = childrenAt(s);
      const main = options[0];
      const hit = options.find((n) => n.uci === uci);
      const acceptable =
        hit && (hit === main || !(hit.nags ?? []).some((n) => BAD_MOVE_NAGS.has(n)));

      if (hit && acceptable && hit !== main && hit.children.length === 0) {
        // Sound, but the author only commented on it: find the main move.
        set({
          shapes: [],
          message: `${hit.comment ? `${hit.comment} ` : ''}Good move. Now find the main move.`,
          messageTs: hit.ts ?? null,
        });
        return;
      }

      if (!hit || !acceptable) {
        const misses = s.missesHere + 1;
        set({
          missesHere: misses,
          totalMisses: s.totalMisses + 1,
          // Always a fresh array: re-sets the board so the wrong move snaps back.
          shapes: [arrow(uci, 'red'), ...(misses >= 2 && main ? [arrow(main.uci, 'green')] : [])],
          message: hit?.comment
            ? `${hit.comment}${misses >= 2 ? ` Try ${main?.san}.` : ''}`
            : misses >= 2
              ? `Try ${main?.san}.`
              : 'Not the move the study recommends. Try again.',
          messageTs: hit?.ts ?? null,
        });
        return;
      }

      const message =
        hit === main
          ? (hit.comment ?? null)
          : `Also good. The study's main move is ${main.san}.${hit.comment ? ` ${hit.comment}` : ''}`;
      set({
        path: [...s.path, hit],
        shapes: hit.shapes ?? [],
        message,
        messageTs: hit.ts ?? null,
        momentsDone: s.momentsDone + 1,
      });
      // A note on the learner's move is read before the reply comes in.
      if (hit.comment && hit.children.length > 0) {
        set({ phase: 'explain' });
        return;
      }
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
