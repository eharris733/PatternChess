import { Blunder } from '../models/blunder';
import { GameRecord } from '../models/gameRecord';
import { parseStartIncrement } from './timeControl';
import { winPercent } from './winningChances';

export type GameStateBucket = 'missedWin' | 'roughlyEqual' | 'alreadyLosing';

export const GAME_STATE_LABEL: Record<GameStateBucket, string> = {
  missedWin: 'Missed win',
  roughlyEqual: 'Roughly equal',
  alreadyLosing: 'Already losing',
};

export const GAME_STATE_ORDER: readonly GameStateBucket[] = [
  'missedWin',
  'roughlyEqual',
  'alreadyLosing',
] as const;

export const TIME_TROUBLE_THRESHOLD_PERCENT = 10;
const MISSED_WIN_WIN_PCT = 75;
const ALREADY_LOSING_WIN_PCT = 25;

export type ContextFilter = GameStateBucket | 'timeTrouble';

export interface BlunderContext {
  preMoveWinPercent: number;
  gameState: GameStateBucket;
  timeRemainingPercent: number | null;
  inTimeTrouble: boolean;
}

export function classifyGameState(evalBeforeCp: number): GameStateBucket {
  const pct = winPercent(evalBeforeCp);
  if (pct >= MISSED_WIN_WIN_PCT) return 'missedWin';
  if (pct <= ALREADY_LOSING_WIN_PCT) return 'alreadyLosing';
  return 'roughlyEqual';
}

/**
 * Time the player had on their clock at the moment they made the blunder, as a
 * percent of their starting time. Uses the previous post-move clock for that
 * color (i.e. the clock they saw when starting their turn). Returns null when
 * clock data is missing or the time control isn't parseable.
 */
export function computeTimeRemainingPercent(
  blunder: Pick<Blunder, 'moveNumber' | 'sideToMove'>,
  game: GameRecord | null,
): number | null {
  if (!game) return null;
  const clocks = game.clockPerPly;
  if (!clocks || clocks.length === 0) return null;
  const tc = parseStartIncrement(game.timeControl);
  if (!tc || tc.startCs <= 0) return null;

  const playerParity = blunder.sideToMove === 'white' ? 0 : 1;
  const plyIndex = (blunder.moveNumber - 1) * 2 + playerParity;

  // Clock at the moment of decision = clock after this player's *previous* move.
  // For the player's first move (plyIndex < 2), they saw the starting clock.
  let beforeCs: number | undefined;
  if (plyIndex < 2) {
    beforeCs = tc.startCs;
  } else {
    beforeCs = clocks[plyIndex - 2];
    if (typeof beforeCs !== 'number') return null;
  }

  return (beforeCs / tc.startCs) * 100;
}

export function computeBlunderContext(
  blunder: Blunder,
  game: GameRecord | null,
): BlunderContext {
  const timeRemainingPercent = computeTimeRemainingPercent(blunder, game);
  return {
    preMoveWinPercent: winPercent(blunder.evalBefore),
    gameState: classifyGameState(blunder.evalBefore),
    timeRemainingPercent,
    inTimeTrouble:
      timeRemainingPercent !== null && timeRemainingPercent < TIME_TROUBLE_THRESHOLD_PERCENT,
  };
}
