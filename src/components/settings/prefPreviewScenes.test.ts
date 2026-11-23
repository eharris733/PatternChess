import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  FORK_BEST,
  FORK_PLAYED,
  FORK_SCENE,
  REFUTE_MOVE,
  REFUTE_SCENE,
  cellOf,
  topLeftIsLight,
  windowPieces,
  type PreviewMove,
  type PreviewScene,
} from './prefPreviewScenes';

function playSan(scene: PreviewScene, move: PreviewMove): string {
  const chess = new Chess(scene.fen);
  return chess.move({ from: move.from, to: move.to }).san;
}

describe('training setting preview scenes', () => {
  it('are legal positions', () => {
    for (const scene of [FORK_SCENE, REFUTE_SCENE]) expect(() => new Chess(scene.fen)).not.toThrow();
  });

  it('captions are the real SAN of each arrow', () => {
    expect(playSan(FORK_SCENE, FORK_BEST)).toBe(FORK_BEST.san);
    expect(playSan(FORK_SCENE, FORK_PLAYED)).toBe(FORK_PLAYED.san);
    expect(playSan(REFUTE_SCENE, REFUTE_MOVE)).toBe(REFUTE_MOVE.san);
  });

  it('the refutation scene is the position after the played move', () => {
    const chess = new Chess(FORK_SCENE.fen);
    chess.move({ from: FORK_PLAYED.from, to: FORK_PLAYED.to });
    expect(chess.fen()).toBe(REFUTE_SCENE.fen);
  });

  it('every drawn arrow starts and ends inside its window', () => {
    // The played move is a caption only; its knight shows on d4 in REFUTE_SCENE.
    for (const [scene, move] of [
      [FORK_SCENE, FORK_BEST],
      [REFUTE_SCENE, REFUTE_MOVE],
    ] as const) {
      expect(cellOf(scene, move.from)).not.toBeNull();
      expect(cellOf(scene, move.to)).not.toBeNull();
    }
  });

  it('shows the pieces the story needs', () => {
    expect(windowPieces(FORK_SCENE).map((p) => `${p.key}@${p.square}`).sort()).toEqual(['bk@e6', 'bq@d5', 'wn@b5']);
    expect(windowPieces(REFUTE_SCENE).map((p) => `${p.key}@${p.square}`).sort()).toEqual(['bk@e6', 'bq@d5', 'wn@d4']);
  });

  it('square colours follow the real board', () => {
    // b7 is light, b6 is dark.
    expect(topLeftIsLight(FORK_SCENE)).toBe(true);
    expect(topLeftIsLight(REFUTE_SCENE)).toBe(false);
  });
});
