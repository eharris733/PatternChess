// Records each ad scene as its own H.264 clip via CDP screencast.
//   node marketing/ad/record.ts [--project landscape|vertical|both] [--scene id,id]
// Clips land in marketing/ad/out/<project>/<nn>-<scene>.mp4; stitch.ts joins them.
// Runs against the dev server (npm run dev) as the real account, with every
// Supabase write blocked (readOnlyGuard) and other players masked (overlay.js).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { mintSession } from './session.ts';
import { installReadOnlyGuard, blockedWrites } from './readOnlyGuard.ts';
import { BASE_URL, loadEnv } from './env.ts';
import { SCENES, type Ratio, type SceneCtx } from './scenes.ts';

const here = (p: string) => new URL(p, import.meta.url).pathname;

export const PROJECTS: Record<Ratio, { width: number; height: number; dpr: number; outW: number; outH: number }> = {
  landscape: { width: 1280, height: 720, dpr: 1.5, outW: 1920, outH: 1080 },
  vertical: { width: 540, height: 960, dpr: 2, outW: 1080, outH: 1920 },
};
const FPS = 30;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectArg = arg('project') ?? 'both';
const ratios: Ratio[] = projectArg === 'both' ? ['landscape', 'vertical'] : [projectArg as Ratio];
const sceneFilter = arg('scene')?.split(',');

const copy = JSON.parse(readFileSync(here('./copy.json'), 'utf8'));
const statsRaw = JSON.parse(readFileSync(here('./stats.json'), 'utf8'));
// "Come back to train": % of users who trained on at least two different days.
const stats = { ...statsRaw, retentionPct: statsRaw.retentionReturnPct };

// Read-only lookups for scenes that feature a real blunder from the account.
const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
async function blunder(id: string) {
  const { data, error } = await admin.from('blunders').select().eq('id', id).single();
  if (error) throw error;
  return data;
}

const { session, storageKey } = await mintSession();
// Let the site's AudioContext run without a real user gesture.
const browser: Browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

for (const ratio of ratios) {
  const vp = PROJECTS[ratio];
  const outDir = here(`./out/${ratio}/`);
  mkdirSync(outDir, { recursive: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
  });
  await context.addInitScript(({ k, s }) => {
    localStorage.setItem(k, JSON.stringify(s));
    // Brand look regardless of the account's theme: a device-stored theme wins
    // over the profile's (themeStore), and the sync-up write is blocked.
    localStorage.setItem('patternchess.boardTheme', 'default');
  }, { k: storageKey, s: session });
  await context.addInitScript({ path: here('./overlay.js') });

  for (const [index, scene] of SCENES.entries()) {
    if (sceneFilter && !sceneFilter.includes(scene.id)) continue;
    const seconds = copy.durations[scene.id] ?? 3;
    console.log(`[${ratio}] ${scene.id} (${seconds}s)`);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
    await installReadOnlyGuard(page);
    const ctx: SceneCtx = { page, ratio, copy, stats, seconds, blunder, baseUrl: BASE_URL };
    await scene.prepare(ctx);
    const file = `${outDir}${String(index + 1).padStart(2, '0')}-${scene.id}.mp4`;
    await recordClip(page, file, seconds, vp, () => scene.act(ctx));
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(`done — ${blockedWrites.length} Supabase writes blocked`);

/**
 * Screencasts the page while `act` runs, for exactly `seconds`. CDP only sends
 * frames on repaint, so each output frame repeats the latest frame at or before
 * its timestamp — a constant 30 fps stream fed to ffmpeg as MJPEG.
 */
async function recordClip(
  page: Page,
  file: string,
  seconds: number,
  vp: (typeof PROJECTS)[Ratio],
  act: () => Promise<void>,
) {
  const cdp = await page.context().newCDPSession(page);
  const frames: { t: number; data: Buffer }[] = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames.push({ t: performance.now(), data: Buffer.from(data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: vp.outW,
    maxHeight: vp.outH,
    everyNthFrame: 1,
  });
  // Nudge a repaint so frame 0 exists even on a static page.
  await page.evaluate(() => document.body.style.setProperty('--ad-tick', String(Math.random())));
  const t0 = performance.now();
  const pageT0: number = await page.evaluate(() => (window as any).__ad.play());
  const acting = act().catch((e) => console.log(`  act failed: ${e.message}`));
  await Promise.race([acting.then(() => waitUntil(t0 + seconds * 1000)), waitUntil(t0 + seconds * 1000)]);
  await waitUntil(t0 + seconds * 1000);
  await cdp.send('Page.stopScreencast');
  const sound: { b64: string; startedAt: number } | null = await page.evaluate(() => (window as any).__ad.stopAudio());
  await cdp.detach();

  const total = Math.round(seconds * FPS);
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${vp.outW}:${vp.outH}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${vp.outW}:${vp.outH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS), '-movflags', '+faststart',
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  let j = 0;
  for (let i = 0; i < total; i++) {
    const at = t0 + (i * 1000) / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= at) j++;
    const frame = frames[j];
    if (!frame) continue;
    if (!ff.stdin.write(frame.data)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  await muxAudio(file, seconds, sound, pageT0);
  console.log(`  → ${file} (${frames.length} source frames${sound ? ', with sound' : ''})`);
}

function waitUntil(t: number) {
  return new Promise((r) => setTimeout(r, Math.max(0, t - performance.now())));
}

/**
 * Lays the page's captured Web Audio under the clip, aligned to the first
 * video frame (the recorder may have started before or after it). Clips with
 * no sound get a silent track so the stitcher can crossfade audio uniformly.
 */
async function muxAudio(file: string, seconds: number, sound: { b64: string; startedAt: number } | null, pageT0: number) {
  const tmp = file.replace(/\.mp4$/, '.tmp.mp4');
  renameSync(file, tmp);
  const args = ['-y', '-loglevel', 'error', '-i', tmp];
  let filter: string;
  if (sound && sound.b64) {
    const webm = file.replace(/\.mp4$/, '.audio.webm');
    writeFileSync(webm, Buffer.from(sound.b64, 'base64'));
    args.push('-i', webm);
    const offsetMs = sound.startedAt - pageT0; // >0: audio began after frame 0
    filter =
      offsetMs >= 0
        ? `[1:a]aresample=48000,adelay=${Math.round(offsetMs)}:all=1,apad,atrim=0:${seconds}[a]`
        : `[1:a]aresample=48000,atrim=start=${(-offsetMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${seconds}[a]`;
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    filter = `[1:a]atrim=0:${seconds}[a]`;
  }
  args.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-shortest', file);
  await new Promise<void>((res, rej) =>
    spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg mux exited ${c}`)))),
  );
  rmSync(tmp);
  rmSync(file.replace(/\.mp4$/, '.audio.webm'), { force: true });
}
