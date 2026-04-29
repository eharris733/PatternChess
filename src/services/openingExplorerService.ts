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
    const res = await fetch(
      `https://explorer.lichess.org/masters?fen=${encodeURIComponent(fen)}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = fromJson(json);
    memoryCache.set(fen, result);
    void supabaseService.cacheExplorerResult(fen, json).catch(() => {});
    return result;
  } catch {
    return null;
  }
}
