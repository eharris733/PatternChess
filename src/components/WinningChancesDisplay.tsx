import clsx from 'clsx';
import { winPercent } from '../chess/winningChances';

export function WinningChancesDisplay({
  evalBefore,
  evalAfter,
  className,
}: {
  evalBefore: number;
  evalAfter: number;
  className?: string;
}) {
  const before = winPercent(evalBefore);
  const after = winPercent(-evalAfter);
  const lost = before - after;

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <div className="flex justify-between text-xs text-text-secondary">
        <span>Before</span>
        <span className="font-mono">{before.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div className="h-full bg-correct/70" style={{ width: `${before}%` }} />
      </div>
      <div className="flex justify-between text-xs text-text-secondary mt-2">
        <span>After</span>
        <span className="font-mono">{after.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div className="h-full bg-incorrect/70" style={{ width: `${after}%` }} />
      </div>
      <div className="flex justify-between text-xs mt-2">
        <span className="text-text-secondary">Chances lost</span>
        <span
          className={clsx(
            'font-mono font-semibold',
            lost >= 25 ? 'text-incorrect' : lost >= 15 ? 'text-mistake' : lost >= 10 ? 'text-inaccuracy' : 'text-correct',
          )}
        >
          {lost.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
