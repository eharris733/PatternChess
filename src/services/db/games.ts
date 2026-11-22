import { rpc } from '../../lib/api';
import type { Tables, TablesInsert, TablesUpdate } from '../../lib/database.types';
import { GameRecord, gameRecordFromJson, parseColor } from '../../models/gameRecord';
import { currentUserId } from './currentUser';

// Server side: functions/_shared/rpc/training.ts (`games.*`). Every handler is
// scoped to the session user (that replaced RLS), so the old optional
// `userId` filters are implicit and kept only for signature compatibility.

/** Games per insert call: keeps each request (PGN text) and its D1 batch small. */
const INSERT_CHUNK = 200;

export async function insertGames(
  games: Omit<TablesInsert<'games'>, 'user_id'>[],
): Promise<GameRecord[]> {
  // ON CONFLICT DO NOTHING on (user_id, platform, external_game_id): a second
  // tab / a racing trigger inserting the same game must not abort the whole
  // batch. The server returns only the rows actually inserted, so callers'
  // "inserted" counts stay honest.
  const inserted: Tables<'games'>[] = [];
  for (let i = 0; i < games.length; i += INSERT_CHUNK) {
    inserted.push(
      ...(await rpc<Tables<'games'>[]>('games.insert', { games: games.slice(i, i + INSERT_CHUNK) })),
    );
  }
  if (inserted.length > 0) forgetUnanalyzedCount();
  return inserted.map(gameRecordFromJson);
}

/**
 * Every game, newest first: by played_at (NULL first), then insertion time, so
 * freshly-imported PGN uploads with missing/old [Date] headers surface at the
 * top of the vault. Every column GameRecord needs EXCEPT the heavy `pgn` and
 * `clock_per_ply` — replay fetches the single full row via getGame.
 */
export async function getGames(_opts?: { userId?: string }): Promise<GameRecord[]> {
  const rows = await rpc<Tables<'games'>[]>('games.list');
  return rows.map(gameRecordFromJson);
}

/**
 * The few fields endgame-scenario derivation needs, for just the given games —
 * so the scan never waits on the full games list.
 */
export async function getScenarioGames(
  ids: readonly string[],
): Promise<Array<Pick<GameRecord, 'id' | 'platform' | 'result' | 'userColor'>>> {
  if (ids.length === 0) return [];
  const rows = await rpc<Array<Pick<Tables<'games'>, 'id' | 'platform' | 'result' | 'user_color'>>>(
    'games.scenarioGames',
    { ids },
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    result: r.result,
    userColor: parseColor(r.user_color),
  }));
}

export async function getGame(id: string): Promise<GameRecord> {
  return gameRecordFromJson(await rpc<Tables<'games'>>('games.get', { id }));
}

export async function markGameAnalyzed(gameId: string): Promise<void> {
  await rpc('games.markAnalyzed', { gameId });
}

export async function getUnanalyzedGameIds(opts: {
  platform: string;
  username: string;
}): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  return rpc<string[]>('games.unanalyzedIds', { platform: opts.platform, username: opts.username });
}

/**
 * Unanalyzed games on every platform, newest first — the leftovers sync never
 * revisits: PGN uploads (sync only sweeps its own platform + username), games
 * under an old username, and runs cut short by a closed tab.
 */
export async function getLeftoverUnanalyzedGameIds(limit: number): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  return rpc<string[]>('games.leftoverUnanalyzedIds', { limit });
}

/**
 * Remembers a zero from countUnanalyzedGames for a short while. Every
 * background job (blunder maintenance, endgame verification, the openings
 * scan) uses the count as its "is sync analysis busy?" gate, and the openings
 * scan re-asks on every loop pass: ~120 requests per 10 minutes on an open
 * dashboard, nearly all answering 0. Only a zero is kept — while games are
 * waiting, the jobs poll on their own timers and must see the count drop
 * promptly. In this tab, only inserting a game or clearing analyzed_at can
 * make it nonzero, and both forget it; another tab's import shows within the TTL.
 */
const UNANALYZED_COUNT_TTL_MS = 30_000;
let unanalyzedZero: { userId: string; at: number } | null = null;

function forgetUnanalyzedCount(): void {
  unanalyzedZero = null;
}

/** User-wide unanalyzed-game count — the maintenance worker's sync guard. */
export async function countUnanalyzedGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  if (
    unanalyzedZero?.userId === userId &&
    Date.now() - unanalyzedZero.at < UNANALYZED_COUNT_TTL_MS
  ) {
    return 0;
  }
  const count = await rpc<number>('games.countUnanalyzed');
  unanalyzedZero = count === 0 ? { userId, at: Date.now() } : null;
  return count;
}

/**
 * Delete one game (its blunders first; every other FK to games cascades).
 * Returns the rows removed — 0 means it wasn't the caller's or is already gone.
 */
export async function deleteGame(gameId: string): Promise<number> {
  return rpc<number>('games.delete', { gameId });
}

/**
 * Bulk delete for the Vault ("Delete games…"). Blunders, endgame scenarios,
 * opening deviations and annotations go with their games (every FK to games
 * cascades). Chunked so progress can be reported. Returns the rows actually
 * removed — fewer than asked means some weren't the caller's.
 */
export async function deleteGames(
  gameIds: string[],
  onProgress?: (deleted: number) => void,
): Promise<number> {
  const CHUNK = 100;
  let deleted = 0;
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    deleted += await rpc<number>('games.deleteMany', { ids: gameIds.slice(i, i + CHUNK) });
    onProgress?.(deleted);
  }
  return deleted;
}

export async function resetGameAnalyzed(gameId: string): Promise<void> {
  await rpc('games.resetAnalyzed', { gameId });
  forgetUnanalyzedCount();
}

export async function getExistingExternalGameIds(
  platform: string,
): Promise<Set<string>> {
  const userId = await currentUserId();
  if (!userId) return new Set();
  const ids = await rpc<Array<string | null>>('games.externalIds', { platform });
  return new Set(ids.filter((id): id is string => !!id));
}

export async function getGameCount(
  platform: string,
  username: string,
): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('games.count', { platform, username });
}

/**
 * `played_at` of the user's games played since `since` — the daily plan's
 * "Play N games" step filters these to the user's local day. A rolling window
 * (not a count) because local midnight depends on the profile timezone.
 */
export async function getGamesPlayedSince(since: Date): Promise<Date[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const playedAt = await rpc<Array<string | null>>('games.playedSince', { since: since.toISOString() });
  return playedAt
    .map((p) => (p ? new Date(p) : null))
    .filter((d): d is Date => d != null && !Number.isNaN(d.getTime()));
}

export async function getTotalGameCount(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('games.totalCount');
}

export async function getUnparsedGames(opts?: { limit?: number }): Promise<GameRecord[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const rows = await rpc<Tables<'games'>[]>('games.unparsed', { limit: opts?.limit });
  return rows.map(gameRecordFromJson);
}

export async function countUnparsedGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('games.countUnparsed');
}

/** Games still needing position-based opening classification, oldest first. */
export async function getUnclassifiedOpeningGames(opts?: {
  limit?: number;
}): Promise<Array<{ id: string; pgn: string }>> {
  const userId = await currentUserId();
  if (!userId) return [];
  return rpc<Array<{ id: string; pgn: string }>>('games.unclassifiedOpenings', { limit: opts?.limit });
}

export async function countUnclassifiedOpeningGames(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  return rpc<number>('games.countUnclassifiedOpenings');
}

export interface GameOpeningPatch {
  id: string;
  /** NULL for games too short to classify — the row is still stamped as done. */
  eco: string | null;
  opening_name: string | null;
  opening_family: string | null;
}

/**
 * Write a batch of classified openings in one round trip (an active account has
 * thousands of games, so per-row requests are far too slow). Returns the number
 * of rows actually updated.
 */
export async function applyGameOpenings(rows: GameOpeningPatch[]): Promise<number> {
  if (rows.length === 0) return 0;
  return rpc<number>('games.applyOpenings', { rows });
}

export async function updateGameMetadata(
  gameId: string,
  patch: {
    eco?: string | null;
    openingName?: string | null;
    userColor?: 'white' | 'black' | null;
    userRating?: number | null;
    opponentRating?: number | null;
    clockPerPly?: number[] | null;
    totalPlies?: number | null;
  },
): Promise<void> {
  // parsed_metadata_at is stamped by the server.
  const update: TablesUpdate<'games'> = {};
  if (patch.eco !== undefined) update.eco = patch.eco;
  if (patch.openingName !== undefined) update.opening_name = patch.openingName;
  if (patch.userColor !== undefined) update.user_color = patch.userColor;
  if (patch.userRating !== undefined) update.user_rating = patch.userRating;
  if (patch.opponentRating !== undefined) update.opponent_rating = patch.opponentRating;
  if (patch.clockPerPly !== undefined) update.clock_per_ply = patch.clockPerPly;
  if (patch.totalPlies !== undefined) update.total_plies = patch.totalPlies;
  await rpc('games.updateMetadata', { gameId, patch: update });
}
