import { useMemo } from 'react';
import type { Key } from 'chessground/types';
import { LazyChessgroundReact } from '../../chess/LazyChessgroundReact';
import { uciToSan } from '../../chess/moveUtils';
import type { BlunderCandidate } from '../../stockfish/stockfishWorkerClient';

interface Props {
  blunder: BlunderCandidate;
  moveLabel?: string;
}

export function BlunderPreview({ blunder, moveLabel }: Props) {
  const orientation = blunder.sideToMove === 'black' ? 'black' : 'white';

  const playedSan = useMemo(
    () => uciToSan(blunder.fen, blunder.playedMove) ?? blunder.playedMove,
    [blunder.fen, blunder.playedMove],
  );
  const bestUci = blunder.correctMoves[0]?.move ?? '';
  const bestSan = useMemo(
    () => (bestUci ? uciToSan(blunder.fen, bestUci) ?? bestUci : '—'),
    [blunder.fen, bestUci],
  );

  const playedMoveSquares = {
    [blunder.playedMove.slice(0, 2)]: 'last-move',
    [blunder.playedMove.slice(2, 4)]: 'last-move',
  } as Record<string, string>;

  const config = useMemo(
    () => ({
      fen: blunder.fen,
      orientation: orientation as 'white' | 'black',
      viewOnly: true,
      coordinates: true,
      animation: { enabled: false, duration: 0 },
      drawable: {
        autoShapes: bestUci
          ? [
              {
                orig: bestUci.slice(0, 2) as Key,
                dest: bestUci.slice(2, 4) as Key,
                brush: 'green',
              },
            ]
          : [],
      },
      highlight: { lastMove: true, check: true },
      lastMove: [
        blunder.playedMove.slice(0, 2) as Key,
        blunder.playedMove.slice(2, 4) as Key,
      ],
    }),
    [blunder.fen, blunder.playedMove, bestUci, orientation],
  );

  // playedMoveSquares is computed for readability; chessground reads from `lastMove`.
  void playedMoveSquares;

  return (
    <div className="border-2 border-text-primary bg-surface">
      <div className="grid md:grid-cols-[280px_1fr]">
        <div className="border-b-2 md:border-b-0 md:border-r-2 border-text-primary p-4 bg-bg">
          <div className="aspect-square w-full">
            <LazyChessgroundReact config={config} />
          </div>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {moveLabel && (
            <div className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              {moveLabel}
            </div>
          )}
          <div className="font-mono uppercase text-base sm:text-lg leading-relaxed text-text-primary">
            You played{' '}
            <span className="font-bold">{playedSan}</span>.
            <br />
            <span className="text-gold-dark">{bestSan}</span> was{' '}
            <span className="text-gold-dark font-bold">{blunder.evalSwing}%</span> stronger.
          </div>
          <div className="mt-auto pt-4 border-t-2 border-text-primary/10">
            <div className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              This is one position. We find every blunder like it.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
