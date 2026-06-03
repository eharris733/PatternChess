/**
 * Achievements — player-facing milestones computed from the same training
 * metrics the rest of the app already tracks. Kept as pure data + functions so
 * the exact definitions and thresholds can be reused for admin analytics
 * (e.g. "% of users who reached Pattern Master") without duplicating logic.
 */

export type AchievementCategory = 'consistency' | 'mastery' | 'practice' | 'library';

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  consistency: 'Consistency',
  mastery: 'Mastery',
  practice: 'Practice',
  library: 'Library',
};

/**
 * The shared metric bundle. Every achievement is a threshold on one of these,
 * so this is also the natural shape for any analytics aggregation.
 */
export interface AchievementMetrics {
  reviewed: number; // lifetime first-attempt correct recalls
  mastered: number; // positions mastered (7 cycles, >=80% recall)
  totalBlunders: number; // blunders catalogued from your games
  gamesAnalyzed: number; // games imported + analyzed
  currentStreakDays: number;
  longestStreakDays: number;
}

export const EMPTY_METRICS: AchievementMetrics = {
  reviewed: 0,
  mastered: 0,
  totalBlunders: 0,
  gamesAnalyzed: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
};

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  // Which metric this milestone is measured against, and the value to reach.
  metric: keyof AchievementMetrics;
  threshold: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Consistency — measured against the longest streak so an earned badge sticks.
  { id: 'streak-3', title: 'Getting Started', description: 'Reach a 3-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 3 },
  { id: 'streak-7', title: 'Weekly Habit', description: 'Reach a 7-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 7 },
  { id: 'streak-30', title: 'Unstoppable', description: 'Reach a 30-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 30 },

  // Mastery — positions taken all the way through the spaced-repetition ladder.
  { id: 'master-1', title: 'First Mastery', description: 'Master your first position.', category: 'mastery', metric: 'mastered', threshold: 1 },
  { id: 'master-10', title: 'Pattern Hunter', description: 'Master 10 positions.', category: 'mastery', metric: 'mastered', threshold: 10 },
  { id: 'master-50', title: 'Pattern Master', description: 'Master 50 positions.', category: 'mastery', metric: 'mastered', threshold: 50 },
  { id: 'master-150', title: 'Total Recall', description: 'Master 150 positions.', category: 'mastery', metric: 'mastered', threshold: 150 },

  // Practice — sheer volume of correct first-attempt recalls.
  { id: 'review-1', title: 'First Drill', description: 'Complete your first drill.', category: 'practice', metric: 'reviewed', threshold: 1 },
  { id: 'review-100', title: 'Centurion', description: 'Recall 100 positions.', category: 'practice', metric: 'reviewed', threshold: 100 },
  { id: 'review-500', title: 'Devoted', description: 'Recall 500 positions.', category: 'practice', metric: 'reviewed', threshold: 500 },
  { id: 'review-1000', title: 'Woodpecker', description: 'Recall 1,000 positions.', category: 'practice', metric: 'reviewed', threshold: 1000 },

  // Library — building up the material to train against.
  { id: 'games-10', title: 'Building a Vault', description: 'Analyze 10 games.', category: 'library', metric: 'gamesAnalyzed', threshold: 10 },
  { id: 'games-100', title: 'Archivist', description: 'Analyze 100 games.', category: 'library', metric: 'gamesAnalyzed', threshold: 100 },
  { id: 'blunders-50', title: 'Know Thy Enemy', description: 'Catalogue 50 blunders.', category: 'library', metric: 'totalBlunders', threshold: 50 },
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

export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'consistency',
  'mastery',
  'practice',
  'library',
];
