import clsx from 'clsx';
import { SPACED_REPETITION_DAYS } from '../models/blunder';

/**
 * The mastery chain: one square per rung of the SR ladder, filled as cycles
 * clear (all filled = mastered). Shared by every surface that shows SR
 * progress for a position, so the ladder always reads the same.
 */
export function MasteryDots({
  cycleNumber,
  size = 'md',
  className,
}: {
  cycleNumber: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const total = SPACED_REPETITION_DAYS.length;
  const filled = Math.min(Math.max(cycleNumber, 0), total);
  return (
    <span
      className={clsx('inline-flex items-center', size === 'sm' ? 'gap-1' : 'gap-1.5', className)}
      role="img"
      aria-label={`${filled} of ${total} cycles completed`}
      data-testid="mastery-dots"
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={clsx(
            'rounded-none border-2 border-text-primary',
            size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3',
            i < filled ? 'bg-gold-dark' : 'bg-surface',
          )}
        />
      ))}
    </span>
  );
}
