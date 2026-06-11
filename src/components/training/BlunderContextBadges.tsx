import clsx from 'clsx';
import { BlunderContext, GAME_STATE_LABEL } from '../../chess/blunderContext';
import { ClockIcon } from '../icons/ClockIcon';

const GAME_STATE_TONE: Record<BlunderContext['gameState'], string> = {
  missedWin: 'bg-mistake/20 text-mistake border-mistake/50',
  roughlyEqual: 'bg-surface-3 text-text-secondary border-text-primary',
  alreadyLosing: 'bg-surface-3 text-text-secondary border-text-primary',
};

function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSpent(seconds: number): string {
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`;
  return `${Math.round(seconds)}s`;
}

export function BlunderContextBadges({ context }: { context: BlunderContext }) {
  const showTimeTrouble = context.inTimeTrouble;
  // Always render the game-state badge (it's always known). Skip 'roughlyEqual'
  // when nothing else is showing — three "Roughly equal" badges everywhere is
  // visual noise.
  const showGameState = context.gameState !== 'roughlyEqual' || showTimeTrouble;
  const showClock = context.timeRemainingSeconds !== null;
  if (!showTimeTrouble && !showGameState && !showClock) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {(showTimeTrouble || showGameState) && (
        <div className="flex flex-wrap gap-1.5">
          {showTimeTrouble && (
            <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight bg-incorrect/20 text-incorrect border-2 border-incorrect/50">
              Time trouble · {Math.round(context.timeRemainingPercent ?? 0)}%
            </span>
          )}
          {showGameState && (
            <span
              className={clsx(
                'px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2',
                GAME_STATE_TONE[context.gameState],
              )}
            >
              {GAME_STATE_LABEL[context.gameState]} · {Math.round(context.preMoveWinPercent)}%
            </span>
          )}
        </div>
      )}
      {showClock && (
        <p className="flex items-center gap-1.5 text-text-secondary text-xs font-mono tabular-nums">
          <ClockIcon className="h-3.5 w-3.5 shrink-0" title="Clock at the moment of the move" />
          {formatClock(context.timeRemainingSeconds as number)} left
          {context.moveTimeSpentSeconds !== null &&
            ` · spent ${formatSpent(context.moveTimeSpentSeconds)}`}
        </p>
      )}
    </div>
  );
}
