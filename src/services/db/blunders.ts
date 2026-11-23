import { rpc } from '../../lib/api';
import type { Tables, TablesInsert } from '../../lib/database.types';
import {
  Blunder,
  blunderFromJson,
  type BlunderPhase,
  CorrectMove,
  type DrillKind,
  nextDrillDate,
  sortDueQueue,
} from '../../models/blunder';
import { currentUserId } from './currentUser';

// Server side: functions/_shared/rpc/training.ts (`blunders.*`). Every handler
// is scoped to the session user (that replaced RLS), so the old optional
// `userId` filters are implicit and kept only for signature compatibility.

type BlunderRow = Tables<'blunders'>;

/** Rows per insert call (one D1 batch each). */
const INSERT_CHUNK = 500;

export async function insertBlunders(
  blunders: Omit<TablesInsert<'blunders'>, 'user_id'>[],
): Promise<void> {
  if (blunders.length === 0) return;
  // Analysis callers predate `kind` and omit it — they are always tactics.
  // The server sets user_id from the session.
  const enriched = blunders.map((b) => ({ kind: 'tactic', ...b }));
  // Drop intra-batch duplicates (e.g. threefold repetition) on the
  // (user_id, fen, kind) conflict target.
  const seen = new Set<string>();
  const deduped: typeof enriched = [];
  for (const row of enriched) {
    const key = `${row.fen ?? ''}|${row.kind ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  for (let i = 0; i < deduped.length; i += INSERT_CHUNK) {
    await rpc('blunders.insert', { blunders: deduped.slice(i, i + INSERT_CHUNK) });
  }
}

// Game-analysis views (Vault, Review) show blunders *found in the game* —
// endgame play-out slips also carry a game_id but aren't part of the game's
// analysis, so these stay tactic-only.
export async function getBlundersForGames(gameIds: string[]): Promise<Blunder[]> {
  if (gameIds.length === 0) return [];
  const rows = await rpc<BlunderRow[]>('blunders.forGames', { gameIds });
  return rows.map(blunderFromJson).sort((a, b) => a.moveNumber - b.moveNumber);
}

export async function getBlunderCountsByGame(_opts?: {
  userId?: string;
}): Promise<Record<string, number>> {
  // One aggregate round trip: { game_id: tactic count }.
  return rpc<Record<string, number>>('blunders.countsByGame');
}

export async function getDueBlunders(_opts?: { userId?: string }): Promise<Blunder[]> {
  // Retired rows (deepening showed the position wasn't really a blunder) are
  // hidden from the queue but keep their SR history and stay in Vault/stats.
  // Final ordering (pressing reviews → mastered maintenance → new, by relative
  // overdue-ness) happens client-side in sortDueQueue — see its docstring for why.
  const rows = await rpc<BlunderRow[]>('blunders.due');
  return sortDueQueue(rows.map(blunderFromJson));
}

/**
 * Live (not retired) tactic/endgame drills from these games — the dashboard's
 * "Train them now" for blunders found by the latest sync.
 */
export async function getLiveBlunderIdsForGames(gameIds: string[]): Promise<string[]> {
  if (gameIds.length === 0) return [];
  return rpc<string[]>('blunders.liveIdsForGames', { gameIds: gameIds.slice(0, 200) });
}

/**
 * The oldest due tactic — the position the onboarding screen previews while
 * analysis is still running. One row, so it can poll cheaply.
 */
export async function getFirstDueTactic(_userId: string): Promise<Blunder | null> {
  const row = await rpc<BlunderRow | null>('blunders.firstDueTactic');
  return row ? blunderFromJson(row) : null;
}

/**
 * Every live (not retired) drill of one kind, with its SR state — for the
 * mastery views on /openings. Not filtered by due date.
 */
export async function getDrillsOfKind(kind: 'opening' | 'endgame'): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<BlunderRow[]>('blunders.drillsOfKind', { kind });
  return rows.map(blunderFromJson);
}

/**
 * Every live (not retired) trainable position of every kind, newest first —
 * the Vault's position lists (blunders, mastered).
 */
export async function getAllLiveBlunders(): Promise<Blunder[]> {
  const rows = await rpc<BlunderRow[]>('blunders.allLive');
  return rows.map(blunderFromJson);
}

/**
 * Specific drills for an on-demand session ("Drill these 5", "Train"),
 * whether or not they are due, in the canonical queue order. Drilling one
 * early still goes through the normal SR rules.
 */
export async function getBlundersByIds(ids: string[]): Promise<Blunder[]> {
  if (ids.length === 0) return [];
  const rows = await rpc<BlunderRow[]>('blunders.byIds', { ids });
  return sortDueQueue(rows.map(blunderFromJson));
}

/**
 * "Practice ahead": live drills that aren't due yet, soonest first, for a
 * player whose queue is clear. Narrowed like the training focus (kind,
 * excluded kind, phase). Drilling one early goes through the normal SR rules
 * (applyDrillResult), exactly like a due drill.
 */
export async function getUpcomingBlunders(opts: {
  kind?: DrillKind | null;
  excludeKind?: DrillKind | null;
  phase?: BlunderPhase | null;
  limit?: number;
} = {}): Promise<Blunder[]> {
  const rows = await rpc<BlunderRow[]>('blunders.upcoming', {
    kind: opts.kind ?? null,
    excludeKind: opts.excludeKind ?? null,
    phase: opts.phase ?? null,
    limit: opts.limit ?? 10,
  });
  return rows.map(blunderFromJson);
}

/** How many positions are due now (same filter as getDueBlunders), without downloading them. */
export async function getDueCount(opts?: {
  userId?: string;
  excludeKind?: 'opening' | 'endgame' | 'tactic';
}): Promise<number> {
  return rpc<number>('blunders.dueCount', { excludeKind: opts?.excludeKind ?? null });
}

export async function getDueTomorrowCount(_opts?: { userId?: string }): Promise<number> {
  // Local-day bounds: the server doesn't know the browser's timezone.
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startOfDayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  return rpc<number>('blunders.dueBetweenCount', {
    from: startOfTomorrow.toISOString(),
    to: startOfDayAfter.toISOString(),
  });
}

export async function appendCorrectMove(
  blunderId: string,
  updatedMoves: CorrectMove[],
): Promise<void> {
  await rpc('blunders.setCorrectMoves', { id: blunderId, correctMoves: updatedMoves });
}

export async function updateBlunderAfterDrill(blunder: Blunder): Promise<void> {
  // advanceSr reschedules nextDrillAt only when the ladder moved; an early
  // (practice) solve keeps the stored date.
  const next = blunder.nextDrillAt ?? nextDrillDate(blunder);
  await rpc('blunders.updateAfterDrill', {
    id: blunder.id,
    patch: {
      cycle_number: blunder.cycleNumber,
      last_drilled_at: new Date().toISOString(),
      next_drill_at: next.toISOString(),
      times_correct: blunder.timesCorrect,
      times_attempted: blunder.timesAttempted,
      last_drill_failed: blunder.lastDrillFailed,
    },
  });
}

/** Candidate pool for the endgame scan: the user's endgame-phase analysis blunders. */
export async function getEndgameCandidateBlunders(): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  // Rows the deeper pass retired weren't real blunders — the server leaves
  // them out so they don't seed scenarios.
  const rows = await rpc<BlunderRow[]>('blunders.endgameCandidates');
  return rows.map(blunderFromJson);
}

/** Persist backfilled enrichment (engine line + motif tags) on a blunder row. */
export async function updateBlunderEnrichment(
  id: string,
  enrichment: {
    solution_line: Record<string, unknown>;
    motifs: string[];
    analysis_depth?: number | null;
    deepened_at?: string;
  },
): Promise<void> {
  await rpc('blunders.updateEnrichment', { id, patch: enrichment });
}

/**
 * Persist a background deepening pass: rewritten evals/PV/motifs plus the
 * deepening metadata. Always an UPDATE — `insertBlunders` ignores duplicates,
 * so a re-insert of the same (user, fen, kind) is a no-op.
 */
export async function updateBlunderDeepening(
  id: string,
  patch: {
    eval_before: number;
    eval_after: number;
    eval_swing: number;
    correct_moves: CorrectMove[];
    solution_line: Record<string, unknown>;
    motifs: string[];
    analysis_depth: number | null;
    deepened_at: string;
    retired_at: string | null;
  },
): Promise<void> {
  await rpc('blunders.updateDeepening', { id, patch });
}

export async function countBlundersForDeepening(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('blunders.countForDeepening');
}

/** Rows awaiting their timed background re-analysis, shallowest first. */
export async function getBlundersForDeepening(opts: { limit: number }): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<BlunderRow[]>('blunders.forDeepening', { limit: opts.limit });
  return rows.map(blunderFromJson);
}

export async function countUnenrichedBlunders(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('blunders.countUnenriched');
}

export async function getUnenrichedBlunders(opts: { limit: number }): Promise<Blunder[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<BlunderRow[]>('blunders.unenriched', { limit: opts.limit });
  return rows.map(blunderFromJson);
}

// Opening items are deduped across every game that reaches the same position
// but keep only one game_id, so re-analyzing that one game must not wipe an
// item (and its SR progress) the other games share.
export async function deleteBlundersForGame(gameId: string): Promise<void> {
  await rpc('blunders.deleteForGame', { gameId });
}

export async function deleteBlunder(blunderId: string): Promise<number> {
  // The rows actually deleted: 0 means the row wasn't the caller's (or is
  // already gone), so callers must check it to know the delete happened.
  return rpc<number>('blunders.delete', { id: blunderId });
}
