/**
 * Animated GIF of a move sequence, PatternChess-branded (see boardCanvas).
 * gifenc is imported lazily so it only ships with share actions.
 */
import { Chess } from 'chess.js';
import {
  createBoardCanvas,
  drawBoardFrame,
  loadPieceImages,
  loadShareFonts,
  readShareTheme,
  type BoardCanvasOptions,
  type BoardFrame,
} from './boardCanvas';

/**
 * Frames for `startFen` followed by each move (SAN or UCI). Stops at the
 * first illegal move rather than throwing, so a bad tail still exports.
 */
export function framesFromMoves(startFen: string, moves: string[]): BoardFrame[] {
  const chess = new Chess(startFen);
  const frames: BoardFrame[] = [{ fen: chess.fen(), lastMove: null }];
  for (const mv of moves) {
    let played;
    try {
      played = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(mv)
        ? chess.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] })
        : chess.move(mv);
    } catch {
      break;
    }
    frames.push({ fen: chess.fen(), lastMove: [played.from, played.to] });
  }
  return frames;
}

export interface GifOptions extends BoardCanvasOptions {
  /** Delay per move in ms. */
  frameMs?: number;
  /** Hold on the first and last frame, ms. */
  holdMs?: number;
}

export async function renderGif(frames: BoardFrame[], opts: GifOptions): Promise<Blob> {
  const [{ GIFEncoder, quantize, applyPalette }, pieces] = await Promise.all([
    import('gifenc'),
    loadPieceImages(),
    loadShareFonts(),
  ]);
  // Theme read once: every frame shares it (and the palette stays stable).
  const themed = { ...opts, theme: opts.theme ?? readShareTheme() };
  const canvas = createBoardCanvas(themed, 1);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas unavailable');
  const frameMs = opts.frameMs ?? 800;
  const holdMs = opts.holdMs ?? 1600;
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    drawBoardFrame(canvas, frame, themed, pieces);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    const last = i === frames.length - 1;
    gif.writeFrame(index, canvas.width, canvas.height, {
      palette,
      delay: i === 0 || last ? holdMs : frameMs,
    });
  });
  gif.finish();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
}
