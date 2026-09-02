import { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Shared board wrapper for the trainer screens: applies the pause blur, the
 * "not ready yet" dim while a position is being set up, and anchors an
 * optional overlay (e.g. the mobile post-attempt action cover).
 *
 * `loading` only dims and swaps the cursor — no blur, no overlay — so the
 * board's box stays put for pointer/drag geometry.
 */
export function BoardStage({
  paused,
  loading = false,
  overlay,
  children,
}: {
  paused: boolean;
  loading?: boolean;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <div
        className={clsx(
          'transition duration-200',
          paused && 'blur-md pointer-events-none select-none',
          !paused && loading && 'opacity-60 cursor-wait',
        )}
        aria-hidden={paused}
        aria-busy={loading || undefined}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
