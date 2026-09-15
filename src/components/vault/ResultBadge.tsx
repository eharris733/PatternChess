import clsx from 'clsx';
import type { Outcome } from './vaultHelpers';

export function ResultBadge({ outcome }: { outcome: Outcome | null }) {
  const map = {
    win: { letter: 'W', cls: 'bg-correct/20 text-correct border-correct/50' },
    loss: { letter: 'L', cls: 'bg-incorrect/20 text-incorrect border-incorrect/50' },
    draw: { letter: 'D', cls: 'bg-surface-3 text-text-secondary border-text-primary' },
  } as const;
  const meta = outcome ? map[outcome] : null;
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center w-6 h-6 rounded-none border-2 font-mono text-xs font-bold',
        meta?.cls ?? 'bg-surface-3 text-text-secondary border-text-primary',
      )}
      title={outcome ?? 'unknown result'}
    >
      {meta?.letter ?? '–'}
    </span>
  );
}
