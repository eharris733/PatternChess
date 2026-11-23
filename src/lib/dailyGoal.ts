/**
 * Daily commitment — how many positions to train and games to play for the
 * day to count as "done" (plus the fixed opening and endgame steps below). Drives the dashboard daily-plan card and the
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

/** Opening reviews the plan asks for per day (capped by the drills you have). */
export const OPENINGS_PER_DAY = 3;
/** Endgame play-outs the plan asks for per day (capped by the endgames you have). */
export const PLAYOUTS_PER_DAY = 2;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The day's units in plan order, for a translated summary (`planSummary` is the English one). */
export type PlanUnit = 'positions' | 'openings' | 'endgames' | 'games';
export function planSummaryParts(
  goals: Pick<DailyGoals, 'positionsPerDay' | 'gamesPerDay'>,
): { unit: PlanUnit; count: number }[] {
  const parts: { unit: PlanUnit; count: number }[] = [
    { unit: 'positions', count: goals.positionsPerDay },
    { unit: 'openings', count: OPENINGS_PER_DAY },
    { unit: 'endgames', count: PLAYOUTS_PER_DAY },
  ];
  if (goals.gamesPerDay > 0) parts.push({ unit: 'games', count: goals.gamesPerDay });
  return parts;
}

/**
 * The whole day in one line, in plan order (Train → Openings → Endgames →
 * Play): "10 positions, 3 opening reviews, 2 endgames, 1 game". The picker
 * and the plan card use it so a level always says what it asks for.
 */
export function planSummary(goals: Pick<DailyGoals, 'positionsPerDay' | 'gamesPerDay'>): string {
  const parts = [
    plural(goals.positionsPerDay, 'position', 'positions'),
    plural(OPENINGS_PER_DAY, 'opening review', 'opening reviews'),
    plural(PLAYOUTS_PER_DAY, 'endgame', 'endgames'),
  ];
  if (goals.gamesPerDay > 0) parts.push(plural(goals.gamesPerDay, 'game', 'games'));
  return parts.join(', ');
}

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
