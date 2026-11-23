// "Today's drill" on a course day: positions from the player's own blunders
// that match the course topic, launched at /training via `blunderIds`.
// Pure; the course page feeds it getAllLiveBlunders + the game stat rows.

import type { Blunder } from '../models/blunder';
import type { Course } from './courseCatalog';
import { classifyEndgameType } from '../chess/endgameType';

export interface DrillGameMeta {
  family: string | null;
  color: 'white' | 'black' | null;
}

export const COURSE_DRILL_SIZE = 10;
/** An opening course widens to early middlegame positions from those games when the opening itself has too few. */
const OPENING_WIDEN_BELOW = 3;
const OPENING_WIDEN_MAX_MOVE = 20;

function inCourseGame(course: Course, b: Blunder, games: ReadonlyMap<string, DrillGameMeta>): boolean {
  const meta = b.gameId ? games.get(b.gameId) : undefined;
  if (!meta?.family || !course.topic.keys.includes(meta.family)) return false;
  return !course.topic.color || meta.color === course.topic.color;
}

/** Every live position that matches the course topic, in no particular order. */
export function matchCourseBlunders(
  course: Course,
  blunders: readonly Blunder[],
  games: ReadonlyMap<string, DrillGameMeta>,
): Blunder[] {
  const { type, keys, endgameType } = course.topic;
  if (type === 'opening') {
    const fromGames = blunders.filter((b) => inCourseGame(course, b, games));
    const core = fromGames.filter((b) => b.kind === 'opening' || (b.kind === 'tactic' && b.phase === 'opening'));
    if (core.length >= OPENING_WIDEN_BELOW) return core;
    const early = fromGames.filter(
      (b) => b.kind === 'tactic' && b.phase !== 'opening' && b.moveNumber <= OPENING_WIDEN_MAX_MOVE,
    );
    return [...core, ...early];
  }
  if (type === 'motif') {
    return blunders.filter((b) => b.kind === 'tactic' && b.motifs.some((m) => keys.includes(m)));
  }
  const phase = keys[0];
  return blunders.filter((b) => {
    const inPhase = phase === 'endgame' ? b.kind === 'endgame' || (b.kind === 'tactic' && b.phase === 'endgame') : b.kind === 'tactic' && b.phase === phase;
    if (!inPhase) return false;
    return !endgameType || classifyEndgameType(b.fen) === endgameType;
  });
}

/** Due first, then the ones you failed last time, then new ones, then the biggest swings. */
function rank(b: Blunder, now: number): [number, number] {
  const due = !b.nextDrillAt || b.nextDrillAt.getTime() <= now;
  const tier = due ? (b.lastDrillFailed ? 0 : b.timesAttempted === 0 ? 2 : 1) : 3;
  return [tier, -Math.abs(b.evalSwing)];
}

/** Today's drill: up to `limit` matching positions, the most useful first. */
export function courseDrillPositions(
  course: Course,
  blunders: readonly Blunder[],
  games: ReadonlyMap<string, DrillGameMeta>,
  opts: { now?: Date; limit?: number } = {},
): Blunder[] {
  const now = (opts.now ?? new Date()).getTime();
  return matchCourseBlunders(course, blunders, games)
    .map((b) => ({ b, k: rank(b, now) }))
    .sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1])
    .slice(0, opts.limit ?? COURSE_DRILL_SIZE)
    .map((x) => x.b);
}

const PHASE_PLACE: Record<string, string> = {
  opening: 'the opening',
  middlegame: 'the middlegame',
  endgame: 'the endgame',
};

/**
 * The "Now your games" heading: "12 mistakes in this opening", "3 mistakes
 * with this pattern", "5 mistakes in these endgames". `n` is every match
 * (matchCourseBlunders), not just today's drill.
 */
export function courseMistakesLabel(course: Course, n: number): string {
  const count = `${n.toLocaleString()} ${n === 1 ? 'mistake' : 'mistakes'}`;
  const { type, keys, endgameType } = course.topic;
  if (type === 'opening') return `${count} in this opening`;
  if (type === 'motif') return `${count} with this pattern`;
  if (endgameType) return `${count} in these endgames`;
  return `${count} in ${PHASE_PLACE[keys[0]] ?? keys[0]}`;
}
