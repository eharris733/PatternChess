import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestD1, type TestD1 } from './rpc/testD1';
import { confirmEventDigest, subscribeEventDigest, unsubscribeEventDigest } from './eventDigest';

let db: TestD1;
beforeEach(async () => {
  db = await openTestD1();
});
afterEach(() => db.close());

const base = { country: 'US', region: 'MA', sourcePath: '/us/ma' };
const row = (email: string) =>
  db.sqlite.prepare('SELECT * FROM event_digest_subscribers WHERE lower(email) = lower(?)').get(email) as Record<string, unknown>;

describe('event digest subscribers', () => {
  it('subscribes as pending and asks for a confirmation', async () => {
    const r = await subscribeEventDigest(db, { email: ' A@Example.com ', ...base });
    expect(r).toMatchObject({ status: 'pending', send_confirm: true });
    expect(row('a@example.com')).toMatchObject({ email: 'A@Example.com', country: 'US', region: 'MA', source_path: '/us/ma' });
  });

  it('is case-insensitive and keeps tokens on a repeat', async () => {
    const a = await subscribeEventDigest(db, { email: 'a@example.com', ...base });
    const b = await subscribeEventDigest(db, { email: 'A@EXAMPLE.COM', ...base, region: 'NY' });
    expect(b.confirm_token).toBe(a.confirm_token);
    expect(row('a@example.com').region).toBe('NY');
    expect((db.sqlite.prepare('SELECT count(*) AS n FROM event_digest_subscribers').get() as { n: number }).n).toBe(1);
  });

  it('confirms, then a repeat subscribe reports active without a new mail', async () => {
    const a = await subscribeEventDigest(db, { email: 'a@example.com', ...base });
    expect(await confirmEventDigest(db, a.confirm_token)).toEqual({ country: 'US', region: 'MA' });
    const firstConfirmed = row('a@example.com').confirmed_at;
    expect(await confirmEventDigest(db, a.confirm_token)).toEqual({ country: 'US', region: 'MA' });
    expect(row('a@example.com').confirmed_at).toBe(firstConfirmed);
    expect(await subscribeEventDigest(db, { email: 'a@example.com', ...base })).toMatchObject({ status: 'active', send_confirm: false });
  });

  it('unsubscribes; confirm no longer works; re-subscribing re-pends with a new confirm token', async () => {
    const a = await subscribeEventDigest(db, { email: 'a@example.com', ...base });
    expect(await unsubscribeEventDigest(db, a.unsub_token)).toBe(true);
    expect(row('a@example.com').status).toBe('unsubscribed');
    expect(await confirmEventDigest(db, a.confirm_token)).toBeNull();
    const b = await subscribeEventDigest(db, { email: 'a@example.com', ...base, country: null });
    expect(b).toMatchObject({ status: 'pending', send_confirm: true, unsub_token: a.unsub_token });
    expect(b.confirm_token).not.toBe(a.confirm_token);
    expect(row('a@example.com')).toMatchObject({ unsubscribed_at: null, country: 'US' });
  });

  it('unknown tokens are no-ops', async () => {
    expect(await confirmEventDigest(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await unsubscribeEventDigest(db, '00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('rejects an invalid email', async () => {
    await expect(subscribeEventDigest(db, { email: 'nope', ...base })).rejects.toThrow(/invalid/);
  });
});
