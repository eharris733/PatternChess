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

export interface TrainingTotals {
  /** Finished sessions' minutes, each capped at 120. */
  minutes: number;
  /** Distinct local dates with at least one correct drill. */
  activeDays: number;
  /**
   * Lifetime first-attempt positions trained: the daily goal's count
   * (training_sessions.blunders_attempted, openings excluded) summed over
   * every session. The /path metric.
   */
  positions: number;
}

/** Lifetime training totals (`profile.trainingTotals`). */
export async function getTrainingTotals(): Promise<TrainingTotals> {
  const data = await rpc<unknown>('profile.trainingTotals');
  const o = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { minutes: num(o.minutes), activeDays: num(o.activeDays), positions: num(o.positions) };
}
