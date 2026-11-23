import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { RpcError } from './core';
import { registry } from './index';
import { handlers, MAX_LINK_IDS, type GameLinkRow } from './vault';
import { openTestD1, type TestD1 } from './testD1';

const alice: SessionUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', image: null, provider: 'google' };
const bob: SessionUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', image: null, provider: 'google' };

let db: TestD1;

function call<T = unknown>(name: string, user: SessionUser, args: Record<string, unknown> = {}): Promise<T> {
  const ctx = { db, env: { DB: db } as unknown as AppEnv, user, request: new Request('https://x'), waitUntil: () => {} };
  return handlers[name].handler(ctx, args) as Promise<T>;
}

function addUser(id: string, email: string) {
  const now = new Date().toISOString();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, email, now, now);
}

function addGame(id: string, userId: string, platform: string, externalId: string, timeControl: string | null) {
  db.sqlite
    .prepare(
      `INSERT INTO games (id, user_id, platform, username, opponent, pgn, external_game_id, time_control)
       VALUES (?, ?, ?, 'me', 'them', '1. e4 *', ?, ?)`,
    )
    .run(id, userId, platform, externalId, timeControl);
}

beforeEach(async () => {
  db = await openTestD1();
  addUser('u-alice', 'alice@example.com');
  addUser('u-bob', 'bob@example.com');
  addGame('g-li', 'u-alice', 'lichess', 'AbCd1234', '600+5');
  addGame('g-cc', 'u-alice', 'chess.com', '123456789', '1/86400');
  addGame('g-bob', 'u-bob', 'lichess', 'ZzZz9999', '180+0');
});
afterEach(() => db.close());

describe('vault.gameLinks', () => {
  it('is registered as a signed-in user RPC', () => {
    expect(registry['vault.gameLinks']?.auth).toBe('user');
  });

  it("returns the site game ids of the caller's games only", async () => {
    const rows = await call<GameLinkRow[]>('vault.gameLinks', alice, { ids: ['g-li', 'g-cc', 'g-bob', 'nope'] });
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'g-cc', platform: 'chess.com', external_game_id: '123456789', time_control: '1/86400' },
      { id: 'g-li', platform: 'lichess', external_game_id: 'AbCd1234', time_control: '600+5' },
    ]);
    const bobs = await call<GameLinkRow[]>('vault.gameLinks', bob, { ids: ['g-li', 'g-bob'] });
    expect(bobs.map((r) => r.id)).toEqual(['g-bob']);
  });

  it('chunks long id lists under the D1 parameter cap and dedupes', async () => {
    const ids = [...Array.from({ length: 250 }, (_, i) => `missing-${i}`), 'g-li', 'g-li'];
    const rows = await call<GameLinkRow[]>('vault.gameLinks', alice, { ids });
    expect(rows.map((r) => r.id)).toEqual(['g-li']);
  });

  it('answers an empty list without a query and rejects bad args', async () => {
    expect(await call('vault.gameLinks', alice, { ids: [] })).toEqual([]);
    await expect(call('vault.gameLinks', alice, {})).rejects.toBeInstanceOf(RpcError);
    await expect(call('vault.gameLinks', alice, { ids: [1, 2] })).rejects.toBeInstanceOf(RpcError);
    const tooMany = Array.from({ length: MAX_LINK_IDS + 1 }, (_, i) => `x${i}`);
    await expect(call('vault.gameLinks', alice, { ids: tooMany })).rejects.toBeInstanceOf(RpcError);
  });
});
