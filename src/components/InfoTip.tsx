import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { InfoIcon } from './icons/InfoIcon';

/**
 * Small info-icon button that toggles an inline popover on click (works on
 * touch, unlike a hover-only title attribute). Escape or an outside click
 * closes it.
 */
export function InfoTip({ label, children, className }: {
  /** Accessible name for the icon button. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={clsx('relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex text-text-secondary hover:text-text-primary transition-colors',
          open && 'text-text-primary',
        )}
      >
        <InfoIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute right-0 top-full mt-1.5 z-30 w-64 bg-surface border-2 border-text-primary shadow-card p-3 text-xs text-text-secondary normal-case font-sans tracking-normal text-left"
        >
          {children}
        </span>
      )}
    </span>
  );
}
