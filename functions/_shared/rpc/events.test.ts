import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { RpcError } from './core';
import { handlers as eventHandlers, locationFromRequest } from './events';
import { handlers as profileHandlers, sanitizeProfilePatch } from './profile';
import { registry } from './index';
import { openTestD1, type TestD1 } from './testD1';

const alice: SessionUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', image: null, provider: 'google' };
const bob: SessionUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', image: null, provider: 'google' };

let db: TestD1;

function withCf(cf: Record<string, unknown> | undefined): Request {
  const req = new Request('https://x');
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  return req;
}

function call<T = unknown>(
  handlers: typeof profileHandlers,
  name: string,
  user: SessionUser,
  args: Record<string, unknown> = {},
  request = new Request('https://x'),
): Promise<T> {
  const ctx = { db, env: { DB: db } as unknown as AppEnv, user, request, waitUntil: () => {} };
  return handlers[name].handler(ctx, args) as Promise<T>;
}

function addUserWithProfile(id: string, email: string) {
  const now = new Date().toISOString();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, email, now, now);
  db.sqlite
    .prepare('INSERT INTO profiles (id, referral_code, email_unsub_token, created_at) VALUES (?, ?, ?, ?)')
    .run(id, `code${id.slice(-4)}`, `tok-${id}`, now);
}

beforeEach(async () => {
  db = await openTestD1();
  addUserWithProfile('u-alice', 'alice@example.com');
  addUserWithProfile('u-bob', 'bob@example.com');
});

afterEach(() => db.close());

describe('profiles.events_state', () => {
  it('is a new, nullable column that starts empty', () => {
    const row = db.sqlite.prepare('SELECT events_state FROM profiles WHERE id = ?').get('u-alice') as Record<string, unknown>;
    expect(row.events_state).toBeNull();
  });

  it('profile.update accepts a US state code and null, and rejects anything else', () => {
    expect(sanitizeProfilePatch({ events_state: 'MA' })).toEqual({ events_state: 'MA' });
    expect(sanitizeProfilePatch({ events_state: 'DC' })).toEqual({ events_state: 'DC' });
    expect(sanitizeProfilePatch({ events_state: null })).toEqual({ events_state: null });
    for (const bad of ['ma', 'XX', 'Massachusetts', 'ON', '', 7]) {
      expect(() => sanitizeProfilePatch({ events_state: bad })).toThrow(RpcError);
    }
  });

  it('writes the caller row only', async () => {
    const row = await call<Record<string, unknown>>(profileHandlers, 'profile.update', alice, {
      patch: { events_state: 'NJ' },
    });
    expect(row).toMatchObject({ id: 'u-alice', events_state: 'NJ' });
    const bobRow = db.sqlite.prepare('SELECT events_state FROM profiles WHERE id = ?').get('u-bob') as Record<string, unknown>;
    expect(bobRow.events_state).toBeNull();

    const cleared = await call<Record<string, unknown>>(profileHandlers, 'profile.update', alice, {
      patch: { events_state: null },
    });
    expect(cleared.events_state).toBeNull();
  });

  it('the D1 CHECK refuses lowercase or long codes written past the allowlist', () => {
    expect(() => db.sqlite.prepare("UPDATE profiles SET events_state = 'ma' WHERE id = 'u-alice'").run()).toThrow();
    expect(() => db.sqlite.prepare("UPDATE profiles SET events_state = 'MAS' WHERE id = 'u-alice'").run()).toThrow();
  });
});

describe('events.locate', () => {
  it('is registered as a signed-in RPC', () => {
    expect(registry['events.locate']?.auth).toBe('user');
  });

  it('returns the US state from Cloudflare geolocation', async () => {
    const loc = await call(eventHandlers, 'events.locate', bob, {}, withCf({ country: 'US', regionCode: 'MA' }));
    expect(loc).toEqual({ country: 'US', region: 'MA' });
  });

  it('gives no region outside the US, for unknown codes, or without cf data', () => {
    expect(locationFromRequest(withCf({ country: 'CA', regionCode: 'ON' }))).toEqual({ country: 'CA', region: null });
    expect(locationFromRequest(withCf({ country: 'US', regionCode: 'PR' }))).toEqual({ country: 'US', region: null });
    expect(locationFromRequest(withCf({ country: 'US' }))).toEqual({ country: 'US', region: null });
    expect(locationFromRequest(withCf(undefined))).toEqual({ country: null, region: null });
  });

  it('splits the UK into its home nations (events.patternchess.com country codes)', () => {
    expect(locationFromRequest(withCf({ country: 'GB', regionCode: 'SCT' }))).toEqual({ country: 'GB-SCT', region: null });
    expect(locationFromRequest(withCf({ country: 'GB', regionCode: 'ENG' }))).toEqual({ country: 'GB-ENG', region: null });
  });

  it('profile.update accepts covered countries only', () => {
    expect(sanitizeProfilePatch({ events_country: 'GB-ENG' })).toEqual({ events_country: 'GB-ENG' });
    expect(sanitizeProfilePatch({ events_country: null })).toEqual({ events_country: null });
    expect(() => sanitizeProfilePatch({ events_country: 'BR' })).toThrow(RpcError);
  });

  it('normalizes case', () => {
    expect(locationFromRequest(withCf({ country: 'us', regionCode: 'ny' }))).toEqual({ country: 'US', region: 'NY' });
  });
});
