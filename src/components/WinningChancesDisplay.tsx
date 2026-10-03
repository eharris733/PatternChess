import type { ReactNode } from 'react';
import clsx from 'clsx';
import { winPercent, cpLoss } from '../chess/winningChances';
import { formatEval } from '../chess/formatEval';
import { InfoTip } from './InfoTip';

/** One-decimal, bare `#` mate — the compact engine-swing presentation. */
const formatSwingEval = (cp: number) => formatEval(cp, { decimals: 1, mate: 'symbol' });

type Side = 'white' | 'black';

/** Chess colours for the bar — White / Black swatches. */
const SIDE_FILL: Record<Side, string> = { white: '#ffffff', black: '#3a3a3a' };

function toneFor(lost: number): { text: string; bg: string } {
  if (lost >= 25) return { text: 'text-incorrect', bg: 'bg-incorrect' };
  if (lost >= 15) return { text: 'text-mistake', bg: 'bg-mistake' };
  if (lost >= 10) return { text: 'text-inaccuracy', bg: 'bg-inaccuracy' };
  return { text: 'text-correct', bg: 'bg-correct' };
}

/**
 * Engine swing for one move as an evaluation bar (the Lichess / Chess.com
 * convention, laid flat): White's winning chances fill from one end and
 * Black's from the other, the side at the bottom of the board on the left.
 * The coloured stretch is what the move changed; evals are White-relative
 * (+ = good for White) like every analysis board.
 *
 * Inputs keep the stored convention: `evalBefore` from the mover's view,
 * `evalAfter` from the opponent's (the side to move after the move).
 */
export function WinningChancesDisplay({
  evalBefore,
  evalAfter,
  mover,
  orientation,
  label,
  showEngineEvals = false,
  className,
}: {
  evalBefore: number;
  evalAfter: number;
  /** Side that played the move. */
  mover: Side;
  /** Side drawn on the left (the board's bottom side). Defaults to the mover. */
  orientation?: Side;
  /** Which move this is, e.g. "Your move: Nf3" — shown beside the heading. */
  label?: ReactNode;
  showEngineEvals?: boolean;
  className?: string;
}) {
  const left = orientation ?? mover;
  const right: Side = left === 'white' ? 'black' : 'white';
  const moverBefore = winPercent(evalBefore);
  const moverAfter = winPercent(-evalAfter);
  const lost = moverBefore - moverAfter;
  const swing = cpLoss(evalBefore, evalAfter);
  const tone = toneFor(lost);

  // Left side's share of the bar, before and after the move.
  const leftBefore = left === mover ? moverBefore : 100 - moverBefore;
  const leftAfter = left === mover ? moverAfter : 100 - moverAfter;
  const lo = Math.min(leftBefore, leftAfter);
  const hi = Math.max(leftBefore, leftAfter);

  const whiteBeforeCp = mover === 'white' ? evalBefore : -evalBefore;
  const whiteAfterCp = mover === 'white' ? -evalAfter : evalAfter;
  const moverName = mover === 'white' ? 'White' : 'Black';

  return (
    <div className={clsx('flex flex-col gap-1.5', className)} data-testid="engine-swing">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="label shrink-0 text-text-primary">Engine swing</span>
          {label && (
            <span className="truncate font-mono text-xs text-text-primary" data-testid="engine-swing-move">
              {label}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={clsx('font-mono font-semibold tabular-nums', tone.text)}>
            {swing > 0 ? '−' : '+'}
            {Math.round(Math.abs(swing))}cp
          </span>
          <InfoTip label="What does this mean?">
            An evaluation bar: White's winning chances fill from one end, Black's from the other.
            The coloured stretch is what this move changed. The number is the swing in centipawns
            (100cp ≈ one pawn).
          </InfoTip>
        </span>
      </div>
      <div
        className="relative h-3.5 overflow-hidden border-2 border-text-primary"
        style={{ backgroundColor: SIDE_FILL[right] }}
        role="img"
        aria-label={`${moverName}'s winning chances ${Math.round(moverBefore)}% to ${Math.round(moverAfter)}%`}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${leftAfter}%`, backgroundColor: SIDE_FILL[left] }} />
        <div
          className={clsx('absolute inset-y-0', tone.bg)}
          style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 0.75)}%` }}
        />
        {/* Where the bar stood before the move. */}
        <div
          className="absolute inset-y-0 w-0.5 bg-text-primary"
          style={{ left: `calc(${leftBefore}% - 1px)` }}
        />
      </div>
      <div className="flex justify-between gap-2 font-mono text-xs tabular-nums text-text-primary">
        <span>
          {moverName} {Math.round(moverBefore)}% {'→'}{' '}
          <span className={clsx('font-semibold', tone.text)}>{Math.round(moverAfter)}%</span>
        </span>
        {showEngineEvals && (
          <span>
            {formatSwingEval(whiteBeforeCp)} {'→'} {formatSwingEval(whiteAfterCp)}
          </span>
        )}
      </div>
    </div>
  );
}
