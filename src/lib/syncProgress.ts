import type { ProviderProgress } from '../services/syncService';
import type { Translator } from '../i18n/useT';

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
  /** The numbers behind `months`, for a translated line. */
  monthCounts?: { done: number; total: number | null } | null;
}

/** "month 2/3" on an incremental sync (the window bounds it), "3 months back" on a backlog import. */
export function monthDetail(
  p: Pick<ProviderProgress, 'monthsDone' | 'monthsTotal'>,
  t?: Translator,
): string | null {
  const done = p.monthsDone ?? 0;
  if (p.monthsTotal != null && p.monthsTotal > 0) {
    const at = Math.min(Math.max(done, 1), p.monthsTotal);
    return t ? t('sync.monthOf', { done: at, total: p.monthsTotal }) : `month ${at}/${p.monthsTotal}`;
  }
  if (done <= 0) return null;
  return t ? t('sync.monthsBack', { count: done }) : `${done} ${done === 1 ? 'month' : 'months'} back`;
}

/** Sum the providers that are fetching right now; null when none is. */
export function summarizeFetch(providers: ProviderProgress[]): FetchSummary | null {
  const fetching = providers.filter((p) => p.phase === 'fetching');
  if (fetching.length === 0) return null;
  const fetched = fetching.reduce((n, p) => n + p.fetched, 0);
  const target = fetching.every((p) => p.total != null)
    ? fetching.reduce((n, p) => n + (p.total ?? 0), 0)
    : null;
  const withMonths = fetching.find((p) => monthDetail(p) != null) ?? null;
  const months = withMonths ? monthDetail(withMonths) : null;
  const monthCounts = withMonths ? { done: withMonths.monthsDone ?? 0, total: withMonths.monthsTotal ?? null } : null;
  return { fetched, target: target && target > 0 ? target : null, months, monthCounts };
}

/** "57 of 200" (backlog import) or "57" (incremental). */
export function fetchCount(s: Pick<FetchSummary, 'fetched' | 'target'>, t?: Translator): string {
  if (s.target == null) return String(s.fetched);
  const fetched = Math.min(s.fetched, s.target);
  return t ? t('sync.countOf', { fetched, target: s.target }) : `${fetched} of ${s.target}`;
}

/** `months`, in the active language when a translator is given. */
function monthsText(s: FetchSummary, t?: Translator): string | null {
  if (!t || !s.monthCounts) return s.months;
  return monthDetail({ monthsDone: s.monthCounts.done, monthsTotal: s.monthCounts.total }, t);
}

/** Nothing counted yet (the archive list or the stream is still on its way). */
function notStarted(s: FetchSummary): boolean {
  return s.fetched === 0 && s.months == null;
}

/** The full line: "Fetching games… 57 of 200 (3 months back)". */
export function fetchingLine(s: FetchSummary, t?: Translator): string {
  if (!t) {
    if (notStarted(s)) return 'Fetching games…';
    return `Fetching games… ${fetchCount(s)}${s.months ? ` (${s.months})` : ''}`;
  }
  if (notStarted(s)) return t('sync.fetchingGames');
  const months = monthsText(s, t);
  return months
    ? t('sync.fetchingGamesCountMonths', { count: fetchCount(s, t), months })
    : t('sync.fetchingGamesCount', { count: fetchCount(s, t) });
}

/** The short form for the sidebar pill: "Fetching 57 of 200". */
export function fetchingHeadline(s: FetchSummary, t?: Translator): string {
  if (!t) return notStarted(s) ? 'Fetching…' : `Fetching ${fetchCount(s)}`;
  return notStarted(s) ? t('sync.fetching') : t('sync.fetchingCount', { count: fetchCount(s, t) });
}
