import {
  fetchChessComGames,
  fetchLichessGames,
  ImportedGame,
  TimeControlCategory,
} from './chessApiService';
import { supabaseService } from './supabaseService';
import { analyzeGames } from './analysisService';
import type { GameRecord } from '../models/gameRecord';

export type Platform = 'lichess' | 'chess.com';

export interface ProviderProgress {
  phase: 'idle' | 'fetching' | 'inserting' | 'analyzing' | 'done' | 'error';
  fetched: number;
  inserted: number;
  total: number | null;
  error: string | null;
  analyzeGameIndex: number;
  analyzeGamesTotal: number;
  analyzePositionIndex: number;
  analyzePositionsTotal: number;
  blundersFound: number;
}

export interface SyncResult {
  inserted: GameRecord[];
  latestPlayedAt: Date | null;
  blundersFound: number;
}

export interface SyncFilters {
  ratedOnly?: boolean;
  timeControls?: TimeControlCategory[];
}

const initial = {
  analyzeGameIndex: 0,
  analyzeGamesTotal: 0,
  analyzePositionIndex: 0,
  analyzePositionsTotal: 0,
  blundersFound: 0,
};

export async function syncProvider(
  platform: Platform,
  username: string,
  since: Date | null,
  filters: SyncFilters,
  onProgress: (p: ProviderProgress) => void,
): Promise<SyncResult> {
  onProgress({
    phase: 'fetching',
    fetched: 0,
    inserted: 0,
    total: null,
    error: null,
    ...initial,
  });

  const ratedOnly = filters.ratedOnly ?? false;
  const timeControls = filters.timeControls ?? [];

  let fetched: ImportedGame[];
  try {
    fetched =
      platform === 'lichess'
        ? await fetchLichessGames(username, { since, ratedOnly, timeControls })
        : await fetchChessComGames(username, { since, ratedOnly, timeControls });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fetch failed';
    onProgress({
      phase: 'error',
      fetched: 0,
      inserted: 0,
      total: null,
      error: msg,
      ...initial,
    });
    throw e;
  }

  onProgress({
    phase: 'inserting',
    fetched: fetched.length,
    inserted: 0,
    total: fetched.length,
    error: null,
    ...initial,
  });

  let existingIds: Set<string>;
  try {
    existingIds = await supabaseService.getExistingExternalGameIds(platform);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lookup failed';
    onProgress({
      phase: 'error',
      fetched: fetched.length,
      inserted: 0,
      total: fetched.length,
      error: msg,
      ...initial,
    });
    throw e;
  }

  const newOnly = fetched.filter((g) => !existingIds.has(g.external_game_id));

  let inserted: GameRecord[] = [];
  if (newOnly.length > 0) {
    try {
      inserted = await supabaseService.insertGames(
        newOnly.map((g) => ({ ...g })) as Array<Record<string, unknown>>,
      );
    } catch (e) {
      // 23505 = unique_violation. A concurrent sync raced us; the row already
      // exists, so treat it as a successful no-op rather than failing the
      // whole sync run.
      const code = (e as { code?: string } | null)?.code;
      if (code === '23505') {
        console.warn('[sync] unique violation on game insert (race with concurrent sync)', e);
        inserted = [];
      } else {
        const msg = e instanceof Error ? e.message : 'Insert failed';
        onProgress({
          phase: 'error',
          fetched: fetched.length,
          inserted: 0,
          total: fetched.length,
          error: msg,
          ...initial,
        });
        throw e;
      }
    }
  }

  // Advance the cursor based on the latest game we *saw* from the platform,
  // not just newly inserted ones. Otherwise a no-op sync (all dupes) leaves
  // last_synced_*_at frozen and we keep re-fetching the same window forever.
  let latest: Date | null = null;
  for (const g of fetched) {
    if (!g.played_at) continue;
    const ts = new Date(g.played_at);
    if (Number.isNaN(ts.getTime())) continue;
    if (!latest || ts > latest) latest = ts;
  }

  // Analyze every un-analyzed game for this user+platform+username, not just
  // newly inserted ones — so legacy state (games inserted but never analyzed)
  // heals itself on the next sync.
  let unanalyzed: string[];
  try {
    unanalyzed = await supabaseService.getUnanalyzedGameIds({ platform, username });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lookup failed';
    onProgress({
      phase: 'error',
      fetched: fetched.length,
      inserted: inserted.length,
      total: fetched.length,
      error: msg,
      ...initial,
    });
    throw e;
  }

  let blundersFound = 0;
  if (unanalyzed.length > 0) {
    onProgress({
      phase: 'analyzing',
      fetched: fetched.length,
      inserted: inserted.length,
      total: fetched.length,
      error: null,
      analyzeGameIndex: 0,
      analyzeGamesTotal: unanalyzed.length,
      analyzePositionIndex: 0,
      analyzePositionsTotal: 0,
      blundersFound: 0,
    });

    try {
      const result = await analyzeGames(unanalyzed, username, (p) => {
        onProgress({
          phase: 'analyzing',
          fetched: fetched.length,
          inserted: inserted.length,
          total: fetched.length,
          error: null,
          analyzeGameIndex: p.gameIndex,
          analyzeGamesTotal: p.gamesTotal,
          analyzePositionIndex: p.positionIndex,
          analyzePositionsTotal: p.positionsTotal,
          blundersFound: p.blundersFound,
        });
      });
      blundersFound = result.blundersFound;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Analyze failed';
      onProgress({
        phase: 'error',
        fetched: fetched.length,
        inserted: inserted.length,
        total: fetched.length,
        error: msg,
        analyzeGameIndex: 0,
        analyzeGamesTotal: unanalyzed.length,
        analyzePositionIndex: 0,
        analyzePositionsTotal: 0,
        blundersFound: 0,
      });
      throw e;
    }
  }

  onProgress({
    phase: 'done',
    fetched: fetched.length,
    inserted: inserted.length,
    total: fetched.length,
    error: null,
    analyzeGameIndex: unanalyzed.length,
    analyzeGamesTotal: unanalyzed.length,
    analyzePositionIndex: 0,
    analyzePositionsTotal: 0,
    blundersFound,
  });

  return { inserted, latestPlayedAt: latest, blundersFound };
}
