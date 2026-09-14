import clsx from 'clsx';
import { formatEval } from '../chess/formatEval';

export { formatEval };

export function EvalDisplay({ cp, className }: { cp: number; className?: string }) {
  const sign = cp > 30 ? 'pos' : cp < -30 ? 'neg' : 'neutral';
  return (
    <span
      className={clsx(
        'font-mono text-sm tabular-nums',
        sign === 'pos' && 'text-correct',
        sign === 'neg' && 'text-incorrect',
        sign === 'neutral' && 'text-text-secondary',
        className,
      )}
    >
      {formatEval(cp)}
    </span>
  );
}
