import type { ContextFilter } from '../../chess/blunderContext';
import type { Motif } from '../../chess/motifs';
import type { Blunder, BlunderPhase, DrillKind } from '../../models/blunder';
import {
  PRACTICE_AHEAD_BATCH,
  PRACTICE_AHEAD_FILTER_POOL,
  type UpcomingParams,
} from '../../hooks/useUpcomingBlunders';

/** Pages a focused session can send you back to (a course day: `/courses/<slug>/<day>`). */
export type ReturnPath = '/openings' | '/endgames' | `/courses/${string}`;

/** The "Back to …" label for a return page. */
export function returnLabel(path: ReturnPath): string {
  if (path === '/openings') return 'Back to Openings';
  if (path === '/endgames') return 'Back to Endgames';
  return 'Back to the lesson';
}

/**
 * What a /training session drills: `location.state` from a deep link, or the
 * landing picker's choice (same shape). At most one filter is set in practice.
 */
export interface TrainingFocus {
  gameIds?: string[];
  contextFilter?: ContextFilter;
  phaseFilter?: BlunderPhase;
  motifFilter?: Motif;
  openingFilter?: string;
  openingColor?: 'white' | 'black' | null;
  openingLabel?: string;
  /** Only drills of this kind ("Review N due" on /openings, the plan's Openings step). */
  kindFilter?: DrillKind;
  /** Exactly these drills, due or not ("Drill these" / "Train" on /openings). */
  blunderIds?: string[];
  /** Banner label for a `blunderIds` session. */
  focusLabel?: string;
  /** Drill what's due next instead of what's due now ("Practice ahead"). */
  practiceAhead?: boolean;
  /** Where "Back to …" goes when the focus runs out. */
  returnTo?: ReturnPath;
}

function isReturnPath(v: unknown): v is ReturnPath {
  return v === '/openings' || v === '/endgames' || (typeof v === 'string' && /^\/courses\/[a-z0-9-]+(\/\d+)?$/.test(v));
}

/** Any filter that narrows the queue (practice-ahead alone is not a filter). */
export function hasFilter(f: TrainingFocus): boolean {
  return !!(
    f.contextFilter ||
    f.phaseFilter ||
    f.motifFilter ||
    f.openingFilter ||
    f.kindFilter ||
    f.blunderIds ||
    f.gameIds
  );
}

/**
 * The page a focused session belongs to: an explicit `returnTo`, else
 * inferred — opening reviews and a hand-picked set of opening drills come from
 * /openings, endgame drills from /endgames.
 */
export function returnPathFor(f: TrainingFocus, blunders: readonly Blunder[] | null = null): ReturnPath | null {
  if (isReturnPath(f.returnTo)) return f.returnTo;
  if (f.kindFilter === 'opening') return '/openings';
  if (f.kindFilter === 'endgame') return '/endgames';
  if (f.blunderIds && blunders && blunders.length > 0) {
    if (blunders.every((b) => b.kind === 'opening')) return '/openings';
    if (blunders.every((b) => b.kind === 'endgame')) return '/endgames';
  }
  return null;
}

/**
 * The focus "Keep training" continues with after a session: the same one, so
 * an openings session never drops into the main queue. A hand-picked set
 * (`blunderIds`) continues as its kind's reviews when it was all one kind
 * with a home page (opening → opening reviews, endgame → endgame positions);
 * a game's blunders and a mixed set go back to the picker (null).
 */
export function continueFocus(f: TrainingFocus, blunders: readonly Blunder[] = []): TrainingFocus | null {
  if (f.gameIds) return null;
  if (f.blunderIds) {
    const back = returnPathFor(f, blunders);
    if (back === '/openings') return { kindFilter: 'opening', returnTo: back };
    if (back === '/endgames') return { phaseFilter: 'endgame', returnTo: back };
    return null;
  }
  if (!hasFilter(f) && !f.practiceAhead) return null;
  return { ...f };
}

/** The same focus, drilling what's due next. */
export function practiceAheadFocus(f: TrainingFocus): TrainingFocus {
  const { blunderIds: _ids, focusLabel: _label, gameIds: _games, ...rest } = f;
  return { ...rest, practiceAhead: true };
}

/** Filters only the client can apply (they need the blunders' games or motif tags). */
function needsClientFilter(f: TrainingFocus): boolean {
  return !!(f.motifFilter || f.openingFilter || f.contextFilter);
}

/**
 * Server query for a practice-ahead focus. Kind and phase narrow on the
 * server; motif / opening / situation narrow afterwards, so they fetch a
 * larger pool. Without a kind, opening drills stay out: they have their own
 * step in the plan and don't count toward "Train N positions".
 */
export function practiceAheadParams(f: TrainingFocus): Required<UpcomingParams> {
  return {
    kind: f.kindFilter ?? null,
    excludeKind: f.kindFilter ? null : 'opening',
    phase: f.phaseFilter ?? null,
    limit: needsClientFilter(f) ? PRACTICE_AHEAD_FILTER_POOL : PRACTICE_AHEAD_BATCH,
  };
}
