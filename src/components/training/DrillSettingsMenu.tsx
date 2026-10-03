import { useEffect, useRef, useState } from 'react';
import { GearIcon } from '../icons/GearIcon';
import { useDrillFeedbackPrefs } from '../../hooks/useDrillFeedbackPrefs';

/**
 * Gear button + popover with the post-miss drill-feedback settings. Lives in
 * BoardActionBar so every drill surface (tactics, queue endgames, /endgames)
 * gets it. The same toggles also appear on /profile; both go through
 * useDrillFeedbackPrefs so they stay in sync.
 */
export function DrillSettingsMenu() {
  const { showAnswer, autoplay, error, setShowAnswer, setAutoplay } = useDrillFeedbackPrefs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-ghost h-8 lg:h-10 px-2 inline-flex items-center"
        aria-label="Drill settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Drill settings"
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Drill settings"
          className="card absolute bottom-full right-0 mb-2 z-30 w-72 flex flex-col gap-3 p-4 shadow-lg"
        >
          <p className="label">After a miss</p>
          <label className="flex items-start gap-2 select-none text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={showAnswer}
              onChange={(e) => setShowAnswer(e.target.checked)}
            />
            <span>
              Show the answer
              <span className="block text-text-secondary text-xs">
                Draws the best move and adds the solution line.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 select-none text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={autoplay}
              onChange={(e) => setAutoplay(e.target.checked)}
            />
            <span>
              Autoplay the lines
              <span className="block text-text-secondary text-xs">
                Plays why your move fails on the board, then the solution when it&rsquo;s shown.
              </span>
            </span>
          </label>
          {error && <p className="text-incorrect text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
