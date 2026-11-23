// The video, second by second: a pure schedule of what the frame shows at time
// t plus the sound cues. render.ts paints frameAt(t) and mixes cues(); keep all
// timing decisions here so tests can pin them.
//
//   0.0–1.0  hook: board + two lines of text (shown from the very first frame)
//   1.0–6.0  5-second countdown, "Comment your move"
//   6.0–7.9  "What I played": red arrow, the move, "??"
//   7.9–…    "The winning move": the line plays out with green arrows
//   last 2s  back to the start position + the PatternChess line (loops cleanly)
import { Chess } from 'chess.js';
import { sideLabel, type Ply, type Puzzle } from './puzzle.ts';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const HOOK_END = 1.0;
export const COUNTDOWN_SECONDS = 5;
const COUNTDOWN_END = HOOK_END + COUNTDOWN_SECONDS;
const PLAYED_ARROW = 0.6;
const SLIDE = 0.22;
const PLAYED_HOLD = 1.1;
const REVEAL_ARROW = 0.55;
const PLY_STEP = 0.8;
const REVEAL_HOLD = 1.3;
const END_CARD = 2.0;

export type Stage = 'hook' | 'countdown' | 'played' | 'reveal' | 'end';
export type Tone = 'neutral' | 'bad' | 'good';

export interface Arrow {
  from: string;
  to: string;
  color: string;
}

export const COLORS = {
  ink: '#1a1a1a',
  paper: '#f4f4f0',
  muted: '#aaaaa2',
  gold: '#C49B2A',
  goldDark: '#8B6914',
  good: '#2E9E3A',
  bad: '#D23A2F',
};

export interface Frame {
  stage: Stage;
  /** Position drawn (for a slide: the position *before* the move, minus the moving piece). */
  fen: string;
  lastMove: [string, string] | null;
  arrow: Arrow | null;
  /** A piece mid-move: draw it at from→to, `progress` 0..1. */
  slide: { from: string; to: string; fenAfter: string; progress: number } | null;
  /** Countdown seconds left (5..1) and how far through the current second (0..1). */
  countdown: { left: number; fraction: number } | null;
  /** Short label on the status row ("Black to move", "What I played", …). */
  status: { text: string; tone: Tone };
  /** "??" / "!!" on a square. */
  badge: { square: string; text: string; tone: Tone } | null;
  /** True on the last two seconds: the PatternChess line replaces the hook. */
  endCard: boolean;
}

export type CueKind = 'tick' | 'tickLast' | 'move' | 'capture' | 'buzz' | 'chime';
export interface Cue {
  t: number;
  kind: CueKind;
}

interface Segment {
  start: number;
  end: number;
  frame: Omit<Frame, 'slide'>;
  slide?: { from: string; to: string; fenAfter: string };
}

function plySegments(start: number, ply: Ply, fenBefore: string, base: Omit<Frame, 'slide' | 'fen' | 'lastMove'>, hold: number): Segment[] {
  return [
    {
      start,
      end: start + SLIDE,
      frame: { ...base, fen: fenBefore, lastMove: null },
      slide: { from: ply.from, to: ply.to, fenAfter: ply.fen },
    },
    { start: start + SLIDE, end: start + SLIDE + hold, frame: { ...base, fen: ply.fen, lastMove: [ply.from, ply.to] } },
  ];
}

export interface Schedule {
  duration: number;
  segments: Segment[];
  cues: Cue[];
}

export function schedule(p: Puzzle): Schedule {
  const toMove = `${sideLabel(p.side)} to move`;
  const segs: Segment[] = [];
  const cues: Cue[] = [];
  const still = (start: number, end: number, f: Partial<Frame> & Pick<Frame, 'stage' | 'status'>) =>
    segs.push({
      start,
      end,
      frame: { fen: p.fen, lastMove: null, arrow: null, countdown: null, badge: null, endCard: false, ...f },
    });

  still(0, HOOK_END, { stage: 'hook', status: { text: toMove, tone: 'neutral' } });
  for (let i = 0; i < COUNTDOWN_SECONDS; i++) {
    const s = HOOK_END + i;
    still(s, s + 1, {
      stage: 'countdown',
      status: { text: toMove, tone: 'neutral' },
      countdown: { left: COUNTDOWN_SECONDS - i, fraction: 0 },
    });
    cues.push({ t: s, kind: i === COUNTDOWN_SECONDS - 1 ? 'tickLast' : 'tick' });
  }

  // What I played.
  let t = COUNTDOWN_END;
  const playedStatus = { text: `What I played: ${p.played.san}`, tone: 'bad' as Tone };
  const redArrow = { from: p.played.from, to: p.played.to, color: COLORS.bad };
  still(t, t + PLAYED_ARROW, { stage: 'played', status: playedStatus, arrow: redArrow });
  t += PLAYED_ARROW;
  segs.push(
    ...plySegments(t, p.played, p.fen, {
      stage: 'played',
      status: playedStatus,
      arrow: null,
      countdown: null,
      badge: { square: p.played.to, text: '??', tone: 'bad' },
      endCard: false,
    }, PLAYED_HOLD),
  );
  cues.push({ t, kind: p.played.capture ? 'capture' : 'move' }, { t: t + SLIDE, kind: 'buzz' });
  t += SLIDE + PLAYED_HOLD;

  // The winning line.
  const revealLabel = p.motifLabel ? `The winning move · ${p.motifLabel}` : 'The winning move';
  const good = { text: revealLabel, tone: 'good' as Tone };
  const first = p.solution[0];
  still(t, t + REVEAL_ARROW, { stage: 'reveal', status: good, arrow: { from: first.from, to: first.to, color: COLORS.good } });
  cues.push({ t, kind: 'chime' });
  t += REVEAL_ARROW;
  let fen = p.fen;
  p.solution.forEach((ply, i) => {
    const last = i === p.solution.length - 1;
    const userMove = i % 2 === 0;
    const hold = last ? REVEAL_HOLD : PLY_STEP - SLIDE;
    segs.push(
      ...plySegments(t, ply, fen, {
        stage: 'reveal',
        status: good,
        arrow: null,
        countdown: null,
        badge:
          last && new Chess(ply.fen).isCheckmate()
            ? { square: ply.to, text: '#', tone: 'good' }
            : userMove && i === 0
              ? { square: ply.to, text: '!!', tone: 'good' }
              : null,
        endCard: false,
      }, hold),
    );
    cues.push({ t, kind: ply.capture ? 'capture' : 'move' });
    fen = ply.fen;
    t += SLIDE + hold;
  });

  // End card on the start position, so the loop back to frame 0 is seamless.
  still(t, t + END_CARD, { stage: 'end', status: { text: toMove, tone: 'neutral' }, endCard: true });
  t += END_CARD;

  return { duration: t, segments: segs, cues };
}

/** What the frame at time t (seconds) shows. */
export function frameAt(s: Schedule, t: number): Frame {
  const seg = s.segments.find((x) => t >= x.start && t < x.end) ?? s.segments[s.segments.length - 1];
  const progress = Math.min(1, Math.max(0, (t - seg.start) / (seg.end - seg.start)));
  const frame: Frame = { ...seg.frame, slide: seg.slide ? { ...seg.slide, progress: easeInOut(progress) } : null };
  if (frame.countdown) frame.countdown = { ...frame.countdown, fraction: progress };
  return frame;
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

export function frameCount(s: Schedule): number {
  return Math.round(s.duration * FPS);
}
