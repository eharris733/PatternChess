import { parseMotifs, type Motif } from '../chess/motifs';

export interface CorrectMove {
  move: string;
  eval: number;
}

/**
 * Engine lines captured at analysis time (blunders.solution_line jsonb).
 * `pv` runs from the position before the blunder (pv[0] === correctMoves[0].move)
 * and drives multi-move drills; `playedPv` is the refutation line from the
 * position after the played move, kept so motifs can be recomputed without
 * re-running the engine. NULL on rows analyzed before this column existed.
 */
export interface SolutionLine {
  pv: string[];
  playedPv: string[];
  v: 1;
}

export type BlunderPhase = 'opening' | 'middlegame' | 'endgame';

/** The only source of user-facing phase labels — never hand-roll these in UI. */
export const PHASE_LABEL: Record<BlunderPhase, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

export const PHASE_ORDER: readonly BlunderPhase[] = ['opening', 'middlegame', 'endgame'] as const;

/**
 * Discriminates how a trainable item is drilled in the unified queue:
 * - `tactic`  — game-analysis blunder; the stored 1–3 move sequence drill.
 * - `endgame` — play-out slip; the full adjudicated endgame vs the engine.
 * - `opening` — the position where the user left masters theory at a cost of
 *   ≥10% winning chances; drilled as a single-move stored-sequence drill whose
 *   correct moves are the theory moves (src/services/openingDeviationService.ts).
 */
export type DrillKind = 'tactic' | 'endgame' | 'opening';

/**
 * The only source of user-facing kind labels. Never render tactic/endgame
 * labels before the user's first move in /training — concealing the kind is
 * the product. Opening drills are the exception: they open by replaying the
 * user's game up to the position (trainingStore phase 'introducing'), which
 * reveals the kind anyway, so they may be named from the start.
 */
export const DRILL_KIND_LABEL: Record<DrillKind, string> = {
  tactic: 'Tactic',
  endgame: 'Endgame',
  opening: 'Opening',
};

export interface EndgameDrillData {
  deservedResult: 'win' | 'draw';
  sourceGameId: string | null;
  v: 1;
}

/**
 * A move offered as the answer at an opening position: a book move (with its
 * game stats) or, past the book, an engine candidate (stats only if the book
 * has a few games there).
 */
export interface TheoryMove {
  uci: string;
  san: string;
  games: number;
  /** Share of the position's book games that chose this move, 0..100. */
  share: number;
  /** Win % for the side making the move, 0..100. */
  moverWinPct: number;
  /** Share of titled players' games here that chose it (OTB tier only). */
  titledShare?: number | null;
  /** Book tier the stats come from ('otb' = OTB 2200+, 'elite' = Lichess Elite). */
  tier?: 'otb' | 'elite' | null;
  /** Engine candidates: true for the engine's top move. */
  engineBest?: boolean;
}

/** Where an opening drill's answer comes from. */
export type OpeningDrillSource = 'book' | 'engine';

export interface OpeningDrillData {
  openingFamily: string | null;
  openingName: string | null;
  theoryMoves: TheoryMove[];
  positionGames: number;
  /** v1 rows (Lichess masters era) are all 'book'. */
  source: OpeningDrillSource;
  v: 1 | 2;
}

export type DrillData = EndgameDrillData | OpeningDrillData;

export interface Blunder {
  id: string;
  gameId: string | null;
  fen: string;
  moveNumber: number;
  playedMove: string;
  correctMoves: CorrectMove[];
  evalBefore: number;
  evalAfter: number;
  evalSwing: number;
  sideToMove: string;
  cycleNumber: number;
  lastDrilledAt: Date | null;
  nextDrillAt: Date | null;
  timesCorrect: number;
  timesAttempted: number;
  /** True iff the most recent drill's first attempt was incorrect — drives the "Try again" bucket. */
  lastDrillFailed: boolean;
  createdAt: Date;
  phase: BlunderPhase;
  solutionLine: SolutionLine | null;
  motifs: Motif[];
  kind: DrillKind;
  drillData: DrillData | null;
  /**
   * Deepest completed engine depth backing the stored evals/PV; null for
   * legacy rows. Informational — the deepening pass is gated on `deepened_at`
   * (time-based), not on reaching a target depth.
   */
  analysisDepth: number | null;
}

/** Derive phase from move number + remaining piece count on the position. */
export function derivePhase(moveNumber: number, fen: string | null): BlunderPhase {
  if (fen) {
    const board = fen.split(' ')[0] ?? '';
    let pieces = 0;
    for (const ch of board) {
      if (/[prnbqkPRNBQK]/.test(ch)) pieces++;
    }
    if (pieces > 0 && pieces <= 12) return 'endgame';
  }
  if (moveNumber <= 12) return 'opening';
  if (moveNumber > 32) return 'endgame';
  return 'middlegame';
}

function parsePhase(v: unknown): BlunderPhase {
  return v === 'opening' || v === 'endgame' ? v : 'middlegame';
}

function parseKind(v: unknown): DrillKind {
  return v === 'endgame' || v === 'opening' ? v : 'tactic';
}

export function parseTheoryMoves(v: unknown): TheoryMove[] {
  if (!Array.isArray(v)) return [];
  const out: TheoryMove[] = [];
  for (const m of v) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (typeof r.uci !== 'string' || typeof r.san !== 'string') continue;
    out.push({
      uci: r.uci,
      san: r.san,
      games: typeof r.games === 'number' ? r.games : 0,
      share: typeof r.share === 'number' ? r.share : 0,
      moverWinPct: typeof r.moverWinPct === 'number' ? r.moverWinPct : 0,
      titledShare: typeof r.titledShare === 'number' ? r.titledShare : null,
      tier: r.tier === 'otb' || r.tier === 'elite' ? r.tier : null,
      engineBest: r.engineBest === true,
    });
  }
  return out;
}

function parseDrillData(kind: DrillKind, v: unknown): DrillData | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (kind === 'endgame') {
    if (d.deservedResult === 'win' || d.deservedResult === 'draw') {
      return {
        deservedResult: d.deservedResult,
        sourceGameId: typeof d.sourceGameId === 'string' ? d.sourceGameId : null,
        v: 1,
      };
    }
    return null;
  }
  if (kind === 'opening') {
    return {
      openingFamily: typeof d.openingFamily === 'string' ? d.openingFamily : null,
      openingName: typeof d.openingName === 'string' ? d.openingName : null,
      theoryMoves: parseTheoryMoves(d.theoryMoves),
      positionGames: typeof d.positionGames === 'number' ? d.positionGames : 0,
      source: d.source === 'engine' ? 'engine' : 'book',
      v: d.v === 2 ? 2 : 1,
    };
  }
  return null;
}

function isUciList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((m) => typeof m === 'string' && m.length >= 4);
}

function parseSolutionLine(v: unknown): SolutionLine | null {
  if (!v || typeof v !== 'object') return null;
  const { pv, playedPv } = v as Record<string, unknown>;
  if (!isUciList(pv) || pv.length === 0 || !isUciList(playedPv)) return null;
  return { pv, playedPv, v: 1 };
}

/**
 * Expanding spaced-repetition ladder, in days. Index 0 is the "new / just
 * failed" interval; each first-attempt solve advances `cycleNumber` by one and
 * the next review lands `SPACED_REPETITION_DAYS[cycleNumber]` days later. A
 * position is mastered once `cycleNumber >= SPACED_REPETITION_DAYS.length`
 * (four successful spaced retrievals, ~32 days). Shortened from a 7-rung /
 * 112-day ladder on 2026-09-02 — see docs/improvements-plan.md.
 */
export const SPACED_REPETITION_DAYS = [1, 3, 7, 21] as const;

/** Maintenance interval for mastered positions: they never leave the queue. */
export const MASTERED_REVIEW_DAYS = 56;

/** Days until the next review for a position currently at `cycleNumber`. */
export function intervalDaysForCycle(cycleNumber: number): number {
  if (cycleNumber >= SPACED_REPETITION_DAYS.length) return MASTERED_REVIEW_DAYS;
  return SPACED_REPETITION_DAYS[Math.max(0, cycleNumber)];
}

export function nextDrillDate(b: Pick<Blunder, 'cycleNumber' | 'lastDrilledAt' | 'createdAt'>): Date {
  const base = b.lastDrilledAt ?? b.createdAt;
  const result = new Date(base);
  result.setDate(result.getDate() + intervalDaysForCycle(b.cycleNumber));
  return result;
}

/**
 * Days until the next review if this position's current cycle is cleared on a
 * first-attempt solve (the cycle advances by one, then the interval applies).
 * Mirrors nextDrillDate + the cycle bump in the training store.
 */
export function nextIntervalDaysIfSolved(b: Pick<Blunder, 'cycleNumber'>): number {
  return intervalDaysForCycle(b.cycleNumber + 1);
}

export function recallRate(b: Blunder): number {
  return b.timesAttempted > 0 ? b.timesCorrect / b.timesAttempted : 0;
}

export function isCorrectMove(b: Blunder, uci: string): boolean {
  return b.correctMoves.some((cm) => cm.move === uci);
}

export function blunderFromJson(json: any): Blunder {
  const correctMoves = ((json.correct_moves as any[]) ?? []).map((e) => ({
    move: e.move as string,
    eval: e.eval as number,
  }));
  const kind = parseKind(json.kind);
  return {
    id: json.id as string,
    gameId: (json.game_id as string | null) ?? null,
    fen: json.fen as string,
    moveNumber: json.move_number as number,
    playedMove: json.played_move as string,
    correctMoves,
    evalBefore: json.eval_before as number,
    evalAfter: json.eval_after as number,
    evalSwing: json.eval_swing as number,
    sideToMove: json.side_to_move as string,
    cycleNumber: (json.cycle_number as number | null) ?? 0,
    lastDrilledAt: json.last_drilled_at ? new Date(json.last_drilled_at as string) : null,
    nextDrillAt: json.next_drill_at ? new Date(json.next_drill_at as string) : null,
    timesCorrect: (json.times_correct as number | null) ?? 0,
    timesAttempted: (json.times_attempted as number | null) ?? 0,
    lastDrillFailed: (json.last_drill_failed as boolean | null) ?? false,
    createdAt: new Date(json.created_at as string),
    phase: parsePhase(json.phase),
    solutionLine: parseSolutionLine(json.solution_line),
    motifs: parseMotifs(json.motifs),
    kind,
    drillData: parseDrillData(kind, json.drill_data),
    analysisDepth: (json.analysis_depth as number | null) ?? null,
  };
}

/**
 * A blunder is "mastered" when it has graduated every spaced-rep cycle with ≥80% recall.
 * Stricter than `srBucket(b) === 'mastered'`, which only checks the cycle threshold.
 * Used by `getBlunderStats()` for the global mastery achievement count.
 */
export function isMastered(b: Blunder): boolean {
  if (b.cycleNumber < SPACED_REPETITION_DAYS.length) return false;
  if (b.timesAttempted === 0) return false;
  return b.timesCorrect / b.timesAttempted >= 0.8;
}

/**
 * Canonical SR taxonomy used across the UI. Every component that surfaces SR state
 * MUST go through `srBucket()` and `SR_BUCKET_LABEL` — do not invent ad-hoc categories.
 *
 * - `new`       — never drilled.
 * - `learning`  — actively progressing through the ladder (cycle 1..N-1).
 * - `tryAgain`  — most recent drill's first attempt was a fail; awaiting retry.
 * - `mastered`  — graduated past the ladder.
 */
export type SrBucket = 'new' | 'learning' | 'tryAgain' | 'mastered';

export const SR_BUCKET_LABEL: Record<SrBucket, string> = {
  new: 'New',
  learning: 'Learning',
  tryAgain: 'Try again',
  mastered: 'Mastered',
};

export const SR_BUCKET_ORDER: readonly SrBucket[] = [
  'new',
  'learning',
  'tryAgain',
  'mastered',
] as const;

export function srBucket(
  b: Pick<Blunder, 'timesAttempted' | 'lastDrillFailed' | 'cycleNumber'>,
): SrBucket {
  if (b.timesAttempted === 0) return 'new';
  if (b.lastDrillFailed) return 'tryAgain';
  if (b.cycleNumber >= SPACED_REPETITION_DAYS.length) return 'mastered';
  return 'learning';
}

/**
 * Due-queue priority tier, most pressing first:
 * 0. `learning`/`tryAgain` — actively decaying memories; the pressing group.
 * 1. `mastered` — due for its maintenance check, but a solid memory can wait
 *    behind fragile ones regardless of how overdue the check is.
 * 2. `new` — never attempted; lowest priority so it never crowds out review.
 */
function queueTier(b: Pick<Blunder, 'timesAttempted' | 'lastDrillFailed' | 'cycleNumber'>): 0 | 1 | 2 {
  const bucket = srBucket(b);
  if (bucket === 'new') return 2;
  if (bucket === 'mastered') return 1;
  return 0;
}

/**
 * Fraction of this position's own review interval that has elapsed past due
 * — "been longer than the days you are supposed to wait between cycles."
 * Ranking by this (rather than raw cycle number or raw overdue days) means a
 * badly-overdue short-interval item outranks a barely-overdue long-interval
 * one, matching how fast each is actually decaying.
 */
function relativeOverdueness(b: Pick<Blunder, 'nextDrillAt' | 'cycleNumber'>, now: Date): number {
  if (!b.nextDrillAt) return 0;
  const intervalDays = intervalDaysForCycle(b.cycleNumber);
  const overdueDays = (now.getTime() - b.nextDrillAt.getTime()) / 86_400_000;
  return intervalDays > 0 ? overdueDays / intervalDays : overdueDays;
}

/**
 * Canonical due-queue order: tier (pressing → maintenance → new) first,
 * relative overdue-ness second (tiers 0/1 — new items skip this, since their
 * 1-day interval would otherwise register as wildly "overdue" and crowd out
 * genuinely overdue reviews), then `nextDrillAt` ascending as a chronological
 * tiebreak. Filtering downstream (phase/motif/opening/etc.) must stay a plain
 * `Array.filter` so it preserves this order — never re-sort after filtering.
 */
export function sortDueQueue(blunders: Blunder[], now: Date = new Date()): Blunder[] {
  return [...blunders].sort((a, b) => {
    const tierDiff = queueTier(a) - queueTier(b);
    if (tierDiff !== 0) return tierDiff;

    if (queueTier(a) === 2) {
      return a.createdAt.getTime() - b.createdAt.getTime();
    }

    const overdueDiff = relativeOverdueness(b, now) - relativeOverdueness(a, now);
    if (overdueDiff !== 0) return overdueDiff;

    const aDue = a.nextDrillAt ?? a.createdAt;
    const bDue = b.nextDrillAt ?? b.createdAt;
    return aDue.getTime() - bDue.getTime();
  });
}
