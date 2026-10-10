// Joins the recorded clips (out/<ratio>/NN-<scene>.mp4, in SCENES order) with
// short crossfades, lays the running captions over the result, and writes
// out/patternchess-ad-16x9.mp4 / -9x16.mp4 plus, per ratio, a captions .srt and
// out/vo-timing.md — the timed script for the voiceover.
//   node marketing/ad/stitch.ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PROJECTS, SCENES } from './scenes.ts';
import { renderCaptionTrack, timeScript, toSrt, type LineTiming } from './captions.ts';

const here = (p: string) => new URL(p, import.meta.url).pathname;
const FADE = 0.3;
const copy = JSON.parse(readFileSync(here('./copy.json'), 'utf8'));
const OUT = { landscape: 'patternchess-ad-16x9', vertical: 'patternchess-ad-9x16' } as const;

const timing: string[] = [
  '# PatternChess ad — voiceover script',
  '',
  'Read each line inside its window; the on-screen captions follow the same timing.',
  'Lines marked (card) are shown as quotes on screen rather than captioned.',
  '',
];

for (const [ratio, name] of Object.entries(OUT) as [keyof typeof OUT, string][]) {
  const dir = here(`./out/${ratio}/`);
  const clips = SCENES.map((s, i) => ({ id: s.id, file: `${dir}${String(i + 1).padStart(2, '0')}-${s.id}.mp4` }));
  const missing = clips.filter((c) => !existsSync(c.file));
  if (missing.length === clips.length) continue;
  if (missing.length) throw new Error(`[${ratio}] missing clips: ${missing.map((c) => c.id).join(', ')} — run ad:record`);
  const durs = clips.map((c) =>
    Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', c.file]).toString().trim()),
  );

  // xfade chain: [0][1]xfade→[v1]; [v1][2]xfade→[v2]; … offsets accumulate minus each fade.
  const filters: string[] = [];
  let label = '[0:v]';
  let offset = 0;
  const starts: number[] = [0];
  for (let i = 1; i < clips.length; i++) {
    offset += durs[i - 1] - FADE;
    starts.push(offset);
    const last = i === clips.length - 1;
    const out = last ? '[vjoined]' : `[v${i}]`;
    filters.push(`${label}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${out}`);
    const aOut = last ? '[aout]' : `[a${i}]`;
    filters.push(`${i === 1 ? '[0:a]' : `[a${i - 1}]`}[${i}:a]acrossfade=d=${FADE}:c1=tri:c2=tri${aOut}`);
    label = out;
  }
  const total = offset + durs[durs.length - 1];

  // A scene's lines play from when its fade begins until the next scene's fade ends.
  const windows = Object.fromEntries(
    clips.map((c, i) => [c.id, { start: starts[i], end: i + 1 < clips.length ? starts[i + 1] + FADE : total }]),
  );
  const lines = timeScript(copy.script, windows);
  const track = await renderCaptionTrack(lines, total, ratio, PROJECTS[ratio], here(`./out/${ratio}/captions`));
  writeFileSync(here(`./out/${name}.srt`), toSrt(lines));

  const capIn = clips.length;
  filters.push(`[${capIn}:v]format=rgba,scale=${PROJECTS[ratio].outW}:${PROJECTS[ratio].outH}[cap]`);
  filters.push(`[vjoined][cap]overlay=0:0:format=auto:eof_action=pass[vout]`);
  const args = ['-y', '-loglevel', 'error', ...clips.flatMap((c) => ['-i', c.file]), '-f', 'concat', '-safe', '0', '-i', track];
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]');
  args.push('-c:a', 'aac', '-b:a', '192k', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-t', total.toFixed(3), '-movflags', '+faststart', here(`./out/${name}.mp4`));
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(`${name}.mp4: ${total.toFixed(1)}s from ${clips.length} clips`);

  timing.push(`## ${ratio === 'landscape' ? '16:9' : '9:16'} — ${name}.mp4 (${total.toFixed(1)}s)`, '', '| # | Scene | Read from | to | Line |', '|---|---|---|---|---|');
  lines.forEach((l, i) => timing.push(`| ${i + 1} | ${l.scene} | ${tc(l.start)} | ${tc(l.end)} | ${l.captioned ? '' : '(card) '}${l.text} |`));
  if (ratio === 'landscape') timing.push('', testimonialCues(lines, windows.testimonials));
  timing.push('');
}

writeFileSync(here('./out/vo-timing.md'), timing.join('\n'));
console.log('wrote out/vo-timing.md');

/** When each quote is on screen in the testimonials card (overlay.js weights quotes by length, min 2.2s). */
function testimonialCues(lines: LineTiming[], win: { start: number; end: number } | undefined) {
  if (!win || !lines.some((l) => l.scene === 'testimonials')) return '';
  const seconds = copy.durations.testimonials;
  const words = (s: string) => s.trim().split(/\s+/).length;
  const weights = copy.testimonials.map((t: any) => Math.max(words(t.quote) + 4, 8));
  const sum = weights.reduce((a: number, b: number) => a + b, 0);
  let at = win.start;
  return [
    'Testimonial quotes on screen:',
    '',
    ...copy.testimonials.map((t: any, i: number) => {
      const len = Math.max(2.2, (seconds * weights[i]) / sum);
      const row = `- ${tc(at)}–${tc(at + len)} **${t.name}**: “${t.quote}”`;
      at += len;
      return row;
    }),
  ].join('\n');
}

function tc(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
