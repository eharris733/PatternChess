import { supabase } from '../../lib/supabase';
import type { TablesUpdate } from '../../lib/database.types';
import { currentUserId } from './currentUser';
import type { DailyGoals } from '../../lib/dailyGoal';

export async function updateProfileLastSynced(
  platform: 'lichess' | 'chess.com',
  ts: Date,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const update: TablesUpdate<'profiles'> =
    platform === 'lichess'
      ? { last_synced_lichess_at: ts.toISOString() }
      : { last_synced_chesscom_at: ts.toISOString() };
  const { error } = await supabase.from('profiles').update(update).eq('id', userId);
  if (error) throw error;
}

export async function updateProfileStreak(args: {
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string;
  timezone: string;
  /** Banked freezes after this update; omitted = leave unchanged. */
  streakFreezes?: number;
  /** Freezes spent by this update, added to the lifetime counter. */
  freezesUsed?: number;
}): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const base = {
    current_streak_days: args.currentStreakDays,
    longest_streak_days: args.longestStreakDays,
    last_drill_local_date: args.lastDrillLocalDate,
    timezone: args.timezone,
  };
  const { error } = await supabase
    .from('profiles')
    .update(args.streakFreezes != null ? { ...base, streak_freezes: args.streakFreezes } : base)
    .eq('id', userId);
  if (error && args.streakFreezes != null) {
    // Freeze columns missing (migration 20261120130000 not applied yet): keep
    // the streak itself working.
    const retry = await supabase.from('profiles').update(base).eq('id', userId);
    if (retry.error) throw retry.error;
    return;
  }
  if (error) throw error;
  if (args.freezesUsed && args.freezesUsed > 0) {
    // Lifetime stat only; read-modify-write is fine (one writer: this user).
    const { data } = await supabase.from('profiles').select('streak_freezes_used').eq('id', userId).single();
    await supabase
      .from('profiles')
      .update({ streak_freezes_used: (data?.streak_freezes_used ?? 0) + args.freezesUsed })
      .eq('id', userId);
  }
}

/** Commitment level + daily plan goals (presets in src/lib/dailyGoal.ts). */
export async function updateDailyGoals(goals: DailyGoals): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({
      commitment_level: goals.level,
      daily_positions_goal: goals.positionsPerDay,
      daily_games_goal: goals.gamesPerDay,
    })
    .eq('id', userId);
  if (error) throw error;
}

/** Training reminder emails on/off (opt-out; the one switch in /profile). */
export async function updateEmailOptIn(optIn: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({ email_opt_in: optIn, email_prompted_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
