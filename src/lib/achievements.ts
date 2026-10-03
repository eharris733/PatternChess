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
  | 'openings'
  | 'endgames'
  | 'discovery'
  | 'library'
  | 'rating';

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  setup: 'Getting set up',
  consistency: 'Consistency',
  mastery: 'Mastery',
  practice: 'Practice',
  openings: 'Openings',
  endgames: 'Endgames',
  discovery: 'Discovery',
  library: 'Library',
  rating: 'Rating',
};

export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'setup',
  'consistency',
  'mastery',
  'practice',
  'openings',
  'endgames',
  'discovery',
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
  mastered: number; // positions mastered (all ladder cycles, >=80% recall)
  totalBlunders: number; // blunders catalogued from your games
  gamesAnalyzed: number; // games imported + analyzed
  currentStreakDays: number;
  longestStreakDays: number;
  connectedLichess: number; // 1 if a Lichess account is linked
  connectedChesscom: number; // 1 if a Chess.com account is linked
  ratingGained: number; // best net rating gain across time controls since joining
  endgamesRescued: number; // /endgames scenarios rescued (status: passed)
  usedTrainingFilter: number; // 1 if a /training focus (opening/motif/phase/situation) has ever been picked
  followedInstagram: number; // 1 once the user has clicked through to the PatternChess Instagram
  sharesCount: number; // shares from PatternChess (links, images, GIFs)
  referralsCount: number; // friends who joined through your invite link
  minutesTrained: number; // lifetime training minutes (sessions capped at 120 min each)
  activeDays: number; // lifetime distinct days with ≥1 correct drill
  openingReviewsOpened: number; // /openings reviews opened
  openingSolved: number; // first-attempt correct recalls on opening drills
  openingMastered: number; // opening drills mastered
  bookDepthGames: number; // games still in theory at move 10 (stayedInBookThrough)
  learnChapters: number; // distinct Learn chapters completed
  endgamePlayouts: number; // /endgames play-outs finished (every attempt)
  endgameSolved: number; // endgame reviews won/held: scenario passes + endgame drills solved first try
  endgameMastered: number; // endgame scenarios + endgame drills through the whole ladder
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
  endgamesRescued: 0,
  usedTrainingFilter: 0,
  followedInstagram: 0,
  sharesCount: 0,
  referralsCount: 0,
  minutesTrained: 0,
  activeDays: 0,
  openingReviewsOpened: 0,
  openingSolved: 0,
  openingMastered: 0,
  bookDepthGames: 0,
  learnChapters: 0,
  endgamePlayouts: 0,
  endgameSolved: 0,
  endgameMastered: 0,
};

export const INSTAGRAM_URL = 'https://www.instagram.com/patternchess/';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  /** Which metric this milestone is measured against, and the value to reach. */
  metric: keyof AchievementMetrics;
  threshold: number;
  /** Optional call-to-action rendered on the tile while unearned (link; external when absolute). */
  action?: { label: string; href: string };
  /** Tile icon; the trophy when omitted. */
  icon?: AchievementIcon;
}

export type AchievementIcon = 'trophy' | 'opening' | 'endgame' | 'learn' | 'clock' | 'calendar';

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Getting set up — link an account so we have games to analyze.
  { id: 'connect-lichess', title: 'Lichess Linked', description: 'Connect your Lichess account.', category: 'setup', metric: 'connectedLichess', threshold: 1 },
  { id: 'connect-chesscom', title: 'Chess.com Linked', description: 'Connect your Chess.com account.', category: 'setup', metric: 'connectedChesscom', threshold: 1 },
  { id: 'follow-instagram', title: 'Follow Along', description: 'Follow @patternchess on Instagram for puzzles and updates.', category: 'setup', metric: 'followedInstagram', threshold: 1, action: { label: 'Follow @patternchess', href: INSTAGRAM_URL } },

  // Consistency — measured against the longest streak so an earned badge sticks.
  { id: 'streak-3', title: 'Getting Started', description: 'Reach a 3-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 3 },
  { id: 'streak-7', title: 'Weekly Habit', description: 'Reach a 7-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 7 },
  { id: 'streak-14', title: 'Fortnight', description: 'Reach a 14-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 14 },
  { id: 'streak-30', title: 'Unstoppable', description: 'Reach a 30-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 30 },
  { id: 'streak-100', title: 'Centennial', description: 'Reach a 100-day training streak.', category: 'consistency', metric: 'longestStreakDays', threshold: 100 },
  // Lifetime totals — reward showing up over time, not only unbroken streaks.
  { id: 'active-days-30', title: 'Showing Up', description: 'Train on 30 different days.', category: 'consistency', metric: 'activeDays', threshold: 30, icon: 'calendar' },
  { id: 'active-days-100', title: 'Clockwork', description: 'Train on 100 different days.', category: 'consistency', metric: 'activeDays', threshold: 100, icon: 'calendar' },
  { id: 'time-10h', title: 'Committed', description: 'Put 10 hours into training.', category: 'consistency', metric: 'minutesTrained', threshold: 600, icon: 'clock' },
  { id: 'time-50h', title: 'Grinder', description: 'Put 50 hours into training.', category: 'consistency', metric: 'minutesTrained', threshold: 3000, icon: 'clock' },

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

  // Openings — the /openings theory-exit review, opening drills and /learn.
  { id: 'opening-review-1', title: 'First Look', description: 'Open one of your opening exits and replay it against the database.', category: 'openings', metric: 'openingReviewsOpened', threshold: 1, icon: 'opening', action: { label: 'See your openings', href: '/openings' } },
  { id: 'opening-review-10', title: 'Case Study', description: 'Review 10 opening exits.', category: 'openings', metric: 'openingReviewsOpened', threshold: 10, icon: 'opening' },
  { id: 'opening-drill-1', title: 'Back in Book', description: 'Solve an opening drill on the first try.', category: 'openings', metric: 'openingSolved', threshold: 1, icon: 'opening' },
  { id: 'opening-drill-25', title: 'Theory Student', description: 'Solve 25 opening drills.', category: 'openings', metric: 'openingSolved', threshold: 25, icon: 'opening' },
  { id: 'opening-drill-100', title: 'Repertoire Builder', description: 'Solve 100 opening drills.', category: 'openings', metric: 'openingSolved', threshold: 100, icon: 'opening' },
  { id: 'opening-master-10', title: 'Well Prepared', description: 'Master 10 opening positions.', category: 'openings', metric: 'openingMastered', threshold: 10, icon: 'opening' },
  { id: 'book-deep-10', title: 'Booked Up', description: 'Still be in theory at move 10 in 10 games.', category: 'openings', metric: 'bookDepthGames', threshold: 10, icon: 'opening' },
  { id: 'book-deep-50', title: 'Deep Prep', description: 'Still be in theory at move 10 in 50 games.', category: 'openings', metric: 'bookDepthGames', threshold: 50, icon: 'opening' },
  { id: 'learn-chapter-1', title: 'Study Hall', description: 'Finish a chapter in the Learn library.', category: 'openings', metric: 'learnChapters', threshold: 1, icon: 'learn', action: { label: 'Open Learn', href: '/learn' } },
  { id: 'learn-chapter-10', title: 'Bookworm', description: 'Finish 10 Learn chapters.', category: 'openings', metric: 'learnChapters', threshold: 10, icon: 'learn' },

  // Endgames — /endgames play-outs (on the SR ladder) and logged endgame drills.
  // The rescue ids predate the category; flair unlocks reference them, so keep them.
  { id: 'endgame-rescue-1', title: 'First Rescue', description: 'Rescue a dropped point in the endgame trainer.', category: 'endgames', metric: 'endgamesRescued', threshold: 1, icon: 'endgame', action: { label: 'Open endgames', href: '/endgames' } },
  { id: 'endgame-rescue-5', title: 'Endgame Medic', description: 'Rescue 5 dropped points in the endgame trainer.', category: 'endgames', metric: 'endgamesRescued', threshold: 5, icon: 'endgame' },
  { id: 'endgame-rescue-15', title: 'Point Guard', description: 'Rescue 15 dropped points in the endgame trainer.', category: 'endgames', metric: 'endgamesRescued', threshold: 15, icon: 'endgame' },
  { id: 'endgame-playout-10', title: 'Endgame Regular', description: 'Finish 10 endgame play-outs.', category: 'endgames', metric: 'endgamePlayouts', threshold: 10, icon: 'endgame' },
  { id: 'endgame-playout-50', title: 'Technique Grinder', description: 'Finish 50 endgame play-outs.', category: 'endgames', metric: 'endgamePlayouts', threshold: 50, icon: 'endgame' },
  { id: 'endgame-solved-25', title: 'Converter', description: 'Win or hold 25 endgame reviews.', category: 'endgames', metric: 'endgameSolved', threshold: 25, icon: 'endgame' },
  { id: 'endgame-master-1', title: 'Clean Technique', description: 'Master an endgame: clear every review on the ladder.', category: 'endgames', metric: 'endgameMastered', threshold: 1, icon: 'endgame' },
  { id: 'endgame-master-10', title: 'Endgame Technician', description: 'Master 10 endgames.', category: 'endgames', metric: 'endgameMastered', threshold: 10, icon: 'endgame' },

  // Discovery — nudges toward the training-focus picker and sharing.
  { id: 'filtered-training-1', title: 'Focused Training', description: 'Train a specific focus — an opening, pattern, phase, or situation — from the training picker.', category: 'discovery', metric: 'usedTrainingFilter', threshold: 1 },
  { id: 'share-1', title: 'First Share', description: 'Share a puzzle, GIF or achievement from PatternChess.', category: 'discovery', metric: 'sharesCount', threshold: 1 },
  { id: 'share-5', title: 'Spreading the Word', description: 'Share 5 times from PatternChess.', category: 'discovery', metric: 'sharesCount', threshold: 5 },
  { id: 'share-25', title: 'Ambassador', description: 'Share 25 times from PatternChess.', category: 'discovery', metric: 'sharesCount', threshold: 25 },
  { id: 'invite-1', title: 'Recruiter', description: 'Get a friend to join PatternChess with your invite link.', category: 'discovery', metric: 'referralsCount', threshold: 1, action: { label: 'Invite a friend', href: '/leaderboards' } },
  { id: 'invite-5', title: 'Club Captain', description: 'Bring 5 friends to PatternChess.', category: 'discovery', metric: 'referralsCount', threshold: 5 },

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
