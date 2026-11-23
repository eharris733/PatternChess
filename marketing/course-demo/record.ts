#!/usr/bin/env node
// 60–90s screen recording of an unlisted creator course (/c/<slug>), for
// creator outreach. One continuous take of the real page, with a drawn cursor,
// caption bar and title/end cards injected as DOM overlays (captions only, no
// voiceover). Same capture technique as marketing/ad/record.ts: CDP screencast
// frames resampled to a constant 30 fps and encoded by ffmpeg.
//
//   npm run dev                    # in another terminal (or COURSE_BASE_URL)
//   npm run course:record -- [--slug hp-sicilian-pin-dzp2it] [--out marketing/course-demo/out/x.mp4]
//
// No login: the course page is public.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type Page } from 'playwright';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SLUG = arg('--slug') ?? 'hp-sicilian-pin-dzp2it';
const OUT = arg('--out') ?? `marketing/course-demo/out/${SLUG.replace(/-[a-z0-9]{6}$/, '')}-demo.mp4`;
const BASE = process.env.COURSE_BASE_URL ?? 'http://localhost:5173';
const VP = { width: 1280, height: 720, dpr: 1.5, outW: 1920, outH: 1080 };
const FPS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wall-clock spans played back faster in the output ([start, end] in performance.now()). */
const FAST = 3;
const fastSpans: Array<[number, number]> = [];

/** Cursor, caption bar and full-screen cards, drawn over the app. */
const OVERLAY = `
addEventListener('DOMContentLoaded', () => {
  const css = document.createElement('style');
  css.textContent = \`
    #cd-cursor { position: fixed; z-index: 99999; width: 22px; height: 22px; margin: -4px 0 0 -4px; pointer-events: none;
      transition: transform .12s; }
    #cd-cursor.down { transform: scale(.82); }
    #cd-cap { position: fixed; z-index: 99998; right: 6.5vw; bottom: 34px; width: 28vw;
      background: #1f1b16; color: #f5f1e8; font: 600 20px/1.3 Inter, system-ui, sans-serif; padding: 12px 22px;
      border: 2px solid #c9a227; box-shadow: 4px 4px 0 #c9a227; opacity: 0; transition: opacity .35s; text-align: left;
      pointer-events: none; }
    #cd-cap.on { opacity: 1; }
    #cd-card { position: fixed; inset: 0; z-index: 99997; background: #1f1b16; color: #f5f1e8; display: flex;
      flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center;
      font-family: Inter, system-ui, sans-serif; opacity: 0; transition: opacity .5s; pointer-events: none; padding: 0 10vw; }
    #cd-card.on { opacity: 1; }
    #cd-card .k { font: 600 15px/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: #c9a227; }
    #cd-card .h { font: 800 46px/1.15 Inter, system-ui, sans-serif; }
    #cd-card .s { font: 500 22px/1.4 Inter, system-ui, sans-serif; color: #d8d0bf; }
  \`;
  document.head.appendChild(css);
  const cur = document.createElement('div');
  cur.id = 'cd-cursor';
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const cap = document.createElement('div');
  cap.id = 'cd-cap';
  const card = document.createElement('div');
  card.id = 'cd-card';
  document.body.append(cur, cap, card);
  addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => cur.classList.add('down'), true);
  addEventListener('mouseup', () => cur.classList.remove('down'), true);
  window.__cd = {
    caption(text) {
      if (!text) { cap.classList.remove('on'); return; }
      cap.textContent = text; cap.classList.add('on');
    },
    card(html) {
      if (!html) { card.classList.remove('on'); return; }
      card.innerHTML = html; card.classList.add('on');
    },
  };
});
`;

async function caption(page: Page, text: string | null) {
  await page.evaluate((t) => (window as any).__cd.caption(t), text);
}

async function card(page: Page, html: string | null) {
  await page.evaluate((h) => (window as any).__cd.card(h), html);
}

let pos = { x: 900, y: 500 };
async function glide(page: Page, to: { x: number; y: number }, ms = 550) {
  const from = pos;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(ms / steps);
  }
  pos = to;
}

async function centerOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function click(page: Page, selector: string, ms = 500) {
  await glide(page, await centerOf(page, selector), ms);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(250);
}

/** Drag a piece (white orientation) with the drawn cursor. */
async function drag(page: Page, uci: string, ms = 450) {
  const b = (await page.locator('cg-board').boundingBox())!;
  const sq = b.width / 8;
  const at = (s: string) => ({
    x: b.x + sq * (s.charCodeAt(0) - 97) + sq / 2,
    y: b.y + sq * (8 - Number(s[1])) + sq / 2,
  });
  await glide(page, at(uci.slice(0, 2)), ms);
  await page.mouse.down();
  await sleep(100);
  await glide(page, at(uci.slice(2, 4)), ms);
  await page.mouse.up();
  await sleep(250);
}

async function waitFor(page: Page, testid: string) {
  await page.locator(`[data-testid=${testid}]`).waitFor({ timeout: 10_000 });
}

/** The take. Captions narrate what the viewer is seeing. */
async function act(page: Page) {
  await card(
    page,
    `<div class="k">Hanging Pawns &times; PatternChess</div>
     <div class="h">One YouTube lesson, turned into a course you play</div>
     <div class="s">&ldquo;Sicilian Pin Variation (and why it's bad for black)&rdquo;</div>`,
  );
  await sleep(4200);
  await card(page, null);
  await sleep(600);

  await caption(page, "Every chapter opens with the creator's own explanation");
  await sleep(4200);
  await click(page, '[data-testid=course-continue]');
  await sleep(700);
  await caption(page, "The video's key moments pause the board");
  await sleep(4200);
  await click(page, '[data-testid=course-continue]');

  await caption(page, "Then it's your move");
  await sleep(1400);
  await drag(page, 'f1d3');
  await caption(page, "A wrong move gets the creator's reasoning, not just a red X");
  await sleep(4200);
  await drag(page, 'd4b5');
  await caption(page, "Sound alternatives get credit, then a nudge toward the creator's move");
  await sleep(4200);
  await drag(page, 'e4e5');
  await caption(page, null);
  await sleep(3200);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await caption(page, 'Each moment links back to the exact second in the video');
  await glide(page, await centerOf(page, '[data-testid=course-watch]'), 700);
  await sleep(3400);
  await click(page, '[data-testid=course-continue]');
  await caption(page, null);
  await sleep(500);
  await drag(page, 'd1g4');
  await sleep(2600);
  await click(page, '[data-testid=course-next]');

  // Chapter 2: the ...Ne4 blunder, played at pace.
  await caption(page, 'Four chapters, sixteen moments, every line checked by Stockfish');
  await sleep(2400);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'd1g4');
  await sleep(1300);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'g4g7');
  await sleep(1300);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'c2c3');
  await sleep(1600);
  await click(page, '[data-testid=course-next]');

  // Chapters 3 and 4 play at FAST× in the output.
  await caption(page, `Chapters 3 and 4 at ${FAST}× speed`);
  fastSpans.push([performance.now(), Infinity]);
  await sleep(1400);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'c1h6');
  await sleep(1200);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'd4e2');
  await sleep(1200);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'h2h4');
  await sleep(1400);
  await click(page, '[data-testid=course-next]');

  // Chapter 4: the best defence.
  await sleep(1400);
  await click(page, '[data-testid=course-continue]');
  await sleep(700);
  await drag(page, 'c1d2');
  await sleep(1300);
  await click(page, '[data-testid=course-continue]');
  await sleep(900);
  await drag(page, 'g4e4');
  await sleep(1800);
  await click(page, '[data-testid=course-next]');
  fastSpans[fastSpans.length - 1][1] = performance.now();

  await caption(page, 'Private link. Nothing is published unless the creator says yes.');
  await sleep(5000);
  await caption(page, null);
  await card(
    page,
    `<div class="k">PatternChess</div>
     <div class="h">Your videos, as interactive courses</div>
     <div class="s">Want to see one built from yours?</div>`,
  );
  await sleep(4500);
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: VP.width, height: VP.height },
    deviceScaleFactor: VP.dpr,
  });
  await page.addInitScript(OVERLAY);
  await page.goto(`${BASE}/c/${SLUG}`);
  await waitFor(page, 'course-continue');
  await page.evaluate(() => document.fonts.ready);
  // Start under the title card so the first frame isn't the bare page.
  await card(page, '<div class="k">&nbsp;</div>');
  await page.mouse.move(pos.x, pos.y);
  await sleep(800);

  const cdp = await page.context().newCDPSession(page);
  const frames: { t: number; data: Buffer }[] = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames.push({ t: performance.now(), data: Buffer.from(data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VP.outW, maxHeight: VP.outH });
  const t0 = performance.now();
  await act(page).catch(async (e) => {
    await page.screenshot({ path: OUT.replace(/\.mp4$/, '.fail.png') });
    throw e;
  });
  const tEnd = performance.now();
  // Output time → source time, compressing the fast spans.
  const segments: Array<{ src0: number; src1: number; rate: number }> = [];
  let cursor = t0;
  for (const [a, b] of fastSpans) {
    segments.push({ src0: cursor, src1: a, rate: 1 }, { src0: a, src1: b, rate: FAST });
    cursor = b;
  }
  segments.push({ src0: cursor, src1: tEnd, rate: 1 });
  const seconds = segments.reduce((acc, g) => acc + (g.src1 - g.src0) / g.rate, 0) / 1000;
  const sourceAt = (outMs: number) => {
    let left = outMs;
    for (const g of segments) {
      const len = (g.src1 - g.src0) / g.rate;
      if (left <= len) return g.src0 + left * g.rate;
      left -= len;
    }
    return tEnd;
  };
  await cdp.send('Page.stopScreencast');
  await browser.close();

  const total = Math.round(seconds * FPS);
  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', `scale=${VP.outW}:${VP.outH}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${VP.outW}:${VP.outH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
      OUT,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  let j = 0;
  for (let i = 0; i < total; i++) {
    const at = sourceAt((i * 1000) / FPS);
    while (j + 1 < frames.length && frames[j + 1].t <= at) j++;
    if (!frames[j]) continue;
    if (!ff.stdin.write(frames[j].data)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  console.log(`${OUT}: ${seconds.toFixed(1)}s from ${frames.length} source frames`);
}

await main();
