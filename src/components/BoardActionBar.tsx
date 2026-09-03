import { useEffect, useRef, useState } from 'react';
import { HintIcon } from './icons/HintIcon';
import { ChevronIcon } from './icons/ChevronIcon';

interface BoardActionBarProps {
  /** Resets the timer when this changes (e.g. blunder index advances). */
  resetKey: string | number;
  /** Timer counts up only while this is true. */
  running: boolean;
  paused: boolean;
  onTogglePaused: () => void;
  /** Show the hint button. */
  showHint: boolean;
  hintLevel: 0 | 1 | 2;
  hintDisabled: boolean;
  onHint: () => void;
  externalUrl?: string | null;
  externalLabel?: string;
  /** Mobile-only prev/next arrows stepping the active line (panel arrows sit below the fold). */
  onStepLine?: ((dir: 1 | -1) => void) | null;
  /** Rewind the last move pair (Endgames tab play-outs only). Hidden when absent. */
  onTakeBack?: () => void;
  takeBackDisabled?: boolean;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function BoardActionBar({
  resetKey,
  running,
  paused,
  onTogglePaused,
  showHint,
  hintLevel,
  hintDisabled,
  onHint,
  externalUrl,
  externalLabel,
  onStepLine,
  onTakeBack,
  takeBackDisabled = false,
}: BoardActionBarProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    setElapsed(0);
    startRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now() - elapsed;
    const id = window.setInterval(() => {
      if (startRef.current != null) setElapsed(Date.now() - startRef.current);
    }, 250);
    return () => {
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, resetKey]);

  const hintLabel = hintLevel === 0 ? 'Hint' : hintLevel === 1 ? 'Show move' : 'Hint shown';
  // The cost is stated before the click: level 1 is free, level 2 forfeits credit.
  const hintTitle =
    hintLevel === 0
      ? 'Highlight the piece to move (free)'
      : hintLevel === 1
        ? 'Show the full move (no credit for this attempt)'
        : 'Hint shown';

  return (
    <div className="flex items-center gap-2 max-w-[min(640px,calc(100vh-5rem))] mx-auto w-full">
      <span
        className="font-mono text-sm text-text-secondary tabular-nums px-2"
        aria-label="Elapsed time"
        title="Elapsed time"
      >
        {formatElapsed(elapsed)}
      </span>

      <button
        type="button"
        className="btn-ghost text-sm h-8 lg:h-10"
        onClick={onTogglePaused}
        aria-label={paused ? 'Resume' : 'Pause'}
        title={paused ? 'Resume' : 'Pause'}
      >
        {paused ? '▶' : '⏸'}
      </button>

      <div className="flex-1" />

      {onStepLine && (
        <>
          <button
            type="button"
            aria-label="Previous move"
            onClick={() => onStepLine(-1)}
            className="btn-ghost h-8 px-3 lg:hidden"
          >
            <ChevronIcon className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next move"
            onClick={() => onStepLine(1)}
            className="btn-ghost h-8 px-3 lg:hidden"
          >
            <ChevronIcon className="h-4 w-4" />
          </button>
        </>
      )}

      {onTakeBack && (
        <button
          type="button"
          className="btn-ghost text-sm h-8 lg:h-10"
          onClick={onTakeBack}
          disabled={takeBackDisabled}
          title="Take back your last move and the engine's reply"
        >
          Take back
        </button>
      )}

      {showHint && (
        <button
          type="button"
          className="btn-ghost text-sm h-8 lg:h-10 inline-flex items-center gap-1.5"
          onClick={onHint}
          disabled={hintDisabled}
          title={hintTitle}
        >
          <HintIcon className="h-4 w-4" />
          {hintLabel}
        </button>
      )}

      {externalUrl && (
        <a
          className="btn-ghost text-sm h-8 lg:h-10"
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={externalLabel ?? 'Analyze this position'}
        >
          Analyze ↗
        </a>
      )}
    </div>
  );
}
