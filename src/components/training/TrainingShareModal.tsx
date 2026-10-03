import { useState } from 'react';
import clsx from 'clsx';
import { BoardPanel } from '../BoardPanel';
import { CloseIcon } from '../icons/CloseIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { Blunder } from '../../models/blunder';
import { ImageShareActions } from '../share/ImageShareActions';
import { ShareImagePreview } from '../share/ShareImagePreview';
import { ShareFrame } from '../share/ShareFrame';
import { useRenderedImage } from '../share/useRenderedImage';

type ShareFormat = 'link' | 'png' | 'gif';

/** Board + caption bar + footer bar (boardCanvas layout: 8 + 0.8 + 0.85 squares tall). */
const SHARE_IMAGE_ASPECT = 8 / 9.65;

const FORMAT_LABEL: Record<ShareFormat, string> = {
  link: 'Link',
  png: 'Screenshot',
  gif: 'GIF',
};

/** The engine line from the puzzle position (stored PV, else the first correct move). */
function solutionUcis(blunder: Blunder): string[] {
  const pv = blunder.solutionLine?.pv ?? [];
  if (pv.length > 0) return pv.slice(0, 10);
  return blunder.correctMoves[0]?.move ? [blunder.correctMoves[0].move] : [];
}

/**
 * Share the current puzzle as a playable link, a branded screenshot, or a
 * GIF of the solution — one modal, the format picked with a small toggle.
 */
export function TrainingShareModal({
  blunder,
  shareUrl,
  sharePlayersLabel,
  shareOpeningLabel,
  shareAnonymous,
  setShareAnonymous,
  shareCopied,
  onCopy,
  onShared,
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
  /** Image/GIF shared or downloaded (share counter). */
  onShared: () => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ShareFormat>('link');
  const orientation = blunder.sideToMove === 'white' ? 'white' : 'black';
  const toPlay = `${blunder.sideToMove === 'white' ? 'White' : 'Black'} to play`;
  const solution = solutionUcis(blunder);
  const formats: ShareFormat[] = solution.length > 0 ? ['link', 'png', 'gif'] : ['link', 'png'];

  const image = useRenderedImage(format === 'link' ? null : format, async () => {
    if (format === 'png') {
      const { renderBoardPng } = await import('../../share/boardCanvas');
      return renderBoardPng({ fen: blunder.fen }, { size: 640, orientation, caption: `${toPlay}. Find the best move.` });
    }
    const { renderGif, framesFromMoves } = await import('../../share/gif');
    return renderGif(framesFromMoves(blunder.fen, solution), {
      size: 640,
      orientation,
      caption: `${toPlay}. The solution.`,
    });
  });

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

        <div role="radiogroup" aria-label="Share as" className="flex justify-center gap-1.5">
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              data-testid={`share-format-${f}`}
              onClick={() => setFormat(f)}
              className={clsx(
                'pill gap-1.5',
                format === f && 'bg-accent/15 border-accent hover:bg-accent/15',
              )}
            >
              <span
                className={clsx(
                  'flex h-3.5 w-3.5 items-center justify-center border-2',
                  format === f ? 'border-accent bg-accent text-bg' : 'border-text-primary',
                )}
              >
                {format === f && <CheckIcon className="h-2.5 w-2.5" />}
              </span>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="max-w-[300px] w-full mx-auto">
          {format === 'link' ? (
            <ShareFrame caption={`${toPlay}. Find the best move.`}>
              <BoardPanel
                fen={blunder.fen}
                orientation={orientation}
                movableFor={null}
                coordinates={false}
                viewOnly
                sounds={false}
              />
            </ShareFrame>
          ) : (
            <ShareImagePreview image={image} aspect={SHARE_IMAGE_ASPECT} />
          )}
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          {format === 'link' && sharePlayersLabel && !shareAnonymous && (
            <p className="text-sm font-medium text-text-primary">{sharePlayersLabel}</p>
          )}
          {format === 'link' && sharePlayersLabel && (
            <label className="flex items-center justify-center gap-2 text-text-primary text-xs cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={shareAnonymous}
                onChange={(e) => setShareAnonymous(e.currentTarget.checked)}
              />
              Hide player names
            </label>
          )}
          <p className="text-text-primary text-xs">
            {format === 'gif'
              ? 'Plays the solution, move by move.'
              : `${shareOpeningLabel ? `${shareOpeningLabel} · ` : ''}${toPlay}`}
          </p>
        </div>

        {format === 'link' ? (
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
        ) : (
          <ImageShareActions
            blob={image.blob}
            filename={`patternchess-puzzle.${format}`}
            title="Share this puzzle"
            shareText={format === 'png' ? `${toPlay}. Can you find the best move?` : 'Watch this combination.'}
            shareUrl={shareUrl}
            onShared={onShared}
          />
        )}
      </div>
    </div>
  );
}
