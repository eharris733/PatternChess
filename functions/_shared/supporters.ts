import Stripe from 'stripe';

/**
 * Shared server code for the $5/month supporter tier (functions/api/stripe/*).
 * No route handlers here, so Pages doesn't mount this file.
 */

export interface StripeEnv {
  /** Restricted key (rk_…): Customers, Checkout Sessions, Subscriptions, Customer portal. */
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  /** The "PatternChess Supporter" $5/mo price. */
  STRIPE_PRICE_ID: string;
  /** The PatternChess Customer Portal configuration (bpc_…). */
  STRIPE_PORTAL_CONFIG_ID: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** Statuses that carry the perks; keep in sync with is_supporter() (migration 20261124120000). */
export const PERK_STATUSES = new Set(['active', 'trialing', 'past_due']);

// Function responses don't get public/_headers — keep the page isolated.
const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...ISOLATION_HEADERS },
  });
}

export function stripeClient(env: StripeEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

export interface AuthedUser {
  id: string;
  email: string | null;
}

/** The signed-in player behind `Authorization: Bearer <supabase access token>`, or null. */
export async function authedUser(request: Request, env: StripeEnv): Promise<AuthedUser | null> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string | null };
  return user.id ? { id: user.id, email: user.email || null } : null;
}

export interface SupporterRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  first_supported_at: string | null;
}

/** PostgREST with the service role (bypasses RLS; `supporters` has no client write policies). */
async function rest(env: StripeEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${init.method ?? 'GET'} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  return res;
}

export async function supporterBy(
  env: StripeEnv,
  column: 'user_id' | 'stripe_customer_id',
  value: string,
): Promise<SupporterRow | null> {
  const res = await rest(env, `supporters?${column}=eq.${encodeURIComponent(value)}&select=*`);
  const rows = (await res.json()) as SupporterRow[];
  return rows[0] ?? null;
}

/** Links a Stripe customer to a player before checkout; the first link wins. */
export async function linkCustomer(env: StripeEnv, userId: string, customerId: string): Promise<SupporterRow> {
  await rest(env, 'supporters?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, stripe_customer_id: customerId }),
  });
  const row = await supporterBy(env, 'user_id', userId);
  if (!row) throw new Error('supporter row missing after insert');
  return row;
}

async function patchSupporter(env: StripeEnv, userId: string, patch: Partial<SupporterRow>) {
  await rest(env, `supporters?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

function hasPrice(sub: Stripe.Subscription, priceId: string): boolean {
  return sub.items.data.some((item) => item.price.id === priceId);
}

/**
 * Mirrors one subscription into `supporters`. Always re-reads the
 * subscription from Stripe, so events arriving out of order or twice leave
 * the same result. Subscriptions on other products (this Stripe account also
 * bills Find Local) are ignored.
 */
export async function syncSubscription(env: StripeEnv, stripe: Stripe, subscriptionId: string): Promise<string> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (!hasPrice(sub, env.STRIPE_PRICE_ID)) return 'ignored: other product';

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const row = await supporterBy(env, 'stripe_customer_id', customerId);
  if (!row) return `ignored: no player for ${customerId}`;

  // A stale event about an old subscription must not end a newer active one.
  if (
    row.stripe_subscription_id &&
    row.stripe_subscription_id !== sub.id &&
    PERK_STATUSES.has(row.status) &&
    !PERK_STATUSES.has(sub.status)
  ) {
    return 'ignored: superseded subscription';
  }

  const periodEnd = Math.max(...sub.items.data.map((item) => item.current_period_end ?? 0));
  const perks = PERK_STATUSES.has(sub.status);
  await patchSupporter(env, row.user_id, {
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_end: periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    ...(perks && !row.first_supported_at ? { first_supported_at: new Date().toISOString() } : {}),
  });
  return `synced ${sub.id}: ${sub.status}`;
}
