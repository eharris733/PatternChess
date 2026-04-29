import clsx from 'clsx';

export function BoardControls({
  canPrev,
  canNext,
  onFirst,
  onPrev,
  onNext,
  onLast,
  externalUrl,
  externalLabel,
  className,
}: {
  canPrev: boolean;
  canNext: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  externalUrl?: string | null;
  externalLabel?: string;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center justify-center gap-1', className)}>
      <button className="btn-ghost" onClick={onFirst} disabled={!canPrev} aria-label="First">
        ⏮
      </button>
      <button className="btn-ghost" onClick={onPrev} disabled={!canPrev} aria-label="Previous">
        ◀
      </button>
      <button className="btn-ghost" onClick={onNext} disabled={!canNext} aria-label="Next">
        ▶
      </button>
      <button className="btn-ghost" onClick={onLast} disabled={!canNext} aria-label="Last">
        ⏭
      </button>
      {externalUrl && (
        <a
          className="btn-ghost"
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={externalLabel ?? 'Open externally'}
          title={externalLabel ?? 'Open externally'}
        >
          ↗
        </a>
      )}
    </div>
  );
}
