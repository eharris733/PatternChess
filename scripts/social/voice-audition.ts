// Renders the same narration in several Kokoro voices so you can pick one by
// ear (then set the repository variable SOCIAL_VOICE). Narration only, no
// effects, one MP3 per voice, plus timings.json (seconds to synthesize each).
//
//   node scripts/social/voice-audition.ts --out <dir> [--voices af_heart,am_michael] [--script script.json]
//
// --script takes a VideoScript JSON (e.g. a social_posts.script value);
// without it a fixed sample script is used. Needs kokoro-js (see voice.ts) and ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderWav, SAMPLE_RATE } from './audio.ts';
import { parseArgs } from './env.ts';
import { BEATS, type VideoScript } from './script.ts';
import { voiceBeat } from './voice.ts';

/** Kokoro's best-rated English voices plus the current default. */
export const AUDITION_VOICES = ['af_heart', 'af_bella', 'af_nicole', 'am_fenrir', 'am_puck', 'am_michael', 'bm_george', 'bm_fable'];

const BEAT_GAP = 0.4;

export const SAMPLE_SCRIPT: VideoScript = {
  hookStyle: 'hidden-mate',
  headline: 'A forced mate is hiding here',
  subline: 'White to move. Find the mate.',
  beats: {
    hook: "There's a forced checkmate hiding in this position, and a 2056 player walked right past it.",
    challenge: 'Pause now. You have 5 seconds to find it.',
    played: 'White played rook takes c2. It grabs a rook, so it looks natural. But it throws the mate away.',
    reveal: 'The move was queen takes h7, check. King takes h7, and then rook h3 is checkmate.',
    cta: 'PatternChess finds the blunders in your own games, then drills them until they stick.',
  },
  captionLead: '',
};

async function main() {
  const args = parseArgs();
  const out = typeof args.out === 'string' ? args.out : 'voice-audition';
  const voices = typeof args.voices === 'string' ? args.voices.split(',').map((v) => v.trim()).filter(Boolean) : AUDITION_VOICES;
  const script: VideoScript = typeof args.script === 'string' ? JSON.parse(readFileSync(args.script, 'utf8')) : SAMPLE_SCRIPT;
  mkdirSync(out, { recursive: true });
  const timings: Record<string, { synthSeconds: number; audioSeconds: number }> = {};
  for (const voice of voices) {
    const started = Date.now();
    const clips: { t: number; samples: Float32Array }[] = [];
    let t = 0.2;
    for (const b of BEATS) {
      const text = script.beats[b];
      if (!text) continue;
      const a = await voiceBeat(text, voice);
      clips.push({ t, samples: a.samples });
      t += a.duration + BEAT_GAP;
    }
    const synthSeconds = (Date.now() - started) / 1000;
    const wav = join(out, `${voice}.wav`);
    writeFileSync(wav, renderWav([], t, clips));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', String(SAMPLE_RATE), '-b:a', '128k', join(out, `${voice}.mp3`)]);
    timings[voice] = { synthSeconds, audioSeconds: Number(t.toFixed(2)) };
    console.log(`${voice}: ${t.toFixed(1)}s of audio in ${synthSeconds.toFixed(1)}s`);
  }
  writeFileSync(join(out, 'timings.json'), JSON.stringify(timings, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
