import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { RARITY_MIN_PLAYERS, computeRarity, handlers } from './achievements';
import { openTestD1, type TestD1 } from './testD1';
import { ACHIEVEMENTS } from '../../../src/lib/achievements';

let db: TestD1;
const user = (id: string): SessionUser => ({ id, email: `${id}@example.com`, name: id, image: null, provider: 'google' });

function call<T = unknown>(name: string, u: SessionUser, args: Record<string, unknown> = {}): Promise<T> {
  const ctx = { db, env: { DB: db } as unknown as AppEnv, user: u, request: new Request('https://x'), waitUntil: () => {} };
  return handlers[name].handler(ctx, args) as Promise<T>;
}

function addPlayer(id: string, trained: boolean) {
  const now = new Date().toISOString();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, `${id}@example.com`, now, now);
  if (trained) {
    db.sqlite
      .prepare('INSERT INTO training_sessions (id, user_id, local_date, started_at) VALUES (?, ?, ?, ?)')
      .run(`s-${id}`, id, now.slice(0, 10), now);
  }
}

const [A, B] = ACHIEVEMENTS.map((a) => a.id);

beforeEach(async () => {
  db = await openTestD1();
});
afterEach(() => db.close());

describe('achievements', () => {
  it('record keeps known ids once per player', async () => {
    addPlayer('p1', true);
    expect(await call('achievements.record', user('p1'), { ids: [A, A, 'made-up', B] })).toEqual({ recorded: 2 });
    await call('achievements.record', user('p1'), { ids: [A] });
    const rows = db.sqlite.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ? ORDER BY 1').all('p1');
    expect(rows.map((r) => (r as { achievement_id: string }).achievement_id).sort()).toEqual([A, B].sort());
  });

  it('rarity is the share of trained players holding each achievement', async () => {
    for (let i = 0; i < RARITY_MIN_PLAYERS; i++) {
      addPlayer(`p${i}`, true);
      await call('achievements.record', user(`p${i}`), { ids: i < 5 ? [A, B] : [A] });
    }
    // Never trained: not counted, even with unlocks.
    addPlayer('idle', false);
    await call('achievements.record', user('idle'), { ids: [A, B] });
    const r = await computeRarity(db as unknown as D1Database);
    expect(r.players).toBe(RARITY_MIN_PLAYERS);
    expect(r.pct[A]).toBe(100);
    expect(r.pct[B]).toBe(25);
  });

  it('hides percentages for a tiny sample', async () => {
    addPlayer('p1', true);
    await call('achievements.record', user('p1'), { ids: [A] });
    const r = await call<{ players: number; pct: Record<string, number> }>('achievements.rarity', user('p1'));
    expect(r).toMatchObject({ players: 1, pct: {} });
  });
});
