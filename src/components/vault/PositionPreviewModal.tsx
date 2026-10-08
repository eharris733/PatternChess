import { useState } from 'react';
import { uciToSan, fenSideToMove } from '../../chess/moveUtils';
import { orderedPlayers } from '../../models/gameRecord';
import type { GameRecord } from '../../models/gameRecord';
import type { Blunder } from '../../models/blunder';
import { MOTIF_LABEL } from '../../chess/motifs';
import { MiniBoard } from '../MiniBoard';
import { CloseIcon } from '../icons/CloseIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { PositionShareModal } from '../share/PositionShareModal';
import { blunderOrientation } from './vaultHelpers';

export function PositionPreviewModal({
  blunder,
  game,
  onClose,
}: {
  blunder: Blunder;
  game: GameRecord | null;
  onClose: () => void;
}) {
  // Share replaces this dialog rather than stacking a second one.
  const [sharing, setSharing] = useState(false);
  const played = uciToSan(blunder.fen, blunder.playedMove) ?? blunder.playedMove;
  const bestUci = blunder.correctMoves[0]?.move;
  const best = bestUci ? (uciToSan(blunder.fen, bestUci) ?? bestUci) : null;
  const sideToMove = fenSideToMove(blunder.fen);
  if (sharing) return <PositionShareModal blunder={blunder} game={game} onClose={onClose} />;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Blunder position"
      onClick={onClose}
    >
      <div
        className="card max-w-sm w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="heading-md">Move {blunder.moveNumber}</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              {sideToMove === 'white' ? 'White' : 'Black'} to move
              {game && ` · ${orderedPlayers(game.username, game.opponent, game.userColor).join(' vs ')}`}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost h-8 px-2 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <MiniBoard
          fen={blunder.fen}
          orientation={game ? blunderOrientation(game, blunder) : sideToMove}
          className="w-full"
        />
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="label">Played</span>
            <span className="font-mono text-incorrect">{played}?</span>
          </div>
          {best && (
            <div className="flex items-center justify-between gap-3">
              <span className="label">Best</span>
              <span className="font-mono text-correct">{best}</span>
            </div>
          )}
          {blunder.motifs.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="label">Motifs</span>
              <span className="flex flex-wrap justify-end gap-1.5">
                {blunder.motifs.map((m) => (
                  <span
                    key={m}
                    className="px-1.5 py-0.5 border-2 border-text-primary/30 font-mono text-[10px] uppercase tracking-tight text-text-secondary"
                  >
                    {MOTIF_LABEL[m]}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-outline self-start inline-flex items-center gap-1.5"
          onClick={() => setSharing(true)}
        >
          <ShareIcon className="h-4 w-4" />
          Share
        </button>
      </div>
    </div>
  );
}
