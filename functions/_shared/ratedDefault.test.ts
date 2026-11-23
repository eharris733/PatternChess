import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfileForUser } from './auth';
import { openTestD1, type TestD1 } from './rpc/testD1';

// New accounts train on rated games only (2026-11-22 feedback). The column's
// SQL default stays 0 (SQLite can't change a default in place without a table
// rebuild), so defaultProfileRow is the source of truth: every profile insert
// goes through createProfileForUser.

let db: TestD1;

beforeEach(async () => {
  db = await openTestD1();
  for (const [id, email] of [
    ['u-new', 'new@example.com'],
    ['u-lich', 'knight@lichess.invalid'],
    ['u-old', 'old@example.com'],
  ]) {
    db.sqlite
      .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, id, email, new Date().toISOString(), new Date().toISOString());
  }
});

afterEach(() => db.close());

function ratedOnly(id: string): unknown {
  return (db.sqlite.prepare('SELECT preferred_rated_only AS v FROM profiles WHERE id = ?').get(id) as { v: unknown }).v;
}

describe('rated-only default', () => {
  it('a new Google or Lichess account trains on rated games only', async () => {
    expect(await createProfileForUser(db as unknown as D1Database, { id: 'u-new', email: 'new@example.com', name: 'New' })).toBe(true);
    expect(await createProfileForUser(db as unknown as D1Database, { id: 'u-lich', email: 'knight@lichess.invalid', name: 'Knight' })).toBe(true);
    expect(ratedOnly('u-new')).toBe(1);
    expect(ratedOnly('u-lich')).toBe(1);
  });

  it('an existing account keeps its choice', async () => {
    db.sqlite
      .prepare(
        "INSERT INTO profiles (id, referral_code, email_unsub_token, created_at, preferred_rated_only) VALUES ('u-old', 'oldcode1', 'tok-old', ?, 0)",
      )
      .run(new Date().toISOString());
    expect(await createProfileForUser(db as unknown as D1Database, { id: 'u-old', email: 'old@example.com', name: 'Old' })).toBe(false);
    expect(ratedOnly('u-old')).toBe(0);
  });
});
