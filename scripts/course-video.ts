#!/usr/bin/env node
// Transcript + board frames for authoring an interactive course lesson.
//
//   npm run course:video -- <youtubeId>                       # fetch the transcript
//   npm run course:video -- <youtubeId> --from 2:00 --to 5:30  # print that window
//   npm run course:video -- <youtubeId> --frames 2:46,4:00     # PNG frames at those times
//   npm run course:video -- <youtubeId> --every 15 --from 2:00 --to 5:30
//
// Everything lands in the gitignored data/course-video/<id>/:
//   transcript.json   [{ start, end, text }] (seconds) from YouTube's English captions
//   transcript.txt    "[m:ss] text" lines, ~8 s chunks, for reading
//   video.mp4         a ≤720p copy, only fetched for --frames/--every (never re-hosted)
//   frames/<m-ss>.png
// Read a frame to confirm the position on the creator's board whenever the
// transcript is ambiguous. Needs yt-dlp and ffmpeg (brew install yt-dlp ffmpeg).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatClock, parseClock, type TranscriptSegment } from '../src/learn/transcriptMatch.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = args.find((a) => /^[\w-]{11}$/.test(a));
if (!id) {
  console.error('usage: npm run course:video -- <youtubeId> [--from m:ss --to m:ss] [--frames m:ss,...] [--every s]');
  process.exit(2);
}

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'data', 'course-video', id);
mkdirSync(dir, { recursive: true });
const url = `https://www.youtube.com/watch?v=${id}`;

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[];
}

/** Word-level timings from YouTube's json3 captions, then ~8 s chunks. */
function parseJson3(raw: Json3): TranscriptSegment[] {
  const words: { t: number; w: string }[] = [];
  for (const ev of raw.events ?? []) {
    if (!ev.segs) continue;
    const base = (ev.tStartMs ?? 0) / 1000;
    for (const s of ev.segs) {
      const text = (s.utf8 ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      words.push({ t: base + (s.tOffsetMs ?? 0) / 1000, w: text });
    }
  }
  words.sort((a, b) => a.t - b.t);
  const out: TranscriptSegment[] = [];
  let cur: { start: number; parts: string[] } | null = null;
  for (const { t, w } of words) {
    if (!cur || t - cur.start >= 8) {
      if (cur) out.push({ start: cur.start, end: t, text: cur.parts.join(' ') });
      cur = { start: t, parts: [] };
    }
    cur.parts.push(w);
  }
  if (cur) out.push({ start: cur.start, end: cur.start + 8, text: cur.parts.join(' ') });
  return out;
}

function fetchTranscript(): TranscriptSegment[] {
  const jsonPath = join(dir, 'transcript.json');
  if (existsSync(jsonPath)) return JSON.parse(readFileSync(jsonPath, 'utf8'));
  execFileSync(
    'yt-dlp',
    ['--no-update', '--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', process.env.SUB_LANGS ?? 'en', '--sub-format', 'json3', '-o', join(dir, 'captions.%(ext)s'), url],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const files = readdirSync(dir).filter((f) => f.startsWith('captions.') && f.endsWith('.json3'));
  // Prefer the creator's own English track, then the original-language auto track.
  const pick = files.find((f) => f === 'captions.en.json3') ?? files.find((f) => f.includes('en-orig')) ?? files[0];
  if (!pick) throw new Error(`no English captions for ${id}`);
  const segs = parseJson3(JSON.parse(readFileSync(join(dir, pick), 'utf8')));
  writeFileSync(jsonPath, `${JSON.stringify(segs)}\n`);
  writeFileSync(join(dir, 'transcript.txt'), segs.map((s) => `[${formatClock(s.start)}] ${s.text}`).join('\n') + '\n');
  return segs;
}

function ensureVideo(): string {
  const path = join(dir, 'video.mp4');
  if (existsSync(path)) return path;
  execFileSync('yt-dlp', ['--no-update', '-f', 'bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]', '--remux-video', 'mp4', '-o', path, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return path;
}

function frame(video: string, t: number): string {
  mkdirSync(join(dir, 'frames'), { recursive: true });
  const out = join(dir, 'frames', `${formatClock(t).replace(':', '-')}.png`);
  if (!existsSync(out)) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-2', '-y', out]);
  }
  return out;
}

const segs = fetchTranscript();
const from = flag('--from') ? parseClock(flag('--from')!) : null;
const to = flag('--to') ? parseClock(flag('--to')!) : null;
const framesArg = flag('--frames');
const every = flag('--every') ? Number(flag('--every')) : null;
if (every != null && !(Number.isFinite(every) && every > 0)) {
  console.error(`--every must be a positive number of seconds (got ${flag('--every')})`);
  process.exit(1);
}

if (framesArg || every) {
  const video = ensureVideo();
  const times: number[] = framesArg
    ? framesArg.split(',').map((s) => parseClock(s.trim()))
    : (() => {
        const lo = from ?? 0;
        const hi = to ?? segs.at(-1)?.end ?? lo;
        const ts: number[] = [];
        for (let t = lo; t <= hi; t += every!) ts.push(t);
        return ts;
      })();
  for (const t of times) console.log(frame(video, t));
} else {
  const lo = from ?? 0;
  const hi = to ?? Infinity;
  for (const s of segs) if (s.end >= lo && s.start <= hi) console.log(`[${formatClock(s.start)}] ${s.text}`);
  if (from == null && to == null) console.error(`\n${segs.length} segments → ${join(dir, 'transcript.txt')}`);
}
