import Stripe from 'stripe';
import { first, insertStmt, nowIso, updateStmt } from './db';

/**
 * Shared server code for the supporter tier ($60/year or $12/month; the
 * original $5/month price stays valid for its subscribers) (functions/api/stripe/*)
 * and the supporter-only articles. No route handlers here, so Pages doesn't
 * mount this file.
 *
 * The player comes from the better-auth session cookie (getSessionUser in
 * ./auth) and the `supporters` mirror lives in the app D1 (env.DB); there are
 * no client write paths to it, only these functions.
 */

export interface SupporterDbEnv {
  /** D1 `patternchess-app`. */
  DB: D1Database;
}

export interface StripeEnv extends SupporterDbEnv {
  /** Restricted key (rk_…): Customers, Checkout Sessions, Subscriptions, Customer portal. */
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  /** The original "PatternChess Supporter" $5/mo price; existing subscribers keep it. */
  STRIPE_PRICE_ID: string;
  /** $60/year ("$5 a month, billed annually"), the default plan. */
  STRIPE_PRICE_ID_ANNUAL?: string;
  /** $12/month. */
  STRIPE_PRICE_ID_MONTHLY?: string;
  /** The PatternChess Customer Portal configuration (bpc_…). */
  STRIPE_PORTAL_CONFIG_ID: string;
}

/** Statuses that carry the perks; keep in sync with supporter_badge() / the client's isSupporter. */
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

/**
 * Cross-site POSTs are refused (the session cookie is SameSite=Lax, so this is
 * belt and braces for the checkout/portal endpoints that create Stripe objects).
 */
export function crossSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== (request.headers.get('host') ?? new URL(request.url).host);
  } catch {
    return true;
  }
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

export async function supporterBy(
  env: SupporterDbEnv,
  column: 'user_id' | 'stripe_customer_id',
  value: string,
): Promise<SupporterRow | null> {
  // `column` is one of two literals, never user input.
  return first<SupporterRow>(env.DB, `SELECT * FROM supporters WHERE ${column} = ?`, [value], 'supporters');
}

/** Links a Stripe customer to a player before checkout; the first link wins. */
export async function linkCustomer(env: SupporterDbEnv, userId: string, customerId: string): Promise<SupporterRow> {
  const now = nowIso();
  await insertStmt(
    env.DB,
    'supporters',
    { user_id: userId, stripe_customer_id: customerId, status: 'none', created_at: now, updated_at: now },
    { onConflict: { target: ['user_id'] } },
  ).run();
  const row = await supporterBy(env, 'user_id', userId);
  if (!row) throw new Error('supporter row missing after insert');
  return row;
}

async function patchSupporter(env: SupporterDbEnv, userId: string, patch: Partial<SupporterRow>) {
  await updateStmt(env.DB, 'supporters', { ...patch, updated_at: nowIso() }, 'user_id = ?', [userId]).run();
}

type PriceEnv = Pick<StripeEnv, 'STRIPE_PRICE_ID' | 'STRIPE_PRICE_ID_ANNUAL' | 'STRIPE_PRICE_ID_MONTHLY'>;

/** Every supporter price this deployment knows: the legacy monthly, annual and monthly. */
export function supporterPriceIds(env: PriceEnv): Set<string> {
  return new Set(
    [env.STRIPE_PRICE_ID, env.STRIPE_PRICE_ID_ANNUAL, env.STRIPE_PRICE_ID_MONTHLY].filter((id): id is string => !!id),
  );
}

/** The Stripe price for a new checkout on `plan`, or null when this deployment lacks it. */
export function checkoutPriceId(env: PriceEnv, plan: 'annual' | 'monthly'): string | null {
  return (plan === 'annual' ? env.STRIPE_PRICE_ID_ANNUAL : env.STRIPE_PRICE_ID_MONTHLY) || null;
}

function hasPrice(sub: Stripe.Subscription, priceIds: Set<string>): boolean {
  return sub.items.data.some((item) => priceIds.has(item.price.id));
}

/**
 * Mirrors one subscription into `supporters`. Always re-reads the
 * subscription from Stripe, so events arriving out of order or twice leave
 * the same result. Subscriptions on any other product are ignored.
 */
export async function syncSubscription(env: StripeEnv, stripe: Stripe, subscriptionId: string): Promise<string> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (!hasPrice(sub, supporterPriceIds(env))) return 'ignored: other product';

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
    ...(perks && !row.first_supported_at ? { first_supported_at: nowIso() } : {}),
  });
  return `synced ${sub.id}: ${sub.status}`;
}
