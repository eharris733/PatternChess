import { supabase } from '../lib/supabase';
import { Blunder, blunderFromJson, CorrectMove, nextDrillDate } from '../models/blunder';
import { GameRecord, gameRecordFromJson } from '../models/gameRecord';
import {
  GameAnnotation,
  gameAnnotationFromJson,
  MoveAnnotation,
  moveAnnotationToJson,
} from '../models/gameAnnotation';
import { TrainingSession, trainingSessionFromJson } from '../models/trainingSession';
import {
  classifyGameState,
  computeTimeRemainingPercent,
  GameStateBucket,
  TIME_TROUBLE_THRESHOLD_PERCENT,
} from '../chess/blunderContext';
import { parseStartIncrement as parseStartIncrementImpl } from '../chess/timeControl';

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// --- Games ---

export async function insertGames(
  games: Array<Record<string, unknown>>,
): Promise<GameRecord[]> {
  const userId = await currentUserId();
  const enriched = userId ? games.map((g) => ({ ...g, user_id: userId })) : games;
  const { data, error } = await supabase.from('games').insert(enriched).select();
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
}

export async function getGames(opts?: { userId?: string }): Promise<GameRecord[]> {
  let q = supabase.from('games').select();
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  // Sort by played_at primarily, but break ties (and rank PGN uploads with
  // missing/old [Date] headers) by insertion time so freshly-imported games
  // always surface at the top of the vault.
  const { data, error } = await q
    .order('played_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
}

export async function getGame(id: string): Promise<GameRecord> {
  const { data, error } = await supabase.from('games').select().eq('id', id).single();
  if (error) throw error;
  return gameRecordFromJson(data);
}

export async function markGameAnalyzed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ analyzed_at: new Date().toISOString() })
    .eq('id', gameId);
  if (error) throw error;
}

// --- Blunders ---

export async function insertBlunders(blunders: Array<Record<string, unknown>>): Promise<void> {
  if (blunders.length === 0) return;
  const userId = await currentUserId();
  const enriched = userId ? blunders.map((b) => ({ ...b, user_id: userId })) : blunders;
  // Drop intra-batch duplicates (e.g. threefold repetition) — Postgres rejects
  // an upsert payload that conflicts with itself on the onConflict target.
  const seen = new Set<string>();
  const deduped: Array<Record<string, unknown>> = [];
  for (const row of enriched) {
    const r = row as Record<string, unknown>;
    const key = `${r.user_id ?? ''}|${r.fen ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  const { error } = await supabase
    .from('blunders')
    .upsert(deduped, { onConflict: 'user_id,fen', ignoreDuplicates: true });
  if (error) throw error;
}

export async function getBlundersForGames(gameIds: string[]): Promise<Blunder[]> {
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from('blunders')
    .select()
    .in('game_id', gameIds)
    .order('move_number');
  if (error) throw error;
  return (data ?? []).map(blunderFromJson);
}

export async function getBlunderCountsByGame(opts?: {
  userId?: string;
}): Promise<Record<string, number>> {
  let q = supabase.from('blunders').select('game_id');
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { data, error } = await q;
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ game_id: string }>) {
    counts[row.game_id] = (counts[row.game_id] ?? 0) + 1;
  }
  return counts;
}

export async function getDueBlunders(opts?: { userId?: string }): Promise<Blunder[]> {
  const now = new Date().toISOString();
  let q = supabase.from('blunders').select().lte('next_drill_at', now);
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { data, error } = await q.order('next_drill_at');
  if (error) throw error;
  return (data ?? []).map(blunderFromJson);
}

export async function getDueTomorrowCount(opts?: { userId?: string }): Promise<number> {
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startOfDayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  let q = supabase
    .from('blunders')
    .select('*', { count: 'exact', head: true })
    .gte('next_drill_at', startOfTomorrow.toISOString())
    .lt('next_drill_at', startOfDayAfter.toISOString());
  if (opts?.userId) q = q.eq('user_id', opts.userId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function appendCorrectMove(
  blunderId: string,
  updatedMoves: CorrectMove[],
): Promise<void> {
  const { error } = await supabase
    .from('blunders')
    .update({ correct_moves: updatedMoves })
    .eq('id', blunderId);
  if (error) throw error;
}

export async function updateBlunderAfterDrill(blunder: Blunder): Promise<void> {
  const next = nextDrillDate(blunder);
  const { error } = await supabase
    .from('blunders')
    .update({
      cycle_number: blunder.cycleNumber,
      last_drilled_at: new Date().toISOString(),
      next_drill_at: next.toISOString(),
      times_correct: blunder.timesCorrect,
      times_attempted: blunder.timesAttempted,
      last_drill_failed: blunder.lastDrillFailed,
    })
    .eq('id', blunder.id);
  if (error) throw error;
}

// --- Insights aggregation queries ---

export interface PhaseCounts {
  opening: number;
  middlegame: number;
  endgame: number;
  total: number;
}

export async function getBlunderPhaseCounts(): Promise<PhaseCounts> {
  const userId = await currentUserId();
  if (!userId) return { opening: 0, middlegame: 0, endgame: 0, total: 0 };
  const { data, error } = await supabase
    .from('blunders')
    .select('phase')
    .eq('user_id', userId);
  if (error) throw error;
  const counts: PhaseCounts = { opening: 0, middlegame: 0, endgame: 0, total: 0 };
  for (const row of (data ?? []) as Array<{ phase: string | null }>) {
    counts.total++;
    if (row.phase === 'opening') counts.opening++;
    else if (row.phase === 'endgame') counts.endgame++;
    else counts.middlegame++;
  }
  return counts;
}

export interface OpeningGroupRow {
  ecoFamily: string;
  openingName: string | null;
  userColor: 'white' | 'black' | null;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  blunders: number;
  openingBlunders: number;
}

interface OpeningRawRow {
  id: string;
  eco: string | null;
  opening_name: string | null;
  user_color: string | null;
  result: string | null;
}

/**
 * Aggregate the user's most-played openings (grouped by ECO family) with
 * win/loss/draw counts and total blunder counts. Returns rows sorted by game
 * count descending.
 */
export async function getOpeningPerformance(opts?: {
  limit?: number;
}): Promise<OpeningGroupRow[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  const { data: gamesData, error: gamesError } = await supabase
    .from('games')
    .select('id, eco, opening_name, user_color, result')
    .eq('user_id', userId)
    .not('eco', 'is', null);
  if (gamesError) throw gamesError;
  const games = (gamesData ?? []) as OpeningRawRow[];
  if (games.length === 0) return [];

  const gameIdToEcoFamily = new Map<string, string>();
  const groups = new Map<string, OpeningGroupRow>();

  for (const g of games) {
    const eco = g.eco;
    if (!eco || eco.length < 2) continue;
    const family = `${eco[0].toUpperCase()}${eco[1]}*`;
    const color = g.user_color === 'white' || g.user_color === 'black' ? g.user_color : null;
    const key = `${family}|${color ?? 'unknown'}`;
    gameIdToEcoFamily.set(g.id, key);
    let group = groups.get(key);
    if (!group) {
      group = {
        ecoFamily: family,
        openingName: g.opening_name,
        userColor: color,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        blunders: 0,
        openingBlunders: 0,
      };
      groups.set(key, group);
    }
    group.games++;
    // Result is stored as PGN format: "1-0", "0-1", "1/2-1/2".
    if (g.result === '1/2-1/2') group.draws++;
    else if (g.result === '1-0' && color === 'white') group.wins++;
    else if (g.result === '0-1' && color === 'black') group.wins++;
    else if (g.result === '1-0' && color === 'black') group.losses++;
    else if (g.result === '0-1' && color === 'white') group.losses++;
  }

  if (gameIdToEcoFamily.size > 0) {
    const gameIds = Array.from(gameIdToEcoFamily.keys());
    const { data: blunderData, error: blunderError } = await supabase
      .from('blunders')
      .select('game_id, phase')
      .in('game_id', gameIds);
    if (blunderError) throw blunderError;
    for (const row of (blunderData ?? []) as Array<{ game_id: string; phase: string | null }>) {
      const key = gameIdToEcoFamily.get(row.game_id);
      if (!key) continue;
      const group = groups.get(key);
      if (!group) continue;
      group.blunders++;
      if (row.phase === 'opening') group.openingBlunders++;
    }
  }

  const list = Array.from(groups.values()).sort((a, b) => b.games - a.games);
  return opts?.limit ? list.slice(0, opts.limit) : list;
}

export interface TimeManagementSample {
  phase: 'opening' | 'middlegame' | 'endgame';
  averageSeconds: number;
  plyCount: number;
}

interface ClockGameRow {
  user_color: string | null;
  clock_per_ply: unknown;
  total_plies: number | null;
  time_control: string | null;
  rated: boolean | null;
}

export const parseStartIncrement = parseStartIncrementImpl;

function isBullet(timeControl: string | null): boolean {
  const tc = parseStartIncrement(timeControl);
  if (!tc) return false;
  return tc.startCs < 18000; // <180 seconds
}

function plyPhase(plyIndex: number): 'opening' | 'middlegame' | 'endgame' {
  const moveNumber = Math.floor(plyIndex / 2) + 1;
  if (moveNumber <= 12) return 'opening';
  if (moveNumber > 32) return 'endgame';
  return 'middlegame';
}

/**
 * Average seconds-per-ply per phase for the user, derived from `clock_per_ply`
 * deltas. Excludes bullet games. Skips games without clock data.
 */
export async function getUserTimeManagement(): Promise<TimeManagementSample[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('games')
    .select('user_color, clock_per_ply, total_plies, time_control, rated')
    .eq('user_id', userId)
    .not('clock_per_ply', 'is', null);
  if (error) throw error;

  const totals: Record<'opening' | 'middlegame' | 'endgame', { sumCs: number; plies: number }> = {
    opening: { sumCs: 0, plies: 0 },
    middlegame: { sumCs: 0, plies: 0 },
    endgame: { sumCs: 0, plies: 0 },
  };

  for (const row of (data ?? []) as ClockGameRow[]) {
    if (isBullet(row.time_control)) continue;
    const color = row.user_color;
    if (color !== 'white' && color !== 'black') continue;
    const clocks = Array.isArray(row.clock_per_ply) ? (row.clock_per_ply as number[]) : null;
    if (!clocks || clocks.length === 0) continue;
    const tc = parseStartIncrement(row.time_control);
    const incCs = tc?.incCs ?? 0;
    const startCs = tc?.startCs ?? clocks[0] ?? 0;

    const userParity = color === 'white' ? 0 : 1;
    for (let i = 0; i < clocks.length; i++) {
      if (i % 2 !== userParity) continue;
      const before = i < 2 ? startCs : (clocks[i - 2] ?? clocks[i] + incCs);
      const after = clocks[i];
      if (typeof before !== 'number' || typeof after !== 'number') continue;
      const spentCs = Math.max(0, before - after + incCs);
      if (spentCs <= 0 || spentCs > 600 * 100) continue; // skip noise > 10 min
      const phase = plyPhase(i);
      totals[phase].sumCs += spentCs;
      totals[phase].plies++;
    }
  }

  const out: TimeManagementSample[] = [];
  for (const phase of ['opening', 'middlegame', 'endgame'] as const) {
    const t = totals[phase];
    if (t.plies === 0) {
      out.push({ phase, averageSeconds: 0, plyCount: 0 });
    } else {
      out.push({ phase, averageSeconds: t.sumCs / t.plies / 100, plyCount: t.plies });
    }
  }
  return out;
}

// --- Game-state and time-trouble blunder stats ---

export interface PhaseCountTriple {
  opening: number;
  middlegame: number;
  endgame: number;
}

function emptyPhaseTriple(): PhaseCountTriple {
  return { opening: 0, middlegame: 0, endgame: 0 };
}

function bumpPhase(t: PhaseCountTriple, phase: string | null): void {
  if (phase === 'opening') t.opening++;
  else if (phase === 'endgame') t.endgame++;
  else t.middlegame++;
}

export interface GameStateStats {
  total: number;
  byBucket: Record<GameStateBucket, { count: number; byPhase: PhaseCountTriple }>;
}

export async function getBlunderGameStateStats(): Promise<GameStateStats> {
  const userId = await currentUserId();
  const empty: GameStateStats = {
    total: 0,
    byBucket: {
      missedWin: { count: 0, byPhase: emptyPhaseTriple() },
      roughlyEqual: { count: 0, byPhase: emptyPhaseTriple() },
      alreadyLosing: { count: 0, byPhase: emptyPhaseTriple() },
    },
  };
  if (!userId) return empty;
  const { data, error } = await supabase
    .from('blunders')
    .select('eval_before, phase')
    .eq('user_id', userId);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ eval_before: number | null; phase: string | null }>) {
    if (typeof row.eval_before !== 'number') continue;
    const bucket = classifyGameState(row.eval_before);
    empty.total++;
    const slot = empty.byBucket[bucket];
    slot.count++;
    bumpPhase(slot.byPhase, row.phase);
  }
  return empty;
}

export interface TimeTroubleStats {
  total: number;              // blunders considered (i.e., game had clock data)
  totalAllBlunders: number;   // every blunder, including those without clock data
  inTimeTrouble: number;
  byPhase: PhaseCountTriple;  // counts within inTimeTrouble
  excludedBlunders: number;   // skipped because game lacks clock data
  thresholdPercent: number;
}

export async function getTimeTroubleStats(): Promise<TimeTroubleStats> {
  const empty: TimeTroubleStats = {
    total: 0,
    totalAllBlunders: 0,
    inTimeTrouble: 0,
    byPhase: emptyPhaseTriple(),
    excludedBlunders: 0,
    thresholdPercent: TIME_TROUBLE_THRESHOLD_PERCENT,
  };
  const userId = await currentUserId();
  if (!userId) return empty;

  const { data: blunderRows, error: bErr } = await supabase
    .from('blunders')
    .select('move_number, side_to_move, phase, game_id, eval_before')
    .eq('user_id', userId);
  if (bErr) throw bErr;
  const blunders = (blunderRows ?? []) as Array<{
    move_number: number;
    side_to_move: string;
    phase: string | null;
    game_id: string;
    eval_before: number | null;
  }>;
  empty.totalAllBlunders = blunders.length;
  if (blunders.length === 0) return empty;

  const gameIds = Array.from(new Set(blunders.map((b) => b.game_id)));
  const { data: gameRows, error: gErr } = await supabase
    .from('games')
    .select('id, clock_per_ply, time_control')
    .in('id', gameIds);
  if (gErr) throw gErr;

  const gameById = new Map<string, GameRecord>();
  for (const raw of (gameRows ?? []) as Array<Record<string, unknown>>) {
    const id = raw.id as string;
    // Build a minimal GameRecord-shaped object — only the fields
    // computeTimeRemainingPercent reads.
    gameById.set(id, {
      id,
      platform: '',
      username: '',
      opponent: '',
      pgn: '',
      timeControl: (raw.time_control as string | null) ?? null,
      rated: false,
      result: null,
      playedAt: null,
      createdAt: new Date(0),
      analyzedAt: null,
      eco: null,
      openingName: null,
      userColor: null,
      userRating: null,
      opponentRating: null,
      clockPerPly: Array.isArray(raw.clock_per_ply)
        ? (raw.clock_per_ply as number[])
        : null,
      totalPlies: null,
      parsedMetadataAt: null,
    });
  }

  for (const b of blunders) {
    const game = gameById.get(b.game_id) ?? null;
    const sideToMove = b.side_to_move === 'white' ? 'white' : 'black';
    const pct = computeTimeRemainingPercent(
      { moveNumber: b.move_number, sideToMove },
      game,
    );
    if (pct === null) {
      empty.excludedBlunders++;
      continue;
    }
    empty.total++;
    if (pct < TIME_TROUBLE_THRESHOLD_PERCENT) {
      empty.inTimeTrouble++;
      bumpPhase(empty.byPhase, b.phase);
    }
  }

  return empty;
}

// --- Blunder Stats (Reviews + Mastered) ---

export interface BlunderStats {
  reviewed: number;
  mastered: number;
  totalBlunders: number;
}

// Stricter than srBucket(b) === 'mastered' (which only checks the cycle threshold).
// Used here for the global "mastered" achievement count, where we want a real
// recall floor before claiming mastery.
const MASTERY_CYCLE_THRESHOLD = 7;
const MASTERY_RECALL_THRESHOLD = 0.8;

export async function getBlunderStats(): Promise<BlunderStats> {
  const userId = await currentUserId();
  if (!userId) return { reviewed: 0, mastered: 0, totalBlunders: 0 };
  const { data, error } = await supabase
    .from('blunders')
    .select('cycle_number, times_correct, times_attempted')
    .eq('user_id', userId);
  if (error) throw error;
  let reviewed = 0;
  let mastered = 0;
  let totalBlunders = 0;
  for (const row of (data ?? []) as Array<{
    cycle_number: number | null;
    times_correct: number | null;
    times_attempted: number | null;
  }>) {
    const c = row.times_correct ?? 0;
    const a = row.times_attempted ?? 0;
    const cycle = row.cycle_number ?? 0;
    reviewed += c;
    totalBlunders++;
    if (cycle >= MASTERY_CYCLE_THRESHOLD && a > 0 && c / a >= MASTERY_RECALL_THRESHOLD) {
      mastered++;
    }
  }
  return { reviewed, mastered, totalBlunders };
}

// --- Game Annotations ---

export async function getAnnotations(gameId: string): Promise<GameAnnotation | null> {
  const { data, error } = await supabase
    .from('game_annotations')
    .select()
    .eq('game_id', gameId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return gameAnnotationFromJson(data);
}

export async function saveAnnotations(
  gameId: string,
  annotations: MoveAnnotation[],
): Promise<void> {
  const userId = await currentUserId();
  const payload = {
    game_id: gameId,
    user_id: userId,
    annotations: annotations.map(moveAnnotationToJson),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('game_annotations')
    .upsert(payload, { onConflict: 'game_id' });
  if (error) throw error;
}

export async function getUnanalyzedGameIds(opts: {
  platform: string;
  username: string;
}): Promise<string[]> {
  const userId = await currentUserId();
  let q = supabase
    .from('games')
    .select('id')
    .eq('platform', opts.platform)
    .eq('username', opts.username)
    .is('analyzed_at', null)
    .order('played_at', { ascending: false, nullsFirst: false });
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => (row as { id: string }).id);
}

export async function deleteBlundersForGame(gameId: string): Promise<void> {
  const { error } = await supabase.from('blunders').delete().eq('game_id', gameId);
  if (error) throw error;
}

export async function resetGameAnalyzed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ analyzed_at: null })
    .eq('id', gameId);
  if (error) throw error;
}

export async function getExistingExternalGameIds(
  platform: string,
): Promise<Set<string>> {
  const userId = await currentUserId();
  let q = supabase.from('games').select('external_game_id').eq('platform', platform);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = (row as { external_game_id: string | null }).external_game_id;
    if (id) ids.add(id);
  }
  return ids;
}

export async function getGameCount(
  platform: string,
  username: string,
): Promise<number> {
  const userId = await currentUserId();
  let q = supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('platform', platform)
    .eq('username', username);
  if (userId) q = q.eq('user_id', userId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function getTotalGameCount(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

export async function updateProfileLastSynced(
  platform: 'lichess' | 'chess.com',
  ts: Date,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const column = platform === 'lichess' ? 'last_synced_lichess_at' : 'last_synced_chesscom_at';
  const { error } = await supabase
    .from('profiles')
    .update({ [column]: ts.toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// --- Training Sessions ---

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
  const update: Record<string, unknown> = {};
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

// --- Profile streak / timezone ---

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

// --- Game metadata (PGN backfill) ---

export async function getUnparsedGames(opts?: { limit?: number }): Promise<GameRecord[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  let q = supabase
    .from('games')
    .select()
    .eq('user_id', userId)
    .is('parsed_metadata_at', null);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(gameRecordFromJson);
}

export async function countUnparsedGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('parsed_metadata_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function updateGameMetadata(
  gameId: string,
  patch: {
    eco?: string | null;
    openingName?: string | null;
    userColor?: 'white' | 'black' | null;
    userRating?: number | null;
    opponentRating?: number | null;
    clockPerPly?: number[] | null;
    totalPlies?: number | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    parsed_metadata_at: new Date().toISOString(),
  };
  if (patch.eco !== undefined) update.eco = patch.eco;
  if (patch.openingName !== undefined) update.opening_name = patch.openingName;
  if (patch.userColor !== undefined) update.user_color = patch.userColor;
  if (patch.userRating !== undefined) update.user_rating = patch.userRating;
  if (patch.opponentRating !== undefined) update.opponent_rating = patch.opponentRating;
  if (patch.clockPerPly !== undefined) update.clock_per_ply = patch.clockPerPly;
  if (patch.totalPlies !== undefined) update.total_plies = patch.totalPlies;
  const { error } = await supabase.from('games').update(update).eq('id', gameId);
  if (error) throw error;
}

// --- Benchmarks ---

export interface BenchmarkRow {
  kind: string;
  bucket: string;
  value: number;
  sampleSize: number;
  source: string | null;
}

export async function getBenchmarks(kind?: string): Promise<BenchmarkRow[]> {
  let q = supabase.from('benchmarks').select();
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    kind: row.kind as string,
    bucket: row.bucket as string,
    value: Number(row.value),
    sampleSize: row.sample_size as number,
    source: (row.source as string | null) ?? null,
  }));
}

// --- Opening Explorer Cache ---

export async function getCachedExplorerResult(fen: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('opening_explorer_cache')
    .select()
    .eq('fen', fen)
    .maybeSingle();
  if (error) return null;
  return (data?.result as any) ?? null;
}

export async function cacheExplorerResult(fen: string, result: any): Promise<void> {
  await supabase.from('opening_explorer_cache').upsert({ fen, result });
}

export const supabaseService = {
  insertGames,
  getGames,
  getGame,
  markGameAnalyzed,
  insertBlunders,
  getBlundersForGames,
  getBlunderCountsByGame,
  getDueBlunders,
  getDueTomorrowCount,
  appendCorrectMove,
  updateBlunderAfterDrill,
  getAnnotations,
  saveAnnotations,
  getCachedExplorerResult,
  cacheExplorerResult,
  getExistingExternalGameIds,
  getGameCount,
  getTotalGameCount,
  getUnanalyzedGameIds,
  deleteBlundersForGame,
  resetGameAnalyzed,
  updateProfileLastSynced,
  createTrainingSession,
  updateTrainingSession,
  getRecentTrainingSessions,
  getTrainingSessionsSince,
  hasTrainingSessionToday,
  updateProfileStreak,
  getUnparsedGames,
  countUnparsedGames,
  updateGameMetadata,
  getBenchmarks,
  getBlunderStats,
  getBlunderPhaseCounts,
  getOpeningPerformance,
  getUserTimeManagement,
  getBlunderGameStateStats,
  getTimeTroubleStats,
};
