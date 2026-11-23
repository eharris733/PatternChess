/**
 * Daily commitment — how many positions to train and games to play for the
 * day to count as "done". Drives the dashboard daily-plan card and the
 * come-back-tomorrow streak loop. Stored per user on `profiles`
 * (commitment_level + daily_positions_goal + daily_games_goal, migration
 * 20261120130000); the presets below are the only label source.
 */

export type CommitmentLevel = 'casual' | 'regular' | 'serious' | 'obsessed' | 'custom';

export interface DailyGoals {
  level: CommitmentLevel;
  /** First-attempt drills (openings excluded) that complete the Train step. */
  positionsPerDay: number;
  /** Games played today (any synced platform) that complete the Play step. 0 hides the step. */
  gamesPerDay: number;
}

export type CommitmentPreset = Exclude<CommitmentLevel, 'custom'>;

export const COMMITMENT_PRESETS: Record<CommitmentPreset, { positionsPerDay: number; gamesPerDay: number }> = {
  casual: { positionsPerDay: 5, gamesPerDay: 1 },
  regular: { positionsPerDay: 10, gamesPerDay: 1 },
  serious: { positionsPerDay: 20, gamesPerDay: 2 },
  obsessed: { positionsPerDay: 30, gamesPerDay: 3 },
};

export const COMMITMENT_PRESET_ORDER: CommitmentPreset[] = ['casual', 'regular', 'serious', 'obsessed'];

export const COMMITMENT_LABEL: Record<CommitmentLevel, string> = {
  casual: 'Casual',
  regular: 'Regular',
  serious: 'Serious',
  obsessed: 'Obsessed',
  custom: 'Custom',
};

/** One line per preset on what it gets you (CommitmentPicker). */
export const COMMITMENT_TAGLINE: Record<CommitmentPreset, string> = {
  casual: 'A coffee-break habit, small enough to never skip.',
  regular: 'Steady progress, done before dinner.',
  serious: 'For players with a rating target in mind.',
  obsessed: 'Your opponents should be worried. So should your family.',
};

/** Bounds match the profiles check constraints. */
export const POSITIONS_PER_DAY_RANGE = { min: 1, max: 100 } as const;
export const GAMES_PER_DAY_RANGE = { min: 0, max: 10 } as const;

/** Default for profiles that predate commitment levels. */
export const DEFAULT_DAILY_GOALS: DailyGoals = { level: 'regular', ...COMMITMENT_PRESETS.regular };

/** Kept for callers that only need the default position goal. */
export const DAILY_GOAL = DEFAULT_DAILY_GOALS.positionsPerDay;

export function isCommitmentLevel(v: unknown): v is CommitmentLevel {
  return v === 'casual' || v === 'regular' || v === 'serious' || v === 'obsessed' || v === 'custom';
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Goals for a preset, or a clamped custom pair. */
export function goalsFor(
  level: CommitmentLevel,
  custom?: { positionsPerDay: number; gamesPerDay: number },
): DailyGoals {
  if (level !== 'custom') return { level, ...COMMITMENT_PRESETS[level] };
  const base = custom ?? COMMITMENT_PRESETS.regular;
  return {
    level,
    positionsPerDay: clampInt(base.positionsPerDay, POSITIONS_PER_DAY_RANGE.min, POSITIONS_PER_DAY_RANGE.max),
    gamesPerDay: clampInt(base.gamesPerDay, GAMES_PER_DAY_RANGE.min, GAMES_PER_DAY_RANGE.max),
  };
}

/** Parse the profiles columns, falling back to the default for missing/invalid values. */
export function dailyGoalsFromJson(json: {
  commitment_level?: unknown;
  daily_positions_goal?: unknown;
  daily_games_goal?: unknown;
}): DailyGoals {
  const level = isCommitmentLevel(json.commitment_level) ? json.commitment_level : DEFAULT_DAILY_GOALS.level;
  const positions = typeof json.daily_positions_goal === 'number' ? json.daily_positions_goal : null;
  const games = typeof json.daily_games_goal === 'number' ? json.daily_games_goal : null;
  if (positions == null || games == null) return goalsFor(level);
  // The stored numbers win (a preset retune never moves existing users);
  // keep the stored label rather than the 'custom' goalsFor stamps.
  return { ...goalsFor('custom', { positionsPerDay: positions, gamesPerDay: games }), level };
}

export interface DailyGoalProgress {
  done: number;
  goal: number;
  remaining: number;
  fraction: number;
  met: boolean;
}

export function dailyGoalProgress(done: number, goal: number = DAILY_GOAL): DailyGoalProgress {
  const safeGoal = Math.max(1, goal);
  const clampedDone = Math.max(0, done);
  return {
    done: clampedDone,
    goal: safeGoal,
    remaining: Math.max(0, safeGoal - clampedDone),
    fraction: Math.min(1, clampedDone / safeGoal),
    met: clampedDone >= safeGoal,
  };
}
