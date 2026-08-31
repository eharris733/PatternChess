import { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Shared board wrapper for the trainer screens: applies the pause blur and
 * anchors an optional overlay (e.g. the mobile post-attempt action cover).
 */
export function BoardStage({
  paused,
  overlay,
  children,
}: {
  paused: boolean;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <div
        className={clsx(
          'transition duration-200',
          paused && 'blur-md pointer-events-none select-none',
        )}
        aria-hidden={paused}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
