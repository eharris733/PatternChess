// Joins the recorded clips (out/<ratio>/NN-*.mp4) with short crossfades into
// out/patternchess-ad-16x9.mp4 / -9x16.mp4, and writes out/vo-timing.md with
// each scene's timecodes and on-screen copy for the voiceover.
//   node marketing/ad/stitch.ts
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const here = (p: string) => new URL(p, import.meta.url).pathname;
const FADE = 0.3;
const copy = JSON.parse(readFileSync(here('./copy.json'), 'utf8'));
const stats = JSON.parse(readFileSync(here('./stats.json'), 'utf8'));
const OUT = { landscape: 'patternchess-ad-16x9.mp4', vertical: 'patternchess-ad-9x16.mp4' } as const;

const onScreen: Record<string, string> = {
  hook: `${copy.hook.headline || '[hook.headline]'} / ${copy.hook.sub || '[hook.sub]'}`,
  stats: `+${stats.eloGained.toLocaleString('en-US')} ${copy.stats.eloLabel || '[eloLabel]'} · ${stats.retentionReturnPct}% ${copy.stats.retentionLabel || '[retentionLabel]'} · ${stats.positionsReviewed.toLocaleString('en-US')} ${copy.stats.solvedLabel || '[solvedLabel]'}`,
  testimonials: copy.testimonials.map((t: any, i: number) => t.name || `[testimonial ${i + 1}]`).join(' → '),
  cta: `${copy.cta.headline || '[cta.headline]'} · ${copy.cta.button || '[cta.button]'} · ${copy.cta.url}`,
};

const timing: string[] = ['# PatternChess ad — voiceover timing', '', 'Crossfades are 0.3s; a scene starts when its fade begins.', ''];

for (const [ratio, name] of Object.entries(OUT)) {
  const dir = here(`./out/${ratio}/`);
  if (!existsSync(dir)) continue;
  const clips = readdirSync(dir).filter((f) => /^\d\d-.+\.mp4$/.test(f)).sort();
  if (!clips.length) continue;
  const durs = clips.map((f) =>
    Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dir + f]).toString().trim()),
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
    const out = last ? '[vout]' : `[v${i}]`;
    filters.push(`${label}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${out}`);
    const aOut = last ? '[aout]' : `[a${i}]`;
    filters.push(`${i === 1 ? '[0:a]' : `[a${i - 1}]`}[${i}:a]acrossfade=d=${FADE}:c1=tri:c2=tri${aOut}`);
    label = out;
  }
  const total = offset + durs[durs.length - 1];
  const args = ['-y', '-loglevel', 'error', ...clips.flatMap((f) => ['-i', dir + f])];
  if (clips.length > 1) args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]');
  args.push('-c:a', 'aac', '-b:a', '192k', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', here(`./out/${name}`));
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(`${name}: ${total.toFixed(1)}s from ${clips.length} clips`);

  timing.push(`## ${ratio === 'landscape' ? '16:9' : '9:16'} — ${name} (${total.toFixed(1)}s)`, '', '| # | Scene | Start | End | On screen |', '|---|---|---|---|---|');
  clips.forEach((f, i) => {
    const id = f.replace(/^\d\d-|\.mp4$/g, '');
    const text = onScreen[id] ?? copy.captions[id] ?? '';
    timing.push(`| ${i + 1} | ${id} | ${tc(starts[i])} | ${tc(starts[i] + durs[i])} | ${text || `[captions.${id}]`} |`);
  });
  timing.push('');
}

writeFileSync(here('./out/vo-timing.md'), timing.join('\n'));
console.log('wrote out/vo-timing.md');

function tc(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
