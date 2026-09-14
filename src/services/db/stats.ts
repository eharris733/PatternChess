import { supabase } from '../../lib/supabase';
import { SPACED_REPETITION_DAYS, srBucket } from '../../models/blunder';
import { GameRecord, resolveOutcome } from '../../models/gameRecord';
import {
  classifyGameState,
  computeTimeRemainingPercent,
  GameStateBucket,
  TIME_TROUBLE_THRESHOLD_PERCENT,
} from '../../chess/blunderContext';
import { parseStartIncrement as parseStartIncrementImpl } from '../../chess/timeControl';
import { currentUserId } from './currentUser';

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
    .eq('user_id', userId)
    .eq('kind', 'tactic');
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

export interface MotifCounts {
  counts: Record<string, number>;
  /** Rows that have been enriched (solution_line present) and could be tagged. */
  tagged: number;
  /** Rows still awaiting the enrichment backfill. */
  untagged: number;
  total: number;
}

export async function getBlunderMotifCounts(): Promise<MotifCounts> {
  // Aggregated server-side (get_blunder_motif_counts RPC) — the old client
  // version downloaded solution_line + motifs for every tactic row (~180KB for
  // an active user) just to tally these few numbers.
  const { data, error } = await supabase.rpc('get_blunder_motif_counts');
  if (error) throw error;
  const d = (data ?? {}) as Partial<MotifCounts>;
  return {
    counts: (d.counts as Record<string, number>) ?? {},
    tagged: d.tagged ?? 0,
    untagged: d.untagged ?? 0,
    total: d.total ?? 0,
  };
}

export interface OpeningGroupRow {
  ecoFamily: string;
  /** Most frequent full ECO code within the family (e.g. "B33" for "B3*"). */
  dominantEco: string | null;
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
  platform: string | null;
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
    .select('id, eco, opening_name, user_color, result, platform')
    .eq('user_id', userId)
    .not('eco', 'is', null);
  if (gamesError) throw gamesError;
  const games = (gamesData ?? []) as OpeningRawRow[];
  if (games.length === 0) return [];

  const gameIdToEcoFamily = new Map<string, string>();
  const groups = new Map<string, OpeningGroupRow>();
  // Per group, count full ECO codes so we can surface the dominant one
  // (e.g. "B33") instead of the bare family wildcard ("B3*").
  const ecoCounts = new Map<string, Map<string, number>>();

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
        dominantEco: null,
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
    const fullEco = eco.trim().toUpperCase();
    let counts = ecoCounts.get(key);
    if (!counts) {
      counts = new Map();
      ecoCounts.set(key, counts);
    }
    counts.set(fullEco, (counts.get(fullEco) ?? 0) + 1);
    // Result format varies by platform (chess.com per-player codes vs PGN);
    // resolveOutcome normalizes both relative to the user's side.
    const outcome = resolveOutcome(g.platform, g.result, color);
    if (outcome === 'win') group.wins++;
    else if (outcome === 'loss') group.losses++;
    else if (outcome === 'draw') group.draws++;
  }

  if (gameIdToEcoFamily.size > 0) {
    // Filter by user_id, not a `.in('game_id', gameIds)` list — a power user's
    // game count turns that into a multi-thousand-character URL that Supabase
    // rejects with 400. Rows for games without an eco code are simply skipped
    // below (gameIdToEcoFamily.get() misses), so this is equivalent.
    const { data: blunderData, error: blunderError } = await supabase
      .from('blunders')
      .select('game_id, phase')
      .eq('user_id', userId)
      .eq('kind', 'tactic');
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

  for (const [key, group] of groups) {
    const counts = ecoCounts.get(key);
    if (!counts) continue;
    let best: string | null = null;
    let bestCount = 0;
    for (const [eco, count] of counts) {
      if (count > bestCount || (count === bestCount && best !== null && eco < best)) {
        best = eco;
        bestCount = count;
      }
    }
    group.dominantEco = best;
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
    .eq('user_id', userId)
    .eq('kind', 'tactic');
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
    .eq('user_id', userId)
    .eq('kind', 'tactic');
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

  // Filter by user_id, not a `.in('id', gameIds)` list built from every
  // distinct blunder game_id — a power user's game count turns that into a
  // multi-thousand-character URL that Supabase rejects with 400 (same class
  // of bug as getOpeningPerformance above).
  const { data: gameRows, error: gErr } = await supabase
    .from('games')
    .select('id, clock_per_ply, time_control')
    .eq('user_id', userId);
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
  /** Sum of first-attempt drills across all positions. */
  attempted: number;
  mastered: number;
  /** Mastered positions whose last drill was within the past 7 days — the "+N this week" cue. */
  masteredRecently: number;
  totalBlunders: number;
}

const RECENT_WINDOW_MS = 7 * 86_400_000;

// Stricter than srBucket(b) === 'mastered' (which only checks the cycle threshold).
// Used here for the global "mastered" achievement count, where we want a real
// recall floor before claiming mastery.
const MASTERY_CYCLE_THRESHOLD = SPACED_REPETITION_DAYS.length;
const MASTERY_RECALL_THRESHOLD = 0.8;

export async function getBlunderStats(): Promise<BlunderStats> {
  const userId = await currentUserId();
  if (!userId) return { reviewed: 0, attempted: 0, mastered: 0, masteredRecently: 0, totalBlunders: 0 };
  const { data, error } = await supabase
    .from('blunders')
    .select('cycle_number, times_correct, times_attempted, last_drilled_at')
    .eq('user_id', userId);
  if (error) throw error;
  const recentSince = Date.now() - RECENT_WINDOW_MS;
  let reviewed = 0;
  let attempted = 0;
  let mastered = 0;
  let masteredRecently = 0;
  let totalBlunders = 0;
  for (const row of (data ?? []) as Array<{
    cycle_number: number | null;
    times_correct: number | null;
    times_attempted: number | null;
    last_drilled_at: string | null;
  }>) {
    const c = row.times_correct ?? 0;
    const a = row.times_attempted ?? 0;
    const cycle = row.cycle_number ?? 0;
    reviewed += c;
    attempted += a;
    totalBlunders++;
    if (cycle >= MASTERY_CYCLE_THRESHOLD && a > 0 && c / a >= MASTERY_RECALL_THRESHOLD) {
      mastered++;
      const last = row.last_drilled_at ? Date.parse(row.last_drilled_at) : NaN;
      if (Number.isFinite(last) && last >= recentSince) masteredRecently++;
    }
  }
  return { reviewed, attempted, mastered, masteredRecently, totalBlunders };
}

// --- Landing page social proof (global, cross-user) ---

export interface LandingStats {
  positionsReviewed: number;
  eloGained: number;
  computedAt: string;
}

/**
 * Global cross-user stats for the landing social-proof badge, via the
 * `landing_stats` RPC (security definer; server-side 6h cache so anonymous
 * landing traffic never triggers the heavy aggregate). Returns null on any
 * failure — the badge degrades to rendering nothing.
 */
export async function getLandingStats(): Promise<LandingStats | null> {
  const { data, error } = await supabase.rpc('landing_stats');
  if (error || !data) return null;
  const d = data as Partial<LandingStats>;
  if (typeof d.positionsReviewed !== 'number' || typeof d.eloGained !== 'number') return null;
  return {
    positionsReviewed: d.positionsReviewed,
    eloGained: d.eloGained,
    computedAt: String(d.computedAt ?? ''),
  };
}

// --- Cycle distribution (woodpecker-ladder timeline) ---

export interface CycleDistribution {
  total: number;
  newCount: number;
  tryAgain: number;
  mastered: number;
  /** Learning positions by ladder rung (cycle 1..SPACED_REPETITION_DAYS.length-1). */
  learningByCycle: { cycle: number; count: number }[];
  learningTotal: number;
}

/**
 * Count the user's trainable positions across the spaced-repetition ladder:
 * new → cycle 1..N-1 (learning) → mastered, with try-again called out. Drives
 * the dashboard "Training timeline". Buckets via the canonical `srBucket()` so
 * it stays consistent with the rest of the SR taxonomy.
 */
export async function getCycleDistribution(): Promise<CycleDistribution> {
  const maxCycle = SPACED_REPETITION_DAYS.length; // mastered at cycle >= maxCycle
  const empty: CycleDistribution = {
    total: 0,
    newCount: 0,
    tryAgain: 0,
    mastered: 0,
    learningByCycle: Array.from({ length: maxCycle - 1 }, (_, i) => ({ cycle: i + 1, count: 0 })),
    learningTotal: 0,
  };
  const userId = await currentUserId();
  if (!userId) return empty;
  const { data, error } = await supabase
    .from('blunders')
    .select('cycle_number, times_attempted, last_drill_failed')
    .eq('user_id', userId);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    cycle_number: number | null;
    times_attempted: number | null;
    last_drill_failed: boolean | null;
  }>) {
    const cycleNumber = row.cycle_number ?? 0;
    const timesAttempted = row.times_attempted ?? 0;
    const lastDrillFailed = row.last_drill_failed ?? false;
    empty.total++;
    const bucket = srBucket({ cycleNumber, timesAttempted, lastDrillFailed });
    if (bucket === 'new') empty.newCount++;
    else if (bucket === 'tryAgain') empty.tryAgain++;
    else if (bucket === 'mastered') empty.mastered++;
    else {
      const idx = Math.min(Math.max(cycleNumber, 1), maxCycle - 1) - 1;
      empty.learningByCycle[idx].count++;
      empty.learningTotal++;
    }
  }
  return empty;
}
