/**
 * Canvas renderer for share images and GIFs: a board (fixed light palette,
 * cburnett pieces from chessground's own stylesheet) framed by a
 * PatternChess-branded footer. Pure canvas — no DOM board, no html2canvas —
 * so the same frames feed PNG screenshots and GIF encoding.
 */
import { Chess } from 'chess.js';

export type Orientation = 'white' | 'black';

export interface BoardFrame {
  fen: string;
  /** Squares of the move that led to this position, highlighted. */
  lastMove?: [string, string] | null;
  /** Optional arrow (e.g. the best move on a puzzle image). */
  arrow?: { from: string; to: string; color?: string } | null;
}

export interface BoardCanvasOptions {
  /** Board edge in CSS px (the canvas is this wide). */
  size: number;
  orientation: Orientation;
  /** Line above the board, e.g. "White to play" or a Moments caption. */
  caption?: string | null;
  /** Right-hand footer text; defaults to the site URL. */
  footerNote?: string;
  /** Colours; defaults to the app's current theme (readShareTheme). */
  theme?: ShareTheme;
}

/**
 * Share images follow the player's theme (board squares, last-move tint, and
 * the ink/paper of the caption and footer bars), so a screenshot or GIF looks
 * like the board they were just looking at. The brand mark stays gold.
 */
export interface ShareTheme {
  light: string;
  dark: string;
  lastMove: string;
  /** Bar background — the darker of the theme's text and page colours. */
  ink: string;
  /** Bar text — the lighter of the two. */
  paper: string;
}

const DEFAULT_THEME: ShareTheme = {
  light: '#f0d9b5',
  dark: '#c0ad90',
  lastMove: 'rgba(139, 105, 20, 0.45)',
  ink: '#1a1a1a',
  paper: '#f4f4f0',
};

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Current theme tokens from :root (see src/styles/themes.css). */
export function readShareTheme(): ShareTheme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const triplet = (name: string) => v(name).split(/\s+/).map(Number);
  const text = triplet('--text-primary');
  const bg = triplet('--bg');
  const valid = (t: number[]) => t.length === 3 && t.every((n) => Number.isFinite(n));
  const [inkRgb, paperRgb] =
    valid(text) && valid(bg) ? (luminance(text) < luminance(bg) ? [text, bg] : [bg, text]) : [null, null];
  return {
    light: v('--board-light') || DEFAULT_THEME.light,
    dark: v('--board-dark') || DEFAULT_THEME.dark,
    lastMove: v('--board-last-move') || DEFAULT_THEME.lastMove,
    ink: inkRgb ? `rgb(${inkRgb.join(',')})` : DEFAULT_THEME.ink,
    paper: paperRgb ? `rgb(${paperRgb.join(',')})` : DEFAULT_THEME.paper,
  };
}

export const GOLD_LIGHT = '#C49B2A';
export const GOLD_DARK = '#8B6914';
export const SITE_LABEL = 'patternchess.com';

const MONO = '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace';
const SANS = 'Inter, "Inter Fallback", system-ui, sans-serif';

export type PieceImages = Record<string, HTMLImageElement>; // key: 'wK', 'bp', …

let piecesPromise: Promise<PieceImages> | null = null;

const ROLE_LETTER: Record<string, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/** Loads the cburnett SVGs chessground already ships (embedded data URIs). */
export function loadPieceImages(): Promise<PieceImages> {
  piecesPromise ??= (async () => {
    const css = (await import('chessground/assets/chessground.cburnett.css?raw')).default;
    const re = /piece\.(\w+)\.(white|black)\s*\{\s*background-image:\s*url\('([^']+)'\)/g;
    const out: PieceImages = {};
    const loads: Promise<void>[] = [];
    for (const m of css.matchAll(re)) {
      const key = `${m[2] === 'white' ? 'w' : 'b'}${ROLE_LETTER[m[1]] ?? m[1]}`;
      const img = new Image();
      img.src = m[3];
      out[key] = img;
      loads.push(img.decode().catch(() => undefined));
    }
    await Promise.all(loads);
    return out;
  })();
  return piecesPromise;
}

/** Wait for the web fonts the canvas text uses (best effort). */
export async function loadShareFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 20px ${MONO}`),
    document.fonts.load(`700 20px ${SANS}`),
    document.fonts.load(`400 20px ${SANS}`),
  ]).catch(() => undefined);
}

function layout(opts: BoardCanvasOptions) {
  const unit = opts.size / 8;
  const captionH = opts.caption ? Math.round(unit * 0.8) : 0;
  const footerH = Math.round(unit * 0.85);
  return { unit, captionH, footerH, width: opts.size, height: captionH + opts.size + footerH };
}

/** Canvas sized for a frame (device pixel ratio applied for crisp PNGs). */
export function createBoardCanvas(opts: BoardCanvasOptions, scale = 1): HTMLCanvasElement {
  const { width, height } = layout(opts);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return canvas;
}

function squareXY(square: string, orientation: Orientation, unit: number): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return [col * unit, row * unit];
}

/** Brand mark (the gold L-pattern from BrandLogo) at x,y with edge `s`. */
export function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const k = s / 120;
  const rect = (rx: number, ry: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + (rx + 20) * k, y + ry * k, 40 * k, 40 * k);
  };
  rect(40, 0, GOLD_LIGHT);
  rect(40, 40, GOLD_DARK);
  rect(40, 80, GOLD_LIGHT);
  rect(0, 80, GOLD_DARK);
}

/** Footer bar: mark + wordmark on the left, a note on the right. */
export function drawFooter(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number,
  height: number,
  note: string,
  theme: ShareTheme = DEFAULT_THEME,
): void {
  ctx.fillStyle = theme.ink;
  ctx.fillRect(0, y, width, height);
  const pad = height * 0.25;
  const mark = height - pad * 2;
  drawBrandMark(ctx, pad, y + pad, mark);
  ctx.fillStyle = theme.paper;
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(height * 0.34)}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('PATTERNCHESS', pad * 1.6 + mark, y + height / 2);
  ctx.fillStyle = GOLD_LIGHT;
  ctx.font = `700 ${Math.round(height * 0.28)}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(note, width - pad, y + height / 2);
  ctx.textAlign = 'left';
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  unit: number,
  color: string,
): void {
  const [fx, fy] = [from[0] + unit / 2, from[1] + unit / 2];
  const [tx, ty] = [to[0] + unit / 2, to[1] + unit / 2];
  const angle = Math.atan2(ty - fy, tx - fx);
  const head = unit * 0.38;
  const ex = tx - Math.cos(angle) * head * 0.8;
  const ey = ty - Math.sin(angle) * head * 0.8;
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = unit * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - Math.cos(angle - 0.5) * head, ty - Math.sin(angle - 0.5) * head);
  ctx.lineTo(tx - Math.cos(angle + 0.5) * head, ty - Math.sin(angle + 0.5) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Paints one frame (caption, board, pieces, footer) onto `canvas`. */
export function drawBoardFrame(
  canvas: HTMLCanvasElement,
  frame: BoardFrame,
  opts: BoardCanvasOptions,
  pieces: PieceImages,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { unit, captionH, footerH, width } = layout(opts);
  const theme = opts.theme ?? readShareTheme();
  const scale = canvas.width / width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  if (captionH > 0 && opts.caption) {
    ctx.fillStyle = theme.ink;
    ctx.fillRect(0, 0, width, captionH);
    ctx.fillStyle = theme.paper;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(captionH * 0.42)}px ${SANS}`;
    ctx.fillText(opts.caption, width / 2, captionH / 2, width - unit * 0.6);
    ctx.textAlign = 'left';
  }

  ctx.save();
  ctx.translate(0, captionH);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? theme.light : theme.dark;
      ctx.fillRect(c * unit, r * unit, unit, unit);
    }
  }
  if (frame.lastMove) {
    ctx.fillStyle = theme.lastMove;
    for (const sq of frame.lastMove) {
      const [x, y] = squareXY(sq, opts.orientation, unit);
      ctx.fillRect(x, y, unit, unit);
    }
  }
  const board = new Chess(frame.fen).board();
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const img = pieces[`${piece.color}${piece.type}`];
      if (!img) continue;
      const [x, y] = squareXY(piece.square, opts.orientation, unit);
      ctx.drawImage(img, x, y, unit, unit);
    }
  }
  if (frame.arrow) {
    drawArrow(
      ctx,
      squareXY(frame.arrow.from, opts.orientation, unit),
      squareXY(frame.arrow.to, opts.orientation, unit),
      unit,
      frame.arrow.color ?? '#15781B',
    );
  }
  ctx.restore();

  drawFooter(ctx, captionH + opts.size, width, footerH, opts.footerNote ?? SITE_LABEL, theme);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), type),
  );
}

/** One branded PNG of a single position. */
export async function renderBoardPng(frame: BoardFrame, opts: BoardCanvasOptions): Promise<Blob> {
  const [pieces] = await Promise.all([loadPieceImages(), loadShareFonts()]);
  const canvas = createBoardCanvas(opts, 2);
  drawBoardFrame(canvas, frame, { ...opts, theme: opts.theme ?? readShareTheme() }, pieces);
  return canvasToBlob(canvas);
}
