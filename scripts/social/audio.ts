// The video's soundtrack, synthesized from the timeline cues (no audio assets:
// the Lichess sound sets are AGPL, see CLAUDE.md "Sounds"). 16-bit mono WAV.
import type { Cue } from './timeline.ts';

export const SAMPLE_RATE = 44_100;

type Voice = (t: number) => number;

const sine = (f: number) => (t: number) => Math.sin(2 * Math.PI * f * t);
const env = (attack: number, decay: number) => (t: number) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / decay);

/** Seeded noise so renders are byte-for-byte reproducible. */
function noise(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0xffffffff - 0.5;
  };
}

function voice(kind: Cue['kind']): { length: number; fn: Voice } {
  switch (kind) {
    case 'tick': {
      const e = env(0.002, 0.025);
      return { length: 0.12, fn: (t) => 0.35 * e(t) * sine(1200)(t) };
    }
    case 'tickLast': {
      const e = env(0.002, 0.05);
      return { length: 0.2, fn: (t) => 0.4 * e(t) * sine(1600)(t) };
    }
    case 'move': {
      // A wooden "tock": a low sine thump plus a short filtered click.
      const e = env(0.001, 0.03);
      const n = noise(7);
      return { length: 0.15, fn: (t) => e(t) * (0.55 * sine(180)(t) + 0.25 * n()) };
    }
    case 'capture': {
      const e = env(0.001, 0.045);
      const n = noise(11);
      return { length: 0.2, fn: (t) => e(t) * (0.6 * sine(140)(t) + 0.4 * n()) };
    }
    case 'buzz': {
      const e = env(0.01, 0.18);
      return { length: 0.45, fn: (t) => 0.22 * e(t) * (sine(110)(t) + 0.6 * sine(116)(t)) };
    }
    case 'chime': {
      const e1 = env(0.005, 0.35);
      const e2 = (t: number) => (t < 0.09 ? 0 : env(0.005, 0.45)(t - 0.09));
      return {
        length: 1.4,
        fn: (t) => 0.22 * e1(t) * sine(659.25)(t) + 0.22 * e2(t) * sine(987.77)(t) + 0.06 * e2(t) * sine(1975.5)(t),
      };
    }
  }
}

/** A narration clip placed at `t` seconds (mono floats at SAMPLE_RATE). */
export interface VoiceClip {
  t: number;
  samples: Float32Array;
}

/** Effects drop to this gain (about −10 dB) while the narrator speaks. */
export const DUCK_GAIN = 0.32;
const DUCK_RAMP = 0.08;
const VOICE_GAIN = 0.95;

export function renderWav(cues: readonly Cue[], duration: number, narration: readonly VoiceClip[] = []): Buffer {
  const n = Math.ceil(duration * SAMPLE_RATE);
  const fx = new Float32Array(n);
  for (const cue of cues) {
    const v = voice(cue.kind);
    const start = Math.round(cue.t * SAMPLE_RATE);
    const len = Math.min(Math.round(v.length * SAMPLE_RATE), n - start);
    for (let i = 0; i < len; i++) fx[start + i] += v.fn(i / SAMPLE_RATE);
  }
  // Ducking envelope: 1 outside narration, DUCK_GAIN inside, with short ramps.
  const gain = new Float32Array(n).fill(1);
  const ramp = Math.round(DUCK_RAMP * SAMPLE_RATE);
  for (const c of narration) {
    const a = Math.round(c.t * SAMPLE_RATE);
    const b = Math.min(n, a + c.samples.length);
    for (let i = Math.max(0, a - ramp); i < Math.min(n, b + ramp); i++) {
      const edge = i < a ? (a - i) / ramp : i >= b ? (i - b) / ramp : 0;
      gain[i] = Math.min(gain[i], DUCK_GAIN + (1 - DUCK_GAIN) * Math.min(1, edge));
    }
  }
  const mix = new Float32Array(n);
  for (let i = 0; i < n; i++) mix[i] = fx[i] * gain[i];
  for (const c of narration) {
    const a = Math.round(c.t * SAMPLE_RATE);
    const len = Math.min(c.samples.length, n - a);
    for (let i = 0; i < len; i++) mix[a + i] += VOICE_GAIN * c.samples[i];
  }
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i])) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
