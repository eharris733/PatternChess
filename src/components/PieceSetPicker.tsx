import clsx from 'clsx';
import { useT } from '../i18n/useT';
import { openSupporterUnlock } from '../state/supporterUnlockStore';
import { PIECE_SETS, PIECE_SET_INFO, type PieceSet } from '../lib/pieceSets';
import { usePieceImages } from '../hooks/usePieceImages';
import { LockIcon } from './icons/LockIcon';

/** Four pieces of one set on the current theme's squares. */
export function PieceSetStrip({ set, className }: { set: PieceSet; className?: string }) {
  const srcs = usePieceImages(set);
  const keys = ['wk', 'wn', 'bq', 'bp'];
  return (
    <div className={clsx('grid grid-cols-4 border border-text-primary/40', className)} aria-hidden>
      {keys.map((k, i) => (
        <div
          key={k}
          className="aspect-square"
          style={{ backgroundColor: i % 2 === 0 ? 'var(--board-light)' : 'var(--board-dark)' }}
        >
          {srcs?.[k] && <img src={srcs[k]} alt="" className="h-full w-full" draggable={false} />}
        </div>
      ))}
    </div>
  );
}

interface PieceSetPickerProps {
  value: PieceSet;
  onChange: (set: PieceSet) => void;
  /** Reward sets the player hasn't unlocked (src/lib/rewards.ts) and what unlocks each. */
  locked?: (set: PieceSet) => string | null;
}

/** /profile "Pieces": every bundled set with a live preview and its credit (public/pieces/LICENSES.md). */
export function PieceSetPicker({ value, onChange, locked }: PieceSetPickerProps) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="piece-set-picker">
      {PIECE_SETS.map((set) => {
        const info = PIECE_SET_INFO[set];
        const active = value === set;
        const lockHint = locked?.(set) ?? null;
        return (
          <button
            key={set}
            type="button"
            aria-pressed={active}
            aria-label={lockHint ? `${info.label} (locked: ${lockHint})` : undefined}
            data-testid={`piece-set-option-${set}`}
            data-locked={lockHint != null || undefined}
            onClick={() =>
              lockHint
                ? openSupporterUnlock({
                    item: t('supporterUnlock.pieceSet', { name: info.label }),
                    earnHint: t('supporterUnlock.orEarn', { hint: lockHint }),
                  })
                : onChange(set)
            }
            className={clsx(
              'flex flex-col gap-2 border-2 bg-surface p-3 text-left transition-all',
              active ? 'border-text-primary shadow-card' : 'border-text-primary/30 hover:border-text-primary',
              lockHint && 'hover:border-text-primary/60',
            )}
          >
            <PieceSetStrip set={set} className={clsx(lockHint && 'opacity-50')} />
            <span className="flex items-center gap-1 text-xs font-semibold text-text-primary">
              {lockHint && <LockIcon className="h-3.5 w-3.5" />}
              {info.label}
            </span>
            <span className="text-[11px] leading-tight text-text-primary">
              {lockHint ?? `${info.author} · ${info.licence}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
