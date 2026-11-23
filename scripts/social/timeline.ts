// The video, second by second: a pure schedule of what the frame shows at time
// t, the sound cues, where each voiceover beat starts, and the captions.
// render.ts paints frameAt(t) and mixes the cues + voice; keep every timing
// decision here so tests can pin them.
//
//   hook        board + headline from the first frame; the narrator's hook
//   countdown   5 seconds, "Comment your move" (the challenge line plays over it)
//   played      red arrow, the move, "??" (blunder: what I played; fall: what most people play)
//   refutation  fall only: the opponent's punishment, move by move
//   reveal      back to the start, green arrow, the right line
//   end         start position + the PatternChess line (loops cleanly into frame 0)
//
// Each scene lasts as long as its animation or its narration, whichever is longer.
import { Chess } from 'chess.js';
import { sideLabel, type Ply, type Puzzle } from './puzzle.ts';
import type { BeatId } from './script.ts';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const HOOK_MIN = 1.0;
export const COUNTDOWN_SECONDS = 5;
const PLAYED_ARROW = 0.6;
const SLIDE = 0.22;
const PLAYED_HOLD = 1.1;
const RESET = 0.45;
const REVEAL_ARROW = 0.55;
const PLY_STEP = 0.85;
const REVEAL_HOLD = 1.3;
const END_CARD = 2.0;
/** Silence after a beat's narration before the scene moves on. */
const TAIL = 0.3;

export type Stage = 'hook' | 'countdown' | 'played' | 'refutation' | 'reveal' | 'end';
export type Tone = 'neutral' | 'bad' | 'good';

export interface Arrow {
  from: string;
  to: string;
  color: string;
}

/** The site's palette (src/styles/themes.css default theme + tailwind.config.ts). */
export const COLORS = {
  ink: '#1a1a1a',
  paper: '#f4f4f0',
  surface: '#ffffff',
  muted: '#5a5a5a',
  gold: '#C49B2A',
  goldDark: '#8B6914',
  good: '#1F7A1F',
  bad: '#C42820',
};

export interface Caption {
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
}

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
  /** True on the closing card: the PatternChess line replaces the headline. */
  endCard: boolean;
  /** The caption chunk on screen and which word is being spoken. */
  caption: { words: string[]; active: number } | null;
}

export type CueKind = 'tick' | 'tickLast' | 'move' | 'capture' | 'buzz' | 'chime';
export interface Cue {
  t: number;
  kind: CueKind;
}

/** Narration lengths and caption chunks per beat (voice.ts BeatAudio fits this). */
export type VoiceTiming = Partial<Record<BeatId, { duration: number; phrases: Caption[] }>>;

interface Segment {
  start: number;
  end: number;
  frame: Omit<Frame, 'slide' | 'caption'>;
  slide?: { from: string; to: string; fenAfter: string };
}

type Base = Omit<Frame, 'slide' | 'fen' | 'lastMove' | 'caption'>;

function plySegments(start: number, ply: Ply, fenBefore: string, base: Base, hold: number): Segment[] {
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
  /** When each narrated beat starts. */
  voice: { beat: BeatId; t: number }[];
  captions: Caption[];
}

export function schedule(p: Puzzle, voice: VoiceTiming = {}): Schedule {
  const toMove = `${sideLabel(p.side)} to move`;
  const segs: Segment[] = [];
  const cues: Cue[] = [];
  const voiceStarts: Schedule['voice'] = [];
  const captions: Caption[] = [];
  /** Narration for beat `b` starts at t; returns when it ends (+ tail). */
  const speak = (b: BeatId, t: number): number => {
    const v = voice[b];
    if (!v) return t;
    voiceStarts.push({ beat: b, t });
    for (const c of v.phrases) {
      captions.push({ start: t + c.start, end: t + c.end, words: c.words.map((w) => ({ text: w.text, start: t + w.start, end: t + w.end })) });
    }
    return t + v.duration + TAIL;
  };
  const still = (start: number, end: number, f: Partial<Frame> & Pick<Frame, 'stage' | 'status'>) =>
    segs.push({
      start,
      end,
      frame: { fen: p.fen, lastMove: null, arrow: null, countdown: null, badge: null, endCard: false, ...f },
    });

  // Hook.
  const hookEnd = Math.max(HOOK_MIN, speak('hook', 0));
  still(0, hookEnd, { stage: 'hook', status: { text: toMove, tone: 'neutral' } });

  // Countdown (the challenge line plays over its first seconds).
  let t = hookEnd;
  const challengeEnd = speak('challenge', t);
  for (let i = 0; i < COUNTDOWN_SECONDS; i++) {
    const s = t + i;
    const last = i === COUNTDOWN_SECONDS - 1;
    still(s, last ? Math.max(s + 1, challengeEnd) : s + 1, {
      stage: 'countdown',
      status: { text: toMove, tone: 'neutral' },
      countdown: { left: COUNTDOWN_SECONDS - i, fraction: 0 },
    });
    cues.push({ t: s, kind: last ? 'tickLast' : 'tick' });
  }
  t = Math.max(t + COUNTDOWN_SECONDS, challengeEnd);

  // The played move.
  const playedStatus = { text: p.format === 'fall' ? `Most people play ${p.played.san}` : `What I played: ${p.played.san}`, tone: 'bad' as Tone };
  const playedEnd = speak('played', t);
  still(t, t + PLAYED_ARROW, { stage: 'played', status: playedStatus, arrow: { from: p.played.from, to: p.played.to, color: COLORS.bad } });
  t += PLAYED_ARROW;
  const playedBase: Base = {
    stage: 'played',
    status: playedStatus,
    arrow: null,
    countdown: null,
    badge: { square: p.played.to, text: '??', tone: 'bad' },
    endCard: false,
  };
  const playedHold = Math.max(PLAYED_HOLD, playedEnd - t - SLIDE);
  segs.push(...plySegments(t, p.played, p.fen, playedBase, playedHold));
  cues.push({ t, kind: p.played.capture ? 'capture' : 'move' }, { t: t + SLIDE, kind: 'buzz' });
  t += SLIDE + playedHold;

  // The punishment (fall).
  if (p.format === 'fall' && p.refutation.length) {
    const status = { text: 'The punishment', tone: 'bad' as Tone };
    const refEnd = speak('refutation', t);
    let fen = p.played.fen;
    p.refutation.forEach((ply, i) => {
      const last = i === p.refutation.length - 1;
      const hold = last ? Math.max(REVEAL_HOLD, refEnd - t - SLIDE) : PLY_STEP - SLIDE;
      segs.push(
        ...plySegments(t, ply, fen, {
          stage: 'refutation',
          status,
          arrow: null,
          countdown: null,
          badge: last && new Chess(ply.fen).isCheckmate() ? { square: ply.to, text: '#', tone: 'bad' } : null,
          endCard: false,
        }, hold),
      );
      cues.push({ t, kind: ply.capture ? 'capture' : 'move' });
      fen = ply.fen;
      t += SLIDE + hold;
    });
  }

  // The right line.
  const revealLabel =
    p.format === 'fall' ? 'The right move' : p.motifLabel ? `The winning move · ${p.motifLabel}` : 'The winning move';
  const good = { text: revealLabel, tone: 'good' as Tone };
  const first = p.solution[0];
  if (p.format === 'fall') {
    // Back to the start so the green arrow lands on the position people got wrong.
    still(t, t + RESET, { stage: 'reveal', status: good });
    t += RESET;
  }
  const revealEnd = speak('reveal', t);
  still(t, t + REVEAL_ARROW, { stage: 'reveal', status: good, arrow: { from: first.from, to: first.to, color: COLORS.good } });
  cues.push({ t, kind: 'chime' });
  t += REVEAL_ARROW;
  let fen = p.fen;
  p.solution.forEach((ply, i) => {
    const last = i === p.solution.length - 1;
    const hold = last ? Math.max(REVEAL_HOLD, revealEnd - t - SLIDE) : PLY_STEP - SLIDE;
    segs.push(
      ...plySegments(t, ply, fen, {
        stage: 'reveal',
        status: good,
        arrow: null,
        countdown: null,
        badge:
          last && new Chess(ply.fen).isCheckmate()
            ? { square: ply.to, text: '#', tone: 'good' }
            : i === 0
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
  const endEnd = Math.max(t + END_CARD, speak('cta', t) + 0.2);
  still(t, endEnd, { stage: 'end', status: { text: toMove, tone: 'neutral' }, endCard: true });
  t = endEnd;

  return { duration: t, segments: segs, cues, voice: voiceStarts, captions };
}

/** What the frame at time t (seconds) shows. */
export function frameAt(s: Schedule, t: number): Frame {
  const seg = s.segments.find((x) => t >= x.start && t < x.end) ?? s.segments[s.segments.length - 1];
  const progress = Math.min(1, Math.max(0, (t - seg.start) / (seg.end - seg.start)));
  const frame: Frame = { ...seg.frame, slide: seg.slide ? { ...seg.slide, progress: easeInOut(progress) } : null, caption: captionAt(s, t) };
  if (frame.countdown) frame.countdown = { ...frame.countdown, fraction: progress };
  return frame;
}

/** The caption chunk being spoken at t (held through short gaps until the next one). */
export function captionAt(s: Schedule, t: number): Frame['caption'] {
  const i = s.captions.findIndex((c, k) => t >= c.start && t < Math.max(c.end + 0.25, Math.min(s.captions[k + 1]?.start ?? Infinity, c.end + 0.6)));
  if (i < 0) return null;
  const c = s.captions[i];
  let active = c.words.findIndex((w) => t >= w.start && t < w.end);
  if (active < 0) active = t < c.words[0].start ? 0 : c.words.length - 1;
  return { words: c.words.map((w) => w.text), active };
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

export function frameCount(s: Schedule): number {
  return Math.round(s.duration * FPS);
}
