import { badRequest, notFound, userRpc, type RpcRegistry, type UserRpcContext } from './core';
import { all, batch, first, insertStmt, nowIso, run, scalar, stmt, updateStmt, uuid } from '../db';
import { TABLES } from '../schema';

/**
 * Openings tab (theory-exit scan + its opening drills) and the repertoire.
 * Ports src/services/db/openingDeviations.ts and src/services/db/repertoire.ts;
 * every query is scoped by the session user (this replaces RLS).
 *
 * EPD prefix matches (`fen LIKE '<epd> %'` in Postgres) use a range on the
 * `(user_id, fen, kind)` unique index instead: SQLite's LIKE is
 * case-insensitive for ASCII, and FEN piece letters are case-significant.
 */

// --- argument checks ---------------------------------------------------------

type Row = Record<string, unknown>;

function argInt(args: Row, key: string, { min = 0, max = 10_000 } = {}): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(`${key} must be an integer in [${min}, ${max}]`);
  }
  return v;
}

function argStr(args: Row, key: string, maxLen = 200): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) throw badRequest(`${key} must be a string`);
  return v;
}

function argObject(args: Row, key: string): Row {
  const v = args[key];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${key} must be an object`);
  return v as Row;
}

/**
 * Keep only whitelisted columns; scalars only, except the table's JSON
 * columns. Unknown keys are refused so a typo can't silently drop a write.
 */
function pickColumns(table: string, obj: Row, allowed: ReadonlySet<string>): Row {
  const json = new Set(TABLES[table].json);
  const out: Row = {};
  for (const [col, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (!allowed.has(col)) throw badRequest(`${table}.${col} cannot be written here`);
    if (v !== null && typeof v === 'object' && !json.has(col)) throw badRequest(`${table}.${col} must be a scalar`);
    out[col] = v;
  }
  return out;
}

/** The EPD (first four FEN fields) as a `[lo, hi)` range over fens that start with `<epd> `. */
function epdRange(epd: string): [string, string] {
  // ' ' is 0x20 and '!' 0x21: every "<epd> …" sorts inside [<epd> , <epd>!).
  return [`${epd} `, `${epd}!`];
}

async function assertOwnGame(ctx: UserRpcContext, gameId: unknown): Promise<string> {
  if (typeof gameId !== 'string' || !gameId) throw badRequest('game_id must be a string');
  const ok = await scalar(ctx.db, 'SELECT 1 FROM games WHERE id = ? AND user_id = ?', [gameId, ctx.user.id]);
  if (!ok) throw notFound('Game not found');
  return gameId;
}

async function assertOwnBlunder(ctx: UserRpcContext, blunderId: unknown): Promise<void> {
  if (blunderId === null || blunderId === undefined) return;
  if (typeof blunderId !== 'string') throw badRequest('blunder_id must be a string');
  const ok = await scalar(ctx.db, 'SELECT 1 FROM blunders WHERE id = ? AND user_id = ?', [blunderId, ctx.user.id]);
  if (!ok) throw notFound('Drill not found');
}

// --- opening_deviations ------------------------------------------------------

/** Columns a theory walk (or a later eval / past-book update) may set. */
const DEVIATION_PATCH_COLS = new Set([
  'status',
  'ply',
  'move_number',
  'user_color',
  'fen_before',
  'epd_before',
  'played_uci',
  'played_san',
  'reason',
  'theory_moves',
  'position_games',
  'played_games',
  'played_mover_win_pct',
  'eval_before',
  'eval_after',
  'chances_lost',
  'classification',
  'eval_depth',
  'evaluated_at',
  'blunder_id',
  'opening_family',
  'opening_name',
  'eco',
  'book_tier',
  'book_end_ply',
  'past_book_checked_at',
]);
const DEVIATION_WALK_COLS = new Set([...DEVIATION_PATCH_COLS, 'game_id']);

/** Columns an opening drill insert may set (SR counters keep their defaults). */
const OPENING_DRILL_COLS = new Set([
  'game_id',
  'fen',
  'move_number',
  'played_move',
  'correct_moves',
  'eval_before',
  'eval_after',
  'eval_swing',
  'side_to_move',
  'phase',
  'kind',
  'drill_data',
  'analysis_depth',
  'deepened_at',
  'solution_line',
  'motifs',
]);

/**
 * A game the walk can take: never walked under this rule version, and its
 * side known. Synced games store `user_color` at insert; one without it waits
 * for analysis to write it (walked earlier, it would be stamped 'skipped' for
 * good). After analysis a still-unknown side really is unknown.
 *
 * Heal: before 2026-11-23 the walk ran on freshly synced games before their
 * side was known and stamped them 'skipped' (a skipped row with no
 * `user_color`). Once the game has its side, it is walked again. A row
 * skipped for a real reason (unreadable moves) carries its colour, so it is
 * never re-walked, and neither is a game whose side stays unknown.
 */
const UNCHECKED_GAMES_WHERE = `user_id = ? AND (
    ((opening_deviation_version IS NULL OR opening_deviation_version < ?)
      AND (user_color IS NOT NULL OR analyzed_at IS NOT NULL))
    OR (user_color IS NOT NULL AND EXISTS (
      SELECT 1 FROM opening_deviations d
      WHERE d.user_id = games.user_id AND d.game_id = games.id
        AND d.status = 'skipped' AND d.user_color IS NULL)))`;

const PAST_BOOK_FROM = `FROM opening_deviations d
  JOIN games g ON g.id = d.game_id AND g.user_id = d.user_id
  WHERE d.user_id = ? AND d.book_end_ply IS NOT NULL AND d.past_book_checked_at IS NULL
    AND g.analyzed_at IS NOT NULL`;

/** One opening group on the Openings tab: a family played as one colour. */
type OpeningGroup = { family: string; color: 'white' | 'black' };

function argGroup(args: Row): OpeningGroup | null {
  const v = args.group;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('group must be an object');
  const family = argStr(v as Row, 'family');
  const color = (v as Row).color;
  if (color !== 'white' && color !== 'black') throw badRequest('group.color must be white or black');
  return { family, color };
}

const groupParams = (g: OpeningGroup | null): string[] => (g ? [g.family, g.color] : []);

/** Games walked per opening group (one deviation row per game), for "most-played first". */
const FAMILY_RANK_CTE = `WITH family_rank AS (
  SELECT opening_family, user_color, count(*) AS n FROM opening_deviations
  WHERE user_id = ? AND status <> 'skipped' GROUP BY opening_family, user_color)`;
const FAMILY_RANK_JOIN = `LEFT JOIN family_rank r
  ON r.opening_family IS d.opening_family AND r.user_color IS d.user_color`;
const GROUP_WHERE = ' AND d.opening_family = ? AND d.user_color = ?';

const REPERTOIRE_COLS = 'id, user_id, color, epd, uci, san, created_at';

export const handlers: RpcRegistry = {
  /** Games whose theory walk is missing or predates `ruleVersion` (newest first). */
  'openings.uncheckedGames': userRpc<{ ruleVersion: number; limit: number }>(async (ctx, args) => {
    const ruleVersion = argInt(args, 'ruleVersion', { max: 1_000_000 });
    const limit = argInt(args, 'limit', { min: 1, max: 1000 });
    return all(
      ctx.db,
      // `played_at IS NULL DESC`: Postgres sorts NULLs first under DESC, SQLite last.
      `SELECT id, pgn, user_color, opening_family, opening_name, eco FROM games
       WHERE ${UNCHECKED_GAMES_WHERE}
       ORDER BY played_at IS NULL DESC, played_at DESC LIMIT ?`,
      [ctx.user.id, ruleVersion, limit],
      'games',
    );
  }),

  'openings.countUncheckedGames': userRpc<{ ruleVersion: number }>(async (ctx, args) => {
    const ruleVersion = argInt(args, 'ruleVersion', { max: 1_000_000 });
    return (
      (await scalar(ctx.db, `SELECT count(*) FROM games WHERE ${UNCHECKED_GAMES_WHERE}`, [ctx.user.id, ruleVersion])) ?? 0
    );
  }),

  /**
   * Upsert a game's theory walk (on `(user_id, game_id)`, overwriting every
   * column sent) and stamp the game with the rule version — one transaction.
   */
  'openings.saveWalk': userRpc<{ row: Row; ruleVersion: number }>(async (ctx, args) => {
    const ruleVersion = argInt(args, 'ruleVersion', { max: 1_000_000 });
    const row = pickColumns('opening_deviations', argObject(args, 'row'), DEVIATION_WALK_COLS);
    if (typeof row.status !== 'string') throw badRequest('row.status is required');
    const gameId = await assertOwnGame(ctx, row.game_id);
    await assertOwnBlunder(ctx, row.blunder_id);
    const update = Object.keys(row).filter((c) => c !== 'game_id').concat('rule_version');
    await batch(ctx.db, [
      insertStmt(
        ctx.db,
        'opening_deviations',
        { id: uuid(), created_at: nowIso(), ...row, user_id: ctx.user.id, rule_version: ruleVersion },
        { onConflict: { target: ['user_id', 'game_id'], update } },
      ),
      stmt(ctx.db, 'UPDATE games SET opening_deviation_version = ? WHERE id = ? AND user_id = ?', [
        ruleVersion,
        gameId,
        ctx.user.id,
      ]),
    ]);
    return null;
  }),

  /**
   * User exits still waiting for the engine: the most-played opening (family
   * and colour, by games walked) first, oldest first within it, so the first
   * opening's report fills in before the long tail. `group` narrows the queue
   * to one opening (the scan's priority group while sync analysis runs).
   */
  'openings.pendingEvals': userRpc<{ limit: number; group?: OpeningGroup }>(async (ctx, args) => {
    const limit = argInt(args, 'limit', { min: 1, max: 1000 });
    const group = argGroup(args);
    return all(
      ctx.db,
      `${FAMILY_RANK_CTE}
       SELECT d.* FROM opening_deviations d ${FAMILY_RANK_JOIN}
       WHERE d.user_id = ? AND d.status = 'user_left' AND d.evaluated_at IS NULL${group ? GROUP_WHERE : ''}
       ORDER BY coalesce(r.n, 0) DESC, d.created_at ASC, d.id ASC LIMIT ?`,
      [ctx.user.id, ctx.user.id, ...groupParams(group), limit],
      'opening_deviations',
    );
  }),

  'openings.countPendingEvals': userRpc(async (ctx) => {
    return (
      (await scalar(
        ctx.db,
        `SELECT count(*) FROM opening_deviations WHERE user_id = ? AND status = 'user_left' AND evaluated_at IS NULL`,
        [ctx.user.id],
      )) ?? 0
    );
  }),

  /** Patch one deviation row (engine score, past-book result). */
  'openings.updateDeviation': userRpc<{ id: string; patch: Row }>(async (ctx, args) => {
    const id = argStr(args, 'id');
    const patch = pickColumns('opening_deviations', argObject(args, 'patch'), DEVIATION_PATCH_COLS);
    if (Object.keys(patch).length === 0) throw badRequest('patch is empty');
    await assertOwnBlunder(ctx, patch.blunder_id);
    await updateStmt(ctx.db, 'opening_deviations', patch, 'id = ? AND user_id = ?', [id, ctx.user.id]).run();
    return null;
  }),

  /**
   * Rows whose opening continues past the book and hasn't been engine-scanned,
   * on analyzed games only — most-played opening first (as `pendingEvals`),
   * oldest first within it. Each row carries its game's `pgn`. `group`
   * narrows it to one opening.
   */
  'openings.pastBookQueue': userRpc<{ limit: number; group?: OpeningGroup }>(async (ctx, args) => {
    const limit = argInt(args, 'limit', { min: 1, max: 1000 });
    const group = argGroup(args);
    return all(
      ctx.db,
      `${FAMILY_RANK_CTE}
       SELECT d.*, g.pgn AS pgn ${PAST_BOOK_FROM}${group ? GROUP_WHERE : ''}
       ORDER BY (SELECT coalesce(max(r.n), 0) FROM family_rank r
                 WHERE r.opening_family IS d.opening_family AND r.user_color IS d.user_color) DESC,
                d.created_at ASC, d.id ASC LIMIT ?`,
      [ctx.user.id, ctx.user.id, ...groupParams(group), limit],
      'opening_deviations',
    );
  }),

  'openings.countPastBookQueue': userRpc(async (ctx) => {
    return (await scalar(ctx.db, `SELECT count(*) ${PAST_BOOK_FROM}`, [ctx.user.id])) ?? 0;
  }),

  /** Every non-skipped deviation row, newest first. */
  'openings.list': userRpc(async (ctx) => {
    return all(
      ctx.db,
      `SELECT * FROM opening_deviations WHERE user_id = ? AND status <> 'skipped'
       ORDER BY created_at DESC, id ASC`,
      [ctx.user.id],
      'opening_deviations',
    );
  }),

  /** The columns `countBookDepthGames` needs, for every non-skipped row. */
  'openings.bookDepthRows': userRpc(async (ctx) => {
    return all(
      ctx.db,
      `SELECT status, reason, ply, book_end_ply FROM opening_deviations
       WHERE user_id = ? AND status <> 'skipped' ORDER BY id`,
      [ctx.user.id],
    );
  }),

  /**
   * Id of an existing tactic/opening drill for this EPD (any move counters).
   * A retired opening drill found here is un-retired: it qualifies again.
   */
  'openings.findDrill': userRpc<{ epd: string }>(async (ctx, args) => {
    const [lo, hi] = epdRange(argStr(args, 'epd', 120));
    const row = await first<{ id: string; kind: string; retired_at: string | null }>(
      ctx.db,
      `SELECT id, kind, retired_at FROM blunders
       WHERE user_id = ? AND fen >= ? AND fen < ? AND kind IN ('tactic', 'opening') LIMIT 1`,
      [ctx.user.id, lo, hi],
    );
    if (!row) return null;
    if (row.kind === 'opening' && row.retired_at) {
      await run(ctx.db, 'UPDATE blunders SET retired_at = NULL WHERE id = ? AND user_id = ?', [row.id, ctx.user.id]);
    }
    return row.id;
  }),

  /** Whether this game's tactic analysis already flagged the position (EPD match). */
  'openings.hasTacticForGamePosition': userRpc<{ gameId: string; epd: string }>(async (ctx, args) => {
    const gameId = argStr(args, 'gameId');
    const [lo, hi] = epdRange(argStr(args, 'epd', 120));
    const hit = await scalar(
      ctx.db,
      `SELECT 1 FROM blunders
       WHERE user_id = ? AND fen >= ? AND fen < ? AND kind = 'tactic' AND game_id = ? LIMIT 1`,
      [ctx.user.id, lo, hi, gameId],
    );
    return hit != null;
  }),

  /**
   * Retire live opening drills no deviation row references any more. One
   * statement, so a partial read can never make a live drill look orphaned.
   * Returns how many were retired.
   */
  'openings.retireOrphanDrills': userRpc(async (ctx) => {
    const meta = await run(
      ctx.db,
      `UPDATE blunders SET retired_at = ?
       WHERE user_id = ? AND kind = 'opening' AND retired_at IS NULL
         AND id NOT IN (
           SELECT blunder_id FROM opening_deviations WHERE user_id = ? AND blunder_id IS NOT NULL
         )`,
      [nowIso(), ctx.user.id, ctx.user.id],
    );
    return meta.changes ?? 0;
  }),

  /** Insert one kind='opening' drill; its id, or null when `(user, fen, kind)` already existed. */
  'openings.insertDrill': userRpc<{ row: Row }>(async (ctx, args) => {
    const row = pickColumns('blunders', argObject(args, 'row'), OPENING_DRILL_COLS);
    if (row.kind !== 'opening') throw badRequest("row.kind must be 'opening'");
    if (typeof row.fen !== 'string' || !row.fen) throw badRequest('row.fen is required');
    if (row.game_id != null) await assertOwnGame(ctx, row.game_id);
    const now = nowIso();
    const inserted = await insertStmt(
      ctx.db,
      'blunders',
      { id: uuid(), created_at: now, next_drill_at: now, ...row, user_id: ctx.user.id },
      { onConflict: { target: ['user_id', 'fen', 'kind'] }, returning: ['id'] },
    ).first<{ id: string }>();
    return inserted?.id ?? null;
  }),

  // --- repertoire_moves ------------------------------------------------------

  /** Every saved repertoire move (both colours), oldest first. */
  'repertoire.list': userRpc(async (ctx) => {
    return all(
      ctx.db,
      `SELECT ${REPERTOIRE_COLS} FROM repertoire_moves WHERE user_id = ? ORDER BY created_at ASC`,
      [ctx.user.id],
      'repertoire_moves',
    );
  }),

  /** Save (or replace) the move for `(color, epd)`; returns the row. */
  'repertoire.upsert': userRpc<{ color: string; epd: string; uci: string; san: string }>(async (ctx, args) => {
    const color = argStr(args, 'color');
    if (color !== 'white' && color !== 'black') throw badRequest("color must be 'white' or 'black'");
    const epd = argStr(args, 'epd', 120);
    const uci = argStr(args, 'uci', 10);
    const san = argStr(args, 'san', 20);
    const row = await first(
      ctx.db,
      `INSERT INTO repertoire_moves (id, user_id, color, epd, uci, san, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, color, epd) DO UPDATE SET uci = excluded.uci, san = excluded.san
       RETURNING ${REPERTOIRE_COLS}`,
      [uuid(), ctx.user.id, color, epd, uci, san, nowIso()],
      'repertoire_moves',
    );
    return row;
  }),

  'repertoire.delete': userRpc<{ id: string }>(async (ctx, args) => {
    const id = argStr(args, 'id');
    await run(ctx.db, 'DELETE FROM repertoire_moves WHERE id = ? AND user_id = ?', [id, ctx.user.id]);
    return null;
  }),
};
