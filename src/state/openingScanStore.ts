import { create } from 'zustand';

/**
 * Live state of the opening-deviation scan (`startOpeningDeviationScan`),
 * shared so /openings sees progress whichever page started the pass.
 *
 * - `idle`     — no pass has reported yet this page load.
 * - `checking` — walking games against the book or scoring exits.
 * - `waiting`  — work is left but the analysis engine belongs to sync
 *                analysis (or maintenance); the pass waits and resumes.
 * - `done`     — every game is analyzed and every queue is drained.
 * - `stopped`  — the pass ended with work left (page unmounted, error).
 */
export type OpeningScanPhase = 'idle' | 'checking' | 'waiting' | 'done' | 'stopped';

export interface OpeningScanState {
  phase: OpeningScanPhase;
  /** Games still waiting for their theory walk. */
  unwalked: number;
  /** User exits still waiting for the engine. */
  unscored: number;
  /** Analyzed games whose opening past the book still needs the engine scan. */
  pastBook: number;
  /** Games sync hasn't analyzed yet (their openings can't be finished). */
  unanalyzed: number;
  /** The opening book kept failing; the walk retries after a pause. */
  bookUnavailable: boolean;
}

export const useOpeningScanStore = create<OpeningScanState>(() => ({
  phase: 'idle',
  unwalked: 0,
  unscored: 0,
  pastBook: 0,
  unanalyzed: 0,
  bookUnavailable: false,
}));

/** Work items left in the scan's own queues. */
export function scanItemsLeft(s: Pick<OpeningScanState, 'unwalked' | 'unscored' | 'pastBook'>): number {
  return s.unwalked + s.unscored + s.pastBook;
}
