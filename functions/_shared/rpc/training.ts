import {
  argNumber,
  argOptString,
  argString,
  argStringArray,
  badRequest,
  notFound,
  userRpc,
  type RpcRegistry,
  type UserRpcContext,
} from './core';
import {
  all,
  batch,
  chunk,
  first,
  insertManyStmts,
  nowIso,
  placeholders,
  scalar,
  stmt,
  updateStmt,
  uuid,
  type SqlParam,
} from '../db';
import { decodeRow, encodeRow, toIsoTimestamp } from '../schema';

/**
 * Training-data RPCs: games, blunders (trainable items), endgame scenarios,
 * game annotations and benchmarks. One handler per function in
 * src/services/db/{games,blunders,endgameScenarios,annotations,benchmarks}.ts
 * (+ src/routes/training/trainingQueue.ts), plus the Postgres RPCs those
 * modules called (`blunder_counts_by_game`, `apply_game_openings`).
 *
 * Every query is scoped by ctx.user.id — that replaces Supabase RLS. Rows come
 * back in the PostgREST shape (snake_case, booleans, parsed JSON) so the
 * client model mappers (gameRecordFromJson, blunderFromJson, …) are unchanged.
 *
 * Postgres ORDER BY puts NULLs last for ASC and first for DESC; SQLite does the
 * opposite, so every nullable sort column spells out NULLS FIRST/LAST.
 */

type Args = Record<string, unknown>;

/** IN-list chunk size: leaves room for the other bound params (D1 caps at 100). */
const IN_CHUNK = 90;
/** PostgREST answered at most 1000 rows to an unpaged select (max_rows). */
const DEFAULT_MAX_ROWS = 1000;

// ---------------------------------------------------------------------------
// column lists
// ---------------------------------------------------------------------------

/**
 * games columns a client may write on insert, with the value used when the
 * row omits one (`undefined` = NULL). user_id is the caller; time_category is
 * derived from time_control by encodeRow.
 */
const GAME_INSERT_DEFAULTS: Record<string, () => unknown> = {
  id: () => uuid(),
  platform: () => undefined,
  username: () => undefined,
  opponent: () => undefined,
  pgn: () => undefined,
  time_control: () => null,
  rated: () => false,
  result: () => null,
  played_at: () => null,
  created_at: () => nowIso(),
  analyzed_at: () => null,
  eco: () => null,
  opening_name: () => null,
  user_color: () => null,
  user_rating: () => null,
  opponent_rating: () => null,
  clock_per_ply: () => null,
  total_plies: () => null,
  parsed_metadata_at: () => null,
  external_game_id: () => undefined,
  opening_family: () => null,
  opening_classified_at: () => null,
  opening_deviation_version: () => null,
};
const GAME_REQUIRED = ['platform', 'username', 'opponent', 'pgn', 'external_game_id'] as const;

/** Every games column (what PostgREST's bare `.select()` returned). */
const GAME_ALL_COLUMNS = ['user_id', ...Object.keys(GAME_INSERT_DEFAULTS)];
const GAME_ALL = GAME_ALL_COLUMNS.join(', ');

/**
 * The games list: everything GameRecord needs EXCEPT the heavy `pgn` and
 * `clock_per_ply` (see GAME_LIST_COLUMNS in the old src/services/db/games.ts).
 */
const GAME_LIST =
  'id, platform, username, opponent, time_control, rated, result, played_at, ' +
  'created_at, analyzed_at, eco, opening_name, opening_family, ' +
  'opening_classified_at, user_color, user_rating, ' +
  'opponent_rating, total_plies, parsed_metadata_at';

const BLUNDER_INSERT_DEFAULTS: Record<string, () => unknown> = {
  id: () => uuid(),
  game_id: () => null,
  fen: () => undefined,
  move_number: () => undefined,
  played_move: () => undefined,
  correct_moves: () => [],
  eval_before: () => undefined,
  eval_after: () => undefined,
  eval_swing: () => undefined,
  side_to_move: () => undefined,
  cycle_number: () => 0,
  last_drilled_at: () => null,
  next_drill_at: () => nowIso(),
  times_correct: () => 0,
  times_attempted: () => 0,
  created_at: () => nowIso(),
  phase: () => 'middlegame',
  last_drill_failed: () => false,
  solution_line: () => null,
  motifs: () => [],
  kind: () => 'tactic',
  drill_data: () => null,
  analysis_depth: () => null,
  deepened_at: () => null,
  retired_at: () => null,
};
const BLUNDER_REQUIRED = [
  'fen',
  'move_number',
  'played_move',
  'eval_before',
  'eval_after',
  'eval_swing',
  'side_to_move',
] as const;

const SCENARIO_INSERT_DEFAULTS: Record<string, () => unknown> = {
  id: () => uuid(),
  game_id: () => undefined,
  blunder_id: () => null,
  start_fen: () => undefined,
  user_color: () => undefined,
  deserved_result: () => undefined,
  actual_result: () => undefined,
  status: () => 'pending',
  attempts: () => 0,
  last_played_at: () => null,
  created_at: () => nowIso(),
  verified_at: () => null,
  retired_at: () => null,
  verify_eval_cp: () => null,
  cycle_number: () => 0,
  times_correct: () => 0,
  times_attempted: () => 0,
  last_drill_failed: () => false,
  last_drilled_at: () => null,
  next_drill_at: () => null,
};
const SCENARIO_REQUIRED = ['game_id', 'start_fen', 'user_color', 'deserved_result', 'actual_result'] as const;

const DRILL_KINDS = ['tactic', 'endgame', 'opening'] as const;
const PHASES = ['opening', 'middlegame', 'endgame'] as const;

// ---------------------------------------------------------------------------
// helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Normalize client insert rows to one fixed column set (insertManyStmts needs
 * every row to have the same keys): unknown keys → 400, missing required → 400,
 * omitted optional columns get the Postgres default. user_id is always the caller.
 */
export function normalizeInsertRows(
  rows: unknown,
  defaults: Record<string, () => unknown>,
  required: readonly string[],
  userId: string,
  label: string,
): Record<string, unknown>[] {
  if (!Array.isArray(rows)) throw badRequest(`${label} must be an array`);
  if (rows.length > 5000) throw badRequest(`${label}: at most 5000 rows per call`);
  return rows.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest(`${label}[${i}] must be an object`);
    const row = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (key === 'user_id') continue; // never trusted; set below
      if (!(key in defaults)) throw badRequest(`${label}[${i}]: unknown column "${key}"`);
    }
    for (const [col, def] of Object.entries(defaults)) {
      const v = row[col];
      out[col] = v === undefined ? def() : v;
    }
    for (const col of required) {
      if (out[col] === undefined || out[col] === null) throw badRequest(`${label}[${i}].${col} is required`);
    }
    if (typeof out.id !== 'string' || !out.id) out.id = uuid();
    out.user_id = userId;
    return out;
  });
}

/** Keep only allow-listed keys of a patch object (unknown keys → 400). */
export function pickPatch(patch: unknown, allowed: readonly string[], label = 'patch'): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw badRequest(`${label} must be an object`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!allowed.includes(k)) throw badRequest(`${label}: column "${k}" can't be written here`);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** A canonical ISO timestamp from an arg (400 when it doesn't parse). */
export function argTimestamp(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' && typeof v !== 'number') throw badRequest(`${key} must be a timestamp`);
  const iso = toIsoTimestamp(v);
  if (Number.isNaN(Date.parse(iso)) || !iso.endsWith('Z')) throw badRequest(`${key} must be a timestamp`);
  return iso;
}

function argLimit(args: Args, key: string, fallback: number, max = 5000): number {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  const n = argNumber(args, key);
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function argId(args: Args, key: string): string {
  const v = argString(args, key);
  if (!v) throw badRequest(`${key} must not be empty`);
  return v;
}

/**
 * `sql(ph)` run once per ≤IN_CHUNK slice of `ids` (deduped), with `ph` the
 * `?, ?, …` list, bound as [...before, ...slice, ...after]. One D1 round trip.
 */
export async function selectIn<T = Record<string, unknown>>(
  db: D1Database,
  ids: readonly string[],
  sql: (ph: string) => string,
  before: readonly SqlParam[],
  after: readonly SqlParam[] = [],
  decodeAs?: string,
): Promise<T[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const results = await batch(
    db,
    chunk(uniq, IN_CHUNK).map((c) => stmt(db, sql(placeholders(c.length)), [...before, ...c, ...after])),
  );
  return results.flatMap((r) =>
    ((r.results ?? []) as Record<string, unknown>[]).map((row) =>
      (decodeAs ? decodeRow<T>(decodeAs, row) : row) as T,
    ),
  );
}

/** UPDATE one of the caller's rows by id (a no-op for anyone else's). */
async function updateOwned(
  ctx: UserRpcContext,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await updateStmt(ctx.db, table, patch, 'id = ? AND user_id = ?', [id, ctx.user.id]).run();
}

async function count(ctx: UserRpcContext, sql: string, params: readonly SqlParam[]): Promise<number> {
  return Number((await scalar<number>(ctx.db, sql, params)) ?? 0);
}

/**
 * Rows a batch of `… RETURNING id` writes touched. D1's `meta.changes` also
 * counts rows changed by FK cascades (deleting a game reports its blunders,
 * scenarios and annotations too), so counts come from RETURNING instead.
 */
function returnedRows(results: D1Result[]): number {
  return results.reduce((n, r) => n + (r.results?.length ?? 0), 0);
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

const games: RpcRegistry = {
  /**
   * insertGames: ON CONFLICT (user_id, platform, external_game_id) DO NOTHING,
   * returning only the rows actually inserted (full rows, like `.select()`).
   */
  'games.insert': userRpc<Args>(async (ctx, args) => {
    const rows = normalizeInsertRows(args.games, GAME_INSERT_DEFAULTS, GAME_REQUIRED, ctx.user.id, 'games');
    if (rows.length === 0) return [];
    const results = await batch(
      ctx.db,
      insertManyStmts(ctx.db, 'games', rows, {
        onConflict: { target: ['user_id', 'platform', 'external_game_id'] },
        returning: GAME_ALL_COLUMNS,
      }),
    );
    return results.flatMap((r) =>
      ((r.results ?? []) as Record<string, unknown>[]).map((row) => decodeRow('games', row)),
    );
  }),

  /** getGames: the list columns, newest first (NULL played_at first, like Postgres DESC). */
  'games.list': userRpc<Args>(async (ctx) =>
    all(
      ctx.db,
      `SELECT ${GAME_LIST} FROM games WHERE user_id = ?
       ORDER BY played_at DESC NULLS FIRST, created_at DESC NULLS FIRST, id`,
      [ctx.user.id],
      'games',
    ),
  ),

  /** getScenarioGames */
  'games.scenarioGames': userRpc<Args>(async (ctx, args) =>
    selectIn(
      ctx.db,
      argStringArray(args, 'ids'),
      (ph) => `SELECT id, platform, result, user_color FROM games WHERE user_id = ? AND id IN (${ph})`,
      [ctx.user.id],
    ),
  ),

  /** fetchGamesByIds (trainingQueue): full rows. */
  'games.byIds': userRpc<Args>(async (ctx, args) =>
    selectIn(
      ctx.db,
      argStringArray(args, 'ids'),
      (ph) => `SELECT ${GAME_ALL} FROM games WHERE user_id = ? AND id IN (${ph})`,
      [ctx.user.id],
      [],
      'games',
    ),
  ),

  /** getGame: one full row; 404 when it isn't the caller's (PostgREST `.single()` errored). */
  'games.get': userRpc<Args>(async (ctx, args) => {
    const row = await first(
      ctx.db,
      `SELECT ${GAME_ALL} FROM games WHERE id = ? AND user_id = ?`,
      [argId(args, 'id'), ctx.user.id],
      'games',
    );
    if (!row) throw notFound('Game not found');
    return row;
  }),

  'games.markAnalyzed': userRpc<Args>(async (ctx, args) => {
    await updateOwned(ctx, 'games', argId(args, 'gameId'), { analyzed_at: nowIso() });
    return null;
  }),

  'games.resetAnalyzed': userRpc<Args>(async (ctx, args) => {
    await updateOwned(ctx, 'games', argId(args, 'gameId'), { analyzed_at: null });
    return null;
  }),

  /** getUnanalyzedGameIds */
  'games.unanalyzedIds': userRpc<Args>(async (ctx, args) => {
    const rows = await all<{ id: string }>(
      ctx.db,
      `SELECT id FROM games
       WHERE user_id = ? AND platform = ? AND username = ? AND analyzed_at IS NULL
       ORDER BY played_at DESC NULLS LAST, id`,
      [ctx.user.id, argString(args, 'platform'), argString(args, 'username')],
    );
    return rows.map((r) => r.id);
  }),

  /** getLeftoverUnanalyzedGameIds */
  'games.leftoverUnanalyzedIds': userRpc<Args>(async (ctx, args) => {
    const rows = await all<{ id: string }>(
      ctx.db,
      `SELECT id FROM games WHERE user_id = ? AND analyzed_at IS NULL
       ORDER BY played_at DESC NULLS LAST, id LIMIT ?`,
      [ctx.user.id, argLimit(args, 'limit', DEFAULT_MAX_ROWS)],
    );
    return rows.map((r) => r.id);
  }),

  /** countUnanalyzedGames */
  'games.countUnanalyzed': userRpc<Args>(async (ctx) =>
    count(ctx, 'SELECT COUNT(*) FROM games WHERE user_id = ? AND analyzed_at IS NULL', [ctx.user.id]),
  ),

  /**
   * deleteGame: the game's blunders, then the game (FKs cascade the rest).
   * Returns the number of games removed (0 = not the caller's / already gone).
   */
  'games.delete': userRpc<Args>(async (ctx, args) => {
    const id = argId(args, 'gameId');
    const [, del] = await batch(ctx.db, [
      stmt(ctx.db, 'DELETE FROM blunders WHERE game_id = ? AND user_id = ?', [id, ctx.user.id]),
      stmt(ctx.db, 'DELETE FROM games WHERE id = ? AND user_id = ? RETURNING id', [id, ctx.user.id]),
    ]);
    return del.results?.length ?? 0;
  }),

  /** deleteGames (one client chunk of ≤100 ids per call). Returns games removed. */
  'games.deleteMany': userRpc<Args>(async (ctx, args) => {
    const ids = [...new Set(argStringArray(args, 'ids', 1000))];
    if (ids.length === 0) return 0;
    const results = await batch(
      ctx.db,
      chunk(ids, IN_CHUNK).map((c) =>
        stmt(ctx.db, `DELETE FROM games WHERE user_id = ? AND id IN (${placeholders(c.length)}) RETURNING id`, [
          ctx.user.id,
          ...c,
        ]),
      ),
    );
    return returnedRows(results);
  }),

  /** getExistingExternalGameIds → string[] (the client builds the Set). */
  'games.externalIds': userRpc<Args>(async (ctx, args) => {
    const rows = await all<{ external_game_id: string }>(
      ctx.db,
      'SELECT external_game_id FROM games WHERE user_id = ? AND platform = ? AND external_game_id IS NOT NULL',
      [ctx.user.id, argString(args, 'platform')],
    );
    return rows.map((r) => r.external_game_id);
  }),

  /** getGameCount */
  'games.count': userRpc<Args>(async (ctx, args) =>
    count(ctx, 'SELECT COUNT(*) FROM games WHERE user_id = ? AND platform = ? AND username = ?', [
      ctx.user.id,
      argString(args, 'platform'),
      argString(args, 'username'),
    ]),
  ),

  /** getGamesPlayedSince → played_at strings (≤500, like the old `.limit(500)`). */
  'games.playedSince': userRpc<Args>(async (ctx, args) => {
    const rows = await all<{ played_at: string | null }>(
      ctx.db,
      'SELECT played_at FROM games WHERE user_id = ? AND played_at >= ? LIMIT 500',
      [ctx.user.id, argTimestamp(args, 'since')],
    );
    return rows.map((r) => r.played_at);
  }),

  /** getTotalGameCount */
  'games.totalCount': userRpc<Args>(async (ctx) =>
    count(ctx, 'SELECT COUNT(*) FROM games WHERE user_id = ?', [ctx.user.id]),
  ),

  /** getUnparsedGames: full rows (no limit → PostgREST's 1000-row cap). */
  'games.unparsed': userRpc<Args>(async (ctx, args) =>
    all(
      ctx.db,
      `SELECT ${GAME_ALL} FROM games WHERE user_id = ? AND parsed_metadata_at IS NULL LIMIT ?`,
      [ctx.user.id, argLimit(args, 'limit', DEFAULT_MAX_ROWS, DEFAULT_MAX_ROWS)],
      'games',
    ),
  ),

  /** countUnparsedGames */
  'games.countUnparsed': userRpc<Args>(async (ctx) =>
    count(ctx, 'SELECT COUNT(*) FROM games WHERE user_id = ? AND parsed_metadata_at IS NULL', [ctx.user.id]),
  ),

  /** getUnclassifiedOpeningGames → { id, pgn }[] by id. */
  'games.unclassifiedOpenings': userRpc<Args>(async (ctx, args) =>
    all(
      ctx.db,
      'SELECT id, pgn FROM games WHERE user_id = ? AND opening_classified_at IS NULL ORDER BY id LIMIT ?',
      [ctx.user.id, argLimit(args, 'limit', DEFAULT_MAX_ROWS, DEFAULT_MAX_ROWS)],
    ),
  ),

  /** countUnclassifiedOpeningGames */
  'games.countUnclassifiedOpenings': userRpc<Args>(async (ctx) =>
    count(ctx, 'SELECT COUNT(*) FROM games WHERE user_id = ? AND opening_classified_at IS NULL', [ctx.user.id]),
  ),

  /**
   * apply_game_openings: per row, eco/opening_name keep the stored value when
   * NULL (unclassifiable), opening_family is overwritten, opening_classified_at
   * stamped. Returns rows updated.
   */
  'games.applyOpenings': userRpc<Args>(async (ctx, args) => {
    const rows = args.rows;
    if (!Array.isArray(rows)) throw badRequest('rows must be an array');
    if (rows.length > 1000) throw badRequest('rows: at most 1000 per call');
    if (rows.length === 0) return 0;
    const now = nowIso();
    const statements = rows.map((raw, i) => {
      if (!raw || typeof raw !== 'object') throw badRequest(`rows[${i}] must be an object`);
      const r = raw as Args;
      const id = argId(r, 'id');
      return stmt(
        ctx.db,
        `UPDATE games SET eco = COALESCE(?, eco), opening_name = COALESCE(?, opening_name),
           opening_family = ?, opening_classified_at = ?
         WHERE id = ? AND user_id = ? RETURNING id`,
        [argOptString(r, 'eco'), argOptString(r, 'opening_name'), argOptString(r, 'opening_family'), now, id, ctx.user.id],
      );
    });
    return returnedRows(await batch(ctx.db, statements));
  }),

  /** updateGameMetadata: the given columns + parsed_metadata_at = now. */
  'games.updateMetadata': userRpc<Args>(async (ctx, args) => {
    const patch = pickPatch(args.patch, [
      'eco',
      'opening_name',
      'user_color',
      'user_rating',
      'opponent_rating',
      'clock_per_ply',
      'total_plies',
    ]);
    await updateOwned(ctx, 'games', argId(args, 'gameId'), { ...patch, parsed_metadata_at: nowIso() });
    return null;
  }),
};

const blunders: RpcRegistry = {
  /** insertBlunders: ON CONFLICT (user_id, fen, kind) DO NOTHING. */
  'blunders.insert': userRpc<Args>(async (ctx, args) => {
    const rows = normalizeInsertRows(args.blunders, BLUNDER_INSERT_DEFAULTS, BLUNDER_REQUIRED, ctx.user.id, 'blunders');
    for (const r of rows) {
      if (!DRILL_KINDS.includes(r.kind as (typeof DRILL_KINDS)[number])) throw badRequest(`bad kind "${String(r.kind)}"`);
    }
    if (rows.length === 0) return null;
    await batch(ctx.db, insertManyStmts(ctx.db, 'blunders', rows, { onConflict: { target: ['user_id', 'fen', 'kind'] } }));
    return null;
  }),

  /** getBlundersForGames: tactic rows of these games. */
  'blunders.forGames': userRpc<Args>(async (ctx, args) =>
    selectIn(
      ctx.db,
      argStringArray(args, 'gameIds'),
      (ph) => `SELECT * FROM blunders WHERE user_id = ? AND kind = 'tactic' AND game_id IN (${ph}) ORDER BY id`,
      [ctx.user.id],
      [],
      'blunders',
    ),
  ),

  /** blunder_counts_by_game: { game_id: tactic count }. */
  'blunders.countsByGame': userRpc<Args>(async (ctx) => {
    const rows = await all<{ game_id: string; n: number }>(
      ctx.db,
      `SELECT game_id, COUNT(*) AS n FROM blunders
       WHERE user_id = ? AND kind = 'tactic' AND game_id IS NOT NULL GROUP BY game_id`,
      [ctx.user.id],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.game_id] = Number(r.n);
    return out;
  }),

  /** getDueBlunders (unsorted; the client applies sortDueQueue). */
  'blunders.due': userRpc<Args>(async (ctx) =>
    all(
      ctx.db,
      `SELECT * FROM blunders WHERE user_id = ? AND next_drill_at <= ? AND retired_at IS NULL
       ORDER BY next_drill_at, id`,
      [ctx.user.id, nowIso()],
      'blunders',
    ),
  ),

  /** getLiveBlunderIdsForGames (the client caps gameIds at 200). */
  'blunders.liveIdsForGames': userRpc<Args>(async (ctx, args) => {
    const rows = await selectIn<{ id: string }>(
      ctx.db,
      argStringArray(args, 'gameIds', 200),
      (ph) =>
        `SELECT id FROM blunders WHERE user_id = ? AND kind IN ('tactic', 'endgame')
         AND retired_at IS NULL AND game_id IN (${ph})`,
      [ctx.user.id],
    );
    return rows.map((r) => r.id);
  }),

  /** getFirstDueTactic: one row or null. */
  'blunders.firstDueTactic': userRpc<Args>(async (ctx) =>
    first(
      ctx.db,
      `SELECT * FROM blunders WHERE user_id = ? AND kind = 'tactic' AND next_drill_at <= ?
       AND retired_at IS NULL ORDER BY next_drill_at, id LIMIT 1`,
      [ctx.user.id, nowIso()],
      'blunders',
    ),
  ),

  /** getDrillsOfKind */
  'blunders.drillsOfKind': userRpc<Args>(async (ctx, args) => {
    const kind = argString(args, 'kind');
    if (kind !== 'opening' && kind !== 'endgame') throw badRequest('kind must be opening | endgame');
    return all(
      ctx.db,
      'SELECT * FROM blunders WHERE user_id = ? AND kind = ? AND retired_at IS NULL ORDER BY id',
      [ctx.user.id, kind],
      'blunders',
    );
  }),

  /** getAllLiveBlunders: newest first. */
  'blunders.allLive': userRpc<Args>(async (ctx) =>
    all(
      ctx.db,
      'SELECT * FROM blunders WHERE user_id = ? AND retired_at IS NULL ORDER BY created_at DESC NULLS FIRST, id',
      [ctx.user.id],
      'blunders',
    ),
  ),

  /** getBlundersByIds: live rows (unsorted; the client applies sortDueQueue). */
  'blunders.byIds': userRpc<Args>(async (ctx, args) =>
    selectIn(
      ctx.db,
      argStringArray(args, 'ids'),
      (ph) => `SELECT * FROM blunders WHERE user_id = ? AND retired_at IS NULL AND id IN (${ph})`,
      [ctx.user.id],
      [],
      'blunders',
    ),
  ),

  /** getDueCount */
  'blunders.dueCount': userRpc<Args>(async (ctx, args) => {
    const exclude = argOptString(args, 'excludeKind');
    if (exclude !== null && !DRILL_KINDS.includes(exclude as (typeof DRILL_KINDS)[number])) {
      throw badRequest('excludeKind must be tactic | endgame | opening');
    }
    return count(
      ctx,
      `SELECT COUNT(*) FROM blunders WHERE user_id = ? AND next_drill_at <= ? AND retired_at IS NULL
       ${exclude ? 'AND kind <> ?' : ''}`,
      exclude ? [ctx.user.id, nowIso(), exclude] : [ctx.user.id, nowIso()],
    );
  }),

  /**
   * getUpcomingBlunders ("Practice ahead"): live drills that are NOT due yet,
   * soonest next_drill_at first, so a player with an empty queue can keep
   * training. Optional `kind` / `excludeKind` / `phase` narrow it the same way
   * the training focus does. Results go through applyDrillResult like any
   * other drill.
   */
  'blunders.upcoming': userRpc<Args>(async (ctx, args) => {
    const kind = argOptString(args, 'kind');
    const exclude = argOptString(args, 'excludeKind');
    const phase = argOptString(args, 'phase');
    for (const [key, v] of [
      ['kind', kind],
      ['excludeKind', exclude],
    ] as const) {
      if (v !== null && !DRILL_KINDS.includes(v as (typeof DRILL_KINDS)[number])) {
        throw badRequest(`${key} must be tactic | endgame | opening`);
      }
    }
    if (phase !== null && !PHASES.includes(phase as (typeof PHASES)[number])) {
      throw badRequest('phase must be opening | middlegame | endgame');
    }
    const where: string[] = ['user_id = ?', 'retired_at IS NULL', 'next_drill_at > ?'];
    const params: SqlParam[] = [ctx.user.id, nowIso()];
    if (kind) {
      where.push('kind = ?');
      params.push(kind);
    }
    if (exclude) {
      where.push('kind <> ?');
      params.push(exclude);
    }
    if (phase) {
      where.push('phase = ?');
      params.push(phase);
    }
    params.push(argLimit(args, 'limit', 10, 200));
    return all(
      ctx.db,
      `SELECT * FROM blunders WHERE ${where.join(' AND ')} ORDER BY next_drill_at, id LIMIT ?`,
      params,
      'blunders',
    );
  }),

  /**
   * getDueTomorrowCount: the client sends its local [start of tomorrow, start
   * of the day after) as ISO instants (the server doesn't know the timezone).
   */
  'blunders.dueBetweenCount': userRpc<Args>(async (ctx, args) =>
    count(ctx, 'SELECT COUNT(*) FROM blunders WHERE user_id = ? AND next_drill_at >= ? AND next_drill_at < ?', [
      ctx.user.id,
      argTimestamp(args, 'from'),
      argTimestamp(args, 'to'),
    ]),
  ),

  /** appendCorrectMove */
  'blunders.setCorrectMoves': userRpc<Args>(async (ctx, args) => {
    if (!Array.isArray(args.correctMoves)) throw badRequest('correctMoves must be an array');
    await updateOwned(ctx, 'blunders', argId(args, 'id'), { correct_moves: args.correctMoves });
    return null;
  }),

  /** updateBlunderAfterDrill (the client computes the SR fields + next_drill_at). */
  'blunders.updateAfterDrill': userRpc<Args>(async (ctx, args) => {
    const patch = pickPatch(args.patch, [
      'cycle_number',
      'last_drilled_at',
      'next_drill_at',
      'times_correct',
      'times_attempted',
      'last_drill_failed',
    ]);
    await updateOwned(ctx, 'blunders', argId(args, 'id'), patch);
    return null;
  }),

  /** getEndgameCandidateBlunders */
  'blunders.endgameCandidates': userRpc<Args>(async (ctx) =>
    all(
      ctx.db,
      `SELECT * FROM blunders WHERE user_id = ? AND kind = 'tactic' AND phase = 'endgame'
       AND retired_at IS NULL ORDER BY move_number, id`,
      [ctx.user.id],
      'blunders',
    ),
  ),

  /** updateBlunderEnrichment */
  'blunders.updateEnrichment': userRpc<Args>(async (ctx, args) => {
    const patch = pickPatch(args.patch, ['solution_line', 'motifs', 'analysis_depth', 'deepened_at']);
    await updateOwned(ctx, 'blunders', argId(args, 'id'), patch);
    return null;
  }),

  /** updateBlunderDeepening */
  'blunders.updateDeepening': userRpc<Args>(async (ctx, args) => {
    const patch = pickPatch(args.patch, [
      'eval_before',
      'eval_after',
      'eval_swing',
      'correct_moves',
      'solution_line',
      'motifs',
      'analysis_depth',
      'deepened_at',
      'retired_at',
    ]);
    await updateOwned(ctx, 'blunders', argId(args, 'id'), patch);
    return null;
  }),

  /** countBlundersForDeepening */
  'blunders.countForDeepening': userRpc<Args>(async (ctx) =>
    count(
      ctx,
      `SELECT COUNT(*) FROM blunders WHERE user_id = ? AND kind IN ('tactic', 'endgame')
       AND solution_line IS NOT NULL AND deepened_at IS NULL`,
      [ctx.user.id],
    ),
  ),

  /** getBlundersForDeepening: shallowest first (NULL depth first), then newest. */
  'blunders.forDeepening': userRpc<Args>(async (ctx, args) =>
    all(
      ctx.db,
      `SELECT * FROM blunders WHERE user_id = ? AND kind IN ('tactic', 'endgame')
       AND solution_line IS NOT NULL AND deepened_at IS NULL
       ORDER BY analysis_depth ASC NULLS FIRST, created_at DESC NULLS FIRST LIMIT ?`,
      [ctx.user.id, argLimit(args, 'limit', DEFAULT_MAX_ROWS)],
      'blunders',
    ),
  ),

  /** countUnenrichedBlunders */
  'blunders.countUnenriched': userRpc<Args>(async (ctx) =>
    count(
      ctx,
      "SELECT COUNT(*) FROM blunders WHERE user_id = ? AND kind = 'tactic' AND solution_line IS NULL",
      [ctx.user.id],
    ),
  ),

  /** getUnenrichedBlunders: newest first. */
  'blunders.unenriched': userRpc<Args>(async (ctx, args) =>
    all(
      ctx.db,
      `SELECT * FROM blunders WHERE user_id = ? AND kind = 'tactic' AND solution_line IS NULL
       ORDER BY created_at DESC NULLS FIRST LIMIT ?`,
      [ctx.user.id, argLimit(args, 'limit', DEFAULT_MAX_ROWS)],
      'blunders',
    ),
  ),

  /** deleteBlundersForGame: everything but opening items (shared across games). */
  'blunders.deleteForGame': userRpc<Args>(async (ctx, args) => {
    const rows = await all(
      ctx.db,
      "DELETE FROM blunders WHERE game_id = ? AND user_id = ? AND kind <> 'opening' RETURNING id",
      [argId(args, 'gameId'), ctx.user.id],
    );
    return rows.length;
  }),

  /** deleteBlunder → rows removed (0 = not the caller's). */
  'blunders.delete': userRpc<Args>(async (ctx, args) => {
    const rows = await all(ctx.db, 'DELETE FROM blunders WHERE id = ? AND user_id = ? RETURNING id', [
      argId(args, 'id'),
      ctx.user.id,
    ]);
    return rows.length;
  }),
};

const endgameScenarios: RpcRegistry = {
  /** getEndgameScenarios: live rows, newest first. */
  'endgameScenarios.list': userRpc<Args>(async (ctx) =>
    all(
      ctx.db,
      `SELECT * FROM endgame_scenarios WHERE user_id = ? AND retired_at IS NULL
       ORDER BY created_at DESC, id`,
      [ctx.user.id],
      'endgame_scenarios',
    ),
  ),

  /** getUnverifiedEndgameScenarios: oldest first. */
  'endgameScenarios.unverified': userRpc<Args>(async (ctx, args) =>
    all(
      ctx.db,
      `SELECT * FROM endgame_scenarios WHERE user_id = ? AND verified_at IS NULL AND retired_at IS NULL
       ORDER BY created_at ASC LIMIT ?`,
      [ctx.user.id, argLimit(args, 'limit', DEFAULT_MAX_ROWS)],
      'endgame_scenarios',
    ),
  ),

  /** countUnverifiedEndgameScenarios */
  'endgameScenarios.countUnverified': userRpc<Args>(async (ctx) =>
    count(
      ctx,
      'SELECT COUNT(*) FROM endgame_scenarios WHERE user_id = ? AND verified_at IS NULL AND retired_at IS NULL',
      [ctx.user.id],
    ),
  ),

  /** markEndgameScenarioVerified */
  'endgameScenarios.markVerified': userRpc<Args>(async (ctx, args) => {
    const now = nowIso();
    const retired = args.retired === true;
    await updateOwned(ctx, 'endgame_scenarios', argId(args, 'id'), {
      verified_at: now,
      verify_eval_cp: Math.round(argNumber(args, 'verifyEvalCp')),
      retired_at: retired ? now : null,
    });
    return null;
  }),

  /** upsertEndgameScenarios: ON CONFLICT (user_id, game_id) DO NOTHING (first write wins). */
  'endgameScenarios.upsert': userRpc<Args>(async (ctx, args) => {
    const rows = normalizeInsertRows(args.rows, SCENARIO_INSERT_DEFAULTS, SCENARIO_REQUIRED, ctx.user.id, 'rows');
    if (rows.length === 0) return null;
    await batch(
      ctx.db,
      insertManyStmts(ctx.db, 'endgame_scenarios', rows, { onConflict: { target: ['user_id', 'game_id'] } }),
    );
    return null;
  }),

  /** updateEndgameScenarioResult */
  'endgameScenarios.updateResult': userRpc<Args>(async (ctx, args) => {
    const status = argString(args, 'status');
    if (!['pending', 'passed', 'failed'].includes(status)) throw badRequest('bad status');
    await updateOwned(ctx, 'endgame_scenarios', argId(args, 'id'), {
      status,
      attempts: argNumber(args, 'attempts'),
      last_played_at: nowIso(),
    });
    return null;
  }),

  /** updateEndgameScenarioSr (the client computes the SR fields + next_drill_at). */
  'endgameScenarios.updateSr': userRpc<Args>(async (ctx, args) => {
    const patch = pickPatch(args.patch, [
      'status',
      'attempts',
      'last_played_at',
      'cycle_number',
      'times_correct',
      'times_attempted',
      'last_drill_failed',
      'last_drilled_at',
      'next_drill_at',
    ]);
    await updateOwned(ctx, 'endgame_scenarios', argId(args, 'id'), patch);
    return null;
  }),
};

const annotations: RpcRegistry = {
  /** getAnnotations: the caller's row for a game, or null. */
  'annotations.get': userRpc<Args>(async (ctx, args) =>
    first(
      ctx.db,
      'SELECT * FROM game_annotations WHERE game_id = ? AND user_id = ?',
      [argId(args, 'gameId'), ctx.user.id],
      'game_annotations',
    ),
  ),

  /**
   * saveAnnotations: upsert on game_id. Only for the caller's own game, and the
   * conflict update never touches another user's row (game_id is unique).
   */
  'annotations.save': userRpc<Args>(async (ctx, args) => {
    const gameId = argId(args, 'gameId');
    if (!Array.isArray(args.annotations)) throw badRequest('annotations must be an array');
    const owned = await scalar(ctx.db, 'SELECT 1 FROM games WHERE id = ? AND user_id = ?', [gameId, ctx.user.id]);
    if (!owned) throw notFound('Game not found');
    const now = nowIso();
    const row = encodeRow('game_annotations', {
      id: uuid(),
      game_id: gameId,
      user_id: ctx.user.id,
      annotations: args.annotations,
      created_at: now,
      updated_at: now,
    });
    await stmt(
      ctx.db,
      `INSERT INTO game_annotations (id, game_id, user_id, annotations, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id) DO UPDATE SET annotations = excluded.annotations, updated_at = excluded.updated_at
       WHERE game_annotations.user_id = excluded.user_id`,
      [row.id, row.game_id, row.user_id, row.annotations, row.created_at, row.updated_at],
    ).run();
    return null;
  }),
};

const benchmarks: RpcRegistry = {
  /** getBenchmarks: global table, readable by any signed-in user. */
  'benchmarks.list': userRpc<Args>(async (ctx, args) => {
    const kind = argOptString(args, 'kind');
    return kind
      ? all(ctx.db, 'SELECT * FROM benchmarks WHERE kind = ?', [kind], 'benchmarks')
      : all(ctx.db, 'SELECT * FROM benchmarks', [], 'benchmarks');
  }),
};

export const handlers: RpcRegistry = {
  ...games,
  ...blunders,
  ...endgameScenarios,
  ...annotations,
  ...benchmarks,
};
