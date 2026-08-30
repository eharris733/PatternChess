import { useMemo } from 'react';
import clsx from 'clsx';
import { ChessgroundReact } from '../chess/chessgroundReact';

/** Static non-interactive board thumbnail for list cards and previews. */
export function MiniBoard({
  fen,
  orientation = 'white',
  className,
}: {
  fen: string;
  orientation?: 'white' | 'black';
  className?: string;
}) {
  const config = useMemo(
    () => ({
      fen,
      orientation,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false, duration: 0 },
      highlight: { lastMove: false, check: false },
      drawable: { autoShapes: [] },
    }),
    [fen, orientation],
  );

  return (
    <div className={clsx('aspect-square pointer-events-none', className)}>
      <ChessgroundReact config={config} />
    </div>
  );
}
