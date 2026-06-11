import clsx from 'clsx';
import { winPercent } from '../chess/winningChances';
import { InfoTip } from './InfoTip';

/** Raw engine eval in pawns, from the player's perspective. ±10000-ish = mate. */
function formatEval(cp: number): string {
  if (cp > 9000) return '#';
  if (cp < -9000) return '-#';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

export function WinningChancesDisplay({
  evalBefore,
  evalAfter,
  showEngineEvals = false,
  className,
}: {
  evalBefore: number;
  evalAfter: number;
  showEngineEvals?: boolean;
  className?: string;
}) {
  const before = winPercent(evalBefore);
  // evalAfter is stored from the opponent's perspective — negate for the player.
  const after = winPercent(-evalAfter);
  const lost = before - after;

  return (
    <div className={clsx('flex items-center justify-between gap-2 text-xs', className)}>
      <span className="text-text-secondary shrink-0">Win chance</span>
      <span className="font-mono tabular-nums text-text-primary text-right">
        {before.toFixed(1)}%{showEngineEvals && ` (${formatEval(evalBefore)})`}
        <span className="text-text-secondary"> {'→'} </span>
        {after.toFixed(1)}%{showEngineEvals && ` (${formatEval(-evalAfter)})`}{' '}
        <span
          className={clsx(
            'font-semibold',
            lost >= 25 ? 'text-incorrect' : lost >= 15 ? 'text-mistake' : lost >= 10 ? 'text-inaccuracy' : 'text-correct',
          )}
        >
          ({lost > 0 ? '−' : '+'}{Math.abs(lost).toFixed(1)}%)
        </span>
      </span>
      <InfoTip label="What do these percentages mean?">
        Your odds of winning before and after the move, from the engine's evaluation (Lichess
        winning-chances model). Moves that lose 15% or more become training positions.
      </InfoTip>
    </div>
  );
}
