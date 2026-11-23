import { fenSideToMove } from '../../chess/moveUtils';
import { MOTIF_LABEL, type Motif } from '../../chess/motifs';
import {
  DRILL_KIND_LABEL,
  PHASE_LABEL,
  SR_BUCKET_LABEL,
  srBucket,
  type Blunder,
  type BlunderPhase,
  type DrillKind,
  type SrBucket,
} from '../../models/blunder';
import type { GameRecord } from '../../models/gameRecord';

/**
 * Filters for the Vault's Blunders and Mastered tabs. They live in the URL
 * (`/vault?motif=missedFork&phase=endgame&from=2026-01-01`) so a filtered view
 * can be bookmarked or linked, and the Export menu exports exactly what the
 * filters show.
 */

export type PlayerColor = 'white' | 'black';

export interface PositionFilters {
  kind: DrillKind | null;
  /** SR bucket (Blunders tab only; every Mastered position is `mastered`). */
  progress: SrBucket | null;
  motif: Motif | null;
  phase: BlunderPhase | null;
  /** Opening family, e.g. "Sicilian Defense". */
  opening: string | null;
  /** The color the user played in that game. */
  color: PlayerColor | null;
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string | null;
  to: string | null;
}

export type FilterKey = keyof PositionFilters;

export const EMPTY_FILTERS: PositionFilters = {
  kind: null,
  progress: null,
  motif: null,
  phase: null,
  opening: null,
  color: null,
  from: null,
  to: null,
};

/** URL query param for each filter. */
export const FILTER_PARAM: Record<FilterKey, string> = {
  kind: 'type',
  progress: 'progress',
  motif: 'motif',
  phase: 'phase',
  opening: 'opening',
  color: 'color',
  from: 'from',
  to: 'to',
};

export const FILTER_PARAM_NAMES: readonly string[] = Object.values(FILTER_PARAM);

export const COLOR_LABEL: Record<PlayerColor, string> = { white: 'White', black: 'Black' };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(v: string | null, allowed: Record<T, unknown>): T | null {
  return v !== null && Object.prototype.hasOwnProperty.call(allowed, v) ? (v as T) : null;
}

function validYmd(v: string | null): string | null {
  if (!v || !YMD.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : v;
}

/** Filters from the URL; unknown or malformed values are ignored. */
export function readFilters(params: URLSearchParams): PositionFilters {
  const opening = params.get(FILTER_PARAM.opening)?.trim();
  return {
    kind: oneOf(params.get(FILTER_PARAM.kind), DRILL_KIND_LABEL),
    progress: oneOf(params.get(FILTER_PARAM.progress), SR_BUCKET_LABEL),
    motif: oneOf(params.get(FILTER_PARAM.motif), MOTIF_LABEL),
    phase: oneOf(params.get(FILTER_PARAM.phase), PHASE_LABEL),
    opening: opening ? opening : null,
    color: oneOf(params.get(FILTER_PARAM.color), COLOR_LABEL),
    from: validYmd(params.get(FILTER_PARAM.from)),
    to: validYmd(params.get(FILTER_PARAM.to)),
  };
}

/** A copy of `params` with `patch` applied (null clears a filter); other params are kept. */
export function writeFilters(params: URLSearchParams, patch: Partial<PositionFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of Object.keys(patch) as FilterKey[]) {
    const v = patch[key];
    if (v === null || v === undefined || v === '') next.delete(FILTER_PARAM[key]);
    else next.set(FILTER_PARAM[key], v);
  }
  return next;
}

/** A copy of `params` without any position filter. */
export function clearFilterParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of FILTER_PARAM_NAMES) next.delete(name);
  return next;
}

/** Filters that apply in this tab (Mastered has no progress filter). */
export function effectiveFilters(filters: PositionFilters, mode: 'blunders' | 'mastered'): PositionFilters {
  return mode === 'mastered' ? { ...filters, progress: null } : filters;
}

/** How many filters are set, for the "Clear filters" button. */
export function activeFilterCount(filters: PositionFilters): number {
  return (Object.keys(filters) as FilterKey[]).filter((k) => filters[k] !== null).length;
}

/** Everything a filter needs to know about one position, resolved once. */
export interface PositionFacts {
  blunder: Blunder;
  game: GameRecord | null;
  bucket: SrBucket;
  color: PlayerColor;
  openingFamily: string | null;
  /** When the game was played (falls back to when the position was found). */
  date: Date;
  /** `date` as a local YYYY-MM-DD, for the date range. */
  ymd: string;
}

export function localYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function positionFacts(blunder: Blunder, game: GameRecord | null): PositionFacts {
  // Every Vault position is the user's move, so the side to move is the user.
  const color = game?.userColor ?? fenSideToMove(blunder.fen);
  const drillFamily =
    blunder.drillData && 'openingFamily' in blunder.drillData ? blunder.drillData.openingFamily : null;
  const date = game?.playedAt ?? blunder.createdAt;
  return {
    blunder,
    game,
    bucket: srBucket(blunder),
    color,
    openingFamily: drillFamily ?? game?.openingFamily ?? null,
    date,
    ymd: localYmd(date),
  };
}

/** True when the position passes every filter, optionally ignoring one (for facet counts). */
export function matchesFilters(f: PositionFacts, filters: PositionFilters, except?: FilterKey): boolean {
  const on = (k: FilterKey) => k !== except && filters[k] !== null;
  if (on('kind') && f.blunder.kind !== filters.kind) return false;
  if (on('progress') && f.bucket !== filters.progress) return false;
  if (on('motif') && !f.blunder.motifs.includes(filters.motif as Motif)) return false;
  if (on('phase') && f.blunder.phase !== filters.phase) return false;
  if (on('opening') && f.openingFamily !== filters.opening) return false;
  if (on('color') && f.color !== filters.color) return false;
  if (on('from') && f.ymd < (filters.from as string)) return false;
  if (on('to') && f.ymd > (filters.to as string)) return false;
  return true;
}

/**
 * Counts per value of one filter, over the positions that pass every OTHER
 * filter — so each option shows how many positions picking it would leave.
 */
export function facetCounts<V extends string>(
  facts: readonly PositionFacts[],
  filters: PositionFilters,
  key: FilterKey,
  valuesOf: (f: PositionFacts) => readonly V[],
): Map<V, number> {
  const out = new Map<V, number>();
  for (const f of facts) {
    if (!matchesFilters(f, filters, key)) continue;
    for (const v of valuesOf(f)) out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}

/** Opening families present, most positions first, then by name. */
export function openingOptions(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
