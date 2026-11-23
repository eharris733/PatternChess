/**
 * The positions behind the /profile training-setting previews
 * (TrainingPrefPreviews.tsx). Each scene is a real, legal position shown
 * through a 4×3 window; arrows are real moves and captions are their SAN
 * (prefPreviewScenes.test.ts checks all of it with chess.js, so the pictures
 * stay chess, not decoration).
 *
 * The story: White's knight on b5 can fork with Nc7+ (king e6, queen d5).
 * The player went Nd4+ instead, and the queen simply takes it (with check).
 */

export type Cell = [col: number, row: number];

export interface PreviewScene {
  /** Full position (White's view). */
  fen: string;
  /** Leftmost file of the window ('a'–'e') and its top rank (3–8). */
  left: string;
  top: number;
}

export interface PreviewMove {
  from: string;
  to: string;
  san: string;
}

/** Before the miss: White to move, Nc7+ forks king and queen. */
export const FORK_SCENE: PreviewScene = {
  fen: '8/8/4k3/1N1q4/8/8/8/6K1 w - - 0 1',
  left: 'b',
  top: 7,
};

/** The best move in FORK_SCENE. */
export const FORK_BEST: PreviewMove = { from: 'b5', to: 'c7', san: 'Nc7+' };

/** What the player played in FORK_SCENE. */
export const FORK_PLAYED: PreviewMove = { from: 'b5', to: 'd4', san: 'Nd4+' };

/** After the miss: Black to move, the queen takes the knight. */
export const REFUTE_SCENE: PreviewScene = {
  fen: '8/8/4k3/3q4/3N4/8/8/6K1 b - - 1 1',
  left: 'b',
  top: 6,
};

/** The refutation of FORK_PLAYED. */
export const REFUTE_MOVE: PreviewMove = { from: 'd5', to: 'd4', san: 'Qxd4+' };

export const WINDOW_COLS = 4;
export const WINDOW_ROWS = 3;

/** Window cell of a square, or null when the square is outside the window. */
export function cellOf(scene: PreviewScene, square: string): Cell | null {
  const col = square.charCodeAt(0) - scene.left.charCodeAt(0);
  const row = scene.top - Number(square[1]);
  if (col < 0 || col >= WINDOW_COLS || row < 0 || row >= WINDOW_ROWS) return null;
  return [col, row];
}

/** Pieces inside the window, keyed like chess.js ('wn', 'bq', …). */
export function windowPieces(scene: PreviewScene): Array<{ at: Cell; key: string; square: string }> {
  const out: Array<{ at: Cell; key: string; square: string }> = [];
  const rows = scene.fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const square = `${String.fromCharCode(97 + file)}${rank}`;
      const at = cellOf(scene, square);
      if (at) out.push({ at, key: `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toLowerCase()}`, square });
      file += 1;
    }
  });
  return out;
}

/** Whether the window's top-left square is light (a8 is light; colours follow the real board). */
export function topLeftIsLight(scene: PreviewScene): boolean {
  const file = scene.left.charCodeAt(0) - 97;
  // a1 (file 0, rank 1) is dark, so an even file index + rank is light.
  return (file + scene.top) % 2 === 0;
}
