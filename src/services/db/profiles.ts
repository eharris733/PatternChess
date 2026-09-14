import { supabase } from '../../lib/supabase';
import type { TablesUpdate } from '../../lib/database.types';
import { currentUserId } from './currentUser';

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
}): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase
    .from('profiles')
    .update({
      current_streak_days: args.currentStreakDays,
      longest_streak_days: args.longestStreakDays,
      last_drill_local_date: args.lastDrillLocalDate,
      timezone: args.timezone,
    })
    .eq('id', userId);
  if (error) throw error;
}
