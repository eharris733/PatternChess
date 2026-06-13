export interface Rank {
  name: string;
  threshold: number;
}

/** Tiers indexed by mastered-blunder count. Threshold is the minimum to enter the tier. */
export const RANKS: readonly Rank[] = [
  { name: 'Pawn', threshold: 0 },
  { name: 'Knight', threshold: 10 },
  { name: 'Bishop', threshold: 50 },
  { name: 'Rook', threshold: 150 },
  { name: 'Queen', threshold: 400 },
  { name: 'Master', threshold: 1000 },
  { name: 'Transcendent', threshold: 2500 },
] as const;

export interface RankProgress {
  current: Rank;
  next: Rank | null;
  /** Whole number of mastered blunders into the current tier. */
  progressIntoTier: number;
  /** Mastered count needed to reach the next tier (0 if already at top). */
  remainingToNext: number;
  /** 0..1 progress within the current tier. 1.0 if at the top tier. */
  fraction: number;
}

export function rankFor(mastered: number): RankProgress {
  let currentIdx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (mastered >= RANKS[i].threshold) currentIdx = i;
    else break;
  }
  const current = RANKS[currentIdx];
  const next = RANKS[currentIdx + 1] ?? null;
  if (!next) {
    return {
      current,
      next: null,
      progressIntoTier: mastered - current.threshold,
      remainingToNext: 0,
      fraction: 1,
    };
  }
  const span = next.threshold - current.threshold;
  const progressIntoTier = mastered - current.threshold;
  return {
    current,
    next,
    progressIntoTier,
    remainingToNext: next.threshold - mastered,
    fraction: span > 0 ? progressIntoTier / span : 0,
  };
}
