// "Recommended for you" on /courses and the dashboard's course ask: ranks the
// catalog by the player's own data. Pure; the inputs come from
// useCourseRecommendations (src/hooks/useCourses.ts).
//
//   opening courses  how often you play the opening (as the course's colour)
//                    and how many of your costly theory exits happened there
//   motif courses    how often the course's motifs tag your blunders
//   phase courses    your blunders in that phase (endgame courses narrowed by
//                    the endgame types you let slip)
//
// Scores are shares of your own totals, weighted so a narrow, specific match
// (one opening, one motif) outranks a broad phase.

import type { Course } from './courseCatalog';
import { MOTIF_LABEL } from '../chess/motifs';
import { ENDGAME_TYPE_LABEL, type EndgameType } from '../chess/endgameType';

export interface OpeningStat {
  /** `games.opening_family`. */
  family: string;
  color: 'white' | 'black' | null;
  games: number;
  /** Games where your own theory exit cost you (costlyExitGames). */
  costlyExits: number;
}

export interface RecommendInput {
  openings: readonly OpeningStat[];
  /** Live tactic blunders per motif id (stats.motifCounts). */
  motifCounts: Readonly<Record<string, number>>;
  /** Tactic blunders per phase. */
  phaseCounts: { opening: number; middlegame: number; endgame: number };
  /** Endgames you let slip, per material family; unknown = a prior split. */
  endgameTypeCounts?: Partial<Record<EndgameType, number>>;
  /** Courses already finished (never recommended again). */
  finished?: ReadonlySet<string>;
}

export interface CourseRecommendation {
  course: Course;
  score: number;
  /** One sentence on why, from the player's numbers. */
  reason: string;
}

export const MIN_OPENING_GAMES = 5;
export const MIN_MOTIF_BLUNDERS = 3;
export const MIN_PHASE_BLUNDERS = 5;

const WEIGHT = { opening: 1, motif: 1.5, phase: 0.5 } as const;

/** Rough share of endgame trouble per family when the scenario scan hasn't run. */
const ENDGAME_TYPE_PRIOR: Record<EndgameType, number> = {
  rook: 0.4,
  pawn: 0.2,
  minor: 0.15,
  'rook-minor': 0.1,
  queen: 0.05,
  'queen-minor': 0.05,
  mixed: 0.05,
};

const COLOR_NAME = { white: 'White', black: 'Black' } as const;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function sum(xs: Iterable<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function scoreOpening(course: Course, input: RecommendInput): Omit<CourseRecommendation, 'course'> | null {
  const { keys, color } = course.topic;
  const matched = input.openings.filter((o) => keys.includes(o.family) && (!color || o.color === color));
  const games = sum(matched.map((o) => o.games));
  if (games < MIN_OPENING_GAMES) return null;
  const costly = sum(matched.map((o) => o.costlyExits));
  const totalGames = sum(input.openings.map((o) => o.games));
  const totalCostly = sum(input.openings.map((o) => o.costlyExits));
  const gameShare = games / Math.max(1, totalGames);
  const leakShare = totalCostly > 0 ? costly / totalCostly : gameShare;
  // Name the family you actually play most among the course's keys.
  const byFamily = new Map<string, number>();
  for (const o of matched) byFamily.set(o.family, (byFamily.get(o.family) ?? 0) + o.games);
  const family = [...byFamily.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const side = color ? ` as ${COLOR_NAME[color]}` : '';
  const reason =
    costly > 0
      ? `You've played the ${family}${side} in ${plural(games, 'game')}, and left theory at a cost in ${costly}.`
      : `You've played the ${family}${side} in ${plural(games, 'game')}.`;
  return { score: WEIGHT.opening * (0.5 * gameShare + 0.5 * leakShare), reason };
}

function scoreMotif(course: Course, input: RecommendInput): Omit<CourseRecommendation, 'course'> | null {
  const hits = course.topic.keys
    .map((k) => ({ k, n: input.motifCounts[k] ?? 0 }))
    .filter((h) => h.n > 0)
    .sort((a, b) => b.n - a.n);
  const count = sum(hits.map((h) => h.n));
  if (count < MIN_MOTIF_BLUNDERS) return null;
  const total = sum(Object.values(input.motifCounts));
  const labels = hits.map((h) => `"${MOTIF_LABEL[h.k as keyof typeof MOTIF_LABEL] ?? h.k}"`);
  const reason = `${labels.join(' and ')} ${hits.length === 1 ? 'tags' : 'tag'} ${plural(count, 'blunder')} from your games.`;
  return { score: (WEIGHT.motif * count) / Math.max(1, total), reason };
}

function scorePhase(course: Course, input: RecommendInput): Omit<CourseRecommendation, 'course'> | null {
  const phase = course.topic.keys[0] as keyof RecommendInput['phaseCounts'];
  const count = input.phaseCounts[phase] ?? 0;
  if (count < MIN_PHASE_BLUNDERS) return null;
  const total = sum(Object.values(input.phaseCounts));
  let share = count / Math.max(1, total);
  const pct = Math.round(share * 100);
  let reason = `${plural(count, 'blunder')} (${pct}% of yours) came in the ${phase}.`;
  const type = course.topic.endgameType;
  if (type) {
    const typeCounts = input.endgameTypeCounts;
    const typeTotal = typeCounts ? sum(Object.values(typeCounts).map((n) => n ?? 0)) : 0;
    if (typeCounts && typeTotal > 0) {
      const n = typeCounts[type] ?? 0;
      if (n === 0) return null;
      share *= n / typeTotal;
      reason = `${plural(n, 'endgame')} you let slip ${n === 1 ? 'was' : 'were'} ${ENDGAME_TYPE_LABEL[type].toLowerCase()}.`;
    } else {
      share *= ENDGAME_TYPE_PRIOR[type];
    }
  }
  return { score: WEIGHT.phase * share, reason };
}

/** Every course that matches your data, best first (unmatched and finished courses left out). */
export function rankCourses(courses: readonly Course[], input: RecommendInput): CourseRecommendation[] {
  const out: CourseRecommendation[] = [];
  for (const course of courses) {
    if (input.finished?.has(course.slug)) continue;
    const scored =
      course.topic.type === 'opening'
        ? scoreOpening(course, input)
        : course.topic.type === 'motif'
          ? scoreMotif(course, input)
          : scorePhase(course, input);
    if (scored && scored.score > 0) out.push({ course, ...scored });
  }
  // Ties keep catalog order (Array.prototype.sort is stable).
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The top `n` for "Recommended for you": best first, at most two of one topic
 * type while others qualify, so three opening courses don't crowd out the
 * motif that costs you most.
 */
export function recommendCourses(courses: readonly Course[], input: RecommendInput, n = 3): CourseRecommendation[] {
  const ranked = rankCourses(courses, input);
  const picked: CourseRecommendation[] = [];
  const perType = new Map<string, number>();
  for (const r of ranked) {
    if (picked.length >= n) break;
    const t = r.course.topic.type;
    if ((perType.get(t) ?? 0) >= 2) continue;
    picked.push(r);
    perType.set(t, (perType.get(t) ?? 0) + 1);
  }
  for (const r of ranked) {
    if (picked.length >= n) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked.sort((a, b) => b.score - a.score);
}
