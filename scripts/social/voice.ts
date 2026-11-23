// The narrator: Kokoro-82M (Apache-2.0) through kokoro-js, on the CPU, free.
// Each sentence is synthesized on its own, so the length of every sentence is
// exact and the captions need no speech-to-text pass; word timings inside a
// sentence are spread by length (close enough for a highlighted caption word).
//
// The model (~90 MB, q8) downloads on first use into SOCIAL_TTS_CACHE
// (default ~/.cache/patternchess-tts; the workflow caches that directory).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_RATE } from './audio.ts';
import { env } from './env.ts';
import type { BeatId } from './script.ts';
import { pronounce } from './spoken.ts';

export const DEFAULT_VOICE = 'am_michael';
export const VOICE_SPEED = 1.1;
/** Pause between sentences in one beat. */
const SENTENCE_GAP = 0.14;
/** Silence kept at either end of a trimmed sentence. */
const EDGE_PAD = 0.03;

export interface Word {
  text: string;
  start: number;
  end: number;
}

/** A caption chunk (≤ 4 words), times relative to the beat's start. */
export interface Phrase {
  text: string;
  start: number;
  end: number;
  words: Word[];
}

export interface BeatAudio {
  duration: number;
  /** Mono float samples at SAMPLE_RATE. */
  samples: Float32Array;
  phrases: Phrase[];
}

export type VoiceTrack = Partial<Record<BeatId, BeatAudio>>;

export function voiceName(): string {
  return env('SOCIAL_VOICE') ?? DEFAULT_VOICE;
}

/** "I played rook takes c2. Wrong." → ["I played rook takes c2.", "Wrong."] */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Caption chunks of at most `max` words, breaking after commas where it can. */
export function chunkWords(sentence: string, max = 4): string[][] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const out: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= max || /[,;:]$/.test(w)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  // Never leave a lone trailing word when it can join the chunk before it.
  if (out.length > 1 && out[out.length - 1].length === 1 && out[out.length - 2].length < max + 1) {
    out[out.length - 2].push(...out.pop()!);
  }
  return out;
}

/** Spreads `duration` over the words by length (letters + a beat for punctuation). */
export function timeWords(sentence: string, start: number, duration: number, max = 4): Phrase[] {
  const chunks = chunkWords(sentence, max);
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[,.!?;:]$/.test(w) ? 3 : 0);
  const total = chunks.flat().reduce((a, w) => a + weight(w), 0) || 1;
  let t = start;
  return chunks.map((chunk) => {
    const words = chunk.map((w) => {
      const d = (weight(w) / total) * duration;
      const word = { text: w, start: t, end: t + d };
      t += d;
      return word;
    });
    return { text: chunk.join(' '), start: words[0].start, end: words[words.length - 1].end, words };
  });
}

/** Linear resample (Kokoro speaks at 24 kHz; the mix is 44.1 kHz). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const n = Math.round((input.length * to) / from);
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = x - i0;
    out[i] = (input[i0] ?? 0) * (1 - f) + (input[i1] ?? 0) * f;
  }
  return out;
}

/** Drops leading / trailing near-silence, keeping EDGE_PAD at either end. */
export function trimSilence(samples: Float32Array, rate: number, threshold = 0.012): Float32Array {
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < threshold) a++;
  while (b > a && Math.abs(samples[b]) < threshold) b--;
  const pad = Math.round(EDGE_PAD * rate);
  return samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad + 1));
}

/** Scales in place so the loudest sample sits at `peak` (every beat equally loud). */
export function normalize(samples: Float32Array, peak = 0.85): void {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max < 1e-4) return;
  const k = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= k;
}

interface Tts {
  generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

let ttsPromise: Promise<Tts> | null = null;

async function tts(): Promise<Tts> {
  ttsPromise ??= (async () => {
    const { env: hf } = await import('@huggingface/transformers');
    hf.cacheDir = env('SOCIAL_TTS_CACHE') ?? join(homedir(), '.cache', 'patternchess-tts');
    const { KokoroTTS } = await import('kokoro-js');
    return (await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })) as unknown as Tts;
  })();
  return ttsPromise;
}

/** Synthesizes one beat: its sentences back to back, with caption timings. */
export async function voiceBeat(text: string, voice = voiceName()): Promise<BeatAudio> {
  const engine = await tts();
  const parts: Float32Array[] = [];
  const phrases: Phrase[] = [];
  let t = 0;
  const gap = new Float32Array(Math.round(SENTENCE_GAP * SAMPLE_RATE));
  for (const [i, sentence] of sentences(text).entries()) {
    const raw = await engine.generate(pronounce(sentence), { voice, speed: VOICE_SPEED });
    const clip = resample(trimSilence(raw.audio, raw.sampling_rate), raw.sampling_rate, SAMPLE_RATE);
    if (i > 0) {
      parts.push(gap);
      t += gap.length / SAMPLE_RATE;
    }
    const d = clip.length / SAMPLE_RATE;
    phrases.push(...timeWords(sentence, t, d));
    parts.push(clip);
    t += d;
  }
  const samples = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    samples.set(p, o);
    o += p.length;
  }
  normalize(samples);
  return { duration: samples.length / SAMPLE_RATE, samples, phrases };
}

export async function voiceScript(beats: Partial<Record<BeatId, string>>, voice = voiceName()): Promise<VoiceTrack> {
  const out: VoiceTrack = {};
  for (const [id, text] of Object.entries(beats) as [BeatId, string][]) {
    if (text) out[id] = await voiceBeat(text, voice);
  }
  return out;
}
