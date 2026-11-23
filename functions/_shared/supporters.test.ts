import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { syncSubscription, type StripeEnv, type SupporterRow } from './supporters';

const env: StripeEnv = {
  STRIPE_SECRET_KEY: 'rk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  STRIPE_PRICE_ID: 'price_pc',
  STRIPE_PORTAL_CONFIG_ID: 'bpc',
  SUPABASE_URL: 'https://db.example',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

function sub(over: Partial<{ id: string; status: string; price: string; cancel: boolean }> = {}) {
  return {
    id: over.id ?? 'sub_1',
    status: over.status ?? 'active',
    customer: 'cus_1',
    cancel_at_period_end: over.cancel ?? false,
    items: { data: [{ price: { id: over.price ?? 'price_pc' }, current_period_end: 1_800_000_000 }] },
  } as unknown as Stripe.Subscription;
}

function stripeWith(s: Stripe.Subscription) {
  return { subscriptions: { retrieve: vi.fn().mockResolvedValue(s) } } as unknown as Stripe;
}

/** Stubs PostgREST: GET returns `row`, PATCH bodies are collected. */
function stubSupabase(row: Partial<SupporterRow> | null) {
  const patches: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }
      const rows = row ? [{ user_id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: null, status: 'none', first_supported_at: null, cancel_at_period_end: false, current_period_end: null, ...row }] : [];
      return new Response(JSON.stringify(rows), { status: 200 });
    }),
  );
  return patches;
}

afterEach(() => vi.unstubAllGlobals());

describe('syncSubscription', () => {
  it('marks a new active subscription and stamps first_supported_at', async () => {
    const patches = stubSupabase({});
    await syncSubscription(env, stripeWith(sub()), 'sub_1');
    expect(patches[0]).toMatchObject({ status: 'active', stripe_subscription_id: 'sub_1', cancel_at_period_end: false });
    expect(patches[0].first_supported_at).toBeTruthy();
    expect(patches[0].current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it('keeps the original first_supported_at', async () => {
    const patches = stubSupabase({ status: 'active', stripe_subscription_id: 'sub_1', first_supported_at: '2026-01-01T00:00:00Z' });
    await syncSubscription(env, stripeWith(sub({ cancel: true })), 'sub_1');
    expect(patches[0]).toMatchObject({ cancel_at_period_end: true });
    expect(patches[0]).not.toHaveProperty('first_supported_at');
  });

  it('records a cancellation', async () => {
    const patches = stubSupabase({ status: 'active', stripe_subscription_id: 'sub_1', first_supported_at: '2026-01-01T00:00:00Z' });
    await syncSubscription(env, stripeWith(sub({ status: 'canceled' })), 'sub_1');
    expect(patches[0]).toMatchObject({ status: 'canceled' });
  });

  it('ignores subscriptions to other products on the same Stripe account', async () => {
    const patches = stubSupabase({});
    expect(await syncSubscription(env, stripeWith(sub({ price: 'price_findlocal' })), 'sub_1')).toMatch(/ignored/);
    expect(patches).toHaveLength(0);
  });

  it('ignores customers with no player', async () => {
    const patches = stubSupabase(null);
    expect(await syncSubscription(env, stripeWith(sub()), 'sub_1')).toMatch(/no player/);
    expect(patches).toHaveLength(0);
  });

  it('never lets an old subscription end a newer active one', async () => {
    const patches = stubSupabase({ status: 'active', stripe_subscription_id: 'sub_new' });
    expect(await syncSubscription(env, stripeWith(sub({ id: 'sub_old', status: 'canceled' })), 'sub_old')).toMatch(/superseded/);
    expect(patches).toHaveLength(0);
  });
});
