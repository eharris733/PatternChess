import { fetchChessComGames, fetchLichessGames, ImportedGame } from './chessApiService';
import { supabaseService } from './supabaseService';
import type { GameRecord } from '../models/gameRecord';

export type Platform = 'lichess' | 'chess.com';

export interface ProviderProgress {
  phase: 'idle' | 'fetching' | 'inserting' | 'done' | 'error';
  fetched: number;
  inserted: number;
  total: number | null;
  error: string | null;
}

export interface SyncResult {
  inserted: GameRecord[];
  latestPlayedAt: Date | null;
}

function dedupeKey(g: { platform: string; opponent: string; played_at: string | null }): string {
  return `${g.platform}|${g.opponent}|${g.played_at ?? ''}`;
}

export async function syncProvider(
  platform: Platform,
  username: string,
  since: Date | null,
  onProgress: (p: ProviderProgress) => void,
): Promise<SyncResult> {
  onProgress({
    phase: 'fetching',
    fetched: 0,
    inserted: 0,
    total: null,
    error: null,
  });

  let fetched: ImportedGame[];
  try {
    fetched =
      platform === 'lichess'
        ? await fetchLichessGames(username, { since })
        : await fetchChessComGames(username, { since });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fetch failed';
    onProgress({ phase: 'error', fetched: 0, inserted: 0, total: null, error: msg });
    throw e;
  }

  onProgress({
    phase: 'inserting',
    fetched: fetched.length,
    inserted: 0,
    total: fetched.length,
    error: null,
  });

  if (fetched.length === 0) {
    onProgress({
      phase: 'done',
      fetched: 0,
      inserted: 0,
      total: 0,
      error: null,
    });
    return { inserted: [], latestPlayedAt: null };
  }

  let existingKeys: Set<string>;
  try {
    existingKeys = await supabaseService.getExistingGameKeys(platform, username);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lookup failed';
    onProgress({
      phase: 'error',
      fetched: fetched.length,
      inserted: 0,
      total: fetched.length,
      error: msg,
    });
    throw e;
  }

  const newOnly = fetched.filter((g) => !existingKeys.has(dedupeKey(g)));

  let inserted: GameRecord[] = [];
  if (newOnly.length > 0) {
    try {
      inserted = await supabaseService.insertGames(
        newOnly.map((g) => ({ ...g })) as Array<Record<string, unknown>>,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Insert failed';
      onProgress({
        phase: 'error',
        fetched: fetched.length,
        inserted: 0,
        total: fetched.length,
        error: msg,
      });
      throw e;
    }
  }

  let latest: Date | null = null;
  for (const g of inserted) {
    if (!g.playedAt) continue;
    if (!latest || g.playedAt > latest) latest = g.playedAt;
  }

  onProgress({
    phase: 'done',
    fetched: fetched.length,
    inserted: inserted.length,
    total: fetched.length,
    error: null,
  });

  return { inserted, latestPlayedAt: latest };
}
