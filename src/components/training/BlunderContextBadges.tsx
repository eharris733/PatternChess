import clsx from 'clsx';
import { BlunderContext, GAME_STATE_LABEL } from '../../chess/blunderContext';

const GAME_STATE_TONE: Record<BlunderContext['gameState'], string> = {
  missedWin: 'bg-mistake/20 text-mistake border-mistake/40',
  roughlyEqual: 'bg-surface-2 text-text-secondary border-surface-2',
  alreadyLosing: 'bg-surface-2 text-text-secondary border-surface-2',
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
        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-incorrect/20 text-incorrect border border-incorrect/40">
          Time trouble · {Math.round(context.timeRemainingPercent ?? 0)}%
        </span>
      )}
      {showGameState && (
        <span
          className={clsx(
            'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border',
            GAME_STATE_TONE[context.gameState],
          )}
        >
          {GAME_STATE_LABEL[context.gameState]}
        </span>
      )}
    </div>
  );
}
