import { useEffect, useState } from 'react';
import type { PieceSet } from '../lib/pieceSets';

/**
 * Image URLs of one piece set, keyed like chess.js ('wk', 'bn', …), for
 * previews outside the board (pickers, reward reveal, settings mini-boards).
 * Reuses the share canvas loader, so cburnett comes from chessground's CSS.
 */
export function usePieceImages(set: PieceSet): Record<string, string> | null {
  const [srcs, setSrcs] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../share/boardCanvas')
      .then(({ loadPieceImages }) => loadPieceImages(set))
      .then((imgs) => {
        if (!alive) return;
        setSrcs(Object.fromEntries(Object.entries(imgs).map(([k, img]) => [k, img.src])));
      })
      .catch(() => alive && setSrcs({}));
    return () => {
      alive = false;
    };
  }, [set]);
  return srcs;
}
