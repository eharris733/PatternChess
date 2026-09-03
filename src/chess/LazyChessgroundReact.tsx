import { lazy, Suspense } from 'react';
import type { ChessgroundReactProps } from './chessgroundReact';

// Code-split board for the public landing page. chessground + its piece-set
// CSS are ~60 kB gzipped that every visitor was paying for before any board
// scrolled into view; the gated app routes keep importing ChessgroundReact
// directly (they are lazy routes already). The fallback fills the parent's
// aspect-square box in the light square color so nothing shifts on load.
const Board = lazy(() =>
  import('./chessgroundReact').then((m) => ({ default: m.ChessgroundReact })),
);

export function LazyChessgroundReact(props: ChessgroundReactProps) {
  return (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          className="w-full h-full"
          style={{ background: 'var(--board-light)' }}
        />
      }
    >
      <Board {...props} />
    </Suspense>
  );
}
