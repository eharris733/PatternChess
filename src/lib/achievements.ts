/**
 * Achievements — player-facing milestones computed from the same training
 * metrics the rest of the app already tracks. Kept as pure data + functions so
 * the exact definitions and thresholds can be reused for admin analytics
 * (e.g. "% of users who reached Pattern Master") without duplicating logic.
 */

export type AchievementCategory =
  | 'setup'
  | 'consistency'
  | 'mastery'
  | 'practice'
  | 'library'
  | 'rating';

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  setup: 'Getting set up',
  consistency: 'Consistency',
  mastery: 'Mastery',
  practice: 'Practice',
  library: 'Library',
  rating: 'Rating',
};

export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'setup',
  'consistency',
  'mastery',
  'practice',
  'library',
  'rating',
];

/**
 * The shared metric bundle. Every achievement is a threshold on one of these,
 * so this is also the natural shape for any analytics aggregation. Booleans are
 * modelled as 0/1 numbers (threshold 1) so every achievement is a simple
 * "value >= threshold" check.
 */
export interface AchievementMetrics {
  reviewed: number; // lifetime first-attempt correct recalls
  mastered: number; // positions mastered (7 cycles, >=80% recall)
  totalBlunders: number; // blunders catalogued from your games
  gamesAnalyzed: number; // games imported + analyzed
  currentStreakDays: number;
  longestStreakDays: number;
  connectedLichess: number; // 1 if a Lichess account is linked
  connectedChesscom: number; // 1 if a Chess.com account is linked
  ratingGained: number; // best net rating gain across time controls since joining
}

export const EMPTY_METRICS: AchievementMetrics = {
  reviewed: 0,
  mastered: 0,
  totalBlunders: 0,
  gamesAnalyzed: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  connectedLichess: 0,
  connectedChesscom: 0,
  ratingGained: 0,
};

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  /** Which metric this milestone is measured against, and the value to reach. */
  metric: keyof AchievementMetrics;
  threshold: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Getting set up — link an account so we have games to analyze.
  { id: 'connect-lichess', title: 'Lichess Linked', description: 'Connect your Lichess account.', category: 'setup', metric: 'connectedLichess', threshold: 1 },
  { id: 'connect-chesscom', title: 'Chess.com Linked', description: 'Connect your Chess.com account.', category: 'setup', metric: 'connectedChesscom', threshold: 1 },

  // Consistency — measured against the longest streak so an earned badge sticks.
  { id: 'streak-3', title: 'Getting Started', description: 'Reach a 3-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 3 },
  { id: 'streak-7', title: 'Weekly Habit', description: 'Reach a 7-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 7 },
  { id: 'streak-14', title: 'Fortnight', description: 'Reach a 14-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 14 },
  { id: 'streak-30', title: 'Unstoppable', description: 'Reach a 30-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 30 },
  { id: 'streak-100', title: 'Centennial', description: 'Reach a 100-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 100 },

  // Mastery — positions taken all the way through the spaced-repetition ladder.
  { id: 'master-1', title: 'First Mastery', description: 'Master your first position.', category: 'mastery', metric: 'mastered', threshold: 1 },
  { id: 'master-10', title: 'Pattern Hunter', description: 'Master 10 positions.', category: 'mastery', metric: 'mastered', threshold: 10 },
  { id: 'master-25', title: 'Sharp Eye', description: 'Master 25 positions.', category: 'mastery', metric: 'mastered', threshold: 25 },
  { id: 'master-50', title: 'Pattern Master', description: 'Master 50 positions.', category: 'mastery', metric: 'mastered', threshold: 50 },
  { id: 'master-100', title: 'Memory Palace', description: 'Master 100 positions.', category: 'mastery', metric: 'mastered', threshold: 100 },
  { id: 'master-150', title: 'Total Recall', description: 'Master 150 positions.', category: 'mastery', metric: 'mastered', threshold: 150 },
  { id: 'master-300', title: 'Grandmaster Memory', description: 'Master 300 positions.', category: 'mastery', metric: 'mastered', threshold: 300 },

  // Practice — sheer volume of correct first-attempt recalls.
  { id: 'review-1', title: 'First Drill', description: 'Complete your first drill.', category: 'practice', metric: 'reviewed', threshold: 1 },
  { id: 'review-50', title: 'Warmed Up', description: 'Recall 50 positions.', category: 'practice', metric: 'reviewed', threshold: 50 },
  { id: 'review-100', title: 'Centurion', description: 'Recall 100 positions.', category: 'practice', metric: 'reviewed', threshold: 100 },
  { id: 'review-500', title: 'Devoted', description: 'Recall 500 positions.', category: 'practice', metric: 'reviewed', threshold: 500 },
  { id: 'review-1000', title: 'Woodpecker', description: 'Recall 1,000 positions.', category: 'practice', metric: 'reviewed', threshold: 1000 },
  { id: 'review-2500', title: 'Relentless', description: 'Recall 2,500 positions.', category: 'practice', metric: 'reviewed', threshold: 2500 },

  // Library — building up the material to train against.
  { id: 'games-10', title: 'Building a Vault', description: 'Analyze 10 games.', category: 'library', metric: 'gamesAnalyzed', threshold: 10 },
  { id: 'games-50', title: 'Collector', description: 'Analyze 50 games.', category: 'library', metric: 'gamesAnalyzed', threshold: 50 },
  { id: 'games-100', title: 'Archivist', description: 'Analyze 100 games.', category: 'library', metric: 'gamesAnalyzed', threshold: 100 },
  { id: 'games-250', title: 'Curator', description: 'Analyze 250 games.', category: 'library', metric: 'gamesAnalyzed', threshold: 250 },
  { id: 'blunders-25', title: 'Self-Aware', description: 'Catalogue 25 blunders.', category: 'library', metric: 'totalBlunders', threshold: 25 },
  { id: 'blunders-100', title: 'Know Thy Enemy', description: 'Catalogue 100 blunders.', category: 'library', metric: 'totalBlunders', threshold: 100 },
  { id: 'blunders-250', title: 'Mistake Museum', description: 'Catalogue 250 blunders.', category: 'library', metric: 'totalBlunders', threshold: 250 },

  // Rating — improvement in your online rating since you joined.
  { id: 'rating-10', title: 'On the Up', description: 'Gain 10 rating points.', category: 'rating', metric: 'ratingGained', threshold: 10 },
  { id: 'rating-20', title: 'Climbing', description: 'Gain 20 rating points.', category: 'rating', metric: 'ratingGained', threshold: 20 },
  { id: 'rating-50', title: 'Breakthrough', description: 'Gain 50 rating points.', category: 'rating', metric: 'ratingGained', threshold: 50 },
  { id: 'rating-100', title: 'Ascending', description: 'Gain 100 rating points.', category: 'rating', metric: 'ratingGained', threshold: 100 },
  { id: 'rating-200', title: 'Soaring', description: 'Gain 200 rating points.', category: 'rating', metric: 'ratingGained', threshold: 200 },
] as const;

export interface EvaluatedAchievement extends AchievementDef {
  value: number;
  earned: boolean;
  fraction: number;
}

export function evaluateAchievements(metrics: AchievementMetrics): EvaluatedAchievement[] {
  return ACHIEVEMENTS.map((def) => {
    const value = metrics[def.metric];
    return {
      ...def,
      value,
      earned: value >= def.threshold,
      fraction: Math.min(1, def.threshold > 0 ? value / def.threshold : 1),
    };
  });
}

export function achievementSummary(metrics: AchievementMetrics): { earned: number; total: number } {
  const evaluated = evaluateAchievements(metrics);
  return { earned: evaluated.filter((a) => a.earned).length, total: evaluated.length };
}

/**
 * The unearned achievement closest to completion — highest progress fraction,
 * breaking ties toward the fewest remaining. Powers the dashboard "next
 * achievement" nudge. Returns null once everything is earned.
 */
export function nearestAchievement(evaluated: EvaluatedAchievement[]): EvaluatedAchievement | null {
  let best: EvaluatedAchievement | null = null;
  for (const a of evaluated) {
    if (a.earned) continue;
    if (!best) {
      best = a;
      continue;
    }
    if (a.fraction > best.fraction) best = a;
    else if (a.fraction === best.fraction && a.threshold - a.value < best.threshold - best.value) {
      best = a;
    }
  }
  return best;
}
