import { BoardPanel } from '../BoardPanel';
import { CloseIcon } from '../icons/CloseIcon';
import { Blunder } from '../../models/blunder';

/** Modal for sharing a public link to the current puzzle (with a name-hiding toggle). */
export function TrainingShareModal({
  blunder,
  shareUrl,
  sharePlayersLabel,
  shareOpeningLabel,
  shareAnonymous,
  setShareAnonymous,
  shareCopied,
  onCopy,
  onClose,
}: {
  blunder: Blunder;
  shareUrl: string;
  sharePlayersLabel: string | null;
  shareOpeningLabel: string | null;
  shareAnonymous: boolean;
  setShareAnonymous: (value: boolean) => void;
  shareCopied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this puzzle"
      onClick={onClose}
    >
      <div
        className="card relative max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="btn-ghost absolute top-3 right-3 p-1 text-text-secondary hover:text-text-primary"
          onClick={onClose}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <h2 className="heading-lg text-center">Share this puzzle</h2>
        <div className="max-w-[280px] w-full mx-auto">
          <BoardPanel
            fen={blunder.fen}
            orientation={blunder.sideToMove === 'white' ? 'white' : 'black'}
            movableFor={null}
            coordinates={false}
            viewOnly
          />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          {sharePlayersLabel && !shareAnonymous && (
            <p className="text-sm font-medium text-text-primary">{sharePlayersLabel}</p>
          )}
          {sharePlayersLabel && (
            <label className="flex items-center justify-center gap-2 text-text-secondary text-xs cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={shareAnonymous}
                onChange={(e) => setShareAnonymous(e.currentTarget.checked)}
              />
              Hide player names
            </label>
          )}
          <p className="text-text-secondary text-xs">
            {shareOpeningLabel ? `${shareOpeningLabel} · ` : ''}
            {blunder.sideToMove === 'white' ? 'White' : 'Black'} to play
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input flex-1 font-mono text-xs"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Share link"
          />
          <button type="button" className="btn-primary shrink-0" onClick={onCopy}>
            {shareCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
