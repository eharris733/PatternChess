import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { openTestD1, type TestD1 } from './rpc/testD1';
import { linkCustomer, supporterBy, syncSubscription, type StripeEnv } from './supporters';

// syncSubscription / linkCustomer against the real D1 schema (node:sqlite shim).

let db: TestD1;
let env: StripeEnv;

function seedUser(id: string) {
  const now = new Date().toISOString();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, `${id}@example.com`, now, now);
}

function seedSupporter(row: Record<string, unknown>) {
  const r = { user_id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: null, status: 'none', first_supported_at: null, ...row };
  db.sqlite
    .prepare('INSERT INTO supporters (user_id, stripe_customer_id, stripe_subscription_id, status, first_supported_at) VALUES (?, ?, ?, ?, ?)')
    .run(r.user_id, r.stripe_customer_id, r.stripe_subscription_id, r.status, r.first_supported_at);
}

function rowOf(userId = 'u1') {
  return supporterBy(env, 'user_id', userId);
}

function sub(over: Partial<{ id: string; status: string; price: string; cancel: boolean; customer: string }> = {}) {
  return {
    id: over.id ?? 'sub_1',
    status: over.status ?? 'active',
    customer: over.customer ?? 'cus_1',
    cancel_at_period_end: over.cancel ?? false,
    items: { data: [{ price: { id: over.price ?? 'price_pc' }, current_period_end: 1_800_000_000 }] },
  } as unknown as Stripe.Subscription;
}

function stripeWith(s: Stripe.Subscription) {
  return { subscriptions: { retrieve: vi.fn().mockResolvedValue(s) } } as unknown as Stripe;
}

beforeEach(async () => {
  db = await openTestD1();
  db.sqlite.exec('PRAGMA foreign_keys = ON');
  env = { DB: db, STRIPE_SECRET_KEY: 'rk_test', STRIPE_WEBHOOK_SECRET: 'whsec', STRIPE_PRICE_ID: 'price_pc', STRIPE_PORTAL_CONFIG_ID: 'bpc' };
  seedUser('u1');
});

afterEach(() => db.close());

describe('linkCustomer', () => {
  it('creates the row with status none', async () => {
    const row = await linkCustomer(env, 'u1', 'cus_1');
    expect(row).toMatchObject({ user_id: 'u1', stripe_customer_id: 'cus_1', status: 'none', cancel_at_period_end: false });
  });

  it('keeps the first link', async () => {
    await linkCustomer(env, 'u1', 'cus_1');
    const row = await linkCustomer(env, 'u1', 'cus_2');
    expect(row.stripe_customer_id).toBe('cus_1');
  });
});

describe('syncSubscription', () => {
  it('marks a new active subscription and stamps first_supported_at', async () => {
    seedSupporter({});
    expect(await syncSubscription(env, stripeWith(sub()), 'sub_1')).toBe('synced sub_1: active');
    const row = await rowOf();
    expect(row).toMatchObject({ status: 'active', stripe_subscription_id: 'sub_1', cancel_at_period_end: false });
    expect(row!.first_supported_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(row!.current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it('keeps the original first_supported_at', async () => {
    seedSupporter({ status: 'active', stripe_subscription_id: 'sub_1', first_supported_at: '2026-01-01T00:00:00.000Z' });
    await syncSubscription(env, stripeWith(sub({ cancel: true })), 'sub_1');
    const row = await rowOf();
    expect(row).toMatchObject({ cancel_at_period_end: true, first_supported_at: '2026-01-01T00:00:00.000Z' });
  });

  it('records a cancellation', async () => {
    seedSupporter({ status: 'active', stripe_subscription_id: 'sub_1', first_supported_at: '2026-01-01T00:00:00.000Z' });
    await syncSubscription(env, stripeWith(sub({ status: 'canceled' })), 'sub_1');
    expect((await rowOf())!.status).toBe('canceled');
  });

  it('ignores subscriptions to other products on the same Stripe account', async () => {
    seedSupporter({});
    expect(await syncSubscription(env, stripeWith(sub({ price: 'price_findlocal' })), 'sub_1')).toMatch(/ignored/);
    expect((await rowOf())!.status).toBe('none');
  });

  it('ignores customers with no player', async () => {
    seedSupporter({});
    expect(await syncSubscription(env, stripeWith(sub({ customer: 'cus_other' })), 'sub_1')).toMatch(/no player/);
    expect((await rowOf())!.status).toBe('none');
  });

  it('never lets an old subscription end a newer active one', async () => {
    seedSupporter({ status: 'active', stripe_subscription_id: 'sub_new' });
    expect(await syncSubscription(env, stripeWith(sub({ id: 'sub_old', status: 'canceled' })), 'sub_old')).toMatch(/superseded/);
    expect(await rowOf()).toMatchObject({ status: 'active', stripe_subscription_id: 'sub_new' });
  });
});
