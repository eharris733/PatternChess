import clsx from 'clsx';

export function formatEval(cp: number): string {
  if (Math.abs(cp) >= 9000) {
    const mate = 10000 - Math.abs(cp);
    return `${cp > 0 ? '#' : '-#'}${mate}`;
  }
  const value = cp / 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

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
