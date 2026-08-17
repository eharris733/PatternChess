import { supabaseService } from './supabaseService';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number | null;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
}

/** masters = OTB master games; lichess = the rated-players database. */
export type ExplorerDb = 'masters' | 'lichess';

export interface ExplorerQuery {
  db: ExplorerDb;
  /** Lichess rating buckets to include (lichess db only), e.g. [1400, 1600]. */
  ratings?: number[];
  /** e.g. ['blitz', 'rapid'] (lichess db only). */
  speeds?: string[];
}

/** Lichess explorer rating buckets (lower bounds). */
export const EXPLORER_RATING_BUCKETS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

/**
 * The two buckets enclosing a player's rating — a band of realistic
 * club-level opposition. Defaults to 1600–1800 when the rating is unknown.
 */
export function ratingBandFor(rating: number | null | undefined): number[] {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return [1600, 1800];
  let lower = EXPLORER_RATING_BUCKETS[0];
  for (const b of EXPLORER_RATING_BUCKETS) {
    if (b <= rating) lower = b;
    else break;
  }
  const idx = EXPLORER_RATING_BUCKETS.indexOf(lower);
  const upper = EXPLORER_RATING_BUCKETS[Math.min(idx + 1, EXPLORER_RATING_BUCKETS.length - 1)];
  return lower === upper ? [lower] : [lower, upper];
}

const memoryCache = new Map<string, ExplorerResult>();

function fromJson(json: any): ExplorerResult {
  return {
    white: (json.white as number) ?? 0,
    draws: (json.draws as number) ?? 0,
    black: (json.black as number) ?? 0,
    moves: ((json.moves as any[]) ?? []).map((m) => ({
      uci: m.uci as string,
      san: m.san as string,
      white: m.white as number,
      draws: m.draws as number,
      black: m.black as number,
      averageRating: (m.averageRating as number | null) ?? null,
    })),
  };
}

export function isBookMove(result: ExplorerResult, uci: string): boolean {
  return result.moves.some((m) => m.uci === uci);
}

function variantKeyFor(q: ExplorerQuery): string {
  if (q.db === 'masters') return '';
  const parts: string[] = [];
  if (q.ratings?.length) parts.push(`ratings=${[...q.ratings].sort((a, b) => a - b).join(',')}`);
  if (q.speeds?.length) parts.push(`speeds=${[...q.speeds].sort().join(',')}`);
  return parts.join('&');
}

// The explorer API is rate-limited. All live requests flow through one shared
// 300ms-spaced queue (cache hits skip it) with exponential backoff on 429 —
// previously the only throttle was a caller-side convention in prefetchBook.
const REQUEST_SPACING_MS = 300;
const BACKOFF_MS = [1_000, 2_000, 4_000];
let requestChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function throttledFetch(url: string): Promise<Response | null> {
  const run = async (): Promise<Response | null> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url).catch(() => null);
      if (res && res.status === 429 && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return res;
    }
  };
  const next = requestChain.then(run);
  requestChain = next.catch(() => {}).then(() => sleep(REQUEST_SPACING_MS));
  return next;
}

/**
 * Fetch explorer stats for a position from the masters or rated-players
 * database. Memory + Supabase cached by (fen, db, variantKey); null on any
 * failure — callers degrade gracefully (hide the panel / fall back to engine).
 */
export async function fetchExplorer(
  fen: string,
  q: ExplorerQuery,
): Promise<ExplorerResult | null> {
  const variantKey = variantKeyFor(q);
  const cacheKey = `${q.db}|${variantKey}|${fen}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  try {
    const dbCached = await supabaseService.getCachedExplorerResult(fen, q.db, variantKey);
    if (dbCached) {
      const r = fromJson(dbCached);
      memoryCache.set(cacheKey, r);
      return r;
    }
  } catch {
    /* fall through to API */
  }

  try {
    const params = new URLSearchParams({ fen });
    if (q.db === 'lichess') {
      if (q.ratings?.length) params.set('ratings', [...q.ratings].sort((a, b) => a - b).join(','));
      if (q.speeds?.length) params.set('speeds', [...q.speeds].sort().join(','));
    }
    const res = await throttledFetch(`https://explorer.lichess.org/${q.db}?${params}`);
    if (!res || !res.ok) return null;
    const json = await res.json();
    const result = fromJson(json);
    memoryCache.set(cacheKey, result);
    void supabaseService
      .cacheExplorerResult(fen, q.db, variantKey, json)
      .catch((err) => console.warn('[explorer] cacheExplorerResult failed', err));
    return result;
  } catch {
    return null;
  }
}

export async function fetchMasters(fen: string): Promise<ExplorerResult | null> {
  return fetchExplorer(fen, { db: 'masters' });
}
