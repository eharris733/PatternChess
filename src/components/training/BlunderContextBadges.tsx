import clsx from 'clsx';
import { BlunderContext, GAME_STATE_LABEL } from '../../chess/blunderContext';

const GAME_STATE_TONE: Record<BlunderContext['gameState'], string> = {
  missedWin: 'bg-mistake/20 text-mistake border-mistake/50',
  roughlyEqual: 'bg-surface-3 text-text-secondary border-text-primary',
  alreadyLosing: 'bg-surface-3 text-text-secondary border-text-primary',
};

export function BlunderContextBadges({ context }: { context: BlunderContext }) {
  const showTimeTrouble = context.inTimeTrouble;
  // Always render the game-state badge (it's always known). Skip 'roughlyEqual'
  // when nothing else is showing — three "Roughly equal" badges everywhere is
  // visual noise.
  const showGameState = context.gameState !== 'roughlyEqual' || showTimeTrouble;
  if (!showTimeTrouble && !showGameState) return null;

  return (
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
  );
}
