/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { dispatchRpc, RpcError, type UserRpcContext } from './core';
import { guardSrPatch, handlers, normalizeInsertRows, pickPatch } from './training';

/**
 * The training-data handlers (games / blunders / endgame scenarios /
 * annotations / benchmarks) against an in-memory SQLite built from the real
 * D1 migrations, behind a minimal D1 shim (batch() returns RETURNING rows like
 * D1 does).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = ['0002_auth.sql', '0001_app.sql'].map((f) => readFileSync(join(root, 'd1/migrations', f), 'utf8'));

type Val = string | number | null;

function d1(sqlite: DatabaseSync): D1Database {
  const exec = (sql: string, params: Val[]) => {
    const st = sqlite.prepare(sql);
    if (st.columns().length > 0) return { results: st.all(...params), success: true, meta: { changes: 0 } };
    const r = st.run(...params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const prepare = (sql: string, params: Val[] = []): D1PreparedStatement => {
    const s = {
      bind: (...vals: Val[]) => prepare(sql, vals),
      all: async () => exec(sql, params),
      first: async () => (sqlite.prepare(sql).all(...params)[0] as unknown) ?? null,
      run: async () => exec(sql, params),
      execSync: () => exec(sql, params),
    };
    return s as unknown as D1PreparedStatement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map((st) => (st as unknown as { execSync: () => unknown }).execSync());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const alice: SessionUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', image: null, provider: 'google' };
const bob: SessionUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', image: null, provider: 'google' };

let sqlite: DatabaseSync;
let db: D1Database;

function ctx(user: SessionUser): UserRpcContext {
  return { db, env: { DB: db } as AppEnv, user, request: new Request('https://x'), waitUntil: () => {} };
}

async function call<T = unknown>(user: SessionUser, name: string, args: object = {}): Promise<T> {
  const def = handlers[name];
  if (!def) throw new Error(`no handler ${name}`);
  return def.handler(ctx(user), args) as Promise<T>;
}

function game(ext: string, extra: Record<string, unknown> = {}) {
  return {
    platform: 'lichess',
    username: 'alice',
    opponent: 'opp',
    pgn: `1. e4 e5 *`,
    external_game_id: ext,
    time_control: '300+0',
    ...extra,
  };
}

function blunder(fen: string, extra: Record<string, unknown> = {}) {
  return {
    fen,
    move_number: 10,
    played_move: 'e4',
    eval_before: 100,
    eval_after: -200,
    eval_swing: 300,
    side_to_move: 'white',
    ...extra,
  };
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) sqlite.exec(m);
  const now = new Date().toISOString();
  for (const u of [alice, bob]) {
    sqlite
      .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .run(u.id, u.name, u.email!, now, now);
  }
  db = d1(sqlite);
});

describe('helpers', () => {
  it('normalizeInsertRows fills defaults, forces user_id, rejects unknown columns', () => {
    const [row] = normalizeInsertRows(
      [{ a: 1, user_id: 'evil' }],
      { id: () => 'x', a: () => undefined, b: () => 7 },
      ['a'],
      'me',
      'rows',
    );
    expect(row).toEqual({ id: 'x', a: 1, b: 7, user_id: 'me' });
    expect(() => normalizeInsertRows([{ zzz: 1 }], { a: () => 1 }, [], 'me', 'rows')).toThrow(RpcError);
    expect(() => normalizeInsertRows([{}], { a: () => undefined }, ['a'], 'me', 'rows')).toThrow(/required/);
  });

  it('pickPatch rejects columns outside the allow-list', () => {
    expect(pickPatch({ a: 1, b: undefined }, ['a', 'b'])).toEqual({ a: 1 });
    expect(() => pickPatch({ user_id: 'x' }, ['a'])).toThrow(RpcError);
  });
});

describe('games', () => {
  it('insert returns only newly inserted rows, decoded, with time_category derived', async () => {
    const first = await call<Record<string, unknown>[]>(alice, 'games.insert', {
      games: [game('g1', { rated: true, clock_per_ply: [10, 9] }), game('g2')],
    });
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({ user_id: alice.id, rated: true, clock_per_ply: [10, 9], external_game_id: 'g1' });
    expect(first[1].rated).toBe(false);
    expect(sqlite.prepare("SELECT time_category FROM games WHERE external_game_id = 'g1'").get()).toEqual({
      time_category: 'blitz',
    });
    // Same (user, platform, external id) again → ignored, not an error.
    const again = await call<unknown[]>(alice, 'games.insert', { games: [game('g1'), game('g3')] });
    expect(again.map((g) => (g as { external_game_id: string }).external_game_id)).toEqual(['g3']);
    // Bob can hold the same external id.
    expect(await call<unknown[]>(bob, 'games.insert', { games: [game('g1')] })).toHaveLength(1);
  });

  it('insert chunks under the 100-parameter limit', async () => {
    const many = Array.from({ length: 37 }, (_, i) => game(`m${i}`));
    expect(await call<unknown[]>(alice, 'games.insert', { games: many })).toHaveLength(37);
  });

  it('list is scoped, omits pgn, and sorts like Postgres (NULL played_at first)', async () => {
    await call(alice, 'games.insert', {
      games: [
        game('old', { played_at: '2026-01-01T00:00:00Z' }),
        game('new', { played_at: '2026-06-01T00:00:00+00:00' }),
        game('nodate'),
      ],
    });
    await call(bob, 'games.insert', { games: [game('bobs')] });
    const rows = await call<Record<string, unknown>[]>(alice, 'games.list');
    expect(rows.map((r) => r.platform && (r as { id: string }).id)).toHaveLength(3);
    expect(rows[0].played_at).toBeNull();
    expect(rows[1].played_at).toBe('2026-06-01T00:00:00.000Z');
    expect(rows[0]).not.toHaveProperty('pgn');
    expect(typeof rows[0].rated).toBe('boolean');
  });

  it('get 404s on another user’s game; byIds/scenarioGames skip it', async () => {
    const [g] = await call<{ id: string }[]>(bob, 'games.insert', { games: [game('b1')] });
    await expect(call(alice, 'games.get', { id: g.id })).rejects.toMatchObject({ status: 404 });
    expect(await call(alice, 'games.byIds', { ids: [g.id] })).toEqual([]);
    expect(await call<unknown[]>(bob, 'games.byIds', { ids: [g.id] })).toHaveLength(1);
    expect(await call(bob, 'games.scenarioGames', { ids: [g.id] })).toEqual([
      { id: g.id, platform: 'lichess', result: null, user_color: null },
    ]);
  });

  it('unanalyzed / unparsed / unclassified counts and analyzed stamps', async () => {
    const rows = await call<{ id: string }[]>(alice, 'games.insert', { games: [game('a'), game('b')] });
    expect(await call(alice, 'games.countUnanalyzed')).toBe(2);
    await call(alice, 'games.markAnalyzed', { gameId: rows[0].id });
    await call(bob, 'games.resetAnalyzed', { gameId: rows[0].id }); // not Bob's: no-op
    expect(await call(alice, 'games.countUnanalyzed')).toBe(1);
    expect(await call(alice, 'games.unanalyzedIds', { platform: 'lichess', username: 'alice' })).toEqual([rows[1].id]);
    expect(await call(alice, 'games.leftoverUnanalyzedIds', { limit: 5 })).toEqual([rows[1].id]);
    expect(await call(alice, 'games.countUnparsed')).toBe(2);
    await call(alice, 'games.updateMetadata', { gameId: rows[0].id, patch: { user_color: 'white', clock_per_ply: [5] } });
    expect(await call(alice, 'games.countUnparsed')).toBe(1);
    await expect(call(alice, 'games.updateMetadata', { gameId: rows[0].id, patch: { user_id: 'x' } })).rejects.toThrow();
    expect(await call(alice, 'games.count', { platform: 'lichess', username: 'alice' })).toBe(2);
    expect(await call(alice, 'games.totalCount')).toBe(2);
    expect(new Set(await call<string[]>(alice, 'games.externalIds', { platform: 'lichess' }))).toEqual(new Set(['a', 'b']));
  });

  it('applyOpenings keeps eco/name when NULL, overwrites family, scoped to the caller', async () => {
    const [a] = await call<{ id: string }[]>(alice, 'games.insert', {
      games: [game('a', { eco: 'C20', opening_name: 'Header name' })],
    });
    const [b] = await call<{ id: string }[]>(bob, 'games.insert', { games: [game('b')] });
    expect(await call(alice, 'games.countUnclassifiedOpenings')).toBe(1);
    const n = await call(alice, 'games.applyOpenings', {
      rows: [
        { id: a.id, eco: null, opening_name: null, opening_family: 'King Pawn' },
        { id: b.id, eco: 'B00', opening_name: 'x', opening_family: 'y' },
      ],
    });
    expect(n).toBe(1);
    const row = await call<Record<string, unknown>>(alice, 'games.get', { id: a.id });
    expect(row).toMatchObject({ eco: 'C20', opening_name: 'Header name', opening_family: 'King Pawn' });
    expect(row.opening_classified_at).toMatch(/Z$/);
    expect(await call(alice, 'games.unclassifiedOpenings', { limit: 10 })).toEqual([]);
  });

  it('delete / deleteMany count only the caller’s games and cascade blunders', async () => {
    const mine = await call<{ id: string }[]>(alice, 'games.insert', {
      games: Array.from({ length: 95 }, (_, i) => game(`d${i}`)),
    });
    const [theirs] = await call<{ id: string }[]>(bob, 'games.insert', { games: [game('x')] });
    await call(alice, 'blunders.insert', { blunders: [blunder('f1', { game_id: mine[0].id })] });
    expect(await call(alice, 'games.delete', { gameId: mine[0].id })).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM blunders').get()).toEqual({ n: 0 });
    const n = await call(alice, 'games.deleteMany', { ids: [...mine.slice(1).map((g) => g.id), theirs.id] });
    expect(n).toBe(94);
    expect(await call(bob, 'games.totalCount')).toBe(1);
  });

  it('playedSince filters by timestamp', async () => {
    await call(alice, 'games.insert', {
      games: [game('a', { played_at: '2026-11-20T10:00:00Z' }), game('b', { played_at: '2026-11-22T10:00:00Z' })],
    });
    expect(await call(alice, 'games.playedSince', { since: '2026-11-21T00:00:00.000Z' })).toEqual([
      '2026-11-22T10:00:00.000Z',
    ]);
    await expect(call(alice, 'games.playedSince', { since: 'nope' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('blunders', () => {
  it('insert fills defaults and ignores duplicates on (user, fen, kind)', async () => {
    const [g] = await call<{ id: string }[]>(alice, 'games.insert', { games: [game('a')] });
    await call(alice, 'blunders.insert', {
      blunders: [blunder('f1', { game_id: g.id, correct_moves: [{ move: 'd4', eval: 10 }] }), blunder('f2', { game_id: g.id })],
    });
    await call(alice, 'blunders.insert', { blunders: [blunder('f1', { game_id: g.id, move_number: 99 })] });
    const rows = await call<Record<string, unknown>[]>(alice, 'blunders.forGames', { gameIds: [g.id] });
    expect(rows).toHaveLength(2);
    const f1 = rows.find((r) => r.fen === 'f1')!;
    expect(f1).toMatchObject({
      move_number: 10,
      kind: 'tactic',
      phase: 'middlegame',
      motifs: [],
      correct_moves: [{ move: 'd4', eval: 10 }],
      last_drill_failed: false,
      cycle_number: 0,
      user_id: alice.id,
    });
    expect(await call(alice, 'blunders.countsByGame')).toEqual({ [g.id]: 2 });
    expect(await call(bob, 'blunders.countsByGame')).toEqual({});
    await expect(call(alice, 'blunders.insert', { blunders: [blunder('f3', { kind: 'weird' })] })).rejects.toThrow();
  });

  it('due queue, counts and live-id lookups respect retired/next_drill_at/kind', async () => {
    const past = '2026-01-01T00:00:00.000Z';
    const future = '2999-01-01T00:00:00.000Z';
    const [g] = await call<{ id: string }[]>(alice, 'games.insert', { games: [game('a')] });
    await call(alice, 'blunders.insert', {
      blunders: [
        blunder('due-tactic', { game_id: g.id, next_drill_at: past }),
        blunder('due-opening', { kind: 'opening', next_drill_at: past }),
        blunder('retired', { game_id: g.id, next_drill_at: past, retired_at: past }),
        blunder('later', { game_id: g.id, kind: 'endgame', next_drill_at: future }),
      ],
    });
    await call(bob, 'blunders.insert', { blunders: [blunder('bob', { next_drill_at: past })] });
    const due = await call<{ fen: string }[]>(alice, 'blunders.due');
    expect(due.map((b) => b.fen).sort()).toEqual(['due-opening', 'due-tactic']);
    expect(await call(alice, 'blunders.dueCount')).toBe(2);
    expect(await call(alice, 'blunders.dueCount', { excludeKind: 'opening' })).toBe(1);
    expect((await call<{ fen: string }>(alice, 'blunders.firstDueTactic')).fen).toBe('due-tactic');
    expect((await call<{ fen: string }>(bob, 'blunders.firstDueTactic')).fen).toBe('bob');
    expect(await call(alice, 'games.totalCount')).toBe(1);
    expect(await call(alice, 'blunders.dueBetweenCount', { from: '2998-12-31T00:00:00Z', to: '2999-01-02T00:00:00Z' })).toBe(1);
    expect(await call<string[]>(alice, 'blunders.liveIdsForGames', { gameIds: [g.id] })).toHaveLength(2);
    expect(await call<unknown[]>(alice, 'blunders.allLive')).toHaveLength(3);
    expect(await call<unknown[]>(alice, 'blunders.drillsOfKind', { kind: 'endgame' })).toHaveLength(1);
    const ids = (await call<{ id: string }[]>(alice, 'blunders.allLive')).map((b) => b.id);
    const bobIds = (await call<{ id: string }[]>(bob, 'blunders.allLive')).map((b) => b.id);
    expect(await call<unknown[]>(alice, 'blunders.byIds', { ids: [...ids, ...bobIds] })).toHaveLength(3);
  });

  it('upcoming (practice ahead) returns not-yet-due live rows, soonest first, scoped and narrowed', async () => {
    const past = '2026-01-01T00:00:00.000Z';
    await call(alice, 'blunders.insert', {
      blunders: [
        blunder('due', { next_drill_at: past }),
        blunder('t-soon', { next_drill_at: '2999-01-02T00:00:00.000Z' }),
        blunder('t-later', { next_drill_at: '2999-01-05T00:00:00.000Z' }),
        blunder('e-mid', { phase: 'endgame', next_drill_at: '2999-01-03T00:00:00.000Z' }),
        blunder('o-soon', { kind: 'opening', next_drill_at: '2999-01-01T00:00:00.000Z' }),
        blunder('retired', { next_drill_at: '2999-01-01T00:00:00.000Z', retired_at: past }),
      ],
    });
    await call(bob, 'blunders.insert', { blunders: [blunder('bob', { next_drill_at: '2999-01-01T00:00:00.000Z' })] });
    const fens = async (args: object) =>
      (await call<{ fen: string }[]>(alice, 'blunders.upcoming', args)).map((b) => b.fen);
    expect(await fens({})).toEqual(['o-soon', 't-soon', 'e-mid', 't-later']);
    expect(await fens({ limit: 2 })).toEqual(['o-soon', 't-soon']);
    expect(await fens({ excludeKind: 'opening' })).toEqual(['t-soon', 'e-mid', 't-later']);
    expect(await fens({ kind: 'opening' })).toEqual(['o-soon']);
    expect(await fens({ phase: 'endgame' })).toEqual(['e-mid']);
    expect(await call<unknown[]>(bob, 'blunders.upcoming', { kind: 'opening' })).toEqual([]);
    // A user id in args is ignored: the session user is the only scope.
    expect(await call<{ fen: string }[]>(bob, 'blunders.upcoming', { userId: alice.id })).toHaveLength(1);
    await expect(call(alice, 'blunders.upcoming', { kind: 'weird' })).rejects.toThrow();
    await expect(call(alice, 'blunders.upcoming', { phase: 'weird' })).rejects.toThrow();
  });

  it('updates are allow-listed and scoped; deletes report rows removed', async () => {
    await call(alice, 'blunders.insert', { blunders: [blunder('f1'), blunder('f2', { phase: 'endgame' })] });
    const [b1] = (await call<{ id: string; fen: string }[]>(alice, 'blunders.allLive')).filter((b) => b.fen === 'f1');
    await call(alice, 'blunders.updateAfterDrill', {
      id: b1.id,
      // A new row is due at once; one write climbs at most one rung (2 → 1).
      patch: { cycle_number: 2, last_drill_failed: true, next_drill_at: '2030-01-01T00:00:00+00:00' },
    });
    await call(bob, 'blunders.updateAfterDrill', { id: b1.id, patch: { cycle_number: 9 } });
    await expect(call(alice, 'blunders.updateAfterDrill', { id: b1.id, patch: { fen: 'x' } })).rejects.toThrow();
    await call(alice, 'blunders.setCorrectMoves', { id: b1.id, correctMoves: [{ move: 'Nf3', eval: 5 }] });
    await call(alice, 'blunders.updateEnrichment', { id: b1.id, patch: { solution_line: { pv: ['a'] }, motifs: ['fork'] } });
    const [row] = await call<Record<string, unknown>[]>(alice, 'blunders.byIds', { ids: [b1.id] });
    expect(row).toMatchObject({
      cycle_number: 1,
      last_drill_failed: true,
      next_drill_at: '2030-01-01T00:00:00.000Z',
      correct_moves: [{ move: 'Nf3', eval: 5 }],
      solution_line: { pv: ['a'] },
      motifs: ['fork'],
    });
    expect(await call<unknown[]>(alice, 'blunders.endgameCandidates')).toHaveLength(1);
    expect(await call(alice, 'blunders.countUnenriched')).toBe(1);
    expect(await call(alice, 'blunders.countForDeepening')).toBe(1);
    expect(await call(bob, 'blunders.delete', { id: b1.id })).toBe(0);
    expect(await call(alice, 'blunders.delete', { id: b1.id })).toBe(1);
  });

  it('forDeepening sorts NULL depth first, then newest', async () => {
    await call(alice, 'blunders.insert', {
      blunders: [
        blunder('d12', { solution_line: {}, analysis_depth: 12, created_at: '2026-01-03T00:00:00Z' }),
        blunder('null-old', { solution_line: {}, created_at: '2026-01-01T00:00:00Z' }),
        blunder('null-new', { solution_line: {}, created_at: '2026-01-02T00:00:00Z' }),
        blunder('done', { solution_line: {}, deepened_at: '2026-01-02T00:00:00Z' }),
      ],
    });
    const rows = await call<{ fen: string }[]>(alice, 'blunders.forDeepening', { limit: 10 });
    expect(rows.map((r) => r.fen)).toEqual(['null-new', 'null-old', 'd12']);
  });

  it('deleteForGame keeps opening items', async () => {
    const [g] = await call<{ id: string }[]>(alice, 'games.insert', { games: [game('a')] });
    await call(alice, 'blunders.insert', {
      blunders: [blunder('t', { game_id: g.id }), blunder('o', { game_id: g.id, kind: 'opening' })],
    });
    expect(await call(alice, 'blunders.deleteForGame', { gameId: g.id })).toBe(1);
    expect((await call<{ fen: string }[]>(alice, 'blunders.allLive')).map((b) => b.fen)).toEqual(['o']);
  });
});

describe('SR guard', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  const due = { cycle_number: 2, next_drill_at: '2026-11-22T12:00:00.000Z' };
  const notDue = { cycle_number: 2, next_drill_at: '2026-11-30T12:00:00.000Z' };
  const solve = { cycle_number: 3, times_correct: 5, times_attempted: 5, last_drill_failed: false, next_drill_at: '2026-12-14T12:00:00.000Z', last_drilled_at: now.toISOString() };

  it('a due row climbs one rung', () => {
    expect(guardSrPatch(due, solve, now)).toEqual(solve);
  });

  it('never climbs more than one rung per write', () => {
    expect(guardSrPatch(due, { ...solve, cycle_number: 4 }, now).cycle_number).toBe(3);
  });

  it('a row that is not due keeps its ladder; only the drill time lands', () => {
    expect(guardSrPatch(notDue, solve, now)).toEqual({ last_drilled_at: now.toISOString() });
  });

  it('a miss on a row that is not due still resets it', () => {
    const miss = { cycle_number: 0, last_drill_failed: true, times_attempted: 6, next_drill_at: '2026-11-24T12:00:00.000Z' };
    expect(guardSrPatch(notDue, miss, now)).toEqual(miss);
  });

  it('allows a little clock skew', () => {
    const soon = { cycle_number: 2, next_drill_at: '2026-11-23T12:05:00.000Z' };
    expect(guardSrPatch(soon, solve, now).cycle_number).toBe(3);
  });

  it('end to end: drilling a not-due position again and again never masters it', async () => {
    await call(alice, 'blunders.insert', { blunders: [blunder('g1', { next_drill_at: '2999-01-01T00:00:00.000Z', cycle_number: 1 })] });
    const [b] = await call<{ id: string }[]>(alice, 'blunders.allLive');
    for (let i = 0; i < 4; i++) {
      await call(alice, 'blunders.updateAfterDrill', {
        id: b.id,
        patch: { cycle_number: 2 + i, times_correct: 1 + i, next_drill_at: '2999-06-01T00:00:00.000Z' },
      });
    }
    const [row] = await call<Record<string, unknown>[]>(alice, 'blunders.byIds', { ids: [b.id] });
    expect(row).toMatchObject({ cycle_number: 1, next_drill_at: '2999-01-01T00:00:00.000Z' });
  });
});

describe('endgame scenarios', () => {
  it('upsert is first-write-wins per (user, game); SR updates are scoped', async () => {
    const [g] = await call<{ id: string }[]>(alice, 'games.insert', { games: [game('a')] });
    const scenario = { game_id: g.id, start_fen: 'fen', user_color: 'white', deserved_result: 'win', actual_result: 'loss' };
    await call(alice, 'endgameScenarios.upsert', { rows: [scenario] });
    await call(alice, 'endgameScenarios.upsert', { rows: [{ ...scenario, start_fen: 'other' }] });
    const [s] = await call<Record<string, unknown>[]>(alice, 'endgameScenarios.list');
    expect(s).toMatchObject({ start_fen: 'fen', status: 'pending', attempts: 0, last_drill_failed: false });
    expect(await call(alice, 'endgameScenarios.countUnverified')).toBe(1);
    await call(alice, 'endgameScenarios.markVerified', { id: s.id, verifyEvalCp: 412.4, retired: false });
    expect(await call(alice, 'endgameScenarios.countUnverified')).toBe(0);
    await call(alice, 'endgameScenarios.updateResult', { id: s.id, status: 'passed', attempts: 2 });
    await call(bob, 'endgameScenarios.updateSr', { id: s.id, patch: { cycle_number: 9 } });
    await call(alice, 'endgameScenarios.updateSr', { id: s.id, patch: { cycle_number: 1, last_drill_failed: true } });
    const [after] = await call<Record<string, unknown>[]>(alice, 'endgameScenarios.list');
    expect(after).toMatchObject({ status: 'passed', attempts: 2, verify_eval_cp: 412, cycle_number: 1, last_drill_failed: true });
    await call(alice, 'endgameScenarios.markVerified', { id: s.id, verifyEvalCp: 0, retired: true });
    expect(await call(alice, 'endgameScenarios.list')).toEqual([]);
    expect(await call(bob, 'endgameScenarios.unverified', { limit: 5 })).toEqual([]);
  });
});

describe('annotations + benchmarks', () => {
  it('save upserts on the caller’s own game only', async () => {
    const [g] = await call<{ id: string }[]>(alice, 'games.insert', { games: [game('a')] });
    await expect(call(bob, 'annotations.save', { gameId: g.id, annotations: [] })).rejects.toMatchObject({ status: 404 });
    await call(alice, 'annotations.save', { gameId: g.id, annotations: [{ moveNumber: 1, side: 'white', san: 'e4' }] });
    await call(alice, 'annotations.save', { gameId: g.id, annotations: [{ moveNumber: 2, side: 'black', san: 'e5' }] });
    const row = await call<Record<string, unknown>>(alice, 'annotations.get', { gameId: g.id });
    expect(row.annotations).toEqual([{ moveNumber: 2, side: 'black', san: 'e5' }]);
    expect(await call(bob, 'annotations.get', { gameId: g.id })).toBeNull();
  });

  it('benchmarks are global', async () => {
    sqlite.exec("INSERT INTO benchmarks VALUES ('k', 'b', 1.5, 10, NULL), ('j', 'b', 2, 3, 's')");
    expect(await call<unknown[]>(bob, 'benchmarks.list')).toHaveLength(2);
    expect(await call(bob, 'benchmarks.list', { kind: 'k' })).toEqual([
      { kind: 'k', bucket: 'b', value: 1.5, sample_size: 10, source: null },
    ]);
  });
});

describe('through dispatchRpc', () => {
  it('answers 401 without a session and { data } with one', async () => {
    const env = { DB: db } as AppEnv;
    const req = () =>
      new Request('https://patternchess.com/api/rpc/games.totalCount', {
        method: 'POST',
        headers: { host: 'patternchess.com', 'content-type': 'application/json' },
        body: '{}',
      });
    const deps = (user: SessionUser | null) => ({ registry: handlers, getUser: async () => user, isAdmin: () => false });
    expect((await dispatchRpc('games.totalCount', req(), env, () => {}, deps(null))).status).toBe(401);
    const ok = await dispatchRpc('games.totalCount', req(), env, () => {}, deps(alice));
    expect(await ok.json()).toEqual({ data: 0 });
  });
});
