import { supabase } from '../../lib/supabase';
import type { TablesUpdate } from '../../lib/database.types';
import { TrainingSession, trainingSessionFromJson } from '../../models/trainingSession';
import { currentUserId } from './currentUser';

export async function createTrainingSession(args: {
  localDate: string;
}): Promise<TrainingSession | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('training_sessions')
    .insert({
      user_id: userId,
      local_date: args.localDate,
      blunders_attempted: 0,
      blunders_correct: 0,
      cycles_completed: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return trainingSessionFromJson(data);
}

export async function updateTrainingSession(
  id: string,
  patch: {
    blundersAttempted?: number;
    blundersCorrect?: number;
    cyclesCompleted?: number;
    endedAt?: Date | null;
  },
): Promise<void> {
  const update: TablesUpdate<'training_sessions'> = {};
  if (patch.blundersAttempted !== undefined) update.blunders_attempted = patch.blundersAttempted;
  if (patch.blundersCorrect !== undefined) update.blunders_correct = patch.blundersCorrect;
  if (patch.cyclesCompleted !== undefined) update.cycles_completed = patch.cyclesCompleted;
  if (patch.endedAt !== undefined) update.ended_at = patch.endedAt ? patch.endedAt.toISOString() : null;
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from('training_sessions').update(update).eq('id', id);
  if (error) throw error;
}

export async function getRecentTrainingSessions(limit = 10): Promise<TrainingSession[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('training_sessions')
    .select()
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(trainingSessionFromJson);
}

export async function getTrainingSessionsSince(sinceDate: string): Promise<TrainingSession[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('training_sessions')
    .select()
    .eq('user_id', userId)
    .gte('local_date', sinceDate)
    .order('local_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(trainingSessionFromJson);
}

export async function hasTrainingSessionToday(localDate: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const { data, error } = await supabase
    .from('training_sessions')
    .select('id, blunders_correct')
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .gt('blunders_correct', 0)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
