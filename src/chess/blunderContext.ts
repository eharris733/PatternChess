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
/** A "long think" = spent at least this fraction of the starting clock on one move. */
export const TIME_LONG_THINK_FRACTION = 0.2;
const MISSED_WIN_WIN_PCT = 75;
const ALREADY_LOSING_WIN_PCT = 25;

export type ContextFilter = GameStateBucket | 'timeTrouble' | 'longThink';

export interface BlunderContext {
  preMoveWinPercent: number;
  gameState: GameStateBucket;
  timeRemainingPercent: number | null;
  timeRemainingSeconds: number | null;
  inTimeTrouble: boolean;
  moveTimeSpentSeconds: number | null;
  isLongThink: boolean;
}

export function classifyGameState(evalBeforeCp: number): GameStateBucket {
  const pct = winPercent(evalBeforeCp);
  if (pct >= MISSED_WIN_WIN_PCT) return 'missedWin';
  if (pct <= ALREADY_LOSING_WIN_PCT) return 'alreadyLosing';
  return 'roughlyEqual';
}

/**
 * Clock state at the moment the player made the blunder. The clock at the
 * moment of decision = clock after this player's *previous* move; for the
 * player's first move (plyIndex < 2) they saw the starting clock. Returns null
 * when clock data is missing or the time control isn't parseable.
 */
function clockBeforeMoveCs(
  blunder: Pick<Blunder, 'moveNumber' | 'sideToMove'>,
  game: GameRecord | null,
): { beforeCs: number; startCs: number; incCs: number; plyIndex: number; clocks: number[] } | null {
  if (!game) return null;
  const clocks = game.clockPerPly;
  if (!clocks || clocks.length === 0) return null;
  const tc = parseStartIncrement(game.timeControl);
  if (!tc || tc.startCs <= 0) return null;

  const playerParity = blunder.sideToMove === 'white' ? 0 : 1;
  const plyIndex = (blunder.moveNumber - 1) * 2 + playerParity;

  let beforeCs: number;
  if (plyIndex < 2) {
    beforeCs = tc.startCs;
  } else {
    const prev = clocks[plyIndex - 2];
    if (typeof prev !== 'number') return null;
    beforeCs = prev;
  }

  return { beforeCs, startCs: tc.startCs, incCs: tc.incCs, plyIndex, clocks };
}

/**
 * Time the player had on their clock at the moment they made the blunder, as a
 * percent of their starting time.
 */
export function computeTimeRemainingPercent(
  blunder: Pick<Blunder, 'moveNumber' | 'sideToMove'>,
  game: GameRecord | null,
): number | null {
  const clock = clockBeforeMoveCs(blunder, game);
  if (!clock) return null;
  return (clock.beforeCs / clock.startCs) * 100;
}

/**
 * Seconds the player spent on the blundering move = clock at the start of their
 * turn minus the clock after the move, plus the increment they earned back.
 * Returns null when clock data or the time control is missing.
 */
export function computeMoveTimeSpentSeconds(
  blunder: Pick<Blunder, 'moveNumber' | 'sideToMove'>,
  game: GameRecord | null,
): number | null {
  const clock = clockBeforeMoveCs(blunder, game);
  if (!clock) return null;
  const afterCs = clock.clocks[clock.plyIndex];
  if (typeof afterCs !== 'number') return null;

  const spentCs = clock.beforeCs - afterCs + clock.incCs;
  return spentCs > 0 ? spentCs / 100 : 0;
}

export function computeBlunderContext(
  blunder: Blunder,
  game: GameRecord | null,
): BlunderContext {
  const clock = clockBeforeMoveCs(blunder, game);
  const timeRemainingPercent = clock ? (clock.beforeCs / clock.startCs) * 100 : null;
  const timeRemainingSeconds = clock ? clock.beforeCs / 100 : null;
  const moveTimeSpentSeconds = computeMoveTimeSpentSeconds(blunder, game);
  const tc = parseStartIncrement(game?.timeControl ?? null);
  const isLongThink =
    moveTimeSpentSeconds !== null && tc !== null && tc.startCs > 0
      ? moveTimeSpentSeconds * 100 >= TIME_LONG_THINK_FRACTION * tc.startCs
      : false;
  return {
    preMoveWinPercent: winPercent(blunder.evalBefore),
    gameState: classifyGameState(blunder.evalBefore),
    timeRemainingPercent,
    timeRemainingSeconds,
    inTimeTrouble:
      timeRemainingPercent !== null && timeRemainingPercent < TIME_TROUBLE_THRESHOLD_PERCENT,
    moveTimeSpentSeconds,
    isLongThink,
  };
}
