import { rpc } from '../../lib/api';
import type { Tables, TablesUpdate } from '../../lib/database.types';
import { TrainingSession, trainingSessionFromJson } from '../../models/trainingSession';
import { currentUserId } from './currentUser';

export async function createTrainingSession(args: {
  localDate: string;
}): Promise<TrainingSession | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const data = await rpc<Tables<'training_sessions'> | null>('sessions.create', { localDate: args.localDate });
  return data ? trainingSessionFromJson(data) : null;
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
  await rpc('sessions.update', { id, patch: update });
}

export async function getRecentTrainingSessions(limit = 10): Promise<TrainingSession[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const data = await rpc<Tables<'training_sessions'>[]>('sessions.recent', { limit });
  return (data ?? []).map(trainingSessionFromJson);
}

export async function getTrainingSessionsSince(sinceDate: string): Promise<TrainingSession[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const data = await rpc<Tables<'training_sessions'>[]>('sessions.since', { sinceDate });
  return (data ?? []).map(trainingSessionFromJson);
}

export async function hasTrainingSessionToday(localDate: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  return (await rpc<boolean>('sessions.hasToday', { localDate })) === true;
}
