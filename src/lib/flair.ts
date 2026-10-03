/**
 * Flair — an earned, cosmetic title a player can pin to their profile and
 * leaderboard rows. Every flair is unlocked by one achievement (single
 * progress source: src/lib/achievements.ts), grouped into three tracks so it
 * rewards how consistently and how long you train, not only volume.
 *
 * `profiles.flair` stores the chosen id. Unlocks are checked client-side
 * (it's cosmetic); unknown ids are never rendered.
 */
import type { EvaluatedAchievement } from './achievements';

export type FlairTrack = 'consistency' | 'time' | 'skill';
export type FlairIcon = 'flame' | 'calendar' | 'clock' | 'opening' | 'endgame' | 'trophy';
export type FlairTone = 'gold' | 'accent' | 'correct' | 'inaccuracy' | 'mistake';

export interface FlairDef {
  id: string;
  title: string;
  track: FlairTrack;
  icon: FlairIcon;
  tone: FlairTone;
  /** Achievement id that unlocks it. */
  unlockedBy: string;
}

export const FLAIR_TRACK_LABEL: Record<FlairTrack, string> = {
  consistency: 'Consistency',
  time: 'Time put in',
  skill: 'Skill',
};

export const FLAIR_TRACK_ORDER: readonly FlairTrack[] = ['consistency', 'time', 'skill'];

export const FLAIRS: readonly FlairDef[] = [
  { id: 'regular', title: 'Regular', track: 'consistency', icon: 'flame', tone: 'mistake', unlockedBy: 'streak-7' },
  { id: 'unstoppable', title: 'Unstoppable', track: 'consistency', icon: 'flame', tone: 'gold', unlockedBy: 'streak-30' },
  { id: 'clockwork', title: 'Clockwork', track: 'consistency', icon: 'calendar', tone: 'accent', unlockedBy: 'active-days-100' },
  { id: 'committed', title: 'Committed', track: 'time', icon: 'clock', tone: 'inaccuracy', unlockedBy: 'time-10h' },
  { id: 'grinder', title: 'Grinder', track: 'time', icon: 'clock', tone: 'gold', unlockedBy: 'time-50h' },
  { id: 'theorist', title: 'Theorist', track: 'skill', icon: 'opening', tone: 'correct', unlockedBy: 'opening-master-10' },
  { id: 'endgame-medic', title: 'Endgame Medic', track: 'skill', icon: 'endgame', tone: 'inaccuracy', unlockedBy: 'endgame-rescue-5' },
  { id: 'pattern-master', title: 'Pattern Master', track: 'skill', icon: 'trophy', tone: 'gold', unlockedBy: 'master-50' },
] as const;

export function flairById(id: string | null | undefined): FlairDef | null {
  if (!id) return null;
  return FLAIRS.find((f) => f.id === id) ?? null;
}

/** Each flair with its unlocking achievement's progress. */
export function evaluateFlairs(
  achievements: EvaluatedAchievement[],
): Array<FlairDef & { unlocked: boolean; requirement: EvaluatedAchievement | null }> {
  const byId = new Map(achievements.map((a) => [a.id, a]));
  return FLAIRS.map((f) => {
    const requirement = byId.get(f.unlockedBy) ?? null;
    return { ...f, requirement, unlocked: requirement?.earned ?? false };
  });
}
