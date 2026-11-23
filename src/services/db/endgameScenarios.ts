import { rpc } from '../../lib/api';
import type { Tables, TablesInsert } from '../../lib/database.types';
import { EndgameScenario, endgameScenarioFromJson, ScenarioStatus } from '../../models/endgameScenario';
import { nextDrillDate } from '../../models/blunder';
import { currentUserId } from './currentUser';

// Server side: functions/_shared/rpc/training.ts (`endgameScenarios.*`),
// scoped to the session user.

type ScenarioRow = Tables<'endgame_scenarios'>;

export async function getEndgameScenarios(): Promise<EndgameScenario[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<ScenarioRow[]>('endgameScenarios.list');
  return rows.map(endgameScenarioFromJson);
}

/** Scenarios the deep re-check hasn't looked at yet (oldest first). */
export async function getUnverifiedEndgameScenarios(opts: {
  limit: number;
}): Promise<EndgameScenario[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<ScenarioRow[]>('endgameScenarios.unverified', { limit: opts.limit });
  return rows.map(endgameScenarioFromJson);
}

export async function countUnverifiedEndgameScenarios(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('endgameScenarios.countUnverified');
}

export async function markEndgameScenarioVerified(
  id: string,
  result: { verifyEvalCp: number; retired: boolean },
): Promise<void> {
  await rpc('endgameScenarios.markVerified', {
    id,
    verifyEvalCp: result.verifyEvalCp,
    retired: result.retired,
  });
}

/**
 * Idempotent scan write: one scenario per game, first write wins so
 * status/attempts survive re-scans.
 */
export async function upsertEndgameScenarios(
  rows: Omit<TablesInsert<'endgame_scenarios'>, 'user_id'>[],
): Promise<void> {
  if (rows.length === 0) return;
  const userId = await currentUserId();
  if (!userId) return; // scenarios are owner-scoped — nothing to persist without one
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await rpc('endgameScenarios.upsert', { rows: rows.slice(i, i + CHUNK) });
  }
}

export async function updateEndgameScenarioResult(
  id: string,
  update: { status: ScenarioStatus; attempts: number },
): Promise<void> {
  // last_played_at is stamped by the server.
  await rpc('endgameScenarios.updateResult', { id, status: update.status, attempts: update.attempts });
}

/** Persist a play-out result on the SR ladder (see applyScenarioResult). */
export async function updateEndgameScenarioSr(s: EndgameScenario): Promise<void> {
  await rpc('endgameScenarios.updateSr', {
    id: s.id,
    patch: {
      status: s.status,
      attempts: s.attempts,
      last_played_at: (s.lastPlayedAt ?? new Date()).toISOString(),
      cycle_number: s.cycleNumber,
      times_correct: s.timesCorrect,
      times_attempted: s.timesAttempted,
      last_drill_failed: s.lastDrillFailed,
      last_drilled_at: (s.lastDrilledAt ?? new Date()).toISOString(),
      next_drill_at: (s.nextDrillAt ?? nextDrillDate(s)).toISOString(),
    },
  });
}
