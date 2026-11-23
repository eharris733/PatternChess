import { useEffect, useRef, useState } from 'react';
import { GearIcon } from '../icons/GearIcon';
import { useDrillFeedbackPrefs } from '../../hooks/useDrillFeedbackPrefs';
import { useT } from '../../i18n/useT';

/**
 * Gear button + popover with the post-miss drill-feedback settings. Lives in
 * BoardActionBar so every drill surface (tactics, queue endgames, /endgames)
 * gets it. The same toggles also appear on /profile; both go through
 * useDrillFeedbackPrefs so they stay in sync.
 */
export function DrillSettingsMenu() {
  const t = useT();
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
        aria-label={t('drillSettings.label')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('drillSettings.label')}
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('drillSettings.label')}
          className="card absolute bottom-full right-0 mb-2 z-30 w-72 flex flex-col gap-3 p-4 shadow-lg"
        >
          <p className="label">{t('drillSettings.afterMiss')}</p>
          <label className="flex items-start gap-2 select-none text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={showAnswer}
              onChange={(e) => setShowAnswer(e.target.checked)}
            />
            <span>
              {t('drillSettings.showAnswer')}
              <span className="block text-text-primary text-xs">{t('drillSettings.showAnswerHelp')}</span>
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
              {t('drillSettings.autoplay')}
              <span className="block text-text-primary text-xs">{t('drillSettings.autoplayHelp')}</span>
            </span>
          </label>
          {error && <p className="text-incorrect text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
