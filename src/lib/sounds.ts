/**
 * App sounds, all synthesized with the Web Audio API — nothing to download,
 * nothing to license. (The Lichess sound sets are AGPL, so they're out.)
 *
 *   move        soft wooden tap (filtered noise burst)
 *   capture     heavier, lower tap with a second knock
 *   check       short bright ping on top of the tap
 *   correct     rising C5 → E5 → G5
 *   incorrect   falling A3 → F#3
 *   achievement C5 → E5 → G5 → C6 fanfare
 *
 * Everything here is best-effort and never throws: no AudioContext, a
 * suspended context (autoplay policy before the first gesture), or a muted
 * preference all just mean silence.
 */
export type SoundKind = 'move' | 'capture' | 'check' | 'correct' | 'incorrect' | 'achievement';

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = true;
let unlockInstalled = false;

/** Profile preference (profiles.sounds_enabled). Defaults on. */
export function setSoundsEnabled(v: boolean): void {
  enabled = v;
}

export function soundsEnabled(): boolean {
  return enabled;
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Browsers only let an AudioContext run after a user gesture. Resume it on
 * the first pointer/key event; idempotent, so any screen may call it.
 */
export function installSoundUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = () => {
    getContext();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

function getNoise(c: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 0.12);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/** A filtered noise burst: the "piece on wood" tap. */
function tap(
  c: AudioContext,
  at: number,
  opts: { cutoffHz: number; seconds: number; gain: number; q?: number },
): void {
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.cutoffHz;
  filter.Q.value = opts.q ?? 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.seconds);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + opts.seconds + 0.02);
}

/** Short tone sequence: [frequencyHz, offsetSeconds][] with a per-note decay. */
function tones(
  c: AudioContext,
  at: number,
  notes: Array<[number, number]>,
  noteSeconds: number,
  opts: { type?: OscillatorType; gain?: number } = {},
): void {
  for (const [freq, offset] of notes) {
    const osc = c.createOscillator();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.value = freq;
    const g = c.createGain();
    const start = at + offset;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.16, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + noteSeconds);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + noteSeconds + 0.02);
  }
}

export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  try {
    const c = getContext();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    switch (kind) {
      case 'move':
        tap(c, t, { cutoffHz: 1400, seconds: 0.07, gain: 0.5 });
        return;
      case 'capture':
        tap(c, t, { cutoffHz: 700, seconds: 0.11, gain: 0.7, q: 2 });
        tap(c, t + 0.045, { cutoffHz: 1100, seconds: 0.07, gain: 0.35 });
        return;
      case 'check':
        tap(c, t, { cutoffHz: 1400, seconds: 0.07, gain: 0.45 });
        tones(c, t, [[1318.5, 0.01]], 0.16, { type: 'sine', gain: 0.12 });
        return;
      case 'correct':
        tones(c, t, [[523.25, 0], [659.25, 0.08], [783.99, 0.16]], 0.16);
        return;
      case 'incorrect':
        tones(c, t, [[220, 0], [185, 0.13]], 0.22, { type: 'sine', gain: 0.2 });
        return;
      case 'achievement':
        tones(c, t, [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.32]], 0.24);
        return;
    }
  } catch {
    /* silent */
  }
}

/** Piece count from the board part of a FEN — used to tell captures apart. */
export function fenPieceCount(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let n = 0;
  for (const ch of board) if (/[prnbqk]/i.test(ch)) n += 1;
  return n;
}
