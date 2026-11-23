import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { dispatchRpc } from './core';
import { handlers } from './openings';

/**
 * Runs the openings/repertoire handlers through dispatchRpc against an
 * in-memory SQLite built from the real D1 migrations, behind a minimal D1 shim.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = ['0002_auth.sql', '0001_app.sql'].map((f) => readFileSync(join(root, 'd1/migrations', f), 'utf8'));

type Val = string | number | null;

function d1(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string, params: Val[] = []): D1PreparedStatement => {
    const s = {
      bind: (...vals: Val[]) => prepare(sql, vals),
      all: async () => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }),
      first: async () => (sqlite.prepare(sql).all(...params)[0] as unknown) ?? null,
      run: async () => {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(r.changes) } };
      },
      raw: async () => [],
    };
    return s as unknown as D1PreparedStatement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const st of stmts) out.push(await st.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const alice: SessionUser = { id: 'u-alice', email: 'a@x.dev', name: 'Alice', image: null, provider: 'google' };
const bob: SessionUser = { id: 'u-bob', email: 'b@x.dev', name: 'Bob', image: null, provider: 'google' };

let sqlite: DatabaseSync;
let env: AppEnv;

async function call<T = unknown>(name: string, args: object, user: SessionUser | null = alice) {
  const res = await dispatchRpc(
    name,
    new Request('https://patternchess.com/api/rpc/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'patternchess.com' },
      body: JSON.stringify(args),
    }),
    env,
    () => {},
    { registry: handlers, getUser: async () => user, isAdmin: () => false },
  );
  const body = (await res.json()) as { data?: T; error?: { code: string; message: string } };
  return { status: res.status, data: body.data as T, error: body.error };
}

const EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';

function seedGame(id: string, userId: string, extra: Record<string, Val> = {}) {
  const row: Record<string, Val> = {
    id,
    user_id: userId,
    platform: 'lichess',
    username: 'me',
    opponent: 'them',
    pgn: `[Event "${id}"]\n\n1. e4 e5 *`,
    external_game_id: `ext-${id}`,
    ...extra,
  };
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO games (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
}

function seedBlunder(id: string, userId: string, fen: string, kind: string, extra: Record<string, Val> = {}) {
  const row: Record<string, Val> = {
    id,
    user_id: userId,
    fen,
    kind,
    move_number: 1,
    played_move: 'e7e5',
    eval_before: 0,
    eval_after: -50,
    eval_swing: 10,
    side_to_move: 'black',
    ...extra,
  };
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO blunders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
}

const walkRow = (gameId: string, extra: Record<string, unknown> = {}) => ({
  game_id: gameId,
  status: 'user_left',
  ply: 1,
  move_number: 1,
  user_color: 'black',
  fen_before: `${EPD} 0 1`,
  epd_before: EPD,
  played_uci: 'a7a6',
  played_san: 'a6',
  reason: 'not_in_book',
  theory_moves: [{ uci: 'e7e5', san: 'e5', games: 100 }],
  eval_before: null,
  evaluated_at: null,
  book_end_ply: null,
  past_book_checked_at: null,
  blunder_id: null,
  ...extra,
});

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const sql of MIGRATIONS) sqlite.exec(sql);
  const now = '2026-11-22T00:00:00.000Z';
  for (const u of [alice, bob]) {
    sqlite
      .prepare('INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(u.id, u.name, u.email!, now, now);
  }
  env = { DB: d1(sqlite) } as AppEnv;
  seedGame('g1', alice.id, { played_at: '2026-11-01T00:00:00.000Z', analyzed_at: now });
  seedGame('g2', alice.id, { played_at: '2026-11-02T00:00:00.000Z', opening_deviation_version: 3, user_color: 'black' });
  seedGame('g3', alice.id, { played_at: null, opening_deviation_version: 2, user_color: 'white' });
  seedGame('gb', bob.id, { played_at: '2026-11-03T00:00:00.000Z' });
});

describe('openings.* deviation scan', () => {
  it('lists unchecked games for the caller only, NULL played_at first like Postgres', async () => {
    const { data } = await call<{ id: string }[]>('openings.uncheckedGames', { ruleVersion: 3, limit: 10 });
    expect(data.map((g) => g.id)).toEqual(['g3', 'g1']);
    expect((await call('openings.countUncheckedGames', { ruleVersion: 3 })).data).toBe(2);
    expect((await call('openings.countUncheckedGames', { ruleVersion: 4 })).data).toBe(3);
  });

  it('holds back an unanalyzed game whose side is unknown until analysis writes it', async () => {
    seedGame('g4', alice.id, { played_at: '2026-11-05T00:00:00.000Z' }); // just synced, no user_color
    const before = await call<{ id: string }[]>('openings.uncheckedGames', { ruleVersion: 3, limit: 10 });
    expect(before.data.map((g) => g.id)).not.toContain('g4');
    expect((await call('openings.countUncheckedGames', { ruleVersion: 3 })).data).toBe(2);

    sqlite.prepare("UPDATE games SET user_color = 'black' WHERE id = 'g4'").run();
    const after = await call<{ id: string }[]>('openings.uncheckedGames', { ruleVersion: 3, limit: 10 });
    expect(after.data.map((g) => g.id)).toEqual(['g3', 'g4', 'g1']);
    expect((await call('openings.countUncheckedGames', { ruleVersion: 3 })).data).toBe(3);
  });

  it('re-walks games skipped only because their side was unknown at walk time', async () => {
    // g2 was walked (v3) before analysis knew the side: skipped, no colour on the row.
    await call('openings.saveWalk', { ruleVersion: 3, row: { game_id: 'g2', status: 'skipped', user_color: null } });
    // g5 was skipped for a real reason (unreadable moves) with its side known.
    seedGame('g5', alice.id, { played_at: '2026-11-06T00:00:00.000Z', user_color: 'white', analyzed_at: '2026-11-22T00:00:00.000Z' });
    await call('openings.saveWalk', { ruleVersion: 3, row: { game_id: 'g5', status: 'skipped', user_color: 'white' } });
    // g6: analyzed, side still unknown, skipped — nothing to heal.
    seedGame('g6', alice.id, { played_at: '2026-11-07T00:00:00.000Z', analyzed_at: '2026-11-22T00:00:00.000Z' });
    await call('openings.saveWalk', { ruleVersion: 3, row: { game_id: 'g6', status: 'skipped', user_color: null } });

    const ids = async () =>
      (await call<{ id: string }[]>('openings.uncheckedGames', { ruleVersion: 3, limit: 10 })).data.map((g) => g.id);
    expect(await ids()).toEqual(['g3', 'g2', 'g1']);
    expect((await call('openings.countUncheckedGames', { ruleVersion: 3 })).data).toBe(3);

    // Walked again with its side: healed, out of the queue.
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g2', { user_color: 'black' }) });
    expect(await ids()).toEqual(['g3', 'g1']);
    // Bob never sees Alice's heal rows.
    expect((await call<unknown[]>('openings.uncheckedGames', { ruleVersion: 3, limit: 10 }, bob)).data).toEqual([]);
  });

  it('refuses a bad limit and anonymous callers', async () => {
    expect((await call('openings.uncheckedGames', { ruleVersion: 3, limit: 'x' })).status).toBe(400);
    expect((await call('openings.countPendingEvals', {}, null)).status).toBe(401);
  });

  it('saveWalk upserts on (user, game), resets columns it is sent, and stamps the game', async () => {
    expect((await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1') })).status).toBe(200);
    const first = sqlite.prepare('SELECT * FROM opening_deviations').all() as Record<string, unknown>[];
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ user_id: alice.id, rule_version: 3, status: 'user_left' });
    expect(JSON.parse(first[0].theory_moves as string)).toEqual([{ uci: 'e7e5', san: 'e5', games: 100 }]);
    expect(sqlite.prepare("SELECT opening_deviation_version v FROM games WHERE id='g1'").get()).toEqual({ v: 3 });

    // Score it, then re-walk: the eval columns the walk sends come back NULL; id + created_at survive.
    await call('openings.updateDeviation', { id: first[0].id, patch: { eval_before: 10, evaluated_at: '2026-11-22T01:00:00Z' } });
    await call('openings.saveWalk', { ruleVersion: 4, row: walkRow('g1', { status: 'theory_end', book_end_ply: 8 }) });
    const again = sqlite.prepare('SELECT * FROM opening_deviations').all() as Record<string, unknown>[];
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({
      id: first[0].id,
      created_at: first[0].created_at,
      status: 'theory_end',
      rule_version: 4,
      eval_before: null,
      evaluated_at: null,
      book_end_ply: 8,
    });
  });

  it("refuses walks on someone else's game and unknown columns", async () => {
    expect((await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('gb') })).status).toBe(404);
    expect((await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1', { user_id: bob.id }) })).status).toBe(400);
    expect(sqlite.prepare('SELECT count(*) n FROM opening_deviations').get()).toEqual({ n: 0 });
  });

  it('pending evals, updateDeviation scoping, past-book queue over analyzed games', async () => {
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1') });
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g2', { status: 'theory_end', book_end_ply: 6 }) });
    const pending = await call<{ id: string; theory_moves: unknown }[]>('openings.pendingEvals', { limit: 10 });
    expect(pending.data).toHaveLength(1);
    expect(Array.isArray(pending.data[0].theory_moves)).toBe(true);
    expect((await call('openings.countPendingEvals', {})).data).toBe(1);

    // Bob can't touch Alice's row.
    await call('openings.updateDeviation', { id: pending.data[0].id, patch: { eval_before: 1 } }, bob);
    expect(sqlite.prepare('SELECT eval_before e FROM opening_deviations WHERE id = ?').get(pending.data[0].id)).toEqual({ e: null });

    await call('openings.updateDeviation', {
      id: pending.data[0].id,
      patch: { eval_before: 20, eval_after: -200, evaluated_at: '2026-11-22T02:00:00Z', book_end_ply: 4 },
    });
    expect((await call('openings.countPendingEvals', {})).data).toBe(0);

    // g1 is analyzed (in the queue); g2 isn't (excluded).
    const queue = await call<{ game_id: string; pgn: string; book_end_ply: number }[]>('openings.pastBookQueue', { limit: 10 });
    expect(queue.data.map((r) => [r.game_id, r.book_end_ply])).toEqual([['g1', 4]]);
    expect(queue.data[0].pgn).toContain('1. e4 e5');
    expect((await call('openings.countPastBookQueue', {})).data).toBe(1);

    await call('openings.updateDeviation', { id: pending.data[0].id, patch: { past_book_checked_at: '2026-11-22T03:00:00Z' } });
    expect((await call('openings.countPastBookQueue', {})).data).toBe(0);
  });

  it('queues put the most-played opening first and can narrow to one group', async () => {
    const now = '2026-11-22T00:00:00.000Z';
    // One Italian game as White, three Sicilians as Black (one already scored).
    seedGame('s1', alice.id, { analyzed_at: now });
    seedGame('s2', alice.id, { analyzed_at: now });
    seedGame('s3', alice.id, { analyzed_at: now });
    const italian = { opening_family: 'Italian Game', user_color: 'white' };
    const sicilian = { opening_family: 'Sicilian Defense', user_color: 'black' };
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1', { ...italian, book_end_ply: 6 }) });
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('s1', { ...sicilian, book_end_ply: 6 }) });
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('s2', sicilian) });
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('s3', { ...sicilian, evaluated_at: now }) });
    // The Italian row is the oldest, yet the Sicilian (3 games) leads.
    sqlite.prepare("UPDATE opening_deviations SET created_at = '2026-01-01T00:00:00.000Z' WHERE game_id = 'g1'").run();

    const pending = await call<{ game_id: string }[]>('openings.pendingEvals', { limit: 10 });
    const ids = pending.data.map((r) => r.game_id);
    expect([...ids.slice(0, 2)].sort()).toEqual(['s1', 's2']);
    expect(ids[2]).toBe('g1');
    const past = await call<{ game_id: string }[]>('openings.pastBookQueue', { limit: 10 });
    expect(past.data.map((r) => r.game_id)).toEqual(['s1', 'g1']);

    const only = { family: 'Italian Game', color: 'white' };
    const narrowed = await call<{ game_id: string }[]>('openings.pendingEvals', { limit: 10, group: only });
    expect(narrowed.data.map((r) => r.game_id)).toEqual(['g1']);
    const narrowedPast = await call<{ game_id: string }[]>('openings.pastBookQueue', { limit: 10, group: only });
    expect(narrowedPast.data.map((r) => r.game_id)).toEqual(['g1']);
    // Bob's queue stays empty, and a malformed group is refused.
    expect((await call<unknown[]>('openings.pendingEvals', { limit: 10 }, bob)).data).toEqual([]);
    expect((await call('openings.pendingEvals', { limit: 10, group: { family: 'x', color: 'red' } })).status).toBe(400);
    expect((await call('openings.pastBookQueue', { limit: 10, group: 'Sicilian' })).status).toBe(400);
  });

  it('list skips skipped rows; bookDepthRows returns the four columns', async () => {
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1') });
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g2', { status: 'skipped' }) });
    const list = await call<{ game_id: string }[]>('openings.list', {});
    expect(list.data.map((r) => r.game_id)).toEqual(['g1']);
    expect((await call<unknown[]>('openings.list', {}, bob)).data).toEqual([]);
    const depth = await call<Record<string, unknown>[]>('openings.bookDepthRows', {});
    expect(depth.data).toEqual([{ status: 'user_left', reason: 'not_in_book', ply: 1, book_end_ply: null }]);
  });
});

describe('openings.* drills', () => {
  it('findDrill matches by EPD prefix, case-sensitively, and un-retires opening drills', async () => {
    // Same letters, swapped case: a case-insensitive LIKE would match this.
    seedBlunder('b-case', alice.id, `${EPD.toUpperCase()} 0 1`, 'tactic');
    expect((await call('openings.findDrill', { epd: EPD })).data).toBeNull();

    seedBlunder('b-open', alice.id, `${EPD} 3 7`, 'opening', { retired_at: '2026-11-01T00:00:00.000Z' });
    seedBlunder('b-bob', bob.id, `${EPD} 0 1`, 'tactic');
    expect((await call('openings.findDrill', { epd: EPD })).data).toBe('b-open');
    expect(sqlite.prepare("SELECT retired_at r FROM blunders WHERE id='b-open'").get()).toEqual({ r: null });
    // An endgame row at the EPD doesn't count.
    seedBlunder('b-end', alice.id, `${EPD} 0 2`, 'endgame');
    expect((await call('openings.findDrill', { epd: EPD }, bob)).data).toBe('b-bob');
  });

  it('hasTacticForGamePosition checks game, kind and EPD', async () => {
    seedBlunder('b1', alice.id, `${EPD} 0 1`, 'tactic', { game_id: 'g1' });
    expect((await call('openings.hasTacticForGamePosition', { gameId: 'g1', epd: EPD })).data).toBe(true);
    expect((await call('openings.hasTacticForGamePosition', { gameId: 'g2', epd: EPD })).data).toBe(false);
    expect((await call('openings.hasTacticForGamePosition', { gameId: 'g1', epd: EPD }, bob)).data).toBe(false);
  });

  it('insertDrill inserts once (DO NOTHING on user, fen, kind) and only kind=opening', async () => {
    const row = {
      game_id: 'g1',
      fen: `${EPD} 0 1`,
      move_number: 1,
      played_move: 'a7a6',
      correct_moves: [{ move: 'e7e5', eval: 0 }],
      eval_before: 0,
      eval_after: -80,
      eval_swing: 12,
      side_to_move: 'black',
      phase: 'opening',
      kind: 'opening',
      drill_data: { source: 'book', v: 2 },
      analysis_depth: 18,
      deepened_at: '2026-11-22T00:00:00.000Z',
    };
    const a = await call<string>('openings.insertDrill', { row });
    expect(typeof a.data).toBe('string');
    expect((await call('openings.insertDrill', { row })).data).toBeNull();
    const stored = sqlite.prepare('SELECT * FROM blunders WHERE id = ?').get(a.data) as Record<string, unknown>;
    expect(stored).toMatchObject({ user_id: alice.id, kind: 'opening', cycle_number: 0, last_drill_failed: 0 });
    expect(JSON.parse(stored.drill_data as string)).toEqual({ source: 'book', v: 2 });
    expect(stored.next_drill_at).toBeTruthy();

    expect((await call('openings.insertDrill', { row: { ...row, kind: 'tactic' } })).status).toBe(400);
    expect((await call('openings.insertDrill', { row: { ...row, game_id: 'gb' } })).status).toBe(404);
    expect((await call('openings.insertDrill', { row: { ...row, times_correct: 5 } })).status).toBe(400);
  });

  it('retireOrphanDrills retires only unreferenced live opening drills of the caller', async () => {
    seedBlunder('o-ref', alice.id, `${EPD} 0 1`, 'opening');
    seedBlunder('o-orphan', alice.id, `${EPD} 0 2`, 'opening');
    seedBlunder('o-gone', alice.id, `${EPD} 0 3`, 'opening', { retired_at: '2026-01-01T00:00:00.000Z' });
    seedBlunder('t-1', alice.id, `${EPD} 0 4`, 'tactic');
    seedBlunder('o-bob', bob.id, `${EPD} 0 1`, 'opening');
    await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1', { blunder_id: 'o-ref' }) });

    expect((await call('openings.retireOrphanDrills', {})).data).toBe(1);
    const retired = sqlite
      .prepare('SELECT id FROM blunders WHERE retired_at IS NOT NULL ORDER BY id')
      .all()
      .map((r) => (r as { id: string }).id);
    expect(retired).toEqual(['o-gone', 'o-orphan']);
    expect((await call('openings.retireOrphanDrills', {})).data).toBe(0);
  });

  it("saveWalk refuses a blunder_id the caller doesn't own", async () => {
    seedBlunder('o-bob', bob.id, `${EPD} 0 1`, 'opening');
    expect((await call('openings.saveWalk', { ruleVersion: 3, row: walkRow('g1', { blunder_id: 'o-bob' }) })).status).toBe(404);
  });
});

describe('repertoire.*', () => {
  it('upserts on (user, color, epd), lists in order, deletes only own rows', async () => {
    const a = await call<Record<string, unknown>>('repertoire.upsert', { color: 'white', epd: EPD, uci: 'e7e5', san: 'e5' });
    expect(a.data).toMatchObject({ user_id: alice.id, color: 'white', epd: EPD, uci: 'e7e5', san: 'e5' });
    expect(Object.keys(a.data).sort()).toEqual(['color', 'created_at', 'epd', 'id', 'san', 'uci', 'user_id']);
    const b = await call<Record<string, unknown>>('repertoire.upsert', { color: 'white', epd: EPD, uci: 'c7c5', san: 'c5' });
    expect(b.data).toMatchObject({ id: a.data.id, created_at: a.data.created_at, uci: 'c7c5', san: 'c5' });
    await call('repertoire.upsert', { color: 'black', epd: EPD, uci: 'e7e6', san: 'e6' });
    await call('repertoire.upsert', { color: 'white', epd: EPD, uci: 'd7d5', san: 'd5' }, bob);

    const list = await call<{ uci: string }[]>('repertoire.list', {});
    expect(list.data.map((r) => r.uci).sort()).toEqual(['c7c5', 'e7e6']); // same-ms created_at ties

    await call('repertoire.delete', { id: a.data.id }, bob);
    expect((await call<unknown[]>('repertoire.list', {})).data).toHaveLength(2);
    await call('repertoire.delete', { id: a.data.id });
    expect((await call<unknown[]>('repertoire.list', {})).data).toHaveLength(1);

    expect((await call('repertoire.upsert', { color: 'red', epd: EPD, uci: 'a', san: 'a' })).status).toBe(400);
  });
});
