import type { ProviderProgress } from '../services/syncService';

/**
 * Wording for live sync progress, shared by the sidebar SyncIndicator, the
 * onboarding import screen and /openings, so every surface counts the same way.
 */

export interface FetchSummary {
  /** Games fetched so far across the providers still fetching. */
  fetched: number;
  /** Their combined game cap, or null when any of them is open-ended (incremental sync). */
  target: number | null;
  /** chess.com month detail, e.g. "month 2/3" or "3 months back"; null when there is none. */
  months: string | null;
}

/** "month 2/3" on an incremental sync (the window bounds it), "3 months back" on a backlog import. */
export function monthDetail(p: Pick<ProviderProgress, 'monthsDone' | 'monthsTotal'>): string | null {
  const done = p.monthsDone ?? 0;
  if (p.monthsTotal != null && p.monthsTotal > 0) return `month ${Math.min(Math.max(done, 1), p.monthsTotal)}/${p.monthsTotal}`;
  if (done <= 0) return null;
  return `${done} ${done === 1 ? 'month' : 'months'} back`;
}

/** Sum the providers that are fetching right now; null when none is. */
export function summarizeFetch(providers: ProviderProgress[]): FetchSummary | null {
  const fetching = providers.filter((p) => p.phase === 'fetching');
  if (fetching.length === 0) return null;
  const fetched = fetching.reduce((n, p) => n + p.fetched, 0);
  const target = fetching.every((p) => p.total != null)
    ? fetching.reduce((n, p) => n + (p.total ?? 0), 0)
    : null;
  const months = fetching.map(monthDetail).find((m) => m != null) ?? null;
  return { fetched, target: target && target > 0 ? target : null, months };
}

/** "57 of 200" (backlog import) or "57" (incremental). */
export function fetchCount(s: Pick<FetchSummary, 'fetched' | 'target'>): string {
  return s.target != null ? `${Math.min(s.fetched, s.target)} of ${s.target}` : String(s.fetched);
}

/** The full line: "Fetching games… 57 of 200 (3 months back)". */
export function fetchingLine(s: FetchSummary): string {
  return `Fetching games… ${fetchCount(s)}${s.months ? ` (${s.months})` : ''}`;
}
