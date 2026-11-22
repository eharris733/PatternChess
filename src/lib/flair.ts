/**
 * Flair — an earned, cosmetic title a player can pin to their profile and
 * leaderboard rows. Every flair is unlocked by one achievement (single
 * progress source: src/lib/achievements.ts), grouped into tracks so it
 * rewards how consistently and how long you train, not only volume. The
 * supporter track is unlocked by the $5/month tier instead (`SUPPORTER_UNLOCK`),
 * and an active supporter may wear any flair.
 *
 * `profiles.flair` stores the chosen id. Unlocks are checked client-side
 * (it's cosmetic); unknown ids are never rendered.
 */
import type { EvaluatedAchievement } from './achievements';

export type FlairTrack = 'consistency' | 'time' | 'skill' | 'supporter';
export type FlairIcon = 'flame' | 'calendar' | 'clock' | 'opening' | 'endgame' | 'trophy' | 'heart';
export type FlairTone = 'gold' | 'accent' | 'correct' | 'inaccuracy' | 'mistake';

export interface FlairDef {
  id: string;
  title: string;
  track: FlairTrack;
  icon: FlairIcon;
  tone: FlairTone;
  /** Achievement id that unlocks it, or a `SUPPORTER_UNLOCK` value. */
  unlockedBy: string;
}

export const FLAIR_TRACK_LABEL: Record<FlairTrack, string> = {
  consistency: 'Consistency',
  time: 'Time put in',
  skill: 'Skill',
  supporter: 'Supporter',
};

/** Unlocks for the supporter track: ever subscribed (kept after lapsing) / subscribed now. */
export const SUPPORTER_UNLOCK = { early: 'supporter:early', active: 'supporter:active' } as const;

export interface SupporterFlairStatus {
  /** Perks on now (`is_supporter`). */
  active: boolean;
  /** Ever subscribed (`first_supported_at`); keeps Early Supporter after lapsing. */
  early: boolean;
}

export const FLAIR_TRACK_ORDER: readonly FlairTrack[] = ['supporter', 'consistency', 'time', 'skill'];

export const FLAIRS: readonly FlairDef[] = [
  { id: 'regular', title: 'Regular', track: 'consistency', icon: 'flame', tone: 'mistake', unlockedBy: 'streak-7' },
  { id: 'unstoppable', title: 'Unstoppable', track: 'consistency', icon: 'flame', tone: 'gold', unlockedBy: 'streak-30' },
  { id: 'clockwork', title: 'Clockwork', track: 'consistency', icon: 'calendar', tone: 'accent', unlockedBy: 'active-days-100' },
  { id: 'committed', title: 'Committed', track: 'time', icon: 'clock', tone: 'inaccuracy', unlockedBy: 'time-10h' },
  { id: 'grinder', title: 'Grinder', track: 'time', icon: 'clock', tone: 'gold', unlockedBy: 'time-50h' },
  { id: 'theorist', title: 'Theorist', track: 'skill', icon: 'opening', tone: 'correct', unlockedBy: 'opening-master-10' },
  { id: 'endgame-medic', title: 'Endgame Medic', track: 'skill', icon: 'endgame', tone: 'inaccuracy', unlockedBy: 'endgame-rescue-5' },
  { id: 'pattern-master', title: 'Pattern Master', track: 'skill', icon: 'trophy', tone: 'gold', unlockedBy: 'master-50' },
  { id: 'early-supporter', title: 'Early Supporter', track: 'supporter', icon: 'heart', tone: 'gold', unlockedBy: SUPPORTER_UNLOCK.early },
  { id: 'patron', title: 'Patron', track: 'supporter', icon: 'heart', tone: 'accent', unlockedBy: SUPPORTER_UNLOCK.active },
] as const;

export function flairById(id: string | null | undefined): FlairDef | null {
  if (!id) return null;
  return FLAIRS.find((f) => f.id === id) ?? null;
}

/** Each flair with its unlocking achievement's progress. Active supporters unlock every flair. */
export function evaluateFlairs(
  achievements: EvaluatedAchievement[],
  supporter: SupporterFlairStatus = { active: false, early: false },
): Array<FlairDef & { unlocked: boolean; requirement: EvaluatedAchievement | null }> {
  const byId = new Map(achievements.map((a) => [a.id, a]));
  return FLAIRS.map((f) => {
    if (f.unlockedBy === SUPPORTER_UNLOCK.early) {
      return { ...f, requirement: null, unlocked: supporter.early || supporter.active };
    }
    if (f.unlockedBy === SUPPORTER_UNLOCK.active) {
      return { ...f, requirement: null, unlocked: supporter.active };
    }
    const requirement = byId.get(f.unlockedBy) ?? null;
    return { ...f, requirement, unlocked: supporter.active || (requirement?.earned ?? false) };
  });
}
