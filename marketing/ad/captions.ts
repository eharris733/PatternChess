// Running captions for the ad: the voiceover script (copy.json `script`) timed
// word by word over the scene each line names, rendered as a transparent
// overlay track that stitch.ts lays over the joined video. Because they're laid
// over the final cut, captions survive crossfades and can be re-timed without
// re-recording. (This ffmpeg has no libass/drawtext, so Chromium draws them.)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { REPO_ROOT } from './env.ts';

export interface ScriptLine {
  scene: string;
  text: string;
  /** false: spoken but not captioned (the card already shows the words). */
  caption?: boolean;
  /** 'side': in 16:9, sit under the drill's side panel instead of over the board. */
  position?: 'side';
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Chunk {
  words: Word[];
  start: number;
  end: number;
}

export interface LineTiming {
  scene: string;
  text: string;
  captioned: boolean;
  side: boolean;
  start: number;
  end: number;
  chunks: Chunk[];
}

// Speech pacing (seconds). Tuned to a brisk ad read, ~165–175 words a minute.
const LEAD = 0.25; // after a scene's crossfade begins
const TAIL = 0.3; // before the scene ends
const COMMA = 0.22;
const STOP = 0.42;
const MAX_STRETCH = 1.2; // slow down to fill a long scene, up to this much
const CHUNK_WORDS = 5;
const CHUNK_CHARS = 30;
const BRIDGE = 1.2; // gaps shorter than this keep the previous phrase up

/** Rough spoken length of one token: digits read out ("10.5" ≈ ten point five). */
function wordWeight(token: string): number {
  const letters = token.replace(/[^\p{L}]/gu, '').length;
  const digits = token.replace(/[^\d]/g, '').length;
  const spokenDigits = digits ? 0.32 * (digits + (token.includes('.') ? 1 : 0)) : 0;
  return 0.16 + 0.042 * letters + spokenDigits;
}

function pauseAfter(token: string): number {
  if (/[.?!]["”’]?$/.test(token)) return STOP;
  if (/[,;:]["”’]?$/.test(token)) return COMMA;
  return 0;
}

/** Times every script line inside its scene window ({start,end} in the final cut). */
export function timeScript(script: ScriptLine[], scenes: Record<string, { start: number; end: number }>): LineTiming[] {
  const lines = script.map((line) => timeLine(line, scenes));
  // Bridge the breath between lines: a blank frame or two between captions
  // reads as a flicker, so the last phrase holds until the next line begins.
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    if (!line.captioned || !next?.captioned) return;
    const last = line.chunks[line.chunks.length - 1];
    if (next.start - last.end < BRIDGE) last.end = next.chunks[0].start;
  });
  return lines;
}

function timeLine(line: ScriptLine, scenes: Record<string, { start: number; end: number }>): LineTiming {
  const win = scenes[line.scene];
  if (!win) throw new Error(`script line for unknown scene "${line.scene}"`);
  const tokens = line.text.trim().split(/\s+/);
  const weights = tokens.map(wordWeight);
  const pauses = tokens.map((t, i) => (i === tokens.length - 1 ? 0 : pauseAfter(t)));
  const natural = weights.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0);
  const available = win.end - win.start - LEAD - TAIL;
  const scale = Math.min(available / natural, MAX_STRETCH);
  if (scale < 0.85) {
    console.warn(`  [captions] "${line.scene}" reads ${(1 / scale).toFixed(2)}× fast — lengthen durations.${line.scene}`);
  }

  let t = win.start + LEAD;
  const words: Word[] = tokens.map((text, i) => {
    const w = { text, start: t, end: t + weights[i] * scale };
    t = w.end + pauses[i] * scale;
    return w;
  });

  const chunks: Chunk[] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const chars = cur.map((x) => x.text).join(' ').length;
    const next = words[i + 1];
    const nextChars = next ? chars + 1 + next.text.length : 0;
    const breakHere =
      !next ||
      (pauseAfter(w.text) > 0 && cur.length >= 2) ||
      cur.length >= CHUNK_WORDS ||
      nextChars > CHUNK_CHARS;
    if (breakHere) {
      chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
      cur = [];
    }
  });
  // Hold each chunk until the next one (or briefly after the line ends).
  chunks.forEach((c, i) => {
    c.end = i + 1 < chunks.length ? chunks[i + 1].start : Math.min(c.end + 0.45, win.end);
  });

  return {
    scene: line.scene,
    text: line.text,
    captioned: line.caption !== false,
    side: line.position === 'side',
    start: words[0].start,
    end: words[words.length - 1].end,
    chunks,
  };
}

const CSS = (ratio: 'landscape' | 'vertical', fontB64: string) => `
  @font-face { font-family: 'AdInter'; src: url(data:font/woff2;base64,${fontB64}) format('woff2'); font-weight: 700; }
  html, body { margin: 0; background: transparent; }
  .cap { position: fixed; left: 50%; transform: translateX(-50%); text-align: center;
    font-family: 'AdInter', system-ui, sans-serif; font-weight: 700; letter-spacing: -0.005em;
    background: rgba(26,26,26,0.88); border-radius: 14px; box-shadow: 0 14px 40px rgba(0,0,0,0.30);
    color: rgba(232,232,232,0.52); white-space: nowrap; }
  .cap .said { color: #E8E8E8; }
  .cap .now { color: #C49B2A; }
  .cap.side { left: 83.6%; bottom: 64px; white-space: normal; width: max-content; max-width: 330px; font-size: 32px; }
  ${
    ratio === 'landscape'
      ? '.cap { bottom: 46px; font-size: 38px; line-height: 1.2; padding: 12px 26px 14px; }'
      : '.cap { bottom: 120px; font-size: 31px; line-height: 1.25; padding: 12px 22px 14px; }'
  }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Renders the caption track for one ratio as PNG states plus an ffconcat list
 * (`<dir>/track.ffconcat`) covering exactly `total` seconds. Returns its path.
 */
export async function renderCaptionTrack(
  lines: LineTiming[],
  total: number,
  ratio: 'landscape' | 'vertical',
  vp: { width: number; height: number; dpr: number },
  dir: string,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const font = readFileSync(`${REPO_ROOT}public/fonts/inter-latin-700-normal.woff2`).toString('base64');

  // Every moment the overlay changes: a chunk appears/disappears or the spoken word advances.
  type State = { at: number; chunk: Chunk | null; active: number; side: boolean };
  const states: State[] = [{ at: 0, chunk: null, active: -1, side: false }];
  for (const line of lines) {
    if (!line.captioned) continue;
    const side = line.side && ratio === 'landscape';
    for (const c of line.chunks) {
      c.words.forEach((w, i) => states.push({ at: w.start, chunk: c, active: i, side }));
      // After the last word, the whole chunk reads as said.
      states.push({ at: c.words[c.words.length - 1].end, chunk: c, active: c.words.length, side });
      states.push({ at: c.end, chunk: null, active: -1, side: false });
    }
  }
  states.sort((a, b) => a.at - b.at);
  // Later entries at the same instant win (a chunk's end vs the next chunk's start).
  const timeline: State[] = [];
  for (const s of states) {
    const t = Math.round(s.at * 1000) / 1000;
    if (timeline.length && Math.abs(timeline[timeline.length - 1].at - t) < 1e-3) {
      // A blank never overrides a chunk starting at the same moment.
      if (s.chunk || !timeline[timeline.length - 1].chunk) timeline[timeline.length - 1] = { ...s, at: t };
    } else timeline.push({ ...s, at: t });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
  await page.setContent(`<!doctype html><html><head><style>${CSS(ratio, font)}</style></head><body><div class="cap" hidden></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);

  const files = new Map<string, string>();
  const list: string[] = ['ffconcat version 1.0'];
  for (let i = 0; i < timeline.length; i++) {
    const s = timeline[i];
    const until = i + 1 < timeline.length ? timeline[i + 1].at : total;
    const dur = Math.min(until, total) - s.at;
    if (dur <= 0) continue;
    const html = s.chunk
      ? s.chunk.words
          .map((w, j) => `<span class="${j < s.active ? 'said' : j === s.active ? 'now' : ''}">${esc(w.text)}</span>`)
          .join(' ')
      : '';
    const key = `${s.side}|${html}`;
    let file = files.get(key);
    if (!file) {
      file = `${dir}/s${String(files.size).padStart(4, '0')}.png`;
      await page.evaluate(
        ([h, side]) => {
          const el = document.querySelector('.cap') as HTMLElement;
          el.innerHTML = h;
          el.hidden = !h;
          el.classList.toggle('side', side);
        },
        [html, s.side] as const,
      );
      await page.screenshot({ path: file, omitBackground: true });
      files.set(key, file);
    }
    list.push(`file '${file}'`, `duration ${dur.toFixed(3)}`);
  }
  // The concat demuxer ignores the last entry's duration unless it's repeated.
  list.push(list[list.length - 2]);
  await browser.close();

  const out = `${dir}/track.ffconcat`;
  writeFileSync(out, list.join('\n') + '\n');
  return out;
}

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** SubRip file of the caption chunks, for editors and platforms that take captions. */
export function toSrt(lines: LineTiming[]): string {
  let n = 0;
  return lines
    .filter((l) => l.captioned)
    .flatMap((l) => l.chunks)
    .map((c) => `${++n}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.words.map((w) => w.text).join(' ')}\n`)
    .join('\n');
}
