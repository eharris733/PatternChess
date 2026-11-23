// Renders a puzzle to a 1080×1920 MP4 (+ a JPEG poster) with @napi-rs/canvas
// and ffmpeg, in the site's look: paper background, ink text, mono headline,
// a 2px-ink-border-and-hard-shadow board (scaled up), gold accents and the
// serif PatternChess wordmark. The board itself is drawn by the app's share
// renderer (src/share/boardCanvas.ts drawBoardFrame), so videos match share
// images.
//
//   node scripts/social/render.ts --blunder <id> [--remote] [--out <dir>] [--template] [--no-voice]
//   node scripts/social/render.ts --trap <fen>|<uci> --players <n> [...]
//
// Layout respects both apps' overlays: nothing in the top 220px (Reels /
// TikTok header), the bottom 480px (caption, music bar) or, below y≈800, the
// right 140px (TikTok's like / comment / share rail).
//
//   236–282   wordmark
//   300–410   headline (mono caps) + gold subline
//   430–548   captions (the narrator's words, current word highlighted)
//   568–626   status pill + countdown ring
//   642–1426  board (784px) with its ink frame and shadow
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Canvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { Chess } from 'chess.js';
import { drawBoardFrame, type PieceImages } from '../../src/share/boardCanvas.ts';
import { renderWav, type VoiceClip } from './audio.ts';
import { endCardLines } from './copy.ts';
import { parseArgs, REPO_ROOT } from './env.ts';
import { buildPuzzle, type Puzzle } from './puzzle.ts';
import type { VideoScript } from './script.ts';
import { COLORS, FPS, HEIGHT, WIDTH, frameAt, frameCount, schedule, type Frame, type Tone } from './timeline.ts';
import type { VoiceTrack } from './voice.ts';

const BOARD = 784;
const BX = 60;
const BY = 642;
const FRAME = 6;
const SHADOW = 14;
const TEXT_X = 60;
const TEXT_W = 960;
const WORDMARK_Y = 236;
const WORDMARK_H = 46;
const HEADLINE_Y = 352;
const SUBLINE_Y = 408;
const CAPTION_TOP = 430;
const CAPTION_H = 118;
const STATUS_Y = 568;
const STATUS_H = 58;

const SANS = 'Inter';
const MONO = 'JetBrains Mono';

const THEME = {
  light: '#f0d9b5',
  dark: '#c0ad90',
  lastMove: 'rgba(139, 105, 20, 0.45)',
  ink: COLORS.ink,
  paper: COLORS.paper,
};

let fontsReady = false;
function registerFonts(): void {
  if (fontsReady) return;
  const dir = (pkg: string) => join(REPO_ROOT, 'node_modules', '@fontsource', pkg, 'files');
  for (const w of [400, 600, 700, 800]) {
    GlobalFonts.registerFromPath(join(dir('inter'), `inter-latin-${w}-normal.woff`), SANS);
  }
  GlobalFonts.registerFromPath(join(dir('jetbrains-mono'), 'jetbrains-mono-latin-700-normal.woff'), MONO);
  fontsReady = true;
}

const ROLE_LETTER: Record<string, string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

/** The cburnett SVGs embedded in chessground's stylesheet (what loadPieceImages does in the browser). */
async function loadPieces(): Promise<Record<string, Image>> {
  const css = readFileSync(join(REPO_ROOT, 'node_modules/chessground/assets/chessground.cburnett.css'), 'utf8');
  const re = /piece\.(\w+)\.(white|black)\s*\{\s*background-image:\s*url\('data:image\/svg\+xml;base64,([^']+)'\)/g;
  const out: Record<string, Image> = {};
  for (const m of css.matchAll(re)) {
    out[`${m[2] === 'white' ? 'w' : 'b'}${ROLE_LETTER[m[1]] ?? m[1]}`] = await loadImage(Buffer.from(m[3], 'base64'));
  }
  if (Object.keys(out).length !== 12) throw new Error(`expected 12 piece images, got ${Object.keys(out).length}`);
  return out;
}

function squareXY(square: string, white: boolean, unit: number): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return [(white ? file : 7 - file) * unit, (white ? 7 - rank : rank) * unit];
}

const toneColor = (t: Tone) => (t === 'good' ? COLORS.good : t === 'bad' ? COLORS.bad : COLORS.surface);

/** Largest font (≤ max) at which `text` fits in `width`. */
function fitFont(ctx: SKRSContext2D, text: string, weight: number, family: string, max: number, width: number, min = 24): number {
  let size = max;
  while (size > min) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
    size -= 2;
  }
  return size;
}

/** A site card: ink fill offset as a hard shadow, ink border, then the face. */
function card(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, face: string, border = 4, shadow = 6): void {
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x + shadow, y + shadow, w, h);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = face;
  ctx.fillRect(x + border, y + border, w - border * 2, h - border * 2);
}

export interface RenderContext {
  pieces: Record<string, Image>;
  wordmark: Image;
}

export async function makeRenderContext(): Promise<RenderContext> {
  registerFonts();
  return {
    pieces: await loadPieces(),
    wordmark: await loadImage(readFileSync(join(REPO_ROOT, 'scripts', 'social', 'assets', 'wordmark.png'))),
  };
}

export interface OnScreenText {
  headline: string;
  subline: string;
}

function drawCaption(ctx: SKRSContext2D, caption: NonNullable<Frame['caption']>): void {
  const text = caption.words.join(' ');
  const size = fitFont(ctx, text, 800, SANS, 56, TEXT_W - 20, 34);
  ctx.font = `800 ${size}px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width;
  const widths = caption.words.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, w) => a + w, 0) + space * (caption.words.length - 1);
  let x = TEXT_X + Math.max(0, (TEXT_W - total) / 2);
  const cy = CAPTION_TOP + CAPTION_H / 2;
  caption.words.forEach((w, i) => {
    if (i === caption.active) {
      const padX = 10;
      const h = size * 1.25;
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(x - padX, cy - h / 2, widths[i] + padX * 2, h);
    }
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(w, x, cy + 2);
    x += widths[i] + space;
  });
}

/** Paints one frame onto `canvas` (1080×1920). */
export function paintFrame(canvas: Canvas, board: Canvas, f: Frame, p: Puzzle, text: OnScreenText, rc: RenderContext): void {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // --- wordmark + headline -------------------------------------------------------
  const wmW = Math.round((WORDMARK_H * rc.wordmark.width) / rc.wordmark.height);
  ctx.drawImage(rc.wordmark, TEXT_X - 4, WORDMARK_Y, wmW, WORDMARK_H);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const [endLine1, endLine2] = endCardLines(p);
  const line1 = (f.endCard ? endLine1 : text.headline).toUpperCase();
  const line2 = f.endCard ? endLine2 : text.subline;
  const s1 = fitFont(ctx, line1, 700, MONO, 60, TEXT_W);
  ctx.font = `700 ${s1}px ${MONO}`;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(line1, TEXT_X, HEADLINE_Y);
  const s2 = fitFont(ctx, line2, 700, f.endCard ? MONO : SANS, 44, TEXT_W);
  ctx.font = `700 ${s2}px ${f.endCard ? MONO : SANS}`;
  ctx.fillStyle = COLORS.goldDark;
  ctx.fillText(line2, TEXT_X, SUBLINE_Y);

  // --- captions --------------------------------------------------------------------
  if (f.caption) drawCaption(ctx, f.caption);

  // --- status row: pill + countdown ----------------------------------------------
  const status = f.status.text;
  ctx.font = `700 30px ${MONO}`;
  const pillW = Math.min(ctx.measureText(status).width + 48, TEXT_W - (f.countdown ? 110 : 0));
  const neutralDark = f.status.tone === 'neutral' && p.side === 'black';
  const face = f.status.tone === 'neutral' ? (neutralDark ? COLORS.ink : COLORS.surface) : toneColor(f.status.tone);
  card(ctx, TEXT_X, STATUS_Y, pillW, STATUS_H, face, 4, 5);
  ctx.fillStyle = f.status.tone === 'neutral' && !neutralDark ? COLORS.ink : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(status, TEXT_X + 24, STATUS_Y + STATUS_H / 2 + 1, pillW - 48);

  if (f.countdown) {
    const cx = BX + BOARD - 30;
    const cy = STATUS_Y + STATUS_H / 2;
    const r = 27;
    ctx.fillStyle = COLORS.surface;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(26,26,26,0.15)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.goldDark;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - f.countdown.fraction));
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 30px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(f.countdown.left), cx, cy + 2);
    ctx.textAlign = 'left';
  }

  // --- board ------------------------------------------------------------------
  const white = p.side === 'white';
  const unit = BOARD / 8;
  let moving: { key: string; from: string; to: string; progress: number } | null = null;
  if (f.slide) {
    const piece = new Chess(f.fen).get(f.slide.from as never);
    // Promotions arrive as the new piece.
    const after = new Chess(f.slide.fenAfter).get(f.slide.to as never);
    const shown = after ?? piece;
    if (shown) moving = { key: `${shown.color}${shown.type}`, ...f.slide };
  }
  drawBoardFrame(
    board as unknown as HTMLCanvasElement,
    { fen: f.fen, lastMove: f.lastMove, arrow: f.arrow },
    { size: BOARD, orientation: white ? 'white' : 'black', theme: THEME },
    rc.pieces as unknown as PieceImages,
  );
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(BX - FRAME + SHADOW, BY - FRAME + SHADOW, BOARD + FRAME * 2, BOARD + FRAME * 2);
  ctx.fillRect(BX - FRAME, BY - FRAME, BOARD + FRAME * 2, BOARD + FRAME * 2);
  ctx.drawImage(board, 0, 0, BOARD, BOARD, BX, BY, BOARD, BOARD);

  if (moving) {
    // Lift the piece off its square (repaint the empty square); whatever it
    // lands on stays drawn until it arrives.
    const [sx, sy] = squareXY(moving.from, white, unit);
    const dark = (moving.from.charCodeAt(0) - 97 + Number(moving.from[1]) - 1) % 2 === 0;
    ctx.fillStyle = dark ? THEME.dark : THEME.light;
    ctx.fillRect(BX + sx, BY + sy, unit, unit);
    const [fx, fy] = squareXY(moving.from, white, unit);
    const [tx, ty] = squareXY(moving.to, white, unit);
    const img = rc.pieces[moving.key];
    if (img) {
      const x = fx + (tx - fx) * moving.progress;
      const y = fy + (ty - fy) * moving.progress;
      ctx.drawImage(img, BX + x, BY + y, unit, unit);
    }
  }

  if (f.badge) {
    const [x, y] = squareXY(f.badge.square, white, unit);
    const r = unit * 0.3;
    const cx = BX + x + unit - r * 0.55;
    const cy = BY + y + r * 0.55;
    ctx.fillStyle = toneColor(f.badge.tone);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(r * 1.05)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.badge.text, cx, cy + 2);
    ctx.textAlign = 'left';
  }

  if (f.endCard) {
    // The brand card over the board: big wordmark + the domain.
    const w = 640;
    const h = Math.round((w * rc.wordmark.height) / rc.wordmark.width);
    const cardW = w + 120;
    const cardH = h + 170;
    const x = BX + (BOARD - cardW) / 2;
    const y = BY + (BOARD - cardH) / 2;
    card(ctx, x, y, cardW, cardH, COLORS.paper, 6, 12);
    ctx.drawImage(rc.wordmark, x + 60, y + 50, w, h);
    ctx.font = `700 44px ${MONO}`;
    ctx.fillStyle = COLORS.goldDark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('patternchess.com', x + cardW / 2, y + cardH - 44);
    ctx.textAlign = 'left';
  }
}

export interface RenderResult {
  mp4: string;
  poster: string;
  duration: number;
}

/** Writes `<out>/<name>.mp4` and `<out>/<name>.jpg`. */
export async function renderPuzzle(
  p: Puzzle,
  script: Pick<VideoScript, 'headline' | 'subline'>,
  voice: VoiceTrack,
  outDir: string,
  rc?: RenderContext,
  name = p.blunderId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60),
): Promise<RenderResult> {
  rc ??= await makeRenderContext();
  mkdirSync(outDir, { recursive: true });
  const sched = schedule(p, voice);
  const clips: VoiceClip[] = sched.voice.map((v) => ({ t: v.t, samples: voice[v.beat]!.samples }));
  const wav = join(outDir, `${name}.wav`);
  writeFileSync(wav, renderWav(sched.cues, sched.duration, clips));
  const mp4 = join(outDir, `${name}.mp4`);
  const poster = join(outDir, `${name}.jpg`);
  const text = { headline: script.headline, subline: script.subline };

  const canvas = new Canvas(WIDTH, HEIGHT);
  const board = new Canvas(BOARD, BOARD + Math.round((BOARD / 8) * 0.85));

  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', String(FPS), '-i', 'pipe:0',
      '-i', wav,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-profile:v', 'high', '-level', '4.1',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
      '-shortest', '-movflags', '+faststart',
      mp4,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<void>((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  let lastKey = '';
  let lastBuf: Buffer | null = null;
  const n = frameCount(sched);
  for (let i = 0; i < n; i++) {
    const f = frameAt(sched, i / FPS);
    const key = JSON.stringify(f);
    if (key !== lastKey || !lastBuf) {
      paintFrame(canvas, board, f, p, text, rc);
      lastBuf = Buffer.from(canvas.data());
      lastKey = key;
    }
    if (!ff.stdin.write(lastBuf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;

  // Poster: the hook frame without a caption (what the review card and the feed grid show).
  paintFrame(canvas, board, { ...frameAt(sched, 0.5), caption: null }, p, text, rc);
  writeFileSync(poster, canvas.encodeSync('jpeg', 88));
  return { mp4, poster, duration: sched.duration };
}

// --- CLI --------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  const target = { remote: !!args.remote };
  const out = typeof args.out === 'string' ? args.out : join(REPO_ROOT, 'marketing', 'social', 'out');
  if (args.template) process.env.SOCIAL_SCRIPT_WRITER = 'template';
  let puzzle: Puzzle | null = null;
  if (typeof args.blunder === 'string') {
    const { fetchBlunder } = await import('./select.ts');
    const row = fetchBlunder(args.blunder, target);
    if (!row) throw new Error(`no blunder ${args.blunder}`);
    puzzle = buildPuzzle(row);
  } else if (typeof args.trap === 'string') {
    const [fen, uci] = args.trap.split('|');
    const { prepareFall } = await import('./fall.ts');
    const res = await prepareFall({ fen, played_move: uci, players: Number(args.players ?? 3) });
    if (!res.ok) throw new Error(res.reason);
    puzzle = res.puzzle;
  } else {
    console.error('usage: node scripts/social/render.ts (--blunder <id> | --trap "<fen>|<uci>" --players <n>) [--remote] [--out <dir>] [--template] [--no-voice]');
    process.exit(1);
  }
  if (!puzzle) throw new Error('this position cannot make a clean puzzle');
  const { writeScript } = await import('./script.ts');
  const { COUNTDOWN_SECONDS } = await import('./timeline.ts');
  const written = await writeScript(puzzle, COUNTDOWN_SECONDS);
  console.log(`script (${written.source}):\n${JSON.stringify(written.script, null, 2)}`);
  if (written.errors.length) console.log(`rejected attempts:\n  ${written.errors.join('\n  ')}`);
  const { voiceScript } = await import('./voice.ts');
  const voice = args['no-voice'] ? {} : await voiceScript(written.script.beats);
  const res = await renderPuzzle(puzzle, written.script, voice, out);
  console.log(`${res.mp4} (${res.duration.toFixed(1)}s)\n${res.poster}`);
}
