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
 * Fetch masters-book stats for a position. Memory + Supabase cached by FEN;
 * null on any failure — callers degrade gracefully (hide the panel).
 */
export async function fetchMasters(fen: string): Promise<ExplorerResult | null> {
  const cached = memoryCache.get(fen);
  if (cached) return cached;

  try {
    const dbCached = await supabaseService.getCachedExplorerResult(fen);
    if (dbCached) {
      const r = fromJson(dbCached);
      memoryCache.set(fen, r);
      return r;
    }
  } catch {
    /* fall through to API */
  }

  try {
    const res = await throttledFetch(
      `https://explorer.lichess.org/masters?fen=${encodeURIComponent(fen)}`,
    );
    if (!res || !res.ok) return null;
    const json = await res.json();
    const result = fromJson(json);
    memoryCache.set(fen, result);
    void supabaseService
      .cacheExplorerResult(fen, json)
      .catch((err) => console.warn('[explorer] cacheExplorerResult failed', err));
    return result;
  } catch {
    return null;
  }
}
