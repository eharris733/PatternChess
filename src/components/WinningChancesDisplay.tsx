import clsx from 'clsx';
import { winPercent, cpLoss } from '../chess/winningChances';
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
  const swing = cpLoss(evalBefore, evalAfter);

  return (
    <div className={clsx('flex items-center justify-between gap-2 text-xs', className)}>
      <span className="text-text-secondary shrink-0">Engine swing</span>
      <span className="font-mono tabular-nums text-text-primary text-right">
        {showEngineEvals && (
          <>
            {formatEval(evalBefore)}
            <span className="text-text-secondary"> {'→'} </span>
            {formatEval(-evalAfter)}{' '}
          </>
        )}
        <span
          className={clsx(
            'font-semibold',
            lost >= 25 ? 'text-incorrect' : lost >= 15 ? 'text-mistake' : lost >= 10 ? 'text-inaccuracy' : 'text-correct',
          )}
        >
          ({swing > 0 ? '−' : '+'}{Math.round(Math.abs(swing))}cp)
        </span>
      </span>
      <InfoTip label="What does this mean?">
        The engine evaluation swing this move caused, in centipawns (100cp ≈ one pawn). Bigger
        swings mean a bigger mistake.
      </InfoTip>
    </div>
  );
}
