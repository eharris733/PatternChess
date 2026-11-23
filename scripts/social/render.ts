// Renders a puzzle to a 1080×1920 MP4 (+ a JPEG poster) with @napi-rs/canvas
// and ffmpeg. The board itself is drawn by the app's share renderer
// (src/share/boardCanvas.ts drawBoardFrame), so videos match share images.
//
//   node scripts/social/render.ts --blunder <id> [--remote] [--out <dir>] [--hook <id>]
//
// Layout respects both apps' overlays: nothing in the top 220px (Reels /
// TikTok header), the bottom 480px (caption, music bar) or, below y≈800, the
// right 140px (TikTok's like / comment / share rail).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Canvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { Chess } from 'chess.js';
import { drawBoardFrame, drawBrandMark, type PieceImages } from '../../src/share/boardCanvas.ts';
import { renderWav } from './audio.ts';
import { hookById, hookForDay, type Hook } from './copy.ts';
import { parseArgs, REPO_ROOT } from './env.ts';
import { buildPuzzle, type Puzzle } from './puzzle.ts';
import { COLORS, FPS, HEIGHT, WIDTH, frameAt, frameCount, schedule, type Frame, type Tone } from './timeline.ts';

const BOARD = 880;
const BX = 60;
const BY = 560;
const TEXT_X = 60;
const TEXT_W = 960;
const STATUS_Y = 470;
const STATUS_H = 66;

const SANS = 'Inter';
const MONO = 'JetBrains Mono';

const THEME = {
  light: '#f0d9b5',
  dark: '#c0ad90',
  lastMove: 'rgba(196, 155, 42, 0.5)',
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

const toneColor = (t: Tone) => (t === 'good' ? COLORS.good : t === 'bad' ? COLORS.bad : COLORS.paper);

/** Largest font (≤ max) at which `text` fits in `width`. */
function fitFont(ctx: SKRSContext2D, text: string, weight: number, family: string, max: number, width: number): number {
  let size = max;
  while (size > 24) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
    size -= 2;
  }
  return size;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface RenderContext {
  pieces: Record<string, Image>;
}

export async function makeRenderContext(): Promise<RenderContext> {
  registerFonts();
  return { pieces: await loadPieces() };
}

/** Paints one frame onto `canvas` (1080×1920). */
export function paintFrame(canvas: Canvas, board: Canvas, f: Frame, p: Puzzle, hook: Hook, rc: RenderContext): void {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // --- headline (two lines) -------------------------------------------------
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const line1 = f.endCard ? 'Train your own blunders like this.' : hook.line1(p);
  const line2 = f.endCard ? 'patternchess.com' : hook.line2(p);
  const s1 = fitFont(ctx, line1, 800, SANS, 62, TEXT_W);
  ctx.font = `800 ${s1}px ${SANS}`;
  ctx.fillStyle = COLORS.paper;
  ctx.fillText(line1, TEXT_X, 320);
  if (f.endCard) {
    const mark = 54;
    drawBrandMark(ctx as unknown as CanvasRenderingContext2D, TEXT_X - 8, 352, mark);
    const s2 = fitFont(ctx, line2, 700, MONO, 54, TEXT_W - mark - 10);
    ctx.font = `700 ${s2}px ${MONO}`;
    ctx.fillStyle = COLORS.gold;
    ctx.fillText(line2, TEXT_X + mark + 4, 400);
  } else {
    const s2 = fitFont(ctx, line2, 700, SANS, 56, TEXT_W);
    ctx.font = `700 ${s2}px ${SANS}`;
    ctx.fillStyle = COLORS.gold;
    ctx.fillText(line2, TEXT_X, 400);
  }

  // --- status row: pill + countdown ----------------------------------------
  const status = f.status.text;
  ctx.font = `700 34px ${SANS}`;
  const pillW = Math.min(ctx.measureText(status).width + 48, TEXT_W - (f.countdown ? 100 : 0));
  const tone = toneColor(f.status.tone);
  roundRect(ctx, TEXT_X, STATUS_Y, pillW, STATUS_H, STATUS_H / 2);
  if (f.status.tone === 'neutral') {
    ctx.fillStyle = p.side === 'white' ? COLORS.paper : '#000000';
    ctx.fill();
    ctx.strokeStyle = COLORS.paper;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = p.side === 'white' ? COLORS.ink : COLORS.paper;
  } else {
    ctx.fillStyle = tone;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
  }
  ctx.textBaseline = 'middle';
  ctx.fillText(status, TEXT_X + 24, STATUS_Y + STATUS_H / 2 + 1, pillW - 48);

  if (f.countdown) {
    const cx = BX + BOARD - 36;
    const cy = STATUS_Y + STATUS_H / 2;
    const r = 33;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(244,244,240,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.gold;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - f.countdown.fraction));
    ctx.stroke();
    ctx.fillStyle = COLORS.paper;
    ctx.font = `700 36px ${MONO}`;
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
  ctx.fillStyle = COLORS.goldDark;
  ctx.fillRect(BX - 6, BY - 6, BOARD + 12, BOARD + 12);
  ctx.drawImage(board, 0, 0, BOARD, BOARD, BX, BY, BOARD, BOARD);

  if (moving) {
    // Lift the piece off its square (repaint the empty square); whatever it
    // lands on stays drawn until it arrives.
    const [sx, sy] = squareXY(moving.from, white, unit);
    const dark = (moving.from.charCodeAt(0) - 97 + Number(moving.from[1]) - 1) % 2 === 0;
    ctx.fillStyle = dark ? THEME.dark : THEME.light;
    ctx.fillRect(BX + sx, BY + sy, unit, unit);
  }

  if (moving) {
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
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(r * 1.05)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.badge.text, cx, cy + 2);
    ctx.textAlign = 'left';
  }
}

export interface RenderResult {
  mp4: string;
  poster: string;
  duration: number;
}

/** Writes `<out>/<blunderId>.mp4` and `<out>/<blunderId>.jpg`. */
export async function renderPuzzle(p: Puzzle, hook: Hook, outDir: string, rc?: RenderContext): Promise<RenderResult> {
  rc ??= await makeRenderContext();
  mkdirSync(outDir, { recursive: true });
  const sched = schedule(p);
  const wav = join(outDir, `${p.blunderId}.wav`);
  writeFileSync(wav, renderWav(sched.cues, sched.duration));
  const mp4 = join(outDir, `${p.blunderId}.mp4`);
  const poster = join(outDir, `${p.blunderId}.jpg`);

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
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
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
      paintFrame(canvas, board, f, p, hook, rc);
      lastBuf = Buffer.from(canvas.data());
      lastKey = key;
    }
    if (!ff.stdin.write(lastBuf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;

  // Poster: the hook frame (what the review card and the feed grid show).
  paintFrame(canvas, board, frameAt(sched, 0.5), p, hook, rc);
  writeFileSync(poster, canvas.encodeSync('jpeg', 88));
  return { mp4, poster, duration: sched.duration };
}

// --- CLI --------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  if (typeof args.blunder !== 'string') {
    console.error('usage: node scripts/social/render.ts --blunder <id> [--remote] [--out <dir>] [--hook <id>]');
    process.exit(1);
  }
  const { fetchBlunder } = await import('./select.ts');
  const row = fetchBlunder(args.blunder, { remote: !!args.remote });
  if (!row) throw new Error(`no blunder ${args.blunder}`);
  const puzzle = buildPuzzle(row);
  if (!puzzle) throw new Error('this blunder cannot make a clean puzzle');
  const hook = typeof args.hook === 'string' ? hookById(args.hook) : hookForDay(new Date().toISOString().slice(0, 10));
  const out = typeof args.out === 'string' ? args.out : join(REPO_ROOT, 'marketing', 'social', 'out');
  const res = await renderPuzzle(puzzle, hook, out);
  console.log(`${res.mp4} (${res.duration.toFixed(1)}s)\n${res.poster}`);
}
